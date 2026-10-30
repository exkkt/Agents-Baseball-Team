import { PLAYERS, cleanText, parseJSON, remember } from './agents.js';
import { createGame, opponent, ruleLineup, validLineup, playAppearance, playPitch, changePitcher } from './baseball.js';
import { addGame } from './records.js';
export const MATCH_KINDS = ['match_lineup', 'match_pitching'];
// 回・点数・球数の説明は画面の実データで行う。LLMは起用の意図を選び、試合状況を作文しない。
const REASONS = { match_lineup: ['守備適性を重視する', '疲労を抑える', '打撃力を重視する', '若手に機会を与える', '能力と調子を総合する'], match_pitching: ['投球負荷を抑える', '投手の状態を優先する', '現在の投手に任せる', '控え投手へ機会を与える'] };
export const safeMatchReason = (kind, text) => REASONS[kind]?.includes(text) ? text : '起用の意図は未確認（自由文の理由は表示を省略）';
const clone = x => JSON.parse(JSON.stringify(x));
export class Matches {
  constructor(d) { this.d = d; this.st = { v: 1, seq: 0, fixtures: [], active: null, nextPlay: null, pitching: null, postgame: [] }; }
  serialize() { return clone(this.st); }
  restore(data) { if (data) this.st = { postgame: [], ...clone(data) }; for (const f of this.st.fixtures) if (f.source === 'llm') f.reason = safeMatchReason('match_lineup', f.reason); if (this.st.active?.source === 'llm') this.st.active.reason = safeMatchReason('match_lineup', this.st.active.reason); }
  roster() { return Object.fromEntries(Object.entries(PLAYERS).map(([id, p]) => [id, { name: this.d.c.person(id).name, positions: p.positions, ability: { ...this.d.trainees[id].ability }, fatigue: this.d.trainees[id].fatigue, condition: this.d.trainees[id].condition }])); }
  fixture() { return this.st.fixtures.find(f => ['scheduled', 'preparing', 'playing'].includes(f.status)); }
  schedule({ day = this.d.day, start = null, manual = false } = {}) {
    const d = this.d, base = d.base() + (day - d.day) * 1440;
    start ??= base + 780;
    if (this.fixture() || start < d.M + 15 || start % 1440 < 540 || start % 1440 > 960) return { ok: false, message: '予約済みの試合があります。または準備時間を確保できません（開始は09:00〜16:00）。' };
    const n = ++this.st.seq, f = { id: `G${n}`, day, start, opponent: (n - 1) % 3, home: n % 2 === 1, status: 'scheduled', lineup: null, source: null, manual };
    this.st.fixtures.push(f); while (this.st.fixtures.length > 60) this.st.fixtures.shift();
    d.log(`${day}日目 ${d.clockAt(start % 1440)} に ${opponent(d.seed, f.opponent).name}との練習試合を予定`, { kind: 'game', who: ['manager'] });
    return { ok: true, id: f.id };
  }
  wants(req) {
    const f = this.fixture();
    return req.kind === 'match_lineup' ? !!f && f.id === req.extra?.game && !f.lineup : !!this.st.pitching && this.st.pitching.key === req.extra?.key;
  }
  context(req) {
    const d = this.d, f = this.fixture(), g = this.st.active, roster = this.roster();
    return { who: 'manager', view: { label: d.c.person('manager').label }, ag: d.agents.manager, ctx: { roster, fixture: f, game: g ? { id: g.id, inning: g.inning, half: g.half, score: g.teams.map(t => t.score), own: g.own, pitcher: g.teams[g.own].pitcher, pitching: g.teams[g.own].pitching, usedPitchers: g.teams[g.own].usedPitchers } : null, recent: (d.records.matches || []).slice(-36), reports: d.agents.manager.knows } };
  }
  onDecision(req, res) {
    if (!this.wants(req)) return { applied: false, note: '試合の判断期限が過ぎた' };
    if (req.kind === 'match_lineup') { const f = this.fixture(); f.lineup = res.decision.lineup; f.source = res.source; f.reason = res.decision.reason; return { applied: true, note: '練習試合の打順・守備位置を決定' }; }
    const g = this.st.active, id = res.decision.pitcher;
    if (id !== 'keep') changePitcher(g, g.own, id, res.source);
    const ps = this.st.pitching; this.st.pitching = null; this.st.nextPlay = this.d.M + 2;
    g.pitchingReviewed ??= []; g.pitchingReviewed.push(ps.key);
    return { applied: true, note: id === 'keep' ? '投手続投を決定' : `投手を${this.d.c.person(id).name}へ交代` };
  }
  holds(id) { return !!PLAYERS[id] && !!this.fixture() && ['preparing', 'playing'].includes(this.fixture().status); }
  holdMinute(c, id) {
    const d = this.d, ag = d.agents[id], p = c.person(id), g = this.st.active;
    if (ag.block) d.finish(c, id, '試合のため練習を終了');
    d.release(id);
    if (!g || !g.teams[g.own].lineup.some(x => x.player === id)) d.trainees[id].fatigue = Math.max(0, d.trainees[id].fatigue - .02);
    const own = g?.teams[g.own], entry = own?.lineup.find(x => x.player === id), defending = g && g.half !== g.own;
    const spots = { P: 'match-P', C: 'match-C', '1B': 'first', '2B': 'second', '3B': 'match-3B', SS: 'short', LF: 'match-LF', CF: 'match-CF', RF: 'match-RF' };
    const batting = g && g.teams[g.half].lineup[g.teams[g.half].next].player === id && g.half === g.own;
    const spot = entry && defending ? spots[entry.position] : batting ? 'match-C' : 'match-bench-' + Object.keys(PLAYERS).indexOf(id);
    if (p.at !== spot && p.goal?.spot !== spot) c.replace(id, { do: 'goto', spot, then: 'match' });
    p.doingText = !g ? '練習試合の準備・ウォームアップ' : !entry ? '練習試合のベンチで待機' : defending ? `練習試合：${entry.position}の守備` : batting ? '練習試合：打席に入っている' : '練習試合：攻撃中・打順待ち';
  }
  minute(c, M) {
    const d = this.d, mod = M % 1440;
    this.st.postgame ??= [];
    this.st.postgame = this.st.postgame.filter(request => !d.analyst.request(request).ok);
    if (!this.fixture() && mod === 510 && [2, 5].includes((d.day - 1) % 7 + 1)) this.schedule();
    for (const req of d.queue.filter(r => MATCH_KINDS.includes(r.kind) && !this.wants(r))) { d.queue.splice(d.queue.indexOf(req), 1); d.stats.expired++; d.record(req, { source: 'rule', decision: null, issues: [] }, false, '試合の判断期限が過ぎた'); }
    const f = this.fixture(); if (!f) return;
    if (f.status === 'scheduled' && M >= f.start - 30) { f.status = 'preparing'; this.st.active = null; d.enqueue('match_lineup', 'manager', { topic: f.id, urgent: true, extra: { game: f.id } }); }
    if (f.status === 'preparing' && M >= f.start && (f.lineup || M >= f.start + 15)) {
      if (!f.lineup) { f.lineup = ruleLineup(this.roster()); f.source = 'fallback'; f.reason = '開始期限のためルール代替'; }
      // 起用時点の状態を固定。試合中の投球疲労は球数から加える。
      this.st.active = createGame({ ...f, seed: d.seed, roster: this.roster(), lineup: f.lineup, opponent: opponent(d.seed, f.opponent) });
      f.status = 'playing'; this.st.nextPlay = M + 2; d.log(`練習試合開始：${this.st.active.teams.map(t => t.name).join(' 対 ')}（起用：${f.source}）`, { kind: 'game', who: ['manager'] });
    }
    const g = this.st.active; if (!g || g.complete || M < this.st.nextPlay) return;
    if (this.st.pitching) {
      if (M < this.st.pitching.deadline) return;
      const req = { kind: 'match_pitching', extra: { key: this.st.pitching.key } };
      this.onDecision(req, { source: 'fallback', decision: matchRule(req.kind, this.context(req)) }); return;
    }
    if (g.outs === 0 && !g.currentPA && g.half !== g.own) {
      const t = g.teams[g.own], ps = t.pitching[t.pitcher], key = `${g.id}:${g.inning}:${t.pitcher}`;
      if (ps.pitches >= 85 && !(g.pitchingReviewed || []).includes(key) && Object.keys(t.roster).some(id => t.roster[id].positions.includes('P') && !t.usedPitchers.includes(id))) {
        this.st.pitching = { key, deadline: M + 10 }; d.enqueue('match_pitching', 'manager', { topic: key, urgent: true, extra: { key } }); return;
      }
    }
    // 相手球団はルールで継投する。
    const other = 1 - g.own, ot = g.teams[other]; if (!g.currentPA && ot.pitching[ot.pitcher].pitches >= 95) { const id = Object.keys(ot.roster).find(id => ot.roster[id].positions.includes('P') && !ot.usedPitchers.includes(id)); if (id) changePitcher(g, other, id); }
    for(let n=0;n<3&&!g.complete&&this.st.nextPlay<=M;n++) {
      const half=g.half, at=this.st.nextPlay;
      const event=g.v===2?playPitch(g,at):null, p=event?.pitch||playAppearance(g,at);
      if(event)c.emit('pitch',{seq:g.pitchSeq,game:g.id});
      this.st.nextPlay=at+(g.v===2?.5:2);
      const field=1-(event?p.half:g.plays.at(-1).half);
      if(field===g.own){for(const x of g.teams[g.own].lineup){const tr=d.trainees[x.player];tr.fatigue=Math.min(100,tr.fatigue+(x.position==='P'?(event?.25:p.pitches*.25):(event?.035:.15)));}}
      else d.trainees[p.batter].fatigue=Math.min(100,d.trainees[p.batter].fatigue+(event?.08:.35));
      if(g.half!==half)break;
    }
    if (!g.complete) return;
    f.status = 'complete'; addGame(d.records, g);
    const own = g.teams[g.own], opp = g.teams[1 - g.own], text = `試合終了：${own.name} ${own.score} − ${opp.score} ${opp.name}。${own.score === opp.score ? '引き分け' : own.score > opp.score ? '勝利' : '敗戦'}`;
    d.log(text, { kind: 'game', who: ['manager', 'analyst'] });
    remember(d.agents.manager, text + '。試合画面で個人成績を確認できる。', c.clock);
    // 少数の対象を順に分析。数値の集計・考察・報告は既存の小野の作業工程を使う。
    const ids = [...new Set([...own.original.map(x => x.player), ...own.usedPitchers])];
    for (let i = 0; i < ids.length; i += 4) this.st.postgame.push({ trigger: 'postgame', by: 'manager', players: ids.slice(i, i + 4), from: Math.max(1, d.day - 6), to: d.day, theme: 'game', question: `${g.id}終了後。試合記録と疲労を確認し、次の起用・練習の判断材料を監督と選手へ共有する。必要なら球種・コース・カウント・イニング別に比較する。少ない打席数で能力を断定しない。` });
    for (const id of Object.keys(PLAYERS)) { d.agents[id].life.slot = null; d.agents[id].plan.morning = []; d.agents[id].plan.afternoon = []; }
    c.emit('autosave', { M });
  }
}
export function matchRule(kind, full) {
  const x = full.ctx;
  if (kind === 'match_lineup') return { lineup: ruleLineup(x.roster), reason: '能力と調子を総合する' };
  const ids = Object.keys(x.roster).filter(id => x.roster[id].positions.includes('P') && !x.game.usedPitchers.includes(id)).sort((a, b) => x.roster[a].fatigue - x.roster[b].fatigue);
  return { pitcher: ids[0] || 'keep', reason: '投球負荷を抑える' };
}
export function matchValidate(kind, text, full) {
  const d = parseJSON(text); if (!d) return { ok: false, issues: ['JSONの形式が不正'] };
  const ok = kind === 'match_lineup' ? validLineup(d.lineup, full.ctx.roster) : d.pitcher === 'keep' || full.ctx.roster[d.pitcher]?.positions?.includes('P') && !full.ctx.game.usedPitchers.includes(d.pitcher);
  const reason = safeMatchReason(kind, cleanText(d.reason,80)), issues = REASONS[kind].includes(d.reason) ? [] : ['自由文の理由は試合状況の取り違えを防ぐため省略'];
  return ok ? { ok: true, decision: kind === 'match_lineup' ? { lineup: d.lineup.map(x => ({ player: x.player, position: x.position })), reason } : { pitcher: d.pitcher, reason }, issues } : { ok: false, issues: ['起用できない選手・守備位置、または重複がある'] };
}
export function matchPrompt(kind, full) {
  const x = full.ctx, lineup = kind === 'match_lineup';
  const properties = lineup ? { lineup: { type: 'array', minItems: 9, maxItems: 9, items: { type: 'object', properties: { player: { type: 'string', enum: Object.keys(x.roster) }, position: { type: 'string', enum: ['P','C','1B','2B','3B','SS','LF','CF','RF'] } }, required: ['player','position'] } } } : { pitcher: { type: 'string', enum: ['keep', ...Object.keys(x.roster).filter(id => x.roster[id].positions.includes('P') && !x.game.usedPitchers.includes(id))] } };
  const score = x.game ? `自軍の得点=${x.game.score[x.game.own]}、相手の得点=${x.game.score[1-x.game.own]}。` : '';
  return { system: 'あなたは架空の球団の佐伯監督です。JSONだけで判断してください。試合結果の数字を作らないでください。reasonは指定された起用の意図から一つ選んでください。', user: `${lineup ? '9人の打順（配列順）と守備位置を決める。選手・守備位置は重複禁止。positionsにある適性のみ許可。DHなし。' : '球数・疲労・試合状況から続投keepか救援投手を選ぶ。'}${score}\n${JSON.stringify(x)}`, schema: { type: 'object', properties: { ...properties, reason: { type: 'string', enum: REASONS[kind] } }, required: [...Object.keys(properties), 'reason'] } };
}
