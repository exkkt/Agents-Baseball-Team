import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Club, CLOCK_RATE } from '../dist/ballclub/sim.js';
import { AgentDirector } from '../dist/ballclub/brain.js';
import { STEP } from '../dist/ballclub/stepper.js';
import { PLAYERS } from '../dist/ballclub/agents.js';
import { query, compare, fmt, METRICS } from '../dist/ballclub/metrics.js';
import { makeStore, addPractice, addSleep, chunkFor, queueChunk } from '../dist/ballclub/records.js';
import { checkText, LIMITS, analysisValidate } from '../dist/ballclub/analyst.js';
import { migrateSnapshot, assertSnapshot } from '../dist/ballclub/save-format.js';
import { MockLLM, tick, kindOf } from './helpers/mock-llm.mjs';

const PER_MIN = Math.round(1 / (STEP * CLOCK_RATE));
const at = (day, hhmm) => { const [h, m] = hhmm.split(':').map(Number); return (day - 1) * 1440 + h * 60 + m; };
const untilClock = (c, day, hhmm) => { const t = at(day, hhmm); while (c.minutes < t - 1e-9) c.step(STEP); };
async function runUntil(c, day, hhmm) { const t = at(day, hhmm); while (c.minutes < t - 1e-9) { for (let i = 0; i < PER_MIN; i++) c.step(STEP); await tick(); } }
const rules = () => { const c = new Club({ seed: 21 }); const d = new AgentDirector({ seed: 21, mode: 'rules' }).start(c); return { c, d }; };
const rep = (minutes, gained, expected, exp = { bat: gained }) => ({ menu: 'batting', intensity: 'normal', minutes, planned: minutes, fatigue0: 10, fatigue1: 20, exp, expectBy: {}, gained, expected });

test('metrics: rates are total numerator / total denominator; missing and zero denominators are not zero; unknown ids are rejected', () => {
  const st = makeStore({ M: 0, day: 1, lineage: 'T' });
  addPractice(st, { player: 'aoki', day: 1, start: 540, end: 600, rep: rep(60, 12, 10) });
  addPractice(st, { player: 'aoki', day: 2, start: 540, end: 570, rep: rep(30, 3, 6) });
  addPractice(st, { player: 'mori', day: 1, start: 540, end: 540, rep: { ...rep(0, 0, 0), menu: 'fielding' } });
  const src = { store: st };
  assert.equal(query(src, { metric: 'expPerHour', players: ['aoki'] }).value, (12 + 3) * 60 / 90, '日ごとの率の平均（12, 6）ではない');
  assert.equal(query(src, { metric: 'expVsExpected', players: ['aoki'] }).value, 15 / 16);
  const z = query(src, { metric: 'expPerHour', players: ['mori'] });
  assert.equal(z.value, null); assert.equal(z.status, 'zero_denominator');
  const none = query(src, { metric: 'practiceMinutes', players: ['kubo'] });
  assert.equal(none.value, null); assert.equal(none.status, 'no_data');
  const zero = query(src, { metric: 'practiceMinutes', players: ['mori'] });
  assert.equal(zero.value, 0); assert.equal(zero.status, 'ok', '確認できたゼロは 0');
  assert.throws(() => query(src, { metric: 'eval' })); assert.throws(() => query(src, { metric: 'sleepQuality', groupBy: 'menu' }));
  assert.ok(query(src, { metric: 'practiceMinutes', players: ['aoki'] }).sparse, '記録が少ないことを返す');
  // 経験値と基礎能力の増加は別の指標
  addSleep(st, { player: 'aoki', rec: { id: 's', kind: 'main', start: 1380, end: 1830, minutes: 450, wakeups: [], endedBy: 'wake', quality: 0.7, fatigue: [40, 10], gains: { bat: 0.2, field: 0, pitch: 0, run: 0 }, consolidated: { bat: 9 } }, startDay: 1, forDay: 2 });
  assert.equal(query(src, { metric: 'abilityGain', players: ['aoki'] }).value, 0.2);
  assert.equal(query(src, { metric: 'expGained', players: ['aoki'] }).value, 15);
  assert.deepEqual(query(src, { metric: 'wakeFatigue', groupBy: 'day' }).groups.map(g => [g.key, g.value]), [[2, 10]], '睡眠は起床した日に数える');
});

