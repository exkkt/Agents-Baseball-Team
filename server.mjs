import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBaseball } from './server/baseball.mjs';
import { createDrive } from './server/drive.mjs';

// ローカル専用の静的サーバー＋LLMアダプター。ブラウザは Ollama に直接つながず、/api/llm/* だけを使う。
// モデルは全員で 1 つを共有し、推論は同時に 1 件だけ Ollama へ送る（残りはここで順番待ち）
export function createApp({ root = resolve('dist'), ollama = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434', model = process.env.BALLCLUB_MODEL || 'gemma4:26b', timeoutMs = Number(process.env.BALLCLUB_LLM_TIMEOUT_MS) || 60000, maxWaiting = 8, drive = {}, baseball = {} } = {}) {
  const handleDrive = createDrive(drive), handleBaseball = createBaseball(baseball);
  let busy = false; const waiting = [];
  const acquire = () => new Promise((ok, ng) => { if (!busy) { busy = true; ok(); } else if (waiting.length >= maxWaiting) ng(Object.assign(Error('queue full'), { code: 'busy' })); else waiting.push(ok); });
  const release = () => { const next = waiting.shift(); if (next) next(); else busy = false; };
  const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  const readBody = req => new Promise((ok, ng) => { let n = 0; const parts = []; req.on('data', d => { n += d.length; if (n > 64 * 1024) { ng(Error('too large')); req.destroy(); } else parts.push(d); }); req.on('end', () => ok(Buffer.concat(parts).toString('utf8'))); req.on('error', ng); });

  async function chat(body, think) {
    const r = await fetch(ollama + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs), body: JSON.stringify({ model, stream: false, ...(think === false ? { think: false } : {}), format: body.schema, keep_alive: '30m', options: { temperature: 0.6, num_predict: 500 }, messages: [{ role: 'system', content: body.system }, { role: 'user', content: body.user }] }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(Error(j.error || `HTTP ${r.status}`), { code: /not found/i.test(j.error || '') ? 'model' : /think/i.test(j.error || '') ? 'think' : 'http' });
    return j;
  }
  async function decide(req, res) {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { ok: false, error: 'http', detail: '要求を読めない' }); }
    if (typeof body?.system !== 'string' || typeof body?.user !== 'string' || !body.schema || typeof body.schema !== 'object') return json(res, 400, { ok: false, error: 'http', detail: 'system・user・schema が必要' });
    const t0 = Date.now();
    try { await acquire(); } catch (e) { return json(res, 503, { ok: false, error: e.code || 'busy', detail: '待ちが多すぎる' }); }
    const waitedMs = Date.now() - t0, t1 = Date.now();
    try {
      let j;
      try { j = await chat(body, false); } catch (e) { if (e.code !== 'think') throw e; j = await chat(body, undefined); } // 思考の切り替えに非対応のモデル
      const content = j.message?.content || '';
      if (!content.trim()) return json(res, 502, { ok: false, error: 'empty', detail: '空の応答', ms: Date.now() - t1 });
      json(res, 200, { ok: true, content, model, ms: Date.now() - t1, waitedMs, evalCount: j.eval_count ?? null });
    } catch (e) {
      const code = e.name === 'TimeoutError' || e.name === 'AbortError' ? 'timeout' : typeof e.code === 'string' ? e.code : 'connect'; // DOMException の数値 code は使わない
      json(res, code === 'timeout' ? 504 : 502, { ok: false, error: code, detail: String(e.message || e).slice(0, 160), ms: Date.now() - t1 });
    } finally { release(); }
  }
  async function status(res) {
    try {
      const r = await fetch(ollama + '/api/tags', { signal: AbortSignal.timeout(3000) });
      const j = await r.json(), models = (j.models || []).map(m => m.name);
      json(res, 200, { ok: true, model, installed: models.includes(model) || models.includes(model + ':latest'), models, busy, waiting: waiting.length });
    } catch { json(res, 200, { ok: false, model, installed: false, models: [], error: 'Ollama に接続できない', busy, waiting: waiting.length }); }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (await handleBaseball(req, res, url)) return;
    if (await handleDrive(req, res, url)) return;
    if (url.pathname === '/api/llm/status' && req.method === 'GET') return status(res);
    if (url.pathname === '/api/llm/decide' && req.method === 'POST') return decide(req, res);
    if (url.pathname.startsWith('/api/')) return json(res, 404, { ok: false, error: 'http', detail: 'not found' });
    try {
      const path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!path.startsWith(root + '/')) { res.writeHead(403).end(); return; }
      const data = await readFile(path);
      res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' })[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    } catch { res.writeHead(404).end('Not found'); }
  });
  server.on('close', () => handleBaseball.close());
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const port = Number(process.env.PORT) || 4173;
  const dataDir = process.env.BALLCLUB_DATA_DIR;
  const options = dataDir ? {baseball:{path:resolve(dataDir,'baseball.sqlite')},drive:{tokenPath:resolve(dataDir,'drive-token.json')}} : {};
  createApp(options).listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}  (LLM: ${process.env.BALLCLUB_MODEL || 'gemma4:26b'} via ${process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'})`));
}
