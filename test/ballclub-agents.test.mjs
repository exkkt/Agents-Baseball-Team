import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Club, CLOCK_RATE } from '../dist/ballclub/sim.js';
import { AgentDirector } from '../dist/ballclub/brain.js';
import { Stepper, STEP } from '../dist/ballclub/stepper.js';
import { PLAYERS, COACHES, validate, buildPrompt, schemaFor } from '../dist/ballclub/agents.js';
import { MENUS } from '../dist/ballclub/growth.js';
import { MockLLM, tick, kindOf } from './helpers/mock-llm.mjs';

const PER_MIN = Math.round(1 / (STEP * CLOCK_RATE)); // ゲーム内1分＝360刻み（動作の6秒）
const mins = (club, n) => { for (let i = 0; i < n * PER_MIN; i++) club.step(STEP); };
const at = (day, hhmm) => { const [h, m] = hhmm.split(':').map(Number); return (day - 1) * 1440 + h * 60 + m; };
const untilClock = (club, day, hhmm) => { const target = at(day, hhmm); while (club.minutes < target - 1e-9) club.step(STEP); };
const rules = (seed = 21) => { const c = new Club({ seed }); const d = new AgentDirector({ seed, mode: 'rules' }).start(c); return { c, d }; };
const llmClub = (llm, seed = 21) => { const c = new Club({ seed }); const d = new AgentDirector({ seed, provider: llm, mode: 'llm' }).start(c); return { c, d }; };
async function runAsync(c, minutes) { for (let i = 0; i < minutes; i++) { mins(c, 1); await tick(); } }
const PIDS = Object.keys(PLAYERS);

test('time axes: 1 real second = 10 game seconds, while walking stays at natural speed', () => {
  const c = new Club({ seed: 3 }); c.place('gm', 'gm-seat', 'pc');
  c.intend('gm', { do: 'goto', spot: 'lineup-view', then: 'look' });
  const g0 = c.minutes, x0 = c.person('gm');
  for (let i = 0; i < 60; i++) c.step(STEP); // 動作の1秒
  assert.ok(Math.abs((c.minutes - g0) * 60 - 10) < 1e-6, 'ゲーム内の時計は10秒進む');
  assert.ok(c.person('gm').stepDist > 30 && c.person('gm').stepDist < 45, `歩行は従来どおり毎秒約38px（${c.person('gm').stepDist.toFixed(1)}px）`);
  void x0;
});

test('24-hour world: the day goes past 18:30; people eat, practise, spend the evening, sleep and wake on their own clocks', () => {
  const { c, d } = rules();
  untilClock(c, 1, '20:30');
  assert.equal(c.clock, '20:30'); assert.equal(d.day, 1);
  assert.ok(PIDS.every(id => d.agents[id].life.state === 'awake'), '夕食後も起きて活動している');
  assert.ok(['hcoach', 'manager', 'gm'].every(id => c.person(id).away), 'スタッフは退勤して帰宅');
  untilClock(c, 2, '02:00');
  assert.ok(PIDS.every(id => d.agents[id].life.state === 'asleep' && c.person(id).at === `dorm-${d.agents[id].life.bed}`), '全員が自分の寮のベッドで眠る（ケア用ベッドではない）');
  untilClock(c, 2, '10:00');
  const sleeps = d.records.sleeps.filter(s => s.kind === 'main');
  assert.equal(sleeps.length, PIDS.length, '一人一回の睡眠が記録される');
  assert.ok(new Set(sleeps.map(s => s.start)).size >= 3 && new Set(sleeps.map(s => s.end)).size >= 3, '就寝・起床の時刻は人によって違う');
  for (const s of sleeps) { assert.ok(s.end > s.start && s.minutes > 300 && s.startDay === 1 && s.forDay === 2); assert.ok(Array.isArray(s.wakeups) && s.quality > 0 && s.fatigueWake <= s.fatigueBed); }
  assert.ok(PIDS.every(id => d.decisions.some(r => r.who === id && r.kind === 'day_plan' && r.day === 2)), '起床後にその日の方針と予定を決める');
  assert.ok(!c.person('hcoach').away && !c.person('analyst').away, 'スタッフは朝に出勤する');
  // 夜の練習（自主練）は全体練習と区別して記録される
  assert.ok(d.records.practice.every(p => typeof p.self === 'boolean'));
});

