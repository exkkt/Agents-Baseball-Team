// 箱庭セーブの検証と移行。Driveから受け取ったセーブ・ブラウザに残っていたセーブを、現在の進行に反映する前に確かめる。DOM に依存しない。
// v1：「1秒＝ゲーム内1分」・9:00〜18:30 だけの進行・夜の一括計算・判断回数の上限（BUDGET）がある版
// v3：12選手の24時間生活・練習試合・打席記録と分析。v1/v2の進行を移行できる
// v2：時計と動作の時間を分け、24時間の生活・長期の記録・小野アナリスト・判断回数の上限なし
import { AGENT_IDS, PLAYERS, POLICY, STAFF, BEDTIMES, LIFE, makeAgent, clockOf } from './agents.js';
import { MENUS, Rng, seedFor, makeTrainee } from './growth.js';
import { makeStore, importLegacy, openDay } from './records.js';
import { CLOCK_RATE, Club } from './sim.js';
import { assertPitchGame } from './pitch-validation.js';
import { validLineup } from './baseball.js';

export const SNAPSHOT_VERSION = 3;
const V1_AGENT_IDS = ['aoki', 'yamada', 'mori', 'kobayashi', 'kubo', 'sato', 'endo', 'kawaguchi', 'hcoach', 'fcoach', 'pcoach', 'manager', 'gm'];
const V2_AGENT_IDS = [...V1_AGENT_IDS, 'analyst'];
const OLD_PLAYERS = V1_AGENT_IDS.slice(0, 8);
const V1_KINDS = ['day_plan', 'next', 'fatigue', 'proposal', 'review', 'day_review', 'policy'];
const V2_KINDS = ['day_plan', 'next', 'fatigue', 'consider', 'review', 'day_review', 'policy', 'staff_plan', 'analysis_plan', 'analysis_more', 'analysis_write'];
const finite = x => typeof x === 'number' && Number.isFinite(x);
const object = x => x && typeof x === 'object' && !Array.isArray(x);
const fail = () => { throw Error('保存データの形式が違います'); };
const check = ok => { if (!ok) fail(); };

