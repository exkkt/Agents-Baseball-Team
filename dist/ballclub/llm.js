// 判断の提供元。ブラウザからは Ollama に直接つながず、server.mjs のローカルアダプター（/api/llm/*）を経由する。DOM に依存しない
export class LocalLLM {
  constructor({ base = '', timeoutMs = 90000, fetchFn = (...a) => fetch(...a) } = {}) {
    this.base = base; this.timeoutMs = timeoutMs; this.fetch = fetchFn;
    this.state = { checked: false, ok: false, model: null, installed: false, error: null, at: 0 };
    this.fails = 0; this.cooldownUntil = 0;
  }
  get label() { return this.state.model ? `ローカルLLM（${this.state.model}）` : 'ローカルLLM'; }
  // 接続確認。失敗しても例外にしない
  async status() {
    try {
      const r = await this.fetch(this.base + '/api/llm/status', { signal: AbortSignal.timeout(5000) });
      const j = await r.json();
      this.state = { checked: true, ok: !!(j.ok && j.installed), model: j.model, installed: !!j.installed, models: j.models || [], error: j.ok ? (j.installed ? null : `モデル ${j.model} が見つからない`) : j.error || '接続できない', at: Date.now() };
    } catch (e) { this.state = { checked: true, ok: false, model: this.state.model, installed: false, error: 'アダプターに接続できない', at: Date.now() }; void e; }
    return this.state;
  }
  // 連続で失敗したら少し待ってから試す（毎回タイムアウトまで待たないように）
  get available() { return this.state.ok && Date.now() >= this.cooldownUntil; }
  async decide({ system, user, schema }) {
    const t0 = Date.now();
    try {
      const r = await this.fetch(this.base + '/api/llm/decide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ system, user, schema }), signal: AbortSignal.timeout(this.timeoutMs) });
      const j = await r.json().catch(() => ({ ok: false, error: 'http', detail: `HTTP ${r.status}` }));
      if (!j.ok) throw Object.assign(Error(j.detail || j.error), { code: j.error || 'http' });
      this.fails = 0;
      return { ok: true, text: j.content, ms: j.ms ?? Date.now() - t0, model: j.model };
    } catch (e) {
      const code = e.name === 'TimeoutError' || e.name === 'AbortError' ? 'timeout' : typeof e.code === 'string' ? e.code : 'connect'; // DOMException の数値 code は使わない
      if (++this.fails >= 2) { this.cooldownUntil = Date.now() + 30000; this.fails = 0; this.status(); }
      return { ok: false, error: code, detail: String(e.message || e).slice(0, 120), ms: Date.now() - t0 };
    }
  }
}
export const ERROR_TEXT = { timeout: '応答が時間切れ', connect: '接続失敗', http: 'アダプターのエラー', empty: '空の応答', model: 'モデルが見つからない', busy: 'アダプターが混雑' };
