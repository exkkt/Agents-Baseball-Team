import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../server.mjs';
import { Club } from '../dist/ballclub/sim.js';
import { AgentDirector } from '../dist/ballclub/brain.js';
import { assertSnapshot } from '../dist/ballclub/save-format.js';
import { DRIVE_SCOPE } from '../server/drive.mjs';

const sample = () => { const c = new Club({ seed: 21 }); return new AgentDirector({ mode: 'rules' }).start(c).serialize(); };
const post = (base, route, data) => fetch(base + '/api/drive/' + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
async function fixture(run) {
  const dir = await mkdtemp(join(tmpdir(), 'ballclub-drive-'));
  const credentialsPath = join(dir, 'credentials.json'), tokenPath = join(dir, 'private', 'token.json');
  // 以下の認証情報はすべて、外部に送らないテスト用の固定ダミー値。
  await writeFile(credentialsPath, JSON.stringify({ installed: { client_id: 'test-client', client_secret: 'test-client-value' } }));
  let calls = 0, exchanges = 0, refreshes = 0, folderCreated = false, saved = null, authForm;
  const response = (j, status = 200) => new Response(JSON.stringify(j), { status, headers: { 'content-type': 'application/json' } });
  const fetchFn = async (url, init = {}) => {
    calls++;
    const u = new URL(url);
    if (u.hostname === 'oauth2.googleapis.com') {
      const form = new URLSearchParams(init.body);
      assert.equal(form.get('client_id'), 'test-client');
      if (form.get('grant_type') === 'refresh_token') { refreshes++; return response({ access_token: 'test-refreshed', scope: DRIVE_SCOPE, expires_in: 3600 }); }
      exchanges++; authForm = form;
      return response({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600, scope: DRIVE_SCOPE });
    }
    assert.equal(u.hostname, 'www.googleapis.com');
    assert.match(init.headers.authorization, /^Bearer test-(access|refreshed)$/);
    if (u.pathname === '/drive/v3/files' && init.method === 'POST') { folderCreated = true; return response({ id: 'folder1', name: 'AI Agents Baseball Team' }); }
    if (u.pathname === '/drive/v3/files') {
      const q = u.searchParams.get('q');
      assert.match(q, /appProperties/);
      if (q.includes('application/vnd.google-apps.folder')) return response({ files: folderCreated ? [{ id: 'folder1', name: 'AI Agents Baseball Team' }] : [] });
      assert.match(q, /'folder1' in parents/);
      return response({ files: saved ? [{ id: 'save1', name: '保存テスト.json', appProperties: { day: '1' } }] : [] });
    }
    if (u.pathname === '/upload/drive/v3/files') {
      const text = init.body;
      assert.ok(!text.includes('test-client-value') && !text.includes('test-access') && !text.includes('test-refresh'));
      saved = JSON.parse(text.split('Content-Type: application/json\r\n\r\n')[1].split('\r\n--')[0]);
      return response({ id: 'save1', name: '保存テスト.json' });
    }
    if (u.pathname === '/drive/v3/files/save1' && u.searchParams.get('alt') === 'media') return response(saved);
    if (u.pathname === '/drive/v3/files/save1') return response({ mimeType: 'application/json', parents: ['folder1'], appProperties: { ballclub: 'ai-agents-baseball-team', type: 'save' }, size: JSON.stringify(saved).length });
    if (u.pathname === '/drive/v3/files/foreign') return response({ mimeType: 'application/json', parents: ['other'], appProperties: {} });
    throw Error('unexpected test request');
  };
  const options = { credentialsPath, downloads: dir, tokenPath, fetchFn };
  let app = createApp({ root: resolve('dist'), drive: options });
  const listen = async srv => { await new Promise(r => srv.listen(0, '127.0.0.1', r)); return `http://127.0.0.1:${srv.address().port}`; };
  let base = await listen(app);
  try { await run({ dir, tokenPath, get base() { return base; }, get calls() { return calls; }, get exchanges() { return exchanges; }, get refreshes() { return refreshes; }, get authForm() { return authForm; }, get saved() { return saved; }, restart: async () => { await new Promise(r => app.close(r)); app = createApp({ root: resolve('dist'), drive: options }); base = await listen(app); } }); }
  finally { await new Promise(r => app.close(r)); await rm(dir, { recursive: true, force: true }); }
}

async function connect(f) {
  const r = await fetch(f.base + '/api/drive/connect', { method: 'POST', redirect: 'manual' });
  assert.equal(r.status, 303);
  const auth = new URL(r.headers.get('location'));
  assert.equal(auth.origin, 'https://accounts.google.com'); assert.equal(auth.searchParams.get('scope'), DRIVE_SCOPE);
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  const callback = new URL(auth.searchParams.get('redirect_uri'));
  callback.search = new URLSearchParams({ state: auth.searchParams.get('state'), code: 'test-code' });
  const done = await fetch(callback, { redirect: 'manual', headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(done.status, 303);
  assert.equal(done.headers.get('location'), '/api/drive/done');
  const challenge = createHash('sha256').update(f.authForm.get('code_verifier')).digest('base64url');
  assert.equal(challenge, auth.searchParams.get('code_challenge'));
  return callback;
}

test('Drive: explicit OAuth + PKCE, no uploads before save, dedicated folder, save and load round trip, private tokens', async () => fixture(async f => {
  const st = await fetch(f.base + '/api/drive/status').then(r => r.json());
  assert.deepEqual(st, { ok: true, configured: true, connected: false, setupError: null });
  assert.equal(f.calls, 0, '状態確認でGoogleに通信しない');
  const cb = await connect(f);
  assert.equal(f.calls, 1, '認証だけではフォルダやファイルを作らない');
  assert.equal((await stat(f.tokenPath)).mode & 0o777, 0o600);
  assert.equal((await stat(join(f.dir, 'private'))).mode & 0o777, 0o700);
  assert.equal((await fetch(cb, { redirect: 'manual' })).status, 200);
  assert.equal(f.exchanges, 1, '認可コードの再利用を拒否');
  const noLeak = JSON.stringify(await fetch(f.base + '/api/drive/status').then(r => r.json()));
  assert.ok(!/test-client|test-access|test-refresh/.test(noLeak));
  const data = sample();
  const saved = await post(f.base, 'save', data).then(r => r.json());
  assert.equal(saved.ok, true); assert.deepEqual(f.saved, data);
  const list = await fetch(f.base + '/api/drive/saves').then(r => r.json());
  assert.equal(list.files[0].id, 'save1');
  const loaded = await post(f.base, 'load', { id: 'save1' }).then(r => r.json());
  assert.deepEqual(loaded.snapshot, data);
  const other = await post(f.base, 'load', { id: 'foreign' }).then(r => r.json());
  assert.equal(other.error, 'file');
  const bad = await post(f.base, 'save', { v: 1 }).then(r => r.json());
  assert.equal(bad.error, 'snapshot');
  const token = JSON.parse(await readFile(f.tokenPath, 'utf8')); token.expires_at = 0;
  await writeFile(f.tokenPath, JSON.stringify(token)); await f.restart();
  assert.equal((await fetch(f.base + '/api/drive/saves').then(r => r.json())).ok, true);
  assert.equal(f.refreshes, 1, '再起動後も認証を更新して利用する');
}));

test('Drive: cross-origin writes, wrong state, missing authorization, and private paths are rejected', async () => fixture(async f => {
  const r = await fetch(f.base + '/api/drive/connect', { method: 'POST', headers: { origin: 'https://example.com' }, redirect: 'manual' });
  assert.equal(r.status, 403); assert.equal(f.calls, 0);
  const denied = await fetch(f.base + '/api/drive/callback?state=wrong&code=test-code');
  assert.ok(!(await denied.text()).includes('test-code')); assert.equal(f.calls, 0);
  assert.equal((await post(f.base, 'save', sample()).then(r => r.json())).error, 'disconnected');
  for (const path of ['/.local/drive-token.json', '/server/drive.mjs', '/%2e%2e/server/drive.mjs']) assert.notEqual((await fetch(f.base + path)).status, 200);
  assert.equal((await fetch(f.base + '/ballclub/drive-ui.js')).status, 200);
}));

test('Drive: snapshot validation rejects malformed player state before replacing a save', () => {
  const data = sample(); assertSnapshot(data);
  data.trainees.aoki.ability.bat = 'bad'; assert.throws(() => assertSnapshot(data));
});