test('display speed does not change results: 1x / 2x / 4x, frame jitter and fast-forward give identical state; pause stops everything', () => {
  const N = PER_MIN * 300;
  const run = (speed, frame) => { const { c, d } = rules(); const s = new Stepper(); let k = 0; while (s.steps < N) s.advance(c, frame(k++), speed); while (s.steps > N) throw Error('overshoot'); return { c, d, s }; };
  const a = run(1, () => 1 / 60), b = run(4, () => 1 / 60), j = run(2, k => [0.004, 0.03, 0.012, 0.05][k % 4]);
  for (const r of [a, b, j]) while (r.s.steps < N) { r.c.step(STEP); r.s.steps++; }
  assert.deepEqual(b.d.trainees, a.d.trainees); assert.deepEqual(j.d.trainees, a.d.trainees);
  // 早送り：時計だけを飛ばさず、同じ刻みを実行する
  const f = rules(), fs = new Stepper(), target = f.c.minutes + 300;
  let guard = 0; while (!fs.fastForward(f.c, target, { budgetMs: 5 }).done && guard++ < 10000);
  const g = rules(); while (g.c.minutes < f.c.minutes - 1e-9) g.c.step(STEP);
  assert.deepEqual(f.d.trainees, g.d.trainees); assert.deepEqual(f.d.records.practice, g.d.records.practice);
  const { c } = rules(), s = new Stepper(), t0 = c.minutes, f0 = JSON.stringify(c.director.trainees), w0 = JSON.stringify(c.director.analyst.st);
  for (let i = 0; i < 100; i++) s.advance(c, 0.05, 4, true);
  assert.equal(c.minutes, t0); assert.equal(JSON.stringify(c.director.trainees), f0); assert.equal(JSON.stringify(c.director.analyst.st), w0);
});

test('normal play and fast-forward through a night give the same sleep, recovery and growth', () => {
  const a = rules(), b = rules();
  untilClock(a.c, 1, '20:00'); untilClock(b.c, 1, '20:00');
  const s = new Stepper(); let guard = 0; while (!s.fastForward(b.c, at(2, '06:30'), { budgetMs: 3 }).done && guard++ < 100000);
  untilClock(a.c, 2, '06:30');
  assert.deepEqual(b.d.trainees, a.d.trainees);
  assert.deepEqual(b.d.records.sleeps, a.d.records.sleeps);
  assert.ok(a.d.records.sleeps.length >= 1);
});

test('while one person waits for the model, others keep living; never more than one inference at a time', async () => {
  // 最後に起きる人の「一日の予定」の推論を止める（先に起きた人の判断は先に済む）
  const probe = rules().d, last = PIDS.reduce((a, b) => probe.agents[a].life.wakeAt >= probe.agents[b].life.wakeAt ? a : b), lastName = new Club().person(last).label;
  const llm = new MockLLM({ delay: p => p.user.includes('起床した。今日の方針') && p.system.includes(`「${lastName}」`) ? 'hold' : 1 });
  const { c, d } = llmClub(llm);
  await runAsync(c, 240);
  assert.equal(d.agents[last].decision.state, 'thinking');
  const aoki = last === 'aoki' ? 'yamada' : 'aoki';
  assert.ok(d.trainees[aoki].today.minutes >= 30, `先に予定が決まった人は練習している（${d.trainees[aoki].today.minutes}分）`);
  assert.ok(c.person('analyst').stepDist > 0, 'スタッフも動いている');
  assert.equal(llm.max, 1); assert.equal(d.maxActive, 1);
  llm.held.forEach(r => r()); await runAsync(c, 3);
  assert.ok(d.decisions.some(r => r.who === last && r.kind === 'day_plan' && r.source === 'llm'));
  await runAsync(c, 300);
  assert.equal(llm.max, 1, `同時に1件まで（呼び出し ${llm.calls.length}件）`);
});

