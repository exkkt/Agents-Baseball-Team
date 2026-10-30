// Google の認証情報はサーバー内でのみ扱う。値や Google の生のエラーを返さない。
import { readFile, readdir, mkdir, writeFile, rename, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { assertSnapshot } from '../dist/ballclub/save-format.js';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const APP = 'ai-agents-baseball-team';
const MAX_BYTES = 5 * 1024 * 1024, RECORD_BYTES = 2 * 1024 * 1024;
const PARTS = { records: '記録（練習・睡眠・日別）', reports: '分析レポート' };
const fail = (code, status = 400) => Object.assign(new Error(code), { code, status });
const MESSAGES = {
  credentials: '接続設定が見つかりません。ダウンロードしたJSONの保存場所を確認してください。',
  multiple: '接続設定の候補が複数あります。BALLCLUB_GOOGLE_CREDENTIALSに使用するファイルのパスを指定してください。',
  desktop: 'デスクトップ アプリ用の接続設定が必要です。',
  state: '認証の受付期限が切れたか、別の接続画面です。もう一度接続してください。',
  denied: 'Googleへの接続は許可されませんでした。',
  auth: 'Googleへの接続を完了できませんでした。設定とテストユーザーを確認してください。',
  disconnected: 'Google Driveに接続してください。',
  scope: 'ファイルの保存権限が許可されていません。もう一度接続してください。',
  network: 'Googleと通信できませんでした。時間をおいて再度お試しください。',
  quota: 'Google側の利用制限に達しました。時間をおいて再度お試しください。',
  forbidden: 'この操作は球団アプリの画面から行ってください。',
  file: 'この球団アプリのセーブデータを選んでください。',
  snapshot: 'セーブデータの形式が正しくありません。',
  large: '保存データが大きすぎます（上限5MB）。',
  storage: '認証情報をPCに保存できませんでした。保存先の権限を確認してください。',
  busy: '保存処理中です。完了してから再度お試しください。',
  record: '記録の形式が正しくありません。',
  downloads: 'ダウンロードフォルダを読み取れませんでした。macOSのアクセス許可を確認するか、BALLCLUB_GOOGLE_CREDENTIALSに設定ファイルのパスを指定してください。'
};

export function createDrive({ credentialsPath = process.env.BALLCLUB_GOOGLE_CREDENTIALS, downloads = join(homedir(), 'Downloads'), tokenPath = join(process.cwd(), '.local', 'drive-token.json'), fetchFn = fetch, now = () => Date.now() } = {}) {
  let credentials, tokens, load, refreshing, pending, saving = false, pushing = Promise.resolve();
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
  const tokenForm = async values => {
    let r;
    try { r = await fetchFn('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values), signal: AbortSignal.timeout(20000) }); }
    catch { throw fail('network', 502); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw fail('auth', 401);
    if (j.scope && !j.scope.split(' ').includes(DRIVE_SCOPE)) throw fail('scope', 401);
    return { ...j, expires_at: now() + (Number(j.expires_in) || 3600) * 1000 };
  };
  async function locate() {
    if (credentialsPath) return credentialsPath;
    // macOS のアクセス許可待ちなどで一覧が返らないときは、待ち続けずに知らせる
    const names = await Promise.race([readdir(downloads).catch(() => []), new Promise((_, ng) => setTimeout(() => ng(fail('downloads')), 5000).unref?.())]);
    const candidates = names.filter(n => /^(client_secret.*|credentials.*|diamond-gm-oauth)\.json$/.test(n));
    if (candidates.length > 1) throw fail('multiple');
    if (!candidates.length) throw fail('credentials');
    return join(downloads, candidates[0]);
  }
  async function client() {
    if (credentials) return credentials;
    const path = await locate();
    let j;
    // アプリが使用するための読み込み。内容はログやレスポンスに出さない。
    try { j = JSON.parse(await readFile(path, 'utf8')); } catch { throw fail('credentials'); }
    if (!j.installed?.client_id) throw fail('desktop');
    credentials = j.installed;
    return credentials;
  }
  async function loadTokens() {
    load ??= (async () => {
      try { const j = JSON.parse(await readFile(tokenPath, 'utf8')); if (typeof j.refresh_token === 'string') tokens = j; }
      catch { /* 初回はまだ保存がない */ }
    })();
    await load;
  }
  async function persist(next) {
    const tmp = tokenPath + '.' + randomBytes(6).toString('hex') + '.tmp';
    try {
      await mkdir(dirname(tokenPath), { recursive: true, mode: 0o700 });
      await chmod(dirname(tokenPath), 0o700);
      await writeFile(tmp, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
      await rename(tmp, tokenPath);
      tokens = next;
    } catch { throw fail('storage', 500); }
  }
  async function access() {
    await loadTokens();
    if (!tokens?.refresh_token) throw fail('disconnected', 401);
    if (tokens.access_token && tokens.expires_at > now() + 60000) return tokens.access_token;
    refreshing ??= (async () => {
      const c = await client();
      const next = await tokenForm({ client_id: c.client_id, ...(c.client_secret ? { client_secret: c.client_secret } : {}), refresh_token: tokens.refresh_token, grant_type: 'refresh_token' });
      await persist({ ...tokens, ...next });
      return tokens.access_token;
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  async function api(path, init = {}) {
    const token = await access();
    let r;
    try { r = await fetchFn('https://www.googleapis.com/' + path, { ...init, headers: { ...init.headers, authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(30000) }); }
    catch { throw fail('network', 502); }
    if (!r.ok) {
      if (r.status === 401) { tokens.expires_at = 0; throw fail('disconnected', 401); }
      if (r.status === 429) throw fail('quota', 429);
      throw fail(r.status === 404 ? 'file' : r.status === 403 ? 'scope' : 'network', r.status === 403 ? 403 : 502);
    }
    return r;
  }
  async function query(q, fields, extra = {}) {
    return (await api('drive/v3/files?' + new URLSearchParams({ q, fields, pageSize: '100', ...extra }))).json();
  }
  const appQuery = `trashed = false and appProperties has { key='ballclub' and value='${APP}' }`;
  async function folder(create = false) {
    const j = await query(appQuery + " and mimeType = 'application/vnd.google-apps.folder'", 'files(id,name,webViewLink)');
    if (j.files?.length) return j.files[0];
    if (!create) return null;
    return (await api('drive/v3/files?fields=id,name,webViewLink', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'AI Agents Baseball Team', mimeType: 'application/vnd.google-apps.folder', appProperties: { ballclub: APP } }) })).json();
  }
  // 記録・レポートは球団専用フォルダの中のサブフォルダに種類を分けて置く（セーブの一覧には混ざらない）
  async function subfolder(part, create = false) {
    const root = await folder(create); if (!root) return null;
    const j = await query(`trashed = false and appProperties has { key='ballclubPart' and value='${APP}-${part}' } and '${root.id}' in parents and mimeType = 'application/vnd.google-apps.folder'`, 'files(id,name)');
    if (j.files?.length) return j.files[0];
    if (!create) return null;
    return (await api('drive/v3/files?fields=id,name', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: PARTS[part], mimeType: 'application/vnd.google-apps.folder', parents: [root.id], appProperties: { ballclubPart: `${APP}-${part}` } }) })).json();
  }
  const PART_OF = { records: 'records', report: 'reports' };
  function checkRecord(kind, id, payload) {
    const object = x => x && typeof x === 'object' && !Array.isArray(x);
    if (!PART_OF[kind] || typeof id !== 'string' || !/^[\w.-]{1,120}$/.test(id) || !object(payload)) throw fail('record');
    if (kind === 'records' && ['matches','games'].some(k => payload.records?.[k] != null && !Array.isArray(payload.records[k]))) throw fail('record');
    if (kind === 'records' && (payload.kind !== 'ballclub-records' || payload.chunk !== id || !Number.isInteger(payload.day) || !object(payload.records) || !['practice', 'sleeps', 'days', 'events'].every(k => Array.isArray(payload.records[k])))) throw fail('record');
    if (kind === 'report' && ('report-' + payload.id !== id || !Array.isArray(payload.facts) || !Array.isArray(payload.findings))) throw fail('record');
  }
  async function body(req, limit = MAX_BYTES) {
    if (!req.headers['content-type']?.startsWith('application/json')) throw fail('forbidden', 403);
    let n = 0; const parts = [];
    for await (const b of req) { n += b.length; if (n > limit) throw fail('large', 413); parts.push(b); }
    try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw fail('snapshot'); }
  }
  function sameOrigin(req) {
    const host = req.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return false;
    // Googleからのトップレベルのリダイレクトは、下のstate検証で保護する。
    if (req.method === 'GET' && /^\/api\/drive\/(callback|done)(\?|$)/.test(req.url)) return true;
    if (req.headers['sec-fetch-site'] === 'cross-site') return false;
    return !req.headers.origin || req.headers.origin === 'http://' + host;
  }
  function finish(res, message) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
    res.end(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Google Drive接続</title><body style="font:16px system-ui;padding:40px;line-height:1.8"><h1>Google Drive接続</h1><p>${message}</p><p>このタブを閉じ、球団の画面で「接続を確認」を押してください。</p></body></html>`);
  }
  return async function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/drive/')) return false;
    try {
      if (!sameOrigin(req)) throw fail('forbidden', 403);
      if (url.pathname === '/api/drive/status' && req.method === 'GET') {
        await loadTokens();
        let configured = false, setupError = null;
        try { await locate(); configured = true; } catch (e) { setupError = e.code || 'credentials'; }
        // 値もファイル名も返さず、状態だけ確認する。Googleには問い合わせない。
        json(res, 200, { ok: true, configured, connected: !!tokens?.refresh_token, setupError });
      } else if (url.pathname === '/api/drive/connect' && req.method === 'POST') {
        const c = await client(); await loadTokens();
        const verifier = randomBytes(48).toString('base64url'), state = randomBytes(32).toString('base64url');
        const redirect = 'http://' + req.headers.host + '/api/drive/callback';
        pending = { verifier, state, redirect, expires: now() + 10 * 60000 };
        const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        auth.search = new URLSearchParams({ client_id: c.client_id, redirect_uri: redirect, response_type: 'code', scope: DRIVE_SCOPE, access_type: 'offline', prompt: 'consent', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
        res.writeHead(303, { Location: auth.href, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); res.end();
      } else if (url.pathname === '/api/drive/callback' && req.method === 'GET') {
        const p = pending;
        if (!p || p.expires < now() || url.searchParams.get('state') !== p.state) throw fail('state');
        pending = null;
        if (url.searchParams.has('error') || !url.searchParams.get('code')) throw fail('denied');
        const c = await client();
        const next = await tokenForm({ client_id: c.client_id, ...(c.client_secret ? { client_secret: c.client_secret } : {}), code: url.searchParams.get('code'), code_verifier: p.verifier, redirect_uri: p.redirect, grant_type: 'authorization_code' });
        if (!next.refresh_token) throw fail('auth', 401);
        await persist(next);
        // 認可コードを履歴に残したまま画面を表示しない。
        res.writeHead(303, { Location: '/api/drive/done', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); res.end();
      } else if (url.pathname === '/api/drive/done' && req.method === 'GET') {
        finish(res, 'Google Driveへの接続設定を保存しました。ファイルはまだ送信していません。');
      } else if (url.pathname === '/api/drive/saves' && req.method === 'GET') {
        const f = await folder();
        if (!f) { json(res, 200, { ok: true, files: [] }); return true; }
        const page = url.searchParams.get('pageToken');
        // セーブだけを一覧にする（記録・レポートはサブフォルダにあり、種類も違う）
        const j = await query(appQuery + ` and appProperties has { key='type' and value='save' } and '${f.id}' in parents and mimeType = 'application/json'`, 'nextPageToken,files(id,name,createdTime,appProperties)', { orderBy: 'createdTime desc', ...(page ? { pageToken: page } : {}) });
        json(res, 200, { ok: true, files: j.files || [], nextPageToken: j.nextPageToken || null });
      } else if (url.pathname === '/api/drive/save' && req.method === 'POST') {
        if (saving) throw fail('busy', 409);
        saving = true;
        try {
          const data = await body(req); try { assertSnapshot(data); } catch { throw fail('snapshot'); }
          const f = await folder(true), boundary = randomBytes(20).toString('hex');
          const name = `球団セーブ_${data.day}日目_${new Date(now()).toISOString().replace(/[:.]/g, '-')}.json`;
          const meta = { name, parents: [f.id], mimeType: 'application/json', appProperties: { ballclub: APP, type: 'save', day: String(data.day) } };
          const upload = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}--\r\n`;
          const result = await (await api('upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', { method: 'POST', headers: { 'content-type': 'multipart/related; boundary=' + boundary }, body: upload })).json();
          json(res, 200, { ok: true, file: result });
        } finally { saving = false; }
      } else if (url.pathname === '/api/drive/load' && req.method === 'POST') {
        const { id } = await body(req);
        if (typeof id !== 'string' || !/^[\w-]{1,200}$/.test(id)) throw fail('file');
        const f = await folder(); if (!f) throw fail('file');
        const meta = await (await api(`drive/v3/files/${id}?fields=mimeType,parents,appProperties,size,trashed`)).json();
        if (meta.trashed || meta.mimeType !== 'application/json' || !meta.parents?.includes(f.id) || meta.appProperties?.ballclub !== APP || meta.appProperties?.type !== 'save') throw fail('file');
        if (Number(meta.size) > MAX_BYTES) throw fail('large', 413);
        const r = await api(`drive/v3/files/${id}?alt=media`);
        let bytes = 0; const chunks = [];
        for await (const chunk of r.body) { bytes += chunk.length; if (bytes > MAX_BYTES) throw fail('large', 413); chunks.push(chunk); }
        let data; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); assertSnapshot(data); } catch { throw fail('snapshot'); }
        json(res, 200, { ok: true, snapshot: data });
      } else if (url.pathname === '/api/drive/records/push' && req.method === 'POST') {
        // 記録1日分・レポート1件を送る。同じIDのファイルがすでにあれば作らずに返す（再送しても重複しない）
        const { kind, id, lineage = '', day = null, players = [], payload } = await body(req, RECORD_BYTES + 4096);
        checkRecord(kind, id, payload);
        if (typeof lineage !== 'string' || !/^[\w-]{0,40}$/.test(lineage)) throw fail('record');
        const run = pushing.then(async () => {
          const part = PART_OF[kind], f = await subfolder(part, true);
          const found = await query(appQuery + ` and appProperties has { key='chunk' and value='${id}' } and '${f.id}' in parents`, 'files(id,name)');
          if (found.files?.length) return { file: found.files[0], duplicate: true };
          const boundary = randomBytes(20).toString('hex'), name = kind === 'records' ? `記録_${day}日目_${id}.json` : `分析レポート_${payload.id}_${payload.createdDay}日目.json`;
          const meta = { name, parents: [f.id], mimeType: 'application/json', appProperties: { ballclub: APP, type: kind, chunk: id, lineage, day: String(day ?? payload.createdDay ?? ''), players: (Array.isArray(players) ? players : []).filter(p => /^\w{1,16}$/.test(p)).join(',').slice(0, 100) } };
          const upload = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(payload)}\r\n--${boundary}--\r\n`;
          return { file: await (await api('upload/drive/v3/files?uploadType=multipart&fields=id,name', { method: 'POST', headers: { 'content-type': 'multipart/related; boundary=' + boundary }, body: upload })).json(), duplicate: false };
        });
        pushing = run.catch(() => {});
        const r = await run;
        json(res, 200, { ok: true, file: r.file, duplicate: r.duplicate });
      } else if (url.pathname === '/api/drive/records/index' && req.method === 'GET') {
        // 検索用の小さな索引：ファイルの中身は取得せず、日付・対象選手などの付帯情報だけを返す
        const kind = url.searchParams.get('kind') === 'report' ? 'report' : 'records', lineage = url.searchParams.get('lineage') || '';
        if (!/^[\w-]{0,40}$/.test(lineage)) throw fail('record');
        const from = Number(url.searchParams.get('fromDay') ?? -Infinity), to = Number(url.searchParams.get('toDay') ?? Infinity);
        const f = await subfolder(PART_OF[kind]);
        if (!f) { json(res, 200, { ok: true, files: [] }); return true; }
        const files = []; let page = null, n = 0;
        do {
          const j = await query(appQuery + ` and appProperties has { key='type' and value='${kind}' }${lineage ? ` and appProperties has { key='lineage' and value='${lineage}' }` : ''} and '${f.id}' in parents`, 'nextPageToken,files(id,name,size,appProperties)', page ? { pageToken: page } : {});
          for (const x of j.files || []) { const day = Number(x.appProperties?.day); if (!(day >= from && day <= to)) continue; files.push({ id: x.id, chunk: x.appProperties?.chunk, day, players: (x.appProperties?.players || '').split(',').filter(Boolean), size: Number(x.size) || null }); }
          page = j.nextPageToken; n++;
        } while (page && n < 5);
        json(res, 200, { ok: true, files: files.sort((a, b) => a.day - b.day) });
      } else if (url.pathname === '/api/drive/records/fetch' && req.method === 'POST') {
        const { id } = await body(req);
        if (typeof id !== 'string' || !/^[\w-]{1,200}$/.test(id)) throw fail('file');
        const meta = await (await api(`drive/v3/files/${id}?fields=mimeType,parents,appProperties,size,trashed`)).json();
        const part = PART_OF[meta.appProperties?.type], f = part && await subfolder(part);
        if (!f || meta.trashed || meta.mimeType !== 'application/json' || !meta.parents?.includes(f.id) || meta.appProperties?.ballclub !== APP) throw fail('file');
        if (Number(meta.size) > RECORD_BYTES) throw fail('large', 413);
        const r = await api(`drive/v3/files/${id}?alt=media`);
        let bytes = 0; const chunks = [];
        for await (const chunk of r.body) { bytes += chunk.length; if (bytes > RECORD_BYTES) throw fail('large', 413); chunks.push(chunk); }
        let data; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail('record'); }
        json(res, 200, { ok: true, kind: meta.appProperties.type, data });
      } else json(res, 404, { ok: false, error: 'not_found', message: '操作が見つかりません。' });
    } catch (e) {
      const code = MESSAGES[e.code] ? e.code : 'network';
      if (url.pathname === '/api/drive/callback') finish(res, MESSAGES[code]);
      else json(res, e.status || 500, { ok: false, error: code, message: MESSAGES[code] });
    }
    return true;
  };
}
