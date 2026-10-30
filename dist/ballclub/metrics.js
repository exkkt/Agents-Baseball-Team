// 箱庭用の共通指標（セマンティックレイヤー）。分析画面と小野アナリストは同じ query() の結果を使う。
// 本編の dist/lib/semantic.js と同じ方針：登録された指標・分析軸だけを受け付け、自由式やSQLの実行口はない。
// 率は「合計分子 ÷ 合計分母」。分母ゼロ・記録なしは null（確認できたゼロとは区別する）。DOM に依存しない
import { rowsOf, pitchRows } from './records.js';

export const ABILITY_LABEL = { bat: '打撃', field: '守備', pitch: '投球', run: '走力' };
const sum = (rows, f) => rows.reduce((n, r) => n + (f(r) ?? 0), 0);
const expSum = (r, a) => a ? (r.exp?.[a] ?? 0) : Object.values(r.exp || {}).reduce((n, v) => n + v, 0);
const gainSum = (r, a) => a ? (r.gains?.[a] ?? 0) : Object.values(r.gains || {}).reduce((n, v) => n + v, 0);
const main = r => r.kind === 'main';

// 分析軸：day＝活動日（04:00 区切り）。睡眠は「起床した活動日（forDay）」に数える
export const DIMENSIONS = { player: '選手', menu: 'メニュー', ability: '能力', day: '日', session: '練習の種類', zone:'コース', count:'投球前カウント', pitchType:'球種', inning:'イニング' };
// source：どの記録を使うか。legacy：既存セーブから取り込んだ日別の記録を使えるか（使えない理由も残す）
export const METRICS = {
  practiceMinutes: { name: '練習時間', unit: '分', digits: 0, source: 'practice', legacy: 'days', dims: ['player', 'menu', 'day', 'session'], formula: 'Σ 練習の実行時間', description: '練習メニューを実際に行った分数（移動・待機・休憩・ケアを除く）', calc: rows => ({ value: sum(rows, r => r.minutes ?? r.practiceMinutes), denom: null }) },
  expGained: { name: '獲得経験', unit: '経験', digits: 1, source: 'practice', legacy: 'days', dims: ['player', 'menu', 'ability', 'day', 'session'], formula: 'Σ 練習で得た経験（能力への定着前）', description: '練習1分ごとに積算した経験。基礎能力の増加量とは別の指標', calc: (rows, a) => ({ value: sum(rows, r => expSum(r, a)), denom: null }) },
  expPerHour: { name: '練習1時間あたりの獲得経験', unit: '経験/時', digits: 1, source: 'practice', legacy: 'days', dims: ['player', 'menu', 'ability', 'day', 'session'], formula: 'Σ 獲得経験 ÷ Σ 練習時間 × 60', description: '練習の効率。日別の値の平均ではなく、期間の合計どうしで割る', calc: (rows, a) => ({ value: sum(rows, r => expSum(r, a)) * 60, denom: sum(rows, r => r.minutes ?? r.practiceMinutes) }) },
  expVsExpected: { name: '見込みに対する練習成果', unit: '倍', digits: 2, source: 'practice', legacy: null, legacyWhy: '既存セーブの日別履歴に見込み値がない', dims: ['player', 'menu', 'day', 'session'], formula: 'Σ 獲得経験 ÷ Σ 見込み経験', description: '条件（疲労・睡眠・指導・逓減）から見込んだ経験に対する実績。1より大きいと見込みより多い', calc: rows => ({ value: sum(rows, r => r.gained), denom: sum(rows, r => r.expected) }) },
  abilityGain: { name: '能力の成長量', unit: 'pt', digits: 2, source: 'sleep', legacy: 'sleeps', dims: ['player', 'ability', 'day'], formula: 'Σ 睡眠で定着した基礎能力の増加（起床した活動日に計上）', description: '基礎能力（20〜99）の増加。経験値とは別の指標', calc: (rows, a) => ({ value: sum(rows, r => gainSum(r, a)), denom: null }) },
  sleepQuality: { name: '睡眠の質（平均）', unit: '0〜1', digits: 2, source: 'sleep', filter: main, legacy: 'sleeps', dims: ['player', 'day'], formula: 'Σ 主な睡眠の質 ÷ 主な睡眠の回数', description: 'ゲーム内の仮定で計算した値。昼寝は含めない', calc: rows => ({ value: sum(rows, r => r.quality), denom: rows.length }) },
  sleepMinutes: { name: '睡眠時間（平均）', unit: '分', digits: 0, source: 'sleep', filter: main, legacy: null, legacyWhy: '既存セーブには就寝・起床の時刻がない', dims: ['player', 'day'], formula: 'Σ 主な睡眠の実際の睡眠時間 ÷ 回数', description: '就寝から起床まで。途中で目が覚めていた時間は除く', calc: rows => ({ value: sum(rows, r => r.minutes), denom: rows.length }) },
  wakeFatigue: { name: '起床時の疲労（平均）', unit: '0〜100', digits: 1, source: 'sleep', filter: main, legacy: 'sleeps', dims: ['player', 'day'], formula: 'Σ 主な睡眠から起きた時点の疲労 ÷ 回数', description: '測る場面を「起床時」に固定した平均', calc: rows => ({ value: sum(rows, r => r.fatigueWake), denom: rows.filter(r => r.fatigueWake != null).length }) },
  bedFatigue: { name: '就寝時の疲労（平均）', unit: '0〜100', digits: 1, source: 'sleep', filter: main, legacy: null, legacyWhy: '既存セーブの値は18:30の一括計算時点で、就寝時とは場面が違う', dims: ['player', 'day'], formula: 'Σ 主な睡眠に入った時点の疲労 ÷ 回数', description: '測る場面を「就寝時」に固定した平均', calc: rows => ({ value: sum(rows, r => r.fatigueBed), denom: rows.filter(r => r.fatigueBed != null).length }) }
};
// 試合成績も分析画面と小野が同じ分子・分母で集計する。投球回は内部ではアウト数で持つ。
const gameMetric = (name, digits, formula, calc, unit = '') => ({ name, unit, digits, source: 'match', legacy: null, dims: ['player', 'day'], formula, description: formula + '。終了した練習試合のみ。少ない出場数から能力や原因を断定しない', calc });
Object.assign(METRICS, {
  avgVelocity: gameMetric('平均球速（全球種）', 1, 'Σ 記録した球速 ÷ Σ 球速のある投球数', rs=>({value:sum(rs,r=>r.pitching?.velocitySum),denom:sum(rs,r=>r.pitching?.measuredPitches)}), 'km/h'),
  avgFastball: gameMetric('平均球速（ストレート）', 1, 'Σ ストレートの球速 ÷ Σ ストレート数', rs=>({value:sum(rs,r=>r.pitching?.fastballVelocitySum),denom:sum(rs,r=>r.pitching?.fastballs)}), 'km/h'),
  gamePA: gameMetric('打席数', 0, 'Σ 打席', rs => ({value:sum(rs,r=>r.PA)})),
  gameH: gameMetric('安打数', 0, 'Σ 安打', rs => ({value:sum(rs,r=>r.H)})),
  gameHR: gameMetric('本塁打数', 0, 'Σ 本塁打', rs => ({value:sum(rs,r=>r.HR)})),
  gameAVG: gameMetric('打率', 3, 'Σ 安打 ÷ Σ 打数', rs => ({value:sum(rs,r=>r.H),denom:sum(rs,r=>r.AB)})),
  gameOBP: gameMetric('出塁率', 3, '(Σ 安打 + 四球) ÷ Σ 打席（死球・犠飛のない簡略試合）', rs => ({value:sum(rs,r=>r.H+r.BB),denom:sum(rs,r=>r.PA)})),
  gameSLG: gameMetric('長打率', 3, 'Σ 塁打 ÷ Σ 打数', rs => ({value:sum(rs,r=>r.TB),denom:sum(rs,r=>r.AB)})),
  gamePitches: gameMetric('投球数', 0, 'Σ 投球数', rs => ({value:sum(rs,r=>r.pitching?.pitches)})),
  gameOuts: gameMetric('投球回', 0, 'Σ 投球アウト数 ÷ 3（表示は回.余りアウト）', rs => ({value:sum(rs,r=>r.pitching?.outs)})),
  gameERA: gameMetric('防御率', 2, 'Σ 失点 × 27 ÷ Σ 投球アウト数（失策のない簡略試合）', rs => ({value:sum(rs,r=>r.pitching?.R)*27,denom:sum(rs,r=>r.pitching?.outs)}))
});
const pitchMetric=(name,role,formula,calc,filter=null,unit='')=>({name,unit,digits:unit==='km/h'?1:3,source:'pitch',pitchRole:role,legacy:null,dims:['player','day','zone','count','pitchType','inning'],formula,description:formula+'。1球記録がある試合のみ。座標は捕手視点。',calc,filter});
Object.assign(METRICS,{
  pitcherVelocity:pitchMetric('条件別の平均球速','pitcher','Σ 球速 ÷ 記録した球数',rs=>({value:sum(rs,r=>r.velocity),denom:rs.length}),null,'km/h'),
  batterWhiffRate:pitchMetric('打者の空振り率','batter','Σ 空振り ÷ スイング数（空振り・ファウル・インプレー）',rs=>({value:rs.filter(p=>p.event==='swinging_strike').length,denom:rs.length}),r=>['swinging_strike','foul','in_play'].includes(r.event)),
  pitcherWhiffRate:pitchMetric('投手の奪空振り率','pitcher','Σ 空振り ÷ スイング数（空振り・ファウル・インプレー）',rs=>({value:rs.filter(p=>p.event==='swinging_strike').length,denom:rs.length}),r=>['swinging_strike','foul','in_play'].includes(r.event)),
  batterPitchAVG:pitchMetric('条件別の打率','batter','Σ 安打 ÷ Σ 打数。打席が決着した終球の条件で分類する',rs=>({value:rs.filter(p=>['1B','2B','3B','HR'].includes(p.result)).length,denom:rs.length}),r=>r.result&&r.result!=='BB')
});
export const METRIC_IDS = Object.keys(METRICS);
export const FEW_DAYS = 3; // これ未満の日数しか記録がなければ「記録が少ない」と表示する

