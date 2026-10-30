import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTrainee, applyMinute, blockLuck, blockReport, nightly, startSleep, sleepMinute, endSleep, wakeDuringSleep, MENUS, TUNING, Rng, SLEEP } from '../dist/ballclub/growth.js';

const INIT = { id: 'x', ability: { bat: 55, field: 50, pitch: 30, run: 55 }, fatigue: 20 };
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = xs => { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); };
// 1 回の練習（同じ条件・別シード）で得た経験
function session({ seed, fatigue = 15, sleep = 0.85, menu = 'batting', minutes = 60, intensity = 'normal', coach = true, condition = 0 }) {
  const tr = makeTrainee({ ...INIT, fatigue, condition }, seed); tr.sleep.quality = sleep;
  const b = { menu, intensity, minutes, luck: blockLuck(tr) };
  for (let i = 0; i < minutes; i++) applyMinute(tr, b, { coach });
  return { tr, rep: blockReport(tr, b) };
}
// 練習の予定を日ごとに繰り返す（残りは休憩）
function days(seed, plan, n = 20) {
  const tr = makeTrainee(INIT, seed);
  for (let d = 1; d <= n; d++) {
    let used = 0;
    for (const [menu, min, intensity] of plan) { const b = { menu, intensity, minutes: min, luck: blockLuck(tr) }; for (let i = 0; i < min; i++) applyMinute(tr, b, { coach: true, minuteOfDay: 600 }); used += min; }
    const rest = { menu: 'rest', intensity: 'normal', luck: 1 }; for (let i = used; i < 450; i++) applyMinute(tr, rest, {});
    nightly(tr, d);
  }
  return tr;
}
const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

test('same seed reproduces the same result; different practices of the same kind vary', () => {
  assert.deepEqual(session({ seed: 7 }).rep, session({ seed: 7 }).rep);
  const xs = SEEDS.map(seed => session({ seed }).rep.gained);
  assert.ok(sd(xs) / mean(xs) > 0.15, `ばらつきがある（変動係数 ${(sd(xs) / mean(xs)).toFixed(2)}）`);
  assert.ok(Math.min(...xs) < mean(xs) * 0.6, '好条件でも成果の小さい回がある');
});

test('conditions shift the average: fatigue and poor sleep lower expected growth', () => {
  const good = mean(SEEDS.map(seed => session({ seed }).rep.gained));
  const tired = mean(SEEDS.map(seed => session({ seed, fatigue: 75 }).rep.gained));
  const poorSleep = mean(SEEDS.map(seed => session({ seed, sleep: 0.25 }).rep.gained));
  const light = mean(SEEDS.map(seed => session({ seed, intensity: 'light' }).rep.gained));
  const noCoach = mean(SEEDS.map(seed => session({ seed, coach: false }).rep.gained));
  assert.ok(good > poorSleep * 1.1 && poorSleep > tired * 1.5, `好条件 ${good.toFixed(1)} > 睡眠不足 ${poorSleep.toFixed(1)} > 疲労 ${tired.toFixed(1)}`);
  assert.ok(good > noCoach && good > light, '指導あり・通常強度のほうが平均は高い');
  // 同じ乱数系列なので、条件の差は見込み（expected）の差としてそのまま出る
  assert.ok(session({ seed: 3 }).rep.expected > session({ seed: 3, fatigue: 75 }).rep.expected);
});

test('practice types grow different abilities', () => {
  const by = menu => session({ seed: 5, menu }).rep.exp;
  assert.deepEqual(Object.keys(by('batting')), ['bat']);
  assert.deepEqual(Object.keys(by('fielding')), ['field']);
  assert.deepEqual(Object.keys(by('pitching')), ['pitch']);
  assert.deepEqual(Object.keys(by('running')), ['run']);
  const rest = session({ seed: 5, menu: 'rest', fatigue: 50 });
  assert.equal(rest.rep.exp, undefined); assert.ok(rest.tr.fatigue < 50, '休憩で疲労が下がる');
});

test('more practice is not always better: diminishing returns and fatigue give rest a value (20 days x 100 seeds)', () => {
  const plans = {
    moderate: [['batting', 60, 'normal'], ['rest', 20, 'normal'], ['batting', 50, 'normal'], ['rest', 20, 'normal'], ['swing', 40, 'normal']],
    heavy: [['batting', 90, 'hard'], ['batting', 90, 'hard'], ['batting', 90, 'hard'], ['swing', 90, 'hard']],
    max: [['batting', 90, 'hard'], ['batting', 90, 'hard'], ['batting', 90, 'hard'], ['batting', 90, 'hard'], ['swing', 90, 'hard']]
  };
  const gain = plan => mean(SEEDS.slice(0, 100).map(seed => days(seed, plan).ability.bat - INIT.ability.bat));
  const g = Object.fromEntries(Object.entries(plans).map(([k, p]) => [k, gain(p)]));
  assert.ok(g.moderate > g.heavy && g.heavy > g.max, JSON.stringify(g));
  // 1 日の中でも逓減する：120分の見込みは 60分の 2 倍より小さい
  const s60 = mean(SEEDS.slice(0, 100).map(seed => session({ seed, minutes: 60 }).rep.expected)), s120 = mean(SEEDS.slice(0, 100).map(seed => session({ seed, minutes: 120 }).rep.expected));
  assert.ok(s120 < 2 * s60 * 0.9, `逓減：60分 ${s60.toFixed(1)} → 120分 ${s120.toFixed(1)}`);
});

