// Driveの球団専用フォルダにある記録・レポートの送信と検索（ブラウザ側）。認証情報は扱わず、server/drive.mjs の /api/drive/records/* だけを使う。
// 送信：未送信分（outbox）を古い順に送り、成功した分だけ「保存済み」にする。同じIDは二度作られない（サーバー側でも確認）。DOM に依存しない
import { chunkFor } from './records.js';

export class DriveArchive {
  constructor({ fetchFn = (...a) => fetch(...a), base = '', local = null, now = () => Date.now() } = {}) {
    this.local = local; this.http = fetchFn; this.base = base; this.now = now;
    this.connected = false; this.index = {}; this.cache = new Map(); this.sending = false; this.last = null; this.retryAt = 0; this.backoff = 0;
  }
  available() { return this.connected; }
  async request(path, body) {
    const r = await this.http(this.base + '/api/drive/' + path, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45000) });
    const j = await r.json().catch(() => ({ ok: false, message: 'サーバーから応答を取得できませんでした。' }));
    if (!r.ok || !j.ok) { if (j.error === 'disconnected' || j.error === 'auth') this.connected = false; throw Object.assign(Error(j.message || 'Google Driveへの操作に失敗しました。'), { code: j.error || 'network' }); }
    return j;
  }
  // 索引（ファイルの付帯情報）は10分間使い回す。中身は一度取得したら同じセッション中は再利用する
  async search({ fromDay, toDay, lineage, kind = 'records' }) {
    const key = `${kind}:${lineage}`, hit = this.index[key];
    let files;
    if (hit && this.now() - hit.at < 600000) files = hit.files;
    else { files = (await this.request(`records/index?kind=${kind}&lineage=${encodeURIComponent(lineage || '')}`)).files; this.index[key] = { at: this.now(), files }; }
    return files.filter(f => f.day >= fromDay && f.day <= toDay).map(f => ({ ...f, cached: this.cache.has(f.id) }));
  }
  async fetchChunk(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    const j = await this.request('records/fetch', { id });
    if(this.cache.size>=8)this.cache.delete(this.cache.keys().next().value);
    this.cache.set(id, j.data); return j.data;
  }
  // 未送信分を送る。失敗したら残して、次の再送まで待つ（自動送信が有効なときだけ時間をおいて再送）
  async flush(director, { manual = false } = {}) {
    const store = director.records;
    if (this.sending || !store.outbox.length) return { sent: 0, left: store.outbox.length };
    if (!manual && this.now() < this.retryAt) return { sent: 0, left: store.outbox.length, waiting: true };
    this.sending = true; let sent = 0;
    try {
      while (store.outbox.length) {
        const item = store.outbox[0];
        let payload;
        try { payload = item.kind === 'records' ? (this.local ? await this.local.prepareChunk(store,item.day) : chunkFor(store,item.day)) : director.analyst.report(item.reportId); } catch(e) { this.last={ok:false,error:e.message}; break; }
        if (!payload) { this.last={ok:false,error:'送信する原本が見つかりません。送信待ちは保持しています。',id:item.id};break; }
        try {
          const j = await this.request('records/push', { kind: item.kind === 'records' ? 'records' : 'report', id: item.id, lineage: store.lineage, day: item.day ?? payload.createdDay, players: payload.players || [], payload });
          // 応答を受け取れたときだけ保存済みにする（重複だった場合も、Drive上にあることを確認できた）
          store.synced[item.id] = { fileId: j.file?.id || null, at: this.now(), duplicate: !!j.duplicate };
          const k = store.outbox.indexOf(item); if (k >= 0) store.outbox.splice(k, 1);
          sent++; this.backoff = 0; this.last = { ok: true, at: this.now(), id: item.id, duplicate: !!j.duplicate };
        } catch (e) {
          item.tries = (item.tries || 0) + 1; item.lastError = e.message;
          this.backoff = Math.min(600000, this.backoff ? this.backoff * 2 : 30000); this.retryAt = this.now() + this.backoff;
          this.last = { ok: false, at: this.now(), id: item.id, error: e.message };
          break;
        }
      }
    } finally { this.sending = false; }
    return { sent, left: store.outbox.length };
  }
}
// 小野アナリスト（analyst.js）に渡す、検索と取得だけの窓口
export function archiveAdapter(archive, local = null) {
  return { localAvailable: () => !!local?.available, available: () => archive.available() || !!local?.available, search: async q => {
    const results=await Promise.allSettled([local?.available?local.search(q):Promise.resolve([]),archive.available()&&!q.localOnly?archive.search(q):Promise.resolve([])]);
    const [a,b]=results.map(r=>r.status==='fulfilled'?r.value:[]);if(results.every(r=>r.status==='rejected'))throw Error('保存庫から過去記録を取得できません');
    const days=new Set(a.map(f=>f.day));return [...a,...b.filter(f=>!days.has(f.day))];
  }, fetch: id => id.startsWith('local:') && local ? local.fetchChunk(id) : archive.fetchChunk(id) };
}