test('no daily call cap: people use the model beyond the old per-day budget, never switched to rules by a count; calls are statistics only', async () => {
  const llm = new MockLLM({ delay: () => 1 });
  const { c, d } = llmClub(llm);
  await runAsync(c, at(1, '18:00') - c.minutes);
  assert.ok(d.decisions.every(r => r.source === 'llm'), 'ルール（上限）への切り替えはない');
  const calls = id => llm.calls.filter(p => p.system.includes(`「${c.person(id).label}」`)).length;
  const most = PIDS.map(calls).sort((a, b) => b - a)[0];
  assert.ok(most > 5, `旧上限（選手5回）を超えて判断できる（最大 ${most}回）`);
  assert.equal(d.agents.aoki.calls.today, calls('aoki'), '今日の呼び出し回数は統計として数える');
  // 活動日の区切り（04:00）で一度だけ統計をリセットする
  await runAsync(c, at(2, '04:01') - c.minutes);
  assert.equal(d.agents.aoki.calls.today, 0); assert.ok(d.agents.aoki.calls.total >= most || d.agents.aoki.calls.total > 0);
  assert.equal(d.rolledAt, at(2, '04:00'));
  const days = d.records.days.filter(r => r.day === 1);
  assert.equal(days.length, PIDS.length, '1日目の記録は一人一回だけ閉じる');
});

test('executing a planned schedule does not call the model; it is only asked at breakpoints', async () => {
  const llm = new MockLLM({ delay: () => 1 });
  const { c, d } = llmClub(llm);
  await runAsync(c, at(1, '09:10') - c.minutes);
  const ag = d.agents.aoki;
  ag.plan.morning = [{ menu: 'swing', minutes: 40, intensity: 'normal' }, { menu: 'stretch', minutes: 30, intensity: 'light' }, { menu: 'running', minutes: 40, intensity: 'normal' }, { menu: 'rest', minutes: 60, intensity: 'normal' }];
  // 区切りでの検討（届いた提案）と疲労の見直しは別。予定の実行のための呼び出しを数える
  const planCalls = () => llm.calls.filter(p => p.system.includes('「青木 #21」') && ['day_plan', 'next'].includes(kindOf(p.schema))).length;
  const n0 = planCalls(), blocks0 = d.blockSeq;
  await runAsync(c, 120);
  assert.equal(planCalls(), n0, '予定どおりに次のメニューへ進むだけなら LLM を呼ばない');
  assert.ok(d.blockSeq > blocks0 + 2, '予定の行動は進んでいる');
});

test('the same request is never queued twice (waiting, thinking or waiting to apply); new requests on the same topic are allowed later', async () => {
  const llm = new MockLLM({ delay: () => 'hold' });
  const { c, d } = llmClub(llm);
  await runAsync(c, 3);
  const inflight = d.inflight;
  assert.equal(d.enqueue(inflight.kind, inflight.who, { topic: inflight.base.split(':')[2] }), null, '推論中と同じ要求はまとめる');
  const r1 = d.enqueue('review', 'hcoach', { topic: 'x' }), r2 = d.enqueue('review', 'hcoach', { topic: 'x' });
  assert.ok(r1 && r2 === null && d.queue.filter(q => q.base === 'hcoach:review:x').length === 1);
  assert.ok(d.stats.merged >= 2);
  d.queue.splice(d.queue.indexOf(r1), 1);
  assert.ok(d.enqueue('review', 'hcoach', { topic: 'x' }), '片付いたあとは同じ話題でも新しく判断できる');
});

test('a hung request is cut off by the watchdog and replaced by rules (marked as fallback)', async () => {
  const llm = new MockLLM({ delay: () => 'hold' });
  const { c, d } = llmClub(llm);
  d.hardTimeoutMs = 0;
  await runAsync(c, 5);
  const r = d.decisions[0];
  assert.equal(r.source, 'fallback'); assert.equal(r.error, 'timeout');
  assert.ok(c.events.some(e => e.text.includes('ルール代替：応答が時間切れ')));
});