test('ability grows slowly from accumulated experience, not in one practice', () => {
  let maxNight = 0;
  for (const seed of SEEDS.slice(0, 100)) {
    const tr = makeTrainee(INIT, seed);
    for (const b of [['batting', 90], ['batting', 90], ['batting', 90]].map(([menu, minutes]) => ({ menu, minutes, intensity: 'hard', luck: blockLuck(tr) }))) for (let i = 0; i < b.minutes; i++) applyMinute(tr, b, { coach: true });
    const before = tr.ability.bat; nightly(tr, 1); maxNight = Math.max(maxNight, tr.ability.bat - before);
    assert.equal(tr.ability.bat >= before, true);
  }
  assert.ok(maxNight > 0 && maxNight < 1, `一晩の最大の伸び ${maxNight.toFixed(3)}`);
});

test('condition (daily form) does not change growth; daily luck is separate', () => {
  const a = session({ seed: 11, condition: 0.9 }), b = session({ seed: 11, condition: -0.9 });
  assert.equal(a.rep.gained, b.rep.gained);
});

test('values stay in range over a long random schedule', () => {
  const g = new Rng(42), menus = Object.keys(MENUS).filter(m => m !== 'meal'), ints = ['light', 'normal', 'hard'];
  for (const seed of [1, 2, 3, 4, 5]) {
    const tr = makeTrainee({ ...INIT, fatigue: 95, condition: 1 }, seed);
    for (let d = 1; d <= 60; d++) {
      for (let k = 0; k < 8; k++) { const b = { menu: menus[Math.floor(g.next() * menus.length)], intensity: ints[Math.floor(g.next() * 3)], minutes: 60, luck: blockLuck(tr) }; for (let i = 0; i < 60; i++) { applyMinute(tr, b, { coach: g.next() < 0.5, minuteOfDay: 1000 }); assert.ok(tr.fatigue >= 0 && tr.fatigue <= 100); } }
      const r = nightly(tr, d);
      assert.ok(r.sleep >= 0.15 && r.sleep <= 1);
      assert.ok(tr.condition >= -1 && tr.condition <= 1);
      for (const v of Object.values(tr.ability)) assert.ok(v >= TUNING.abilityMin && v <= TUNING.abilityMax);
      for (const v of Object.values(tr.exp)) assert.ok(v >= 0);
    }
  }
});

test('sleep is an action: consolidation happens once, in proportion to the time actually slept (naps, interruptions, midnight)', () => {
  const tr = makeTrainee(INIT, 9); tr.exp.bat = 40;
  // 昼寝 30 分：少しだけ定着し、残りは消えずに持ち越す
  startSleep(tr, { M: 750, id: 'n1', kind: 'nap' }); for (let i = 0; i < 30; i++) sleepMinute(tr);
  const nap = endSleep(tr, { M: 780, day: 1 });
  assert.equal(nap.kind, 'nap'); assert.ok(nap.consolidated.bat > 0 && nap.consolidated.bat < 40 * 0.1);
  assert.ok(tr.exp.bat > 30, '昼寝で定着しなかった経験はほぼ残る');
  const sleepBefore = tr.sleep; assert.equal(sleepBefore.quality, 0.7, '昼寝では翌日の練習に効く睡眠の質を更新しない');
  // 日付をまたぐ睡眠・途中で目が覚める：目覚めている間は回復しない
  const pending = tr.exp.bat, ab = tr.ability.bat;
  startSleep(tr, { M: 1380, id: 's1' }); for (let i = 0; i < 120; i++) sleepMinute(tr);
  wakeDuringSleep(tr, 1500, 10); const f = tr.fatigue; for (let i = 0; i < 10; i++) sleepMinute(tr); assert.equal(tr.fatigue, f);
  for (let i = 0; i < 300; i++) sleepMinute(tr);
  const r = endSleep(tr, { M: 1810, day: 2 });
  assert.equal(r.minutes, 420); assert.equal(r.wakeups.length, 1); assert.equal(r.wakeups[0].minutes, 10);
  assert.ok(r.consolidated.bat <= pending && tr.exp.bat < pending, '定着した分だけ経験が減る（二重に変換しない）');
  assert.ok(Math.abs(tr.ability.bat - ab - r.gains.bat) < 1e-3);
  assert.equal(endSleep(tr, { M: 1811, day: 2 }), null, '終わった睡眠をもう一度終えても何も起きない');
  assert.ok(SLEEP.fullMinutes === 450);
});

test('nightly self-practice and late bedtimes are not always better (20 days x 100 seeds)', () => {
  const run = (seed, extra, sleepMin) => {
    const tr = makeTrainee(INIT, seed);
    for (let d = 1; d <= 20; d++) {
      for (const [menu, min] of [['batting', 60], ['rest', 20], ['batting', 50], ['swing', 40], ...extra]) { const b = { menu, intensity: 'normal', minutes: min, luck: blockLuck(tr) }; for (let i = 0; i < min; i++) applyMinute(tr, b, { coach: menu !== 'swing' || !extra.length, minuteOfDay: 1300, at: 1300 + i }); }
      startSleep(tr, { M: 0, id: 'x' + d, lateLoad: extra.length ? 40 : 0 }); for (let i = 0; i < sleepMin; i++) sleepMinute(tr); endSleep(tr, { M: sleepMin, day: d });
      tr.today = makeTrainee(INIT, seed).today;
    }
    return tr.ability.bat - INIT.ability.bat;
  };
  const mean2 = xs => xs.reduce((a, b) => a + b, 0) / xs.length, seeds = SEEDS.slice(0, 100);
  const normal = mean2(seeds.map(s => run(s, [], 450))), lateGrind = mean2(seeds.map(s => run(s, [['swing', 40]], 330)));
  assert.ok(normal > lateGrind, `通常 ${normal.toFixed(2)} > 毎晩の自主練＋夜更かし ${lateGrind.toFixed(2)}`);
});
