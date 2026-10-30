import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { resolve } from 'node:path';
import { createApp } from '../server.mjs';
import { LocalLLM } from '../dist/ballclub/llm.js';

const listen = srv => new Promise(r => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));
// Ollama の代わり。同時に処理している件数を数える
function fakeOllama() {
  const st = { active: 0, max: 0, calls: [] };
  const srv = http.createServer((req, res) => {
    if (req.url === '/api/tags') { res.end(JSON.stringify({ models: [{ name: 'fake:1' }] })); return; }
    let body = ''; req.on('data', d => body += d); req.on('end', async () => {
      const j = JSON.parse(body); st.calls.push(j); st.active++; st.max = Math.max(st.max, st.active);
      const user = j.messages[1].content;
      await new Promise(r => setTimeout(r, user.includes('SLOW') ? 1500 : 80));
      st.active--;
      if (user.includes('BAD')) { res.writeHead(500); res.end(JSON.stringify({ error: 'boom' })); return; }
      res.end(JSON.stringify({ message: { content: JSON.stringify({ blocks: [], reason: user }) }, eval_count: 5 }));
    });
  });
  return { srv, st };
}
const post = (base, user) => fetch(base + '/api/llm/decide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ system: 's', user, schema: { type: 'object' } }) }).then(r => r.json());

test('adapter: one shared model, one inference at a time, structured request, status', async () => {
  const f = fakeOllama(), fb = await listen(f.srv);
  const app = createApp({ root: resolve('dist'), ollama: fb, model: 'fake:1', timeoutMs: 800 }), base = await listen(app);
  try {
    const st = await fetch(base + '/api/llm/status').then(r => r.json());
    assert.equal(st.ok, true); assert.equal(st.installed, true); assert.equal(st.model, 'fake:1');
    const rs = await Promise.all(['a', 'b', 'c', 'd'].map(u => post(base, u)));
    assert.ok(rs.every(r => r.ok)); assert.equal(f.st.max, 1, 'Ollama へは同時に1件だけ');
    assert.ok(f.st.calls.every(c => c.model === 'fake:1' && c.stream === false && c.format && c.think === false), '共有モデル・構造化出力');
    const slow = await post(base, 'SLOW'); assert.equal(slow.ok, false); assert.equal(slow.error, 'timeout');
    const bad = await post(base, 'BAD'); assert.equal(bad.ok, false); assert.equal(bad.error, 'http');
    const r = await fetch(base + '/api/llm/decide', { method: 'POST', body: '{"user":1}' }).then(r => r.json()); assert.equal(r.ok, false);
    assert.equal((await fetch(base + '/ballclub.html')).status, 200, '静的ファイルは従来どおり');
    assert.notEqual((await fetch(base + '/%2e%2e/package.json')).status, 200, 'dist の外は返さない');
    // クライアント側：成功・失敗を区別して返す
    const llm = new LocalLLM({ base });
    assert.equal((await llm.status()).ok, true);
    const ok = await llm.decide({ system: 's', user: 'hello', schema: { type: 'object' } }); assert.equal(ok.ok, true); assert.match(ok.text, /hello/);
    const ng = await llm.decide({ system: 's', user: 'BAD', schema: { type: 'object' } }); assert.equal(ng.ok, false);
  } finally { app.close(); f.srv.close(); }
});

test('adapter: Ollama unreachable -> connect error and status not ok (nothing pretends to succeed)', async () => {
  const app = createApp({ root: resolve('dist'), ollama: 'http://127.0.0.1:9', model: 'fake:1', timeoutMs: 800 }), base = await listen(app);
  try {
    const st = await fetch(base + '/api/llm/status').then(r => r.json()); assert.equal(st.ok, false); assert.equal(st.installed, false);
    const r = await post(base, 'x'); assert.equal(r.ok, false); assert.equal(r.error, 'connect');
    const llm = new LocalLLM({ base }); await llm.status();
    assert.equal(llm.available, false);
    const d = await llm.decide({ system: 's', user: 'x', schema: {} }); assert.equal(d.ok, false); assert.equal(d.error, 'connect');
  } finally { app.close(); }
  const gone = new LocalLLM({ base: 'http://127.0.0.1:9' });
  assert.equal((await gone.status()).ok, false);
  assert.equal((await gone.decide({ system: 's', user: 'x', schema: {} })).ok, false);
});