test('connection failure: life goes on with rules across midnight, clearly marked, never shown as an LLM decision', async () => {
  const llm = new MockLLM({ fail: { ok: false, error: 'connect', ms: 5 } });
  const { c, d } = llmClub(llm);
  await runAsync(c, at(2, '08:00') - c.minutes);
  assert.equal(d.day, 2, '夜を越えて進行する');
  assert.ok(d.decisions.length > 20 && d.decisions.every(r => r.source !== 'llm'));
  const text = c.events.filter(e => e.kind === 'decision').map(e => e.text);
  assert.ok(text.every(t => !t.includes('ローカルLLM')) && text.some(t => t.includes('ルール代替')));
  assert.ok(PIDS.every(id => d.records.practice.some(p => p.player === id)));
  const off = { state: { checked: true, ok: false }, available: false, decide: () => { throw Error('呼ばれないはず'); } };
  const c2 = new Club({ seed: 21 }), d2 = new AgentDirector({ seed: 21, provider: off, mode: 'llm' }).start(c2);
  mins(c2, 60);
  assert.ok(d2.decisions.length >= 8 && d2.decisions.every(r => r.source === 'fallback'));
});

test('sleeping people are not asked to decide; the model is not called through the night', async () => {
  const llm = new MockLLM({ delay: () => 1 });
  const { c, d } = llmClub(llm);
  await runAsync(c, at(1, '23:45') - c.minutes);
  const n = llm.calls.length;
  d.enqueue('next', 'aoki', { topic: 'test' });
  await runAsync(c, at(2, '05:30') - c.minutes);
  assert.equal(llm.calls.length, n, '深夜（全員が寝ている・スタッフも就寝）は推論しない');
  assert.ok(d.queue.some(r => r.who === 'aoki'), '眠っている人の要求は起きるまで待つ（取り消さない・ルールにしない）');
});

test('invalid answers: unknown IDs and out-of-range values are rejected or clamped; broken JSON falls back', async () => {
  const ctx = { menus: PLAYERS.aoki.menus, eveningMenus: ['swing', 'running', 'stretch', 'care', 'rest', 'free'], usualBed: '23:00', players: COACHES.hcoach.players, menusOf: Object.fromEntries(COACHES.hcoach.players.map(p => [p, PLAYERS[p].menus])), items: [{ id: 'I1' }, { id: 'I2' }], role: 'coach' };
  const v = validate('next', JSON.stringify({ blocks: [{ menu: 'pitching', minutes: 30, intensity: 'normal' }, { menu: 'fly', minutes: 30 }, { menu: 'batting', minutes: 999, intensity: 'max' }, { menu: 'swing', minutes: 'x' }], reason: '<b>理由</b>' + 'あ'.repeat(80) }), ctx);
  assert.ok(v.ok); assert.deepEqual(v.decision.blocks, [{ menu: 'batting', minutes: 90, intensity: 'normal' }]);
  assert.ok(v.decision.reason.length <= 60 && !v.decision.reason.includes('<'));
  const p = validate('day_plan', JSON.stringify({ focus: 'party', morning: [{ menu: 'batting', minutes: 30, intensity: 'normal' }], afternoon: [], evening: [{ menu: 'batting', minutes: 30, intensity: 'normal' }, { menu: 'swing', minutes: 300, intensity: 'hard' }], bedtime: '03:00', reason: 'r' }), ctx);
  assert.equal(p.decision.focus, 'balanced'); assert.equal(p.decision.bedtime, '23:00');
  assert.deepEqual(p.decision.evening, [{ menu: 'swing', minutes: 60, intensity: 'hard' }], '夜はケージ打撃を選べず、長さも上限で切る');
  const k = validate('consider', JSON.stringify({ decisions: [{ id: 'I1', choice: 'adopt', reason: 'x' }, { id: 'I9', choice: 'adopt' }], reason: 'r' }), ctx);
  assert.deepEqual(k.decision.decisions.map(x => [x.id, x.choice]), [['I1', 'adopt'], ['I2', 'hold']], '答えのない項目は採用せず保留');
  assert.equal(validate('staff_plan', JSON.stringify({ focus: 'nap', watch: 'none', note: '', reason: 'r' }), ctx).ok, false);
  assert.equal(validate('next', 'これはJSONではない', ctx).ok, false);
  const r = validate('review', JSON.stringify({ proposals: [{ player: 'yamada', menu: 'rest', minutes: 20, intensity: 'normal', message: 'x' }, { player: 'aoki', menu: 'rest', minutes: 200, intensity: 'normal', message: 'y' }], note: '', reason: 'r' }), ctx);
  assert.deepEqual(r.decision.proposals.map(x => [x.player, x.minutes]), [['aoki', 60]]);
  const llm = new MockLLM({ raw: () => '{"morning": [' });
  const { c, d } = llmClub(llm);
  await runAsync(c, 20);
  assert.ok(d.decisions.length > 0 && d.decisions.every(x => x.source === 'fallback' && x.error === 'invalid'));
});