function checkCommon(data, ids, kinds, plans) {
  check(Number.isInteger(data.seed) && Number.isInteger(data.day) && data.day >= 1 && POLICY[data.policy]);
  check(object(data.trainees) && object(data.agents) && object(data.people) && object(data.reserved) && object(data.stats));
  check(Array.isArray(data.locked) && Array.isArray(data.pending) && Array.isArray(data.decisions) && Array.isArray(data.events));
  check(data.pending.length <= 64 && data.decisions.length <= 3000 && data.events.length <= 400);
  check(['reqSeq', 'blockSeq', 'eseq', 'rand', 'savedAt'].every(k => finite(data[k])));
  check(Object.keys(data.trainees).length === ids.filter(id => PLAYERS[id]).length && ids.every(id => object(data.agents[id])));
  for (const id of ids) {
    const a = data.agents[id], p = data.people[id];
    check(a.id === id && object(a.plan) && object(a.decision) && Array.isArray(a.knows) && Array.isArray(a.recent));
    for (const w of plans) check(Array.isArray(a.plan[w] ?? []));
    for (const b of [...plans.flatMap(w => a.plan[w] || []), ...(a.block ? [a.block] : [])]) check(object(b) && MENUS[b.menu] && finite(b.minutes) && b.minutes >= 0);
    check(object(p) && finite(p.x) && finite(p.y) && Array.isArray(p.path) && Array.isArray(p.queue));
  }
  for (const id of ids.filter(id => PLAYERS[id])) {
    const tr = data.trainees[id];
    check(object(tr) && tr.id === id && object(tr.ability) && object(tr.exp) && object(tr.today) && object(tr.traits) && object(tr.sleep));
    check(finite(tr.fatigue) && tr.fatigue >= 0 && tr.fatigue <= 100 && finite(tr.condition) && Math.abs(tr.condition) <= 1);
    check(finite(tr.sleep.quality) && Array.isArray(tr.history) && finite(tr.rng));
    for (const key of ['bat', 'field', 'pitch', 'run']) check(finite(tr.ability[key]) && tr.ability[key] >= 20 && tr.ability[key] <= 99 && finite(tr.exp[key]) && tr.exp[key] >= 0);
  }
  for (const r of data.pending) check(object(r) && ids.includes(r.who) && kinds.includes(r.kind));
}
// 形式だけを確かめる（v1 も v2 も受け付ける）。中身は変えない
export function assertSnapshot(data) {
  check(object(data));
  if (data.v === 1) {
    check(finite(data.t) && data.t >= 0 && finite(data.lastMinute) && data.lastMinute <= Math.floor(data.t + 1e-6));
    check(Object.keys(data.agents).length === V1_AGENT_IDS.length);
    checkCommon(data, V1_AGENT_IDS, V1_KINDS, ['morning', 'afternoon']);
    return data;
  }
  check(data.v === 2 || data.v === SNAPSHOT_VERSION);
  check(finite(data.t) && finite(data.gm) && data.gm >= 0 && finite(data.lastMinute) && data.lastMinute <= Math.floor(data.gm + 1e-6));
  const ids = data.v === 2 ? V2_AGENT_IDS : AGENT_IDS;
  checkCommon(data, ids, data.v === 2 ? V2_KINDS : [...V2_KINDS, 'match_lineup', 'match_pitching'], ['morning', 'afternoon', 'evening']);
  const r = data.records;
  check(object(r) && finite(r.seq) && ['practice', 'sleeps', 'days', 'events', 'outbox'].every(k => Array.isArray(r[k])) && object(r.legacy) && object(r.synced));
  check(r.practice.length <= 20000 && r.sleeps.length <= 20000 && r.days.length <= 20000);
  check(object(data.analysis) && Array.isArray(data.analysis.jobs) && Array.isArray(data.analysis.reports) && data.analysis.reports.length <= 100);
  for (const id of ids.filter(id => PLAYERS[id])) check(object(data.agents[id].life) && ['awake', 'asleep'].includes(data.agents[id].life.state));
  if (data.v === 3) {
    const m = data.matches;
    check(object(m) && m.v === 1 && Number.isInteger(m.seq) && m.seq >= 0 && Array.isArray(m.fixtures) && m.fixtures.length <= 60);
    check(Array.isArray(r.matches) && r.matches.length <= 20000 && Array.isArray(r.games) && r.games.length <= 1000);
    for (const f of m.fixtures) check(object(f) && typeof f.id === 'string' && Number.isInteger(f.day) && finite(f.start) && ['scheduled','preparing','playing','complete'].includes(f.status) && (f.lineup == null || validLineup(f.lineup, PLAYERS)));
    if (m.active) checkGame(m.active);
    check(m.nextPlay == null || finite(m.nextPlay));
    check(m.pitching == null || object(m.pitching) && typeof m.pitching.key === 'string' && finite(m.pitching.deadline));
    for (const row of r.games) { check(object(row)); checkGame(row.game); check(row.game.complete); }
    for (const row of r.matches) check(object(row) && PLAYERS[row.player] && finite(row.day) && ['PA','AB','H','HR','BB','K','R','RBI','TB'].every(k => finite(row[k]) && row[k] >= 0));
  }
  return data;
}

export function checkGame(g) {
  check(object(g) && [1,2].includes(g.v) && typeof g.id === 'string' && finite(g.rng) && Number.isInteger(g.inning) && g.inning >= 1 && g.inning <= 12 && [0,1].includes(g.half) && [0,1].includes(g.own));
  check(Number.isInteger(g.outs) && g.outs >= 0 && g.outs <= 3 && typeof g.complete === 'boolean' && Array.isArray(g.bases) && g.bases.length === 3);
  check(Array.isArray(g.teams) && g.teams.length === 2 && Array.isArray(g.plays) && g.plays.length <= 1500 && Array.isArray(g.substitutions));
  for (const t of g.teams) {
    check(object(t) && object(t.roster) && object(t.batting) && object(t.pitching) && finite(t.score) && t.score >= 0 && Array.isArray(t.innings) && t.innings.length <= 12);
    for (const p of Object.values(t.roster)) check(object(p) && Array.isArray(p.positions) && object(p.ability) && ['bat','field','pitch','run'].every(k => finite(p.ability[k])) && finite(p.fatigue) && finite(p.condition));
    check(validLineup(t.lineup,t.roster) && validLineup(t.original,t.roster) && t.roster[t.pitcher]?.positions.includes('P') && Array.isArray(t.usedPitchers) && Number.isInteger(t.next) && t.next >= 0 && t.next < 9);
    for (const x of t.lineup) check(object(t.batting[x.player]));
    check(object(t.pitching[t.pitcher]) && t.innings.every(n => Number.isInteger(n) && n >= 0));
  }
  check(g.teams[g.own].lineup.every(x => PLAYERS[x.player]));
  for (const r of g.bases) check(r == null || object(r) && g.teams[g.half].roster[r.player] && g.teams[1-g.half].pitching[r.pitcher]);
  if(g.v===2) assertPitchGame(g);
  for (const p of g.plays) check(object(p) && [0,1].includes(p.half) && g.teams[p.half].roster[p.batter] && g.teams[1-p.half].roster[p.pitcher] && ['BB','K','OUT','1B','2B','3B','HR'].includes(p.result) && Array.isArray(p.runs) && finite(p.pitches));
}

