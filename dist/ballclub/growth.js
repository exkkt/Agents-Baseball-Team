// 練習・疲労・睡眠・成長のルール。ゲーム内の仮定であり、現実の人体を再現するものではない。
// 数値の計算はすべてここで行い、AI（LLM）には計算済みの結果だけを渡す。DOM に依存しない
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const r1 = n => Math.round(n * 10) / 10, r2 = n => Math.round(n * 100) / 100;

// 状態を保存できる乱数（mulberry32）。人物ごとに別の系列を持たせ、他人の判断の時期が変わっても揺らぎが混ざらないようにする
export class Rng {
  constructor(seed) { this.s = seed >>> 0; }
  next() { this.s = (this.s + 0x6D2B79F5) >>> 0; let t = this.s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }
  normal() { const u = Math.max(1e-9, this.next()), v = this.next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
}
export const seedFor = (seed, key) => { let h = (2166136261 ^ seed) >>> 0; for (const ch of String(key)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return h; };

export const ABILITIES = { bat: '打撃', field: '守備', pitch: '投球', run: '走力' };
export const INTENSITY = {
  light: { label: '軽め', gain: 0.6, fatigue: 0.5 },
  normal: { label: '通常', gain: 1.0, fatigue: 1.0 },
  hard: { label: '強め', gain: 1.3, fatigue: 1.7 }
};

// 練習メニュー。gains＝1分あたりにどの能力の経験が入るか（相対値）、fatigue＝1分あたりの疲労、recover＝1分あたりの回復
// spots は使える地点と、そこでの動作（sim.js の ACTS）。light に別の動作があれば lightAct
export const MENUS = {
  batting: { label: 'フリー打撃', kind: 'practice', gains: { bat: 1 }, fatigue: 0.32, coach: 'hcoach', spots: [{ spot: 'cage-bat', act: 'bat' }], note: '打撃が伸びる・疲労 中' },
  swing: { label: '素振り', kind: 'practice', gains: { bat: 0.45 }, fatigue: 0.15, coach: 'hcoach', spots: [{ spot: 'swing-spot', act: 'swing' }], note: '打撃が少し伸びる・疲労 小' },
  fielding: { label: '守備ノック', kind: 'practice', gains: { field: 1 }, fatigue: 0.28, coach: 'fcoach', spots: [{ spot: 'short', act: 'field' }, { spot: 'second', act: 'field' }, { spot: 'first', act: 'firstbase' }], note: '守備が伸びる・疲労 中' },
  pitching: { label: 'ブルペン投球', kind: 'practice', gains: { pitch: 1 }, fatigue: 0.5, coach: 'pcoach', spots: [{ spot: 'mound', act: 'pitch' }], note: '投球が伸びる・疲労 大' },
  catching: { label: 'ブルペン捕球', kind: 'practice', gains: { field: 0.7 }, fatigue: 0.3, coach: 'pcoach', spots: [{ spot: 'plate', act: 'catch' }], note: '捕手の守備が伸びる・疲労 中' },
  running: { label: 'ダッシュ走', kind: 'practice', gains: { run: 1 }, fatigue: 0.42, spots: [{ spot: 'track-w', act: 'run', lightAct: 'jog' }], note: '走力が伸びる・疲労 大' },
  stretch: { label: 'ストレッチ', kind: 'recover', recover: 0.1, spots: [{ spot: 'stretch', act: 'stretch' }, { spot: 'stretch-2', act: 'stretch' }], note: '疲労が少し抜ける' },
  rest: { label: '休憩', kind: 'recover', recover: 0.22, spots: ['bench-2', 'bench-3', 'bench-4', 'locker-1', 'locker-2', 'cafe-2-0', 'cafe-2-1', 'cafe-2-2', 'cafe-2-3', 'cafe-1-0', 'cafe-1-1', 'cafe-1-2'].map(spot => ({ spot, act: 'sitrest' })), note: '疲労が抜ける' },
  care: { label: 'トレーナーのケア', kind: 'recover', recover: 0.3, trainerBonus: 1.3, spots: [{ spot: 'bed-1', act: 'lie' }, { spot: 'bed-2', act: 'lie' }], note: '疲労がよく抜ける（トレーナーがいると効果増）' },
  meal: { label: '食事', kind: 'recover', recover: 0.22, internal: true, spots: [], note: '' },
  // 生活の行動（予定・ルールで実行し、LLM は選ばない）。回復は休憩と同じ扱い
  free: { label: '自由時間', kind: 'recover', recover: 0.05, internal: true, spots: [], note: '' }, // 夜の自由時間で疲れが抜けきらないように（主な回復は睡眠）
  prep: { label: '身支度・準備', kind: 'recover', recover: 0.04, internal: true, spots: [], note: '' }
};
// 夜の自主練で選べるメニュー（グラウンド照明の下でできるもの）
export const SELF_MENUS = ['swing', 'running', 'stretch'];
export const PRACTICE_MENUS = Object.keys(MENUS).filter(k => MENUS[k].kind === 'practice');

// 調整できる係数（README「成長ルール」に説明）
export const TUNING = {
  expPerMinute: 0.25, // 条件がすべて標準のときの 1 分あたり経験
  dimMinutes: 90, // 同じ能力の練習を続けたときの逓減の強さ（この分数で効率が半分）
  freshFatigue: 30, // これ以下の疲労では効率が落ちない
  fatigueSlope: 80, // 疲労 freshFatigue+この値 で効率が下限に達する
  minFatigueEff: 0.2,
  coachBonus: 1.15, // 担当コーチが見ているときの効率
  dayLuckSd: 0.18, // 日ごとの揺らぎ（対数正規の標準偏差）
  blockLuckSd: 0.3, // 練習 1 回ごとの揺らぎ
  expPerPoint: 60, // 能力 1 上げるのに必要な定着経験（能力50付近）
  carryOver: 0.5, // 定着しなかった経験のうち翌日に残る割合
  nightRecovery: 34, // 睡眠で抜ける疲労の基準値（標準の睡眠 450 分あたり）
  lateLoadPenalty: 0.0015, // 就寝前90分以内の練習 1 分あたりの睡眠の質の低下
  idleRecover: 0.04, // 移動・待機中の 1 分あたり回復
  abilityMin: 20, abilityMax: 99
};
export const fatigueEff = f => f <= TUNING.freshFatigue ? 1 : Math.max(TUNING.minFatigueEff, 1 - (f - TUNING.freshFatigue) / TUNING.fatigueSlope);
export const sleepEff = q => 0.85 + 0.3 * q; // 昨夜の睡眠の質（0〜1）で回復状態を表す
export const levelCost = a => 1 + ((a - 40) / 25) ** 2; // 能力が高いほど上げにくい
export const condLabel = c => c >= 0.5 ? '絶好調' : c >= 0.15 ? '好調' : c > -0.15 ? '普通' : c > -0.5 ? '不調' : '絶不調';
export const fatigueLabel = f => f >= 80 ? 'かなり高い' : f >= 60 ? '高い' : f >= 35 ? 'ふつう' : '低い';

export function makeTrainee(init, seed) {
  const id = init.id;
  return {
    id, ability: { ...init.ability }, exp: { bat: 0, field: 0, pitch: 0, run: 0 }, fatigue: init.fatigue ?? 15, condition: init.condition ?? 0,
    sleep: { quality: init.sleep ?? 0.7, night: 0 }, dayLuck: 1, traits: { growth: { bat: 1, field: 1, pitch: 1, run: 1, ...init.growth }, recovery: init.recovery ?? 1, stamina: init.stamina ?? 1, sleep: init.sleepTrait ?? 0 },
    rng: new Rng(seedFor(seed, 'train:' + id)).s, today: newDay(), history: [], last: null, perf: { cage: 0, good: 0, sharp: 0 }, asleep: null, lastSleep: null
  };
}
const newDay = () => ({ minutes: 0, hardLate: 0, load: { bat: 0, field: 0, pitch: 0, run: 0 }, exp: { bat: 0, field: 0, pitch: 0, run: 0 }, byMenu: {}, practiceLog: [] });
// 活動日の区切り（04:00）で一度だけ呼ぶ。練習時間・逓減・打撃の出来を新しい日に切り替える
export function newPracticeDay(tr) { tr.today = newDay(); tr.perf = { cage: 0, good: 0, sharp: 0 }; }
const rngOf = tr => { const g = new Rng(0); g.s = tr.rng; return g; };
const saveRng = (tr, g) => { tr.rng = g.s; };

// 練習 1 回を始めるときの揺らぎ（同じ練習でも毎回の結果が変わる）
export function blockLuck(tr) { const g = rngOf(tr); const v = clamp(Math.exp(TUNING.blockLuckSd * g.normal()), 0.45, 1.9); saveRng(tr, g); return r2(v); }

// 1 分の活動を反映する。block={menu,intensity,luck,acc}。acc に実績・見込み・要因の積算を残す
export function applyMinute(tr, block, ctx = {}) {
  const M = MENUS[block.menu], I = INTENSITY[block.intensity] || INTENSITY.normal, acc = block.acc ??= newAcc(tr);
  acc.minutes++;
  if (M.kind === 'recover') {
    const rec = M.recover * tr.traits.recovery * (ctx.trainer && M.trainerBonus ? M.trainerBonus : 1);
    tr.fatigue = clamp(tr.fatigue - rec, 0, 100);
    return;
  }
  const fe = fatigueEff(tr.fatigue), se = sleepEff(tr.sleep.quality), ce = ctx.coach ? TUNING.coachBonus : 1, luck = tr.dayLuck * block.luck;
  for (const [a, w] of Object.entries(M.gains)) {
    const de = 1 / (1 + tr.today.load[a] / TUNING.dimMinutes);
    const base = TUNING.expPerMinute * w * I.gain, expect = base * fe * se * ce * de, got = expect * luck;
    tr.exp[a] += got; tr.today.exp[a] += got; tr.today.load[a] += w * I.gain;
    acc.exp[a] = (acc.exp[a] || 0) + got; acc.expect[a] = (acc.expect[a] || 0) + expect; acc.base[a] = (acc.base[a] || 0) + base;
    acc.f.fatigue += fe * base; acc.f.sleep += se * base; acc.f.coach += ce * base; acc.f.dim += de * base; acc.w += base;
  }
  tr.fatigue = clamp(tr.fatigue + M.fatigue * I.fatigue / tr.traits.stamina, 0, 100);
  tr.today.minutes++; tr.today.byMenu[block.menu] = (tr.today.byMenu[block.menu] || 0) + 1;
  if (block.intensity === 'hard' && ctx.minuteOfDay >= 16 * 60 + 30) tr.today.hardLate++;
  if (ctx.at != null) { const log = (tr.today.practiceLog ??= []); log.push(ctx.at); if (log.length > 120) log.shift(); }
}
export const idleMinute = tr => { tr.fatigue = clamp(tr.fatigue - TUNING.idleRecover * tr.traits.recovery, 0, 100); };
const newAcc = tr => ({ minutes: 0, exp: {}, expect: {}, base: {}, f: { fatigue: 0, sleep: 0, coach: 0, dim: 0 }, w: 0, fatigue0: tr.fatigue });

// 練習 1 回の結果。数値は積算した実績そのもの。説明は計算に使った要因だけで組み立てる
export function blockReport(tr, block) {
  const M = MENUS[block.menu], acc = block.acc || newAcc(tr);
  const rep = { menu: block.menu, label: M.label, intensity: block.intensity, minutes: acc.minutes, planned: block.minutes, fatigue0: r1(acc.fatigue0), fatigue1: r1(tr.fatigue), kind: M.kind };
  if (M.kind !== 'practice' || !acc.w) return rep;
  const sum = o => Object.values(o).reduce((s, v) => s + v, 0);
  rep.exp = Object.fromEntries(Object.entries(acc.exp).map(([k, v]) => [k, r2(v)]));
  rep.gained = r2(sum(acc.exp)); rep.expected = r2(sum(acc.expect)); rep.baseline = r2(sum(acc.base));
  rep.expectBy = Object.fromEntries(Object.entries(acc.expect).map(([k, v]) => [k, r2(v)]));
  rep.luck = r2(tr.dayLuck * block.luck); rep.dayLuck = tr.dayLuck; rep.blockLuck = block.luck;
  rep.factors = { fatigue: r2(acc.f.fatigue / acc.w), sleep: r2(acc.f.sleep / acc.w), coach: r2(acc.f.coach / acc.w), dim: r2(acc.f.dim / acc.w) };
  rep.cond = r2(rep.baseline ? rep.expected / rep.baseline : 1); // 条件による見込みの増減（揺らぎを除く）
  rep.verdict = rep.luck >= 1.25 ? 'big' : rep.luck <= 0.75 ? 'small' : 'normal';
  return rep;
}
export function describeReport(rep, name) {
  const I = INTENSITY[rep.intensity]?.label || '';
  if (rep.kind !== 'practice') return `${name}：${rep.label} ${rep.minutes}分。疲労 ${rep.fatigue0}→${rep.fatigue1}`;
  const gains = Object.entries(rep.exp).map(([k, v]) => `${ABILITIES[k]}経験 +${v.toFixed(1)}`).join('・');
  const head = rep.verdict === 'big' ? '成果が大きかった。' : rep.verdict === 'small' ? '成果は小さかった。' : '';
  const why = rep.verdict === 'normal' ? '' : `（見込み ${rep.expected.toFixed(1)} に対し ×${rep.luck.toFixed(2)}。日と回の揺らぎによる）`;
  const cond = rep.cond <= 0.8 ? `条件補正 ×${rep.cond.toFixed(2)}（疲労×${rep.factors.fatigue}・睡眠×${rep.factors.sleep}・逓減×${rep.factors.dim}）。` : '';
  return `${name}：${rep.label} ${rep.minutes}分（${I}）→ ${gains}。${head}${why}${cond}疲労 ${rep.fatigue0}→${rep.fatigue1}`;
}

// 睡眠は「就寝 → 1分ごとの回復 → 起床（または中断）」の行動。経験の定着と翌日の調子は、起床時に一度だけ計算する。
// 定着の量は眠った長さに比例する（昼寝は少し、標準の 450 分で満額）。同じ経験は一度定着した分だけ減るので、
// 日付をまたいでも・昼寝や中断をはさんでも、同じ経験が二重に能力へ変換されることはない
export const SLEEP = { fullMinutes: 450, mainMin: 180, longMinutes: 420 };
export function startSleep(tr, { M = 0, id = null, kind = 'main', lateLoad = 0 } = {}) {
  const g = rngOf(tr), f = tr.fatigue;
  // 寝付きの見込み：適度な疲労で少し良く、疲労65超・遅い時間の強い練習・就寝直前の練習で悪化、＋乱数
  const qb = clamp(0.66 + tr.traits.sleep + 0.0015 * Math.min(f, 60) - 0.008 * Math.max(0, f - 65) - 0.002 * tr.today.hardLate - TUNING.lateLoadPenalty * lateLoad + 0.1 * g.normal(), 0.15, 1);
  saveRng(tr, g);
  tr.asleep = { id, kind, start: M, minutes: 0, qb, fatigue0: f, wakeups: [], awakeLeft: 0 };
  return tr.asleep;
}
// 眠っている 1 分（途中で目が覚めている間は回復しない）
export function sleepMinute(tr) {
  const s = tr.asleep; if (!s) return;
  if (s.awakeLeft > 0) { s.awakeLeft--; s.wakeups[s.wakeups.length - 1].minutes++; return; }
  s.minutes++;
  tr.fatigue = clamp(tr.fatigue - TUNING.nightRecovery * (0.7 + 0.6 * s.qb) * tr.traits.recovery / SLEEP.fullMinutes, 0, 100);
}
// 夜中に一度目が覚める（記録に残る。眠りの質が少し下がる）
export function wakeDuringSleep(tr, M, minutes) { const s = tr.asleep; if (!s) return; s.wakeups.push({ at: M, minutes: 0 }); s.awakeLeft = minutes; }
export function endSleep(tr, { M = 0, day = 0, reason = 'wake' } = {}) {
  const s = tr.asleep; if (!s) return null;
  tr.asleep = null;
  const g = rngOf(tr), df = clamp(s.minutes / SLEEP.fullMinutes, 0, 1), main = s.minutes >= SLEEP.mainMin;
  const q = clamp(s.qb * (0.75 + 0.25 * Math.min(1, s.minutes / SLEEP.longMinutes)) - 0.04 * s.wakeups.length, 0.1, 1);
  const gains = {}, consolidated = {};
  for (const a of Object.keys(tr.exp)) {
    const pending = tr.exp[a], conv = pending * (0.45 + 0.4 * q) * df;
    const before = tr.ability[a], gain = before >= TUNING.abilityMax ? 0 : conv / (TUNING.expPerPoint * levelCost(before)) * tr.traits.growth[a];
    tr.ability[a] = clamp(before + gain, TUNING.abilityMin, TUNING.abilityMax);
    tr.exp[a] = Math.max(0, (pending - conv) * (1 - (1 - TUNING.carryOver) * df));
    gains[a] = tr.ability[a] - before; consolidated[a] = conv;
  }
  if (main) {
    const c0 = tr.condition;
    tr.condition = clamp(0.45 * c0 + 0.3 * g.normal() + 0.6 * (q - 0.66) - 0.008 * Math.max(0, tr.fatigue - 45), -1, 1);
    tr.dayLuck = r2(clamp(Math.exp(TUNING.dayLuckSd * g.normal()), 0.6, 1.6));
    tr.sleep = { quality: r2(q), night: day, id: s.id, end: M, minutes: s.minutes };
  }
  saveRng(tr, g);
  const rec = { id: s.id, kind: main ? 'main' : 'nap', start: s.start, end: M, minutes: s.minutes, wakeups: s.wakeups.map(w => ({ ...w })), endedBy: reason, quality: r2(q), fatigue: [r1(s.fatigue0), r1(tr.fatigue)], gains: Object.fromEntries(Object.entries(gains).map(([k, v]) => [k, Math.round(v * 1000) / 1000])), consolidated: Object.fromEntries(Object.entries(consolidated).map(([k, v]) => [k, r2(v)])), condition: r2(tr.condition) };
  tr.lastSleep = rec;
  return rec;
}

// 従来の「夜の一括計算」と同じ結果を返す互換用（標準の 450 分をまとめて眠る）。成長の性質のテストで使う
export function nightly(tr, day) {
  startSleep(tr, { M: 0, id: 'night-' + day });
  for (let i = 0; i < SLEEP.fullMinutes; i++) sleepMinute(tr);
  const r = endSleep(tr, { M: SLEEP.fullMinutes, day });
  const rec_ = { day, minutes: tr.today.minutes, exp: Object.fromEntries(Object.entries(tr.today.exp).map(([k, v]) => [k, r2(v)])), gains: r.gains, sleep: r.quality, fatigue: r.fatigue, condition: r.condition, perf: { ...tr.perf } };
  newPracticeDay(tr);
  return rec_;
}

// 打撃ケージでの「今日の出来」。能力・調子・疲労で決まり、成長には使わない
export const cageForm = tr => clamp(0.3 + (tr.ability.bat - 50) / 90 + 0.12 * tr.condition - 0.004 * Math.max(0, tr.fatigue - 40), 0.1, 0.95);