test('stale answers are re-checked: not executed when the situation changed while waiting', async () => {
  const llm = new MockLLM({ delay: (p, n) => n === 1 ? 'hold' : 1 });
  const { c, d } = llmClub(llm);
  await runAsync(c, 3);
  const who = d.inflight.who; d.agents[who].rev++;
  llm.held.forEach(r => r());
  await runAsync(c, 2);
  const rec = d.decisions.find(r => r.who === who && r.kind === 'day_plan');
  assert.equal(rec.applied, false); assert.match(rec.note, /状況が変わった/);
});

test('non-urgent coach proposals wait for the player\'s next breakpoint; urgent fatigue proposals and constraints act at once', () => {
  const { c, d } = rules();
  untilClock(c, 1, '09:40');
  const ag = d.agents.aoki, tr = d.trainees.aoki;
  d.finish(c, 'aoki'); ag.plan.morning = [{ menu: 'swing', minutes: 40, intensity: 'normal' }]; d.startBlock(c, 'aoki', { menu: 'batting', minutes: 60, intensity: 'normal' });
  const blk = ag.block;
  d.deliver('aoki', { kind: 'proposal', kindLabel: '提案', from: 'hcoach', fromLabel: '高橋打撃コーチ', text: '素振り', change: { type: 'block', block: { menu: 'swing', minutes: 20, intensity: 'light' } }, changeText: '素振り', urgent: false, needsDecision: true });
  mins(c, 5);
  assert.equal(ag.block, blk, '緊急でない提案では、実行中の練習を中断しない');
  assert.ok(d.queue.every(r => !(r.who === 'aoki' && r.kind === 'consider')), '区切りまで検討を保留');
  tr.fatigue = 70; ag.block.phase = 'active';
  d.deliver('aoki', { kind: 'proposal', kindLabel: '提案', from: 'hcoach', fromLabel: '高橋打撃コーチ', text: 'ストレッチ', change: { type: 'block', block: { menu: 'stretch', minutes: 20, intensity: 'light' } }, changeText: 'ストレッチ', urgent: true, needsDecision: true });
  mins(c, 2);
  assert.notEqual(ag.block?.id, blk.id, '急ぎの提案はすぐに検討し、採用すれば練習を切り替える');
  // プログラム側の制約（LLM の順番を待たない）
  tr.fatigue = 65; d.finish(c, 'aoki'); d.startBlock(c, 'aoki', { menu: 'batting', minutes: 60, intensity: 'hard' });
  assert.equal(ag.block.intensity, 'normal', '疲労60以上では強めを通常に下げる');
  tr.fatigue = 87.9; ag.block.phase = 'active'; ag.block.spot = c.person('aoki').at;
  for (let i = 0; i < 5; i++) d.playerMinute(c, 'aoki', d.M);
  assert.equal(ag.block.menu, 'rest', '疲労88で練習を止めて休憩');
  assert.ok(c.events.some(e => e.kind === 'warn' && e.who.includes('aoki')));
});