test('analysis by rules: the report keeps the same numbers as the shared query, records its data and reaches the right people', () => {
  const { c, d } = rules();
  untilClock(c, 3, '13:00');
  const r = d.analyst.st.reports[0];
  assert.ok(r, '2日目以降の定例分析でレポートができる');
  for (const k of ['id', 'createdDay', 'period', 'players', 'metrics', 'data', 'facts', 'findings', 'insight', 'recommendations', 'caveats', 'recipients', 'generatedBy', 'asOf']) assert.ok(r[k] !== undefined, k);
  assert.equal(r.generatedBy, 'rule');
  // 事実の数値は、同じ時点で共通の集計をやり直した値と一致する（画面・報告文・グラフで同じ）
  for (const f of r.facts.filter(x => !x.groupBy)) {
    const q = query({ store: d.records }, { metric: f.metric, from: f.from, to: f.to, players: f.player ? [f.player] : null, asOf: r.asOf.seq });
    assert.equal(f.value, q.value); assert.equal(f.display, fmt(f.metric, q.value)); assert.equal(f.count, q.count);
  }
  assert.ok(r.findings.every(x => x.factText.includes(r.facts.find(f => f.id === x.fact).display) || x.factText.includes('記録なし')));
  assert.ok(r.caveats.some(x => /原因は確認していません/.test(x)));
  assert.ok(r.recipients.some(x => x.who === 'manager'));
  assert.ok(r.recipients.every(x => x.status === 'delivered' || x.held), '報告済みか、伝えられない理由を残す');
  assert.ok(c.events.some(e => /小野アナリストが.*にレポート .* を報告/.test(e.text)));
});

test('the data is fixed when the analysis starts: records added later never change the report', async () => {
  const { c, d } = rules();
  untilClock(c, 2, '09:20');
  const ask = d.analyst.request({ trigger: 'owner', by: 'owner', players: ['aoki'], from: 1, to: 2, theme: 'efficiency' });
  assert.ok(ask.ok);
  untilClock(c, 2, '09:45');
  const j = d.analyst.st.jobs.find(x => x.id === ask.id) || d.analyst.st.jobs.find(x => x.trigger === 'owner');
  const asOf = j.asOf.seq;
  untilClock(c, 2, '17:00');
  const r = d.analyst.st.reports.find(x => x.jobId === j.id);
  assert.ok(r, '依頼のレポートができる');
  assert.ok(d.records.seq > asOf, '分析中にも記録は増えた');
  for (const f of r.facts.filter(x => !x.groupBy)) assert.equal(f.value, query({ store: d.records }, { metric: f.metric, from: f.from, to: f.to, players: f.player ? [f.player] : null, asOf }).value);
  const now = query({ store: d.records }, { metric: 'practiceMinutes', from: 1, to: 2, players: ['aoki'] }).value;
  const fixed = r.facts.find(f => f.metric === 'practiceMinutes' && f.period === 'current' && !f.groupBy)?.value;
  assert.ok(fixed != null && now >= fixed);
});