// v1 → v2。v1 は 9:00〜18:30 の昼間にしか保存されないので、全員が起きて施設にいる状態から続ける。
// 保存していなかった詳細（就寝時刻・練習ごとの時刻・日ごとのメニュー内訳）は作らず、残っている日別履歴だけを記録として取り込む
function migrateV1(input) {
  const data = JSON.parse(JSON.stringify(assertSnapshot(input)));
  if (data.v !== 1) return data;
  const gm = 540 + data.t, M = Math.floor(gm + 1e-6), base = M - (M % 1440), mod = M % 1440, day = data.day;
  const shift = x => (finite(x) ? x + 540 : x);
  const agents = {};
  const ids = OLD_PLAYERS;
  for (const id of V2_AGENT_IDS) {
    const old = data.agents[id], ag = makeAgent(id);
    if (old) {
      Object.assign(ag, { knows: old.knows, recent: old.recent, block: old.block || null, rev: old.rev || 0, reason: old.reason || null, focus: old.focus || null, policy: old.policy || null, planSource: old.planSource });
      ag.plan = { focus: null, morning: old.plan.morning || [], afternoon: old.plan.afternoon || [], evening: [], bedtime: null };
      // 旧版の「今日の判断回数（上限つき）」は、上限のない統計として残す
      ag.calls = { today: old.used || 0, total: old.used || 0, byKind: {}, migratedFromBudget: true };
      ag.decision = old.decision?.state === 'queued' ? { ...old.decision, since: shift(old.decision.since) } : { state: 'idle' };
      if (ag.block) { ag.block.startM ??= M - (ag.block.done || 0); ag.block.self = false; }
    }
    agents[id] = ag;
  }
  ids.forEach((id, i) => {
    const P = PLAYERS[id], ag = agents[id], slot = mod < 720 ? 'morning' : mod < 780 ? 'lunch' : mod < 1050 ? 'afternoon' : 'dinner';
    ag.life = { state: 'awake', initial: false, migrated: true, slot, bed: i, sleepSeq: 0, rng: new Rng(seedFor(data.seed, 'life:' + id)).s, wakeAt: null, wakeup: null, napped: mod >= 750, fatigueAsked: {},
      sched: { wake: base + 390, wash: base + 405, breakfastAt: base + 420, breakfastUntil: base + 445, amStart: base + LIFE.amStart, lunchAt: base + LIFE.lunch, pmStart: base + LIFE.pmStart, pmEnd: base + LIFE.dinner, dinnerUntil: base + LIFE.dinner + 45, bedAt: base + BEDTIMES[P.bed] } };
    if (ag.block?.menu === 'meal') ag.block.life = true;
  });
  const trainees = data.trainees;
  for (const tr of Object.values(trainees)) { tr.asleep = null; tr.lastSleep = null; tr.today.practiceLog = []; tr.sleep = { ...tr.sleep, id: null, migrated: true }; }
  const records = makeStore({ M, day });
  importLegacy(records, trainees, { day, M });
  for (const id of ids) openDay(records, id, day, trainees[id], M);
  const duty = {}, people = {};
  for (const [id, S] of Object.entries(STAFF)) duty[id] = { state: mod >= S.arrive && mod < S.leave ? 'on' : 'away', arriveAt: base + S.arrive, leaveAt: base + S.leave, day };
  for (const [id, p] of Object.entries(data.people)) people[id] = { ...p, away: duty[id]?.state === 'away', sleeping: false };
  // 判断待ちは新しい形に直す。コーチの提案は、本人が区切りで検討する「届いた提案」に移す
  const pending = [];
  let itemSeq = 0;
  for (const r of data.pending) {
    if (r.kind === 'proposal' && r.extra?.proposal) {
      const pr = r.extra.proposal, from = r.extra.from, ag = agents[r.who];
      ag.inbox.push({ id: `I${++itemSeq}`, status: 'pending', at: shift(r.minute), clock: clockOf(mod), holds: 0, kind: 'proposal', kindLabel: '提案', from, fromLabel: from, text: `${MENUS[pr.menu].label} ${pr.minutes}分「${pr.message || ''}」（旧版から引き継ぎ）`, change: { type: 'block', block: { menu: pr.menu, minutes: pr.minutes, intensity: pr.intensity } }, changeText: `${MENUS[pr.menu].label}を次に行う`, urgent: false, needsDecision: true });
      ag.decision = { state: 'idle' };
      continue;
    }
    const win = r.kind === 'next' || r.kind === 'fatigue' ? (mod < 720 ? 'morning' : 'afternoon') : null;
    const topic = r.kind === 'day_plan' || r.kind === 'day_review' || r.kind === 'policy' ? `d${day}` : r.kind === 'review' ? String(mod >= 900 ? 900 : 630) : win || '';
    const baseKey = `${r.who}:${r.kind}:${topic}`;
    pending.push({ key: `${baseKey}#${day}.m`, base: baseKey, kind: r.kind, who: r.who, day, minute: shift(r.minute), depth: r.depth || 1, priority: r.priority, extra: win ? { win } : r.extra, urgent: r.kind === 'fatigue', notBefore: shift(r.minute), id: r.id });
  }
  const out = {
    v: 2, seed: data.seed, mode: data.mode, t: data.t, gm, rate: CLOCK_RATE, day, lastMinute: shift(data.lastMinute), rolledAt: null, policy: data.policy,
    reqSeq: data.reqSeq, blockSeq: data.blockSeq, itemSeq, keyCount: {}, reserved: data.reserved, locked: [...new Set([...data.locked.filter(x => x !== 'analyst'), 'analyst'])], threads: {}, duty,
    trainees, agents, pending, decisions: data.decisions.map(x => ({ ...x, minute: shift(x.minute) })), stats: { ...data.stats, merged: 0, deferred: 0, expired: 0, calls: data.stats.llm || 0 },
    records, analysis: { seq: 0, jobs: [], reports: [], lastDaily: day - 1 }, people, events: data.events, eseq: data.eseq, rand: data.rand, cyc: data.cyc, knockOff: data.knockOff, savedAt: data.savedAt, migratedFrom: { v: 1, at: `${day}日目 ${clockOf(mod)}` }
  };
  return assertSnapshot(out);
}