test('a consultation ends (adopted / declined / held too often) and a new one can start; new facts reopen the same topic', () => {
  const { c, d } = rules();
  untilClock(c, 1, '10:00');
  const item = d.deliver('mori', { kind: 'proposal', kindLabel: '提案', from: 'fcoach', fromLabel: '岡守備コーチ', text: 'x', change: { type: 'block', block: { menu: 'stretch', minutes: 20, intensity: 'light' } }, changeText: 'x', urgent: false, needsDecision: true, thread: 'T-a' });
  d.threads['T-a'] = { id: 'T-a', from: 'fcoach', to: 'mori', topic: 'stretch', status: 'open', openedAt: d.M, turns: 1 };
  assert.ok(d.threadBlock('fcoach', 'mori'), '検討中は同じ相手に新しい提案を送らない');
  for (let k = 0; k < 3; k++) d.decideItem(c, 'mori', item, 'hold', '情報不足', 'rule');
  assert.equal(item.status, 'closed'); assert.match(item.end, /進展がない/);
  assert.equal(d.threads['T-a'].status, 'closed');
  const item2 = d.deliver('mori', { kind: 'proposal', kindLabel: '提案', from: 'fcoach', fromLabel: '岡守備コーチ', text: 'y', change: null, urgent: false, needsDecision: true, thread: 'T-b' });
  d.threads['T-b'] = { id: 'T-b', from: 'fcoach', to: 'mori', topic: 'rest', status: 'open', openedAt: d.M, turns: 1 };
  d.decideItem(c, 'mori', item2, 'decline', 'いまは続けたい', 'rule');
  assert.ok(d.threadBlock('fcoach', 'mori'), '同じ状況のままなら、見送られた提案を繰り返さない');
  d.trainees.mori.fatigue += 20; // 新しい事実（疲労の変化）
  assert.equal(d.threadBlock('fcoach', 'mori'), null, '状況が変われば同じ話題でも再検討できる');
  assert.ok(d.records.events.some(e => e.kind === 'proposal_decision' && /見送り/.test(e.text)));
});

test('sleep and growth are never double counted: across midnight, naps and interrupted sleep, growth equals the sum of sleep records', () => {
  const { c, d } = rules();
  const start = Object.fromEntries(PIDS.map(id => [id, { ...d.trainees[id].ability }]));
  untilClock(c, 1, '12:20'); d.trainees.sato.fatigue = 80; // 昼寝をしやすくする（疲れていると昼食後に仮眠）
  untilClock(c, 4, '10:00');
  for (const id of PIDS) {
    const sum = a => d.records.sleeps.filter(s => s.player === id).reduce((n, s) => n + s.gains[a], 0);
    for (const a of ['bat', 'field', 'pitch', 'run']) assert.ok(Math.abs(d.trainees[id].ability[a] - start[id][a] - sum(a)) < 0.01, `${id} ${a}：能力の増加＝睡眠の定着分の合計`);
    for (const v of Object.values(d.trainees[id].exp)) assert.ok(v >= 0);
  }
  for (const r of d.records.days) { const g = d.records.sleeps.filter(s => s.player === r.player && s.forDay === r.day).reduce((n, s) => n + s.gains.bat, 0); assert.ok(Math.abs(r.abilityEnd.bat - r.abilityStart.bat - g) < 0.01, '日別の能力の変化＝その日に終わった睡眠の定着分'); }
  const ids = d.records.sleeps.map(s => s.id); assert.equal(new Set(ids).size, ids.length, '同じ睡眠を二重に記録しない');
  assert.ok(d.records.sleeps.some(s => s.kind === 'nap'), '昼寝も記録される');
});

test('memories and plans are per person: prompts carry only that person\'s own state and memory', async () => {
  const llm = new MockLLM({ delay: () => 1 });
  const { c, d } = llmClub(llm);
  await runAsync(c, at(1, '11:00') - c.minutes);
  d.agents.yamada.recent.push({ time: '10:00', text: '山田だけの秘密のメモ-XYZ' });
  const aokiPrompt = buildPrompt('next', d.context({ who: 'aoki', kind: 'next' }));
  assert.ok(!aokiPrompt.user.includes('XYZ') && !aokiPrompt.system.includes('山田'));
  const fPrompt = buildPrompt('review', d.context({ who: 'fcoach', kind: 'review' }));
  assert.ok(fPrompt.user.includes('山田') && !fPrompt.user.includes('青木 #21('));
  assert.notEqual(d.agents.aoki.recent, d.agents.yamada.recent);
  assert.ok(llm.calls.filter(p => p.system.includes('「青木 #21」')).every(p => !p.user.includes('XYZ')));
});