test('analysis with the shared model: the analyst chooses players, periods and metrics within limits, one inference at a time, while others keep working', async () => {
  let holdWrite = true; const released = [];
  const llm = new MockLLM({ delay: p => kindOf(p.schema) === 'analysis_write' && holdWrite ? 'hold' : 1 });
  const c = new Club({ seed: 21 }), d = new AgentDirector({ seed: 21, provider: llm, mode: 'llm' }).start(c);
  await runUntil(c, 2, '09:20');
  const minutesBefore = d.trainees.aoki.today.minutes;
  for (let i = 0; i < 300 && !llm.held.length; i++) { for (let k = 0; k < PER_MIN; k++) c.step(STEP); await tick(); }
  assert.ok(llm.held.length, '考察の推論で待っている');
  for (let i = 0; i < 60; i++) { for (let k = 0; k < PER_MIN; k++) c.step(STEP); await tick(); }
  assert.ok(d.trainees.aoki.today.minutes > minutesBefore, '分析の推論待ちの間も選手は練習している');
  holdWrite = false; llm.held.splice(0).forEach(r => { released.push(1); r(); });
  await runUntil(c, 2, '15:00');
  assert.equal(llm.max, 1);
  const r = d.analyst.st.reports[0];
  assert.ok(r && r.generatedBy === 'llm' && r.planBy === 'llm');
  assert.ok(r.data.followups <= LIMITS.maxFollowups && r.players.length <= LIMITS.maxPlayers);
  assert.ok(r.facts.some(f => f.groupBy === 'menu'), '追加の調査（メニュー別）を許可された道具で行った');
  // 採用した提案（ケアを入れる）が実際の予定に反映される
  await runUntil(c, 2, '17:00');
  const rec = r.recommendations.find(x => x.type === 'add_care');
  assert.equal(rec.status, 'adopted');
  assert.ok(d.records.events.some(e => e.kind === 'report_decision' && e.ref === r.id));
  assert.ok(d.agents[rec.player].changes.some(ch => /ケア/.test(ch.text)));
});

test('report text is checked: numbers must match the computed facts and causal claims are removed', () => {
  const facts = [{ id: 'f1', display: '8.5', groups: null, from: 1, to: 3, count: 4, days: 3 }];
  const issues = [];
  assert.equal(checkText('練習効率は8.5だった。疲労が原因で効率が下がった。', facts, issues, 'x'), '練習効率は8.5だった。');
  assert.equal(checkText('効率は12.3に上がった。', facts, issues, 'x'), '');
  assert.ok(issues.length === 2);
  const v = analysisValidate('analysis_plan', JSON.stringify({ players: ['aoki', 'nobody'], metrics: ['expPerHour', 'DROP TABLE'], current_from: -5, current_to: 999, baseline_from: 0, baseline_to: 0, archive: true, focus: 'x', reason: 'r' }), { ctx: { players: Object.keys(PLAYERS).map(id => ({ id })), minDay: 1, maxDay: 4, archive: false } });
  assert.deepEqual(v.decision.players, ['aoki']); assert.deepEqual(v.decision.metrics, ['expPerHour']);
  assert.deepEqual(v.decision.current, { from: 1, to: 4 }); assert.equal(v.decision.archive, false);
});

test('Drive archive: the analyst searches and fetches within the limits and reuses fetched records', async () => {
  const { c, d } = rules();
  untilClock(c, 2, '09:00');
  const old = makeStore({ M: 0, day: 1, lineage: d.records.lineage });
  for (let day = 1; day <= 8; day++) addPractice(old, { player: 'aoki', day: -10 + day, start: 0, end: 30, rep: rep(30, 5, 5) });
  const calls = { search: 0, fetch: 0 };
  d.archive = { available: () => true, search: async ({ fromDay, toDay }) => { calls.search++; return Array.from({ length: 8 }, (_, k) => ({ id: 'c' + k, day: -9 + k, players: ['aoki'] })).filter(f => f.day >= fromDay && f.day <= toDay); }, fetch: async id => { calls.fetch++; return chunkFor(old, -9 + Number(id.slice(1))); } };
  d.records.legacy.days = []; d.records.since.day = 1;
  const ask = d.analyst.request({ trigger: 'owner', by: 'owner', players: ['aoki'], from: 1, to: 1, theme: 'efficiency' });
  const j = d.analyst.st.jobs.find(x => x.id === ask.id);
  j.plan = { players: ['aoki'], metrics: ['practiceMinutes'], current: { from: 1, to: 1 }, baseline: { from: -9, to: 0 }, archive: true, focus: '' };
  j.stage = 'collect'; j.work = 0; j.asOf = { seq: d.records.seq, M: d.M, clock: c.clock, day: d.day };
  d.analyst.collect(j);
  for (let i = 0; i < 20 && j.pending; i++) await tick();
  assert.equal(calls.search, 1); assert.equal(calls.fetch, LIMITS.maxFetch, `取得は上限 ${LIMITS.maxFetch}件まで`);
  assert.ok(j.archiveRows.length > 0 && j.notes.some(n => /上限/.test(n)));
  const base = query({ store: d.records, extra: j.archiveRows }, { metric: 'practiceMinutes', from: -9, to: 0, players: ['aoki'] });
  assert.equal(base.value, LIMITS.maxFetch * 30, 'Driveから取得した記録も同じ集計で数える');
});

