// テスト用：構造化出力（JSON Schema）を真似るローカルLLMのモック。schema から判断の種類を見分け、許可された選択肢で答える
export const tick = () => new Promise(r => setImmediate(r));
export const kindOf = s => s.properties.morning ? 'day_plan' : s.properties.blocks ? 'next' : s.properties.decisions ? 'consider' : s.properties.proposals ? 'review' : s.properties.tomorrow ? 'day_review' : s.properties.policy ? 'policy' : s.properties.watch ? 'staff_plan' : s.properties.metrics ? 'analysis_plan' : s.properties.more ? 'analysis_more' : s.properties.findings ? 'analysis_write' : 'unknown';
const dayOf = user => Number((user.match(/いま：(\d+)日目/) || [])[1] || 1);
export function answer({ schema, user }) {
  const k = kindOf(schema), en = p => p.enum[0];
  const blk = items => ({ menu: en(items.properties.menu), minutes: 30, intensity: 'normal' });
  switch (k) {
    case 'day_plan': return { focus: 'balanced', morning: [blk(schema.properties.morning.items), { menu: 'rest', minutes: 20, intensity: 'normal' }], afternoon: [blk(schema.properties.afternoon.items), { menu: 'stretch', minutes: 20, intensity: 'light' }], evening: [{ menu: 'stretch', minutes: 15, intensity: 'light' }], bedtime: '22:30', reason: 'モックの予定' };
    case 'next': return { blocks: [blk(schema.properties.blocks.items)], reason: 'モックの次の予定' };
    case 'consider': return { decisions: schema.properties.decisions.items.properties.id.enum.map(id => ({ id, choice: 'adopt', reason: 'モックで採用' })), reason: 'モックの検討' };
    case 'review': { const it = schema.properties.proposals.items.properties; return { proposals: [{ player: it.player.enum[0], menu: 'stretch', minutes: 20, intensity: 'light', message: '少しほぐそう' }], note: 'モックの報告', reason: 'モックの振り返り' }; }
    case 'day_review': return { tomorrow: schema.properties.tomorrow.items.properties.player.enum.map(p => ({ player: p, focus: 'balanced' })), report: '報告', ask_analyst: 'none', reason: 'モック' };
    case 'policy': return { policy: 'balanced', message: '了解', reason: 'モック' };
    case 'staff_plan': return { focus: en(schema.properties.focus), watch: 'none', note: 'いつもどおり', reason: 'モック' };
    case 'analysis_plan': { const d = dayOf(user); return { players: [schema.properties.players.items.enum[0]], metrics: ['expPerHour', 'practiceMinutes', 'wakeFatigue'], current_from: Math.max(1, d - 2), current_to: Math.max(1, d - 1), baseline_from: 0, baseline_to: 0, archive: false, focus: '練習の効率', reason: 'モックの計画' }; }
    case 'analysis_more': return { more: [{ metric: 'practiceMinutes', player: 'all', groupBy: 'menu', period: 'current' }], done: true, reason: 'モックの追加調査' };
    case 'analysis_write': { const ids = schema.properties.findings.items.properties.fact.enum; const players = schema.properties.recommendations.items.properties.player.enum; return { findings: ids.slice(0, 2).map(fact => ({ fact, note: '記録どおりの値' })), insight: '直近の練習の記録を確認した。', recommendations: [{ type: 'add_care', player: players[0], focus: 'none', note: 'ケアを入れてみる' }], caveats: ['記録が少ない'], reason: 'モックの考察' }; }
  }
  return {};
}
export class MockLLM {
  constructor({ delay = () => 0, fail = null, raw = null } = {}) { this.delay = delay; this.fail = fail; this.raw = raw; this.active = 0; this.max = 0; this.calls = []; this.state = { checked: true, ok: true }; this.available = true; this.held = []; }
  async decide(prompt) {
    this.active++; this.max = Math.max(this.max, this.active); this.calls.push(prompt);
    try {
      const d = this.delay(prompt, this.calls.length);
      if (d === 'hold') await new Promise(r => this.held.push(r));
      else for (let i = 0; i < d; i++) await tick();
      if (this.fail) return this.fail;
      return { ok: true, text: this.raw ? this.raw(prompt) : JSON.stringify(answer(prompt)), ms: 1000 };
    } finally { this.active--; }
  }
}