test('save and resume at night, while walking and mid-analysis continue exactly like the original', () => {
  for (const [day, hhmm] of [[1, '23:10'], [2, '06:41'], [2, '10:02']]) {
    const { c, d } = rules();
    untilClock(c, day, hhmm); mins(c, 0.5);
    const data = JSON.parse(JSON.stringify(d.serialize()));
    const c2 = new Club({ seed: 21 }), d2 = AgentDirector.restore(c2, data, { mode: 'rules' });
    assert.equal(c2.clock, c.clock); assert.deepEqual(d2.trainees, d.trainees); assert.deepEqual(d2.agents, d.agents);
    for (const cl of [c, c2]) untilClock(cl, 2, '12:00');
    assert.deepEqual(d2.trainees, d.trainees, `${day}日目 ${hhmm} の保存から同じ経過`);
    assert.deepEqual(d2.records.sleeps, d.records.sleeps); assert.deepEqual(d2.analyst.st, d.analyst.st);
    assert.deepEqual(c2.events.map(e => e.text), c.events.map(e => e.text));
  }
});

test('pending reports, held items and changed plans survive save and resume', () => {
  const { c, d } = rules();
  untilClock(c, 1, '10:00');
  d.deliver('aoki', { kind: 'proposal', kindLabel: '提案', from: 'hcoach', fromLabel: '高橋打撃コーチ', text: '保存テスト', change: null, urgent: false, needsDecision: true });
  d.agents.aoki.plan.afternoon = [{ menu: 'running', minutes: 30, intensity: 'normal' }];
  const c2 = new Club({ seed: 21 }), d2 = AgentDirector.restore(c2, JSON.parse(JSON.stringify(d.serialize())), { mode: 'rules' });
  assert.ok(d2.agents.aoki.inbox.some(i => i.text === '保存テスト' && i.status === 'pending'));
  assert.deepEqual(d2.agents.aoki.plan.afternoon, [{ menu: 'running', minutes: 30, intensity: 'normal' }]);
});

test('replaying the recorded decisions (including LLM ones) reproduces the same growth', async () => {
  const llm = new MockLLM({ delay: (p, n) => 1 + (n * 7) % 5 });
  const { c, d } = llmClub(llm);
  let k = 0;
  for (let i = 0; i < 700; i++) { mins(c, 1); for (let j = 0; j < (k++ % 3); j++) await tick(); }
  assert.ok(d.decisions.filter(r => r.source === 'llm').length > 15);
  const c2 = new Club({ seed: 21 }), d2 = new AgentDirector({ seed: 21, mode: 'llm', replay: d.decisions }).start(c2);
  mins(c2, 700);
  assert.deepEqual(d2.trainees, d.trainees);
});

test('LLM output schemas only offer allowed IDs', () => {
  const s = schemaFor('day_plan', { menus: PLAYERS.endo.menus, eveningMenus: ['running', 'stretch', 'care', 'rest', 'free'] });
  assert.deepEqual(s.properties.morning.items.properties.menu.enum, PLAYERS.endo.menus);
  assert.ok(!s.properties.evening.items.properties.menu.enum.includes('batting'));
  assert.ok(Object.keys(MENUS).includes('free'));
});

test('new state modules stay DOM-free', async () => {
  for (const f of ['growth.js', 'agents.js', 'brain.js', 'llm.js', 'stepper.js', 'records.js', 'metrics.js', 'analyst.js', 'save-format.js', 'drive-archive.js']) {
    const src = await readFile(new URL(`../dist/ballclub/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /document\.|window\.|getContext|requestAnimationFrame|localStorage/, f);
  }
});