// 表示用の丸め。画面・報告文・グラフで同じ関数を使い、数字を一致させる
export function fmt(metric, v) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (metric === 'gameOuts') return Math.floor(v / 3) + '.' + v % 3;
  const d = METRICS[metric]?.digits ?? 1;
  return v.toFixed(d);
}
export function unitText(metric) { const u = METRICS[metric].unit; return u === '倍' ? '倍' : u.includes('〜') ? `（${u}）` : ' ' + u; }
export const withUnit = (metric, v) => v == null ? '—（記録なし）' : `${fmt(metric, v)}${unitText(metric)}`;

function rowsFor(src, def, opt) {
  const kind = def.source, base = { from: opt.from, to: opt.to, players: opt.players, asOf: opt.asOf ?? Infinity, extra: src.extra || [] };
  let rows;
  if(kind==='pitch'){
    const raw=[...(src.store.games||[]).filter(r=>r.seq<=base.asOf).flatMap(r=>pitchRows(r,src.store.lineage)),...(src.extra||[]).filter(r=>r.t==='pitch')],seen=new Set();
    rows=raw.filter(r=>{const own=def.pitchRole==='pitcher'?r.half!==r.own:r.half===r.own,player=def.pitchRole==='pitcher'?r.pitcher:r.batter;if(!own||base.players&&!base.players.includes(player)||r.day<(base.from??-Infinity)||r.day>(base.to??Infinity)||seen.has(r.rid))return false;seen.add(r.rid);return true;}).map(r=>({...r,player:def.pitchRole==='pitcher'?r.pitcher:r.batter}));
  }else rows=rowsOf(src.store,kind,base).filter(r=>!r.legacy);
  if (def.filter) rows = rows.filter(def.filter);
  let legacy = [];
  if (def.legacy === 'days') legacy = rowsOf(src.store, 'day', base).filter(r => r.legacy);
  if (def.legacy === 'sleeps') legacy = rowsOf(src.store, 'sleep', base).filter(r => r.legacy);
  if (opt.session) rows = rows.filter(r => opt.session === 'self' ? r.self : !r.self);
  return { rows, legacy };
}
const dayOf = r => r.t === 'sleep' ? r.forDay : r.day;
function evaluate(def, rows, ability) {
  if (!rows.length) return { value: null, status: 'no_data' };
  const { value, denom } = def.calc(rows, ability);
  if (denom == null) return { value, status: 'ok' };
  if (!denom) return { value: null, status: 'zero_denominator' };
  return { value: value / denom, status: 'ok' };
}