// v2 → v3：元の8選手の時計・記録・睡眠・判断を保ち、不足していた4選手だけ追加する。
export function migrateSnapshot(input) {
  const data = migrateV1(input);
  if (data.v === SNAPSHOT_VERSION) return data;
  const club = new Club({ seed: data.seed }), M = Math.floor(data.gm), mod = M % 1440, base = M - mod;
  for (const [i, id] of Object.keys(PLAYERS).entries()) {
    if (data.trainees[id]) continue;
    const P = PLAYERS[id], ag = makeAgent(id), awake = mod >= 390 && mod < BEDTIMES[P.bed];
    data.trainees[id] = makeTrainee({id, ...P}, data.seed); data.agents[id] = ag;
    ag.life = { state: awake ? 'awake' : 'asleep', initial: true, slot: null, bed: i, sleepSeq: 0, rng: new Rng(seedFor(data.seed, 'life:' + id)).s, wakeAt: base + (mod < 390 ? 390 : 1830), wakeup: null, napped: false, fatigueAsked: {}, sched: awake ? {wake:base+390,wash:base+405,breakfastAt:base+420,breakfastUntil:base+445,amStart:base+540,lunchAt:base+720,pmStart:base+780,pmEnd:base+1050,dinnerUntil:base+1095,bedAt:base+BEDTIMES[P.bed]} : null };
    club.place(id, 'dorm-' + i, 'lie');
    const p = club.person(id); data.people[id] = { x:p.x, y:p.y, at:p.at, activity:'lie', act:p.act, dir:p.dir, path:[], queue:[], moving:false, sleeping:!awake, away:false, doingText:'追加された選手：寮で準備中' };
    openDay(data.records, id, data.day, data.trainees[id], M);
  }
  data.records.matches ??= []; data.records.games ??= [];
  data.matches = { v:1, seq:0, fixtures:[], active:null, nextPlay:null, pitching:null };
  data.v = SNAPSHOT_VERSION;
  return assertSnapshot(data);
}
