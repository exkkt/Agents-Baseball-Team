import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../server.mjs';
import { Club, CLOCK_RATE } from '../dist/ballclub/sim.js';
import { AgentDirector } from '../dist/ballclub/brain.js';
import { STEP } from '../dist/ballclub/stepper.js';
import { DriveArchive } from '../dist/ballclub/drive-archive.js';

// メモリ上の模擬 Google Drive（実際の Google には接続しない）。appProperties・親フォルダ・種類で検索できる
function fakeDrive() {
  const files = new Map(); let seq = 0;
  const st = { files, uploads: 0, failUploads: 0, loseResponses: 0, mediaReads: 0 };
  const res = (j, status = 200) => new Response(JSON.stringify(j), { status, headers: { 'content-type': 'application/json' } });
  const match = (f, q) => {
    if (/trashed = false/.test(q) && f.meta.trashed) return false;
    for (const [, k, v] of q.matchAll(/appProperties has \{ key='([^']+)' and value='([^']+)' \}/g)) if (f.meta.appProperties?.[k] !== v) return false;
    for (const [, p] of q.matchAll(/'([^']+)' in parents/g)) if (!f.meta.parents?.includes(p)) return false;
    const mt = q.match(/mimeType = '([^']+)'/); if (mt && f.meta.mimeType !== mt[1]) return false;
    return true;
  };
  st.fetchFn = async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname === 'oauth2.googleapis.com') return res({ access_token: 'test-refreshed', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.file' });
    if (u.pathname === '/drive/v3/files' && init.method === 'POST') { const meta = JSON.parse(init.body), id = 'f' + ++seq; files.set(id, { meta: { ...meta, id }, content: null }); return res({ id, name: meta.name }); }
    if (u.pathname === '/drive/v3/files') { const q = u.searchParams.get('q'); return res({ files: [...files.values()].filter(f => match(f, q)).map(f => ({ id: f.meta.id, name: f.meta.name, appProperties: f.meta.appProperties, size: String(f.content?.length || 0) })) }); }
    if (u.pathname === '/upload/drive/v3/files') {
      if (st.failUploads > 0) { st.failUploads--; return res({ error: 'unavailable' }, 503); }
      const [, metaPart, body] = init.body.split(/--[0-9a-f]+\r\nContent-Type: application\/json[^\r]*\r\n\r\n/);
      const meta = JSON.parse(metaPart.split('\r\n')[0]), content = body.split('\r\n--')[0], id = 'f' + ++seq;
      files.set(id, { meta: { ...meta, id, mimeType: 'application/json' }, content }); st.uploads++;
      if (st.loseResponses > 0) { st.loseResponses--; throw Error('connection reset'); } // 保存は成功したが応答が届かない
      return res({ id, name: meta.name });
    }
    const m = u.pathname.match(/^\/drive\/v3\/files\/(\w+)$/);
    if (m && files.has(m[1])) { const f = files.get(m[1]); if (u.searchParams.get('alt') === 'media') { st.mediaReads++; return new Response(f.content, { status: 200 }); } return res({ mimeType: f.meta.mimeType, parents: f.meta.parents, appProperties: f.meta.appProperties, size: f.content?.length || 0, trashed: false }); }
    return res({}, 404);
  };
  return st;
}
async function withServer(run) {
  const dir = await mkdtemp(join(tmpdir(), 'ballclub-records-'));
  const credentialsPath = join(dir, 'credentials.json'), tokenPath = join(dir, 'private', 'token.json');
  await writeFile(credentialsPath, JSON.stringify({ installed: { client_id: 'test-client', client_secret: 'test-client-value' } }));
  await mkdir(join(dir, 'private'), { recursive: true });
  await writeFile(tokenPath, JSON.stringify({ access_token: 'test-access', refresh_token: 'test-refresh', expires_at: Date.now() + 3600000 }));
  const drive = fakeDrive(), app = createApp({ root: resolve('dist'), drive: { credentialsPath, downloads: dir, tokenPath, fetchFn: drive.fetchFn } });
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.address().port}`;
  try { await run({ base, drive }); } finally { await new Promise(r => app.close(r)); await rm(dir, { recursive: true, force: true }); }
}
const director = () => { const c = new Club({ seed: 21 }); const d = new AgentDirector({ seed: 21, mode: 'rules' }).start(c); const per = Math.round(1 / (STEP * CLOCK_RATE)); while (c.minutes < 1440 * 2 + 300) c.step(STEP); void per; return { c, d }; };

test('Drive records: unsent days are kept on failure, resent without duplicates, and never mixed into the save list', async () => withServer(async ({ base, drive }) => {
  const { d } = director();
  const ar = new DriveArchive({ base }); ar.connected = true;
  const pending = 2 + d.analyst.st.reports.length;
  assert.equal(d.records.outbox.filter(o => o.kind === 'records').length, 2);
  assert.equal(d.records.outbox.filter(o => o.kind === 'report').length, d.analyst.st.reports.length);
  assert.equal(d.records.outbox.length, pending, '閉じた2日分の記録と完成した全レポートが未送信');
  drive.failUploads = 1;
  let r = await ar.flush(d);
  assert.equal(r.sent, 0); assert.equal(d.records.outbox.length, pending, '失敗したら未送信のまま残す'); assert.equal(Object.keys(d.records.synced).length, 0, '保存できていないものを保存済みにしない');
  assert.ok(ar.last && !ar.last.ok);
  r = await ar.flush(d); assert.equal(r.waiting, true, '自動の再送は時間をおく');
  drive.loseResponses = 1;
  r = await ar.flush(d, { manual: true });
  assert.equal(r.sent, 0); assert.equal(drive.uploads, 1, 'Drive側には1件保存されたが、応答は届かなかった');
  r = await ar.flush(d, { manual: true });
  assert.equal(r.sent, pending); assert.equal(d.records.outbox.length, 0);
  assert.equal(drive.uploads, pending, '再送しても同じ日の記録は二重に作らない（1日目は1件だけ）');
  assert.equal([...drive.files.values()].filter(f => f.meta.appProperties?.day === '1' && f.meta.appProperties?.type === 'records').length, 1);
  assert.ok(Object.values(d.records.synced).some(s => s.duplicate), '既にあったものは「保存済み」と確認した');
  const types = [...drive.files.values()].map(f => f.meta.appProperties?.type || f.meta.appProperties?.ballclubPart || 'root');
  assert.ok(types.includes('records') && types.includes('report') && !types.includes('save'));
  const list = await fetch(base + '/api/drive/saves').then(x => x.json());
  assert.deepEqual(list.files, [], '保存一覧に記録ファイルは出ない');
  // 索引で日付を絞り込み、中身は必要な分だけ取得する（取得済みは再利用）
  const found = await ar.search({ fromDay: 2, toDay: 2, lineage: d.records.lineage });
  assert.equal(found.length, 1); assert.equal(found[0].day, 2);
  const a = await ar.fetchChunk(found[0].id), b = await ar.fetchChunk(found[0].id);
  assert.equal(a, b); assert.equal(drive.mediaReads, 1);
  assert.equal(a.day, 2); assert.ok(a.records.practice.length > 0);
  assert.equal(a.records.games.length, 1); assert.ok(a.records.games[0].game.complete);
  assert.ok(a.records.matches.length >= 9, '試合記録も日次チャンクで保存・取得できる');
  const other = await ar.search({ fromDay: 1, toDay: 9, lineage: 'someone-else' });
  assert.equal(other.length, 0, '別の進行（系統）の記録は混ぜない');
}));

test('Drive records: malformed payloads and foreign files are rejected', async () => withServer(async ({ base }) => {
  const post = (path, body) => fetch(base + '/api/drive/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
  assert.equal((await post('records/push', { kind: 'records', id: "x' or 1=1", payload: {} })).error, 'record');
  assert.equal((await post('records/push', { kind: 'script', id: 'a', payload: {} })).error, 'record');
  assert.equal((await post('records/fetch', { id: 'nope' })).ok, false);
}));