// 1つの指標を、期間・選手・分析軸で集計する。opt: { metric, from, to, players, groupBy, ability, session, asOf }
export function query(src, opt) {
  const def = METRICS[opt.metric]; if (!def) throw Error('未登録の指標です：' + opt.metric);
  if (opt.groupBy && !def.dims.includes(opt.groupBy)) throw Error('この指標では使えない分析軸です：' + opt.groupBy);
  if (opt.ability && !ABILITY_LABEL[opt.ability]) throw Error('未登録の能力です');
  const { rows, legacy } = rowsFor(src, def, opt);
  // 既存セーブの記録は、詳細な記録がない日（選手×日）だけ使う。同じ日を二重に数えない（移行した日の途中までは合計として足す）
  const detailed = new Set(rows.map(r => r.player + ':' + dayOf(r)));
  const usable = legacy.filter(r => r.partial || !detailed.has(r.player + ':' + dayOf(r)));
  const all = [...rows, ...usable];
  const days = new Set(all.map(dayOf)), notes = [];
  if (usable.length) notes.push(`既存セーブから取り込んだ記録 ${usable.length}件を含む（${usable[0].source}）`);
  if (!['match','pitch'].includes(def.source) && !def.legacy && rowsOf(src.store, def.source === 'sleep' ? 'sleep' : 'day', { from: opt.from, to: opt.to, players: opt.players, asOf: opt.asOf ?? Infinity }).some(r => r.legacy)) notes.push(`既存セーブの期間は対象外（${def.legacyWhy}）`);
  const res = { metric: opt.metric, name: def.name, unit: def.unit, formula: def.formula, from: opt.from ?? null, to: opt.to ?? null, players: opt.players || null, ability: opt.ability || null, session: opt.session || null, count: all.length, legacyCount: usable.length, daysWithData: days.size, sparse: days.size < FEW_DAYS, notes, asOf: opt.asOf ?? null, ...evaluate(def, all, opt.ability) };
  if (opt.groupBy) {
    const groups = new Map(), add = (k, r) => { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); };
    for (const r of all) {
      if (opt.groupBy === 'player') add(r.player, r);
      else if (opt.groupBy === 'day') add(dayOf(r), r);
      else if (opt.groupBy === 'zone') add(r.zone,r);
      else if (opt.groupBy === 'count') add(`${r.before.balls}-${r.before.strikes}`,r);
      else if (opt.groupBy === 'pitchType') add(r.type,r);
      else if (opt.groupBy === 'inning') add(r.inning,r);
      else if (opt.groupBy === 'menu') add(r.legacy ? '(内訳なし)' : r.menu, r);
      else if (opt.groupBy === 'session') add(r.legacy ? '(内訳なし)' : r.self ? 'self' : 'team', r);
      else if (opt.groupBy === 'ability') for (const a of Object.keys(ABILITY_LABEL)) add(a, r);
    }
    res.groups = [...groups.entries()].map(([key, rs]) => ({ key, count: rs.length, ...evaluate(def, rs, opt.groupBy === 'ability' ? key : opt.ability) }));
    if (opt.groupBy === 'day') res.groups.sort((a, b) => a.key - b.key);
    if (opt.groupBy === 'ability') res.groups = res.groups.filter(g => g.value !== 0 || def.source === 'sleep');
  }
  return res;
}

// 選手比較表：選手 × 指標（各セルも query と同じ計算）
export function compare(src, { players, from, to, metrics, asOf }) {
  return players.map(p => ({ player: p, cells: Object.fromEntries(metrics.map(m => [m, query(src, { metric: m, from, to, players: [p], asOf })])) }));
}
// 能力の推移（活動日の終わりの値）。記録した日の値だけで、未記録の日を補間しない
export function abilitySeries(src, { player, from, to, asOf = Infinity }) {
  const rows = rowsOf(src.store, 'day', { from, to, players: [player], asOf, extra: src.extra || [] }).filter(r => !r.legacy && r.abilityEnd).sort((a, b) => a.day - b.day);
  return rows.map(r => ({ day: r.day, start: r.abilityStart, end: r.abilityEnd }));
}