test('migration: a real v1 save loads without resetting progress, keeps no call cap, and imports only what was saved', async () => {
  const v1 = JSON.parse(await readFile(new URL('./fixtures/save-v1.json', import.meta.url), 'utf8'));
  assert.equal(v1.v, 1); assertSnapshot(v1);
  const v2 = migrateSnapshot(v1);
  assert.equal(v2.v, 3); assert.ok(v2.agents.analyst, '小野アナリスト（新しい人物）を追加');
  const c = new Club({ seed: v2.seed }), d = AgentDirector.restore(c, v2, { mode: 'rules' });
  assert.equal(d.day, v1.day); assert.equal(c.clock, '16:30');
  for (const id of Object.keys(v1.trainees)) assert.deepEqual(d.trainees[id].ability, v1.trainees[id].ability, '能力は初期化しない');
  assert.ok(d.records.legacy.days.length > 0 && d.records.legacy.sleeps.every(s => s.start === null && s.minutes === null), '保存していない就寝時刻は作らない');
  assert.ok(Object.values(d.agents).every(a => !('used' in a)), '旧BUDGETの使用回数は制限として残らない');
  untilClock(c, 4, '10:00');
  assert.ok(d.decisions.filter(r => r.minute > v2.gm).every(r => r.source !== 'limit'));
  const m = query({ store: d.records }, { metric: 'practiceMinutes', groupBy: 'menu', players: ['aoki'] });
  assert.ok(m.groups.some(g => g.key === '(内訳なし)'), '既存セーブの日はメニュー内訳なしとして区別');
  assert.ok(compare({ store: d.records }, { players: ['aoki'], from: 1, to: 3, metrics: ['expVsExpected'] })[0].cells.expVsExpected.notes.some(n => /対象外/.test(n)), '見込み値のない既存の期間は対象外と明示');
  // 移行後のセーブも検証を通り、もう一度読み込める
  const again = AgentDirector.restore(new Club({ seed: 21 }), migrateSnapshot(JSON.parse(JSON.stringify(d.serialize()))), { mode: 'rules' });
  assert.equal(again.day, d.day);
});

test('records for Drive: one chunk per closed day with its sleeps; the same chunk is queued only once', () => {
  const { c, d } = rules();
  untilClock(c, 3, '05:00');
  assert.deepEqual(d.records.outbox.filter(o => o.kind === 'records').map(o => o.day), [1, 2]);
  queueChunk(d.records, 1); assert.equal(d.records.outbox.filter(o => o.day === 1).length, 1);
  const ch = chunkFor(d.records, 1);
  assert.ok(ch.records.practice.length > 0 && ch.records.days.length === Object.keys(PLAYERS).length);
  assert.ok(ch.records.sleeps.every(s => s.forDay === 1), '睡眠は起床した日のチャンクに入る（夜中の睡眠も途中で切れない）');
  assert.equal(chunkFor(d.records, 2).records.sleeps.filter(s => s.kind === 'main').length, Object.keys(PLAYERS).length);
  void METRICS;
});
