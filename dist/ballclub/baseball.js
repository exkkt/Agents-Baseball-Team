// 打席単位の練習試合。すべての得点・個人成績は plays から積算する。DOM・LLM に依存しない。
import { simulatePitch, pitcherProfile } from './pitch-model.js';
import { Rng, seedFor, clamp } from './growth.js';
export const POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
export const RESULTS = { BB: '四球', K: '三振', OUT: '凡退', '1B': '単打', '2B': '二塁打', '3B': '三塁打', HR: '本塁打' };
const clone = x => JSON.parse(JSON.stringify(x));
export const batting = () => ({ PA: 0, AB: 0, H: 0, doubles: 0, triples: 0, HR: 0, BB: 0, K: 0, R: 0, RBI: 0, TB: 0 });
export const pitching = () => ({ outs: 0, H: 0, HR: 0, BB: 0, K: 0, R: 0, pitches: 0, BF: 0, measuredPitches: 0, velocitySum: 0, maxVelocity: null, fastballs: 0, fastballVelocitySum: 0 });
export function validLineup(lineup, roster) {
  return Array.isArray(lineup) && lineup.length === 9 && lineup.every(x => x && typeof x === 'object' && typeof x.player === 'string' && typeof x.position === 'string') && new Set(lineup.map(x => x.player)).size === 9 && POSITIONS.every(pos => lineup.filter(x => x.position === pos).length === 1) && lineup.every(x => roster[x.player]?.positions?.includes(x.position));
}
export function ruleLineup(roster) {
  // 守備の選択肢が少ないポジションから割り当てる。バックトラックで全ポジションを必ず埋める。
  const rank = (id, pos) => roster[id].ability[pos === 'P' ? 'pitch' : 'bat'] - roster[id].fatigue * .32;
  const sorted = [...POSITIONS].sort((a, b) => Object.values(roster).filter(p => p.positions.includes(a)).length - Object.values(roster).filter(p => p.positions.includes(b)).length);
  function assign(i, used, out) {
    if (i === 9) return out;
    const pos = sorted[i];
    for (const id of Object.keys(roster).filter(id => !used.has(id) && roster[id].positions.includes(pos)).sort((a, b) => rank(b, pos) - rank(a, pos))) {
      const r = assign(i + 1, new Set([...used, id]), [...out, { player: id, position: pos }]); if (r) return r;
    }
    return null;
  }
  const out = assign(0, new Set(), []); if (!out) throw Error('9つの守備位置を埋められません');
  return out.sort((a, b) => rank(b.player, b.position) - rank(a.player, a.position));
}
export function opponent(seed, index = 0) {
  const g = new Rng(seedFor(seed, 'opponent:' + index)), names = ['みなとシーガルズ', '若葉フォックス', '北丘ファルコンズ'];
  const roster = {};
  POSITIONS.forEach((pos, i) => { const id = 'opp' + i; roster[id] = { name: ['佐々木','伊藤','中村','吉田','山本','清水','松本','井上','藤田'][i], positions: [pos], ability: { bat: pos === 'P' ? 27 : 48 + Math.floor(g.next() * 22), pitch: pos === 'P' ? 55 + Math.floor(g.next() * 12) : 30, field: 50 + Math.floor(g.next() * 20), run: 45 + Math.floor(g.next() * 24) }, fatigue: 15, condition: (g.next() - .5) * .4 }; });
  roster.opp9 = { ...clone(roster.opp0), name: '山口' };
  return { name: names[index % names.length], roster, lineup: ruleLineup(roster) };
}
function team(name, roster, lineup) {
  if (!validLineup(lineup, roster)) throw Error('無効なメンバー表');
  const pitcher = lineup.find(x => x.position === 'P').player;
  return { name, roster: clone(roster), lineup: clone(lineup), original: clone(lineup), pitcher, usedPitchers: [pitcher], next: 0, score: 0, innings: [0], batting: Object.fromEntries(Object.keys(roster).map(id => [id, batting()])), pitching: { [pitcher]: pitching() } };
}
export function createGame({ id, day, start, seed, roster, lineup, opponent: opp, home = true, source = 'rule', reason = '' }) {
  const prepare = r => Object.fromEntries(Object.entries(r).map(([id,p]) => [id, {...p, bats: p.bats || (seedFor(17,id) % 4 === 0 ? 'L' : 'R'), throws: p.throws || (seedFor(31,id) % 4 === 0 ? 'L' : 'R'), pitchingProfile: p.pitchingProfile || pitcherProfile(id, p.ability.pitch)}]));
  const own = team('こもれびベアーズ', prepare(roster), lineup), other = team(opp.name, prepare(opp.roster), opp.lineup);
  return { v: 2, model: 'pitch-v1', pitchSeq: 0, currentPA: null, id, day, start, end: null, rng: seedFor(seed, id), inning: 1, half: 0, outs: 0, bases: [null, null, null], own: home ? 1 : 0, teams: home ? [other, own] : [own, other], plays: [], substitutions: [], complete: false, source, reason };
}
export function changePitcher(game, side, id, source = 'rule') {
  const t = game.teams[side];
  if (game.complete || game.currentPA || !t.roster[id]?.positions?.includes('P') || t.usedPitchers.includes(id)) return false;
  const old = t.pitcher, slot = t.lineup.findIndex(x => x.player === old);
  if (slot < 0) return false;
  t.lineup[slot] = { player: id, position: 'P' }; t.pitcher = id; t.usedPitchers.push(id); t.pitching[id] = pitching();
  game.substitutions.push({ side, from: old, to: id, inning: game.inning, half: game.half, source, after: game.plays.length }); return true;
}
function legacyAppearance(game, M, forced = null) {
  if (game.complete) return null;
  const g = new Rng(0); g.s = game.rng; const rand = () => g.next();
  const a = game.half, b = 1 - a, atk = game.teams[a], def = game.teams[b], batter = atk.lineup[atk.next].player, pitcher = def.pitcher;
  const hit = atk.roster[batter], arm = def.roster[pitcher], bs = atk.batting[batter], ps = def.pitching[pitcher];
  const fatigue = clamp(arm.fatigue + ps.pitches * .3, 0, 100), bat = hit.ability.bat + hit.condition * 7 - hit.fatigue * .12, pitch = arm.ability.pitch + arm.condition * 7 - fatigue * .14;
  const defense = def.lineup.reduce((s, x) => s + def.roster[x.player].ability.field, 0) / 9;
  const probs = [['BB', clamp(.08 + (55 - pitch) * .0012, .035, .16)], ['K', clamp(.21 + (pitch - bat) * .003, .08, .4)], ['HR', clamp(.025 + (bat - pitch) * .0011, .004, .09)], ['3B', .006], ['2B', clamp(.045 + (bat - pitch) * .0008, .015, .1)], ['1B', clamp(.16 + (bat - pitch) * .0016 + (60 - defense) * .001, .07, .29)]];
  let result = 'OUT', u = rand(); for (const [r, p] of probs) { if (u < p) { result = r; break; } u -= p; }
  if (forced != null) { if (!RESULTS[forced]) throw Error('無効な打席結果'); result = forced; }
  const pitches = result === 'BB' ? 4 + Math.floor(rand() * 4) : result === 'K' ? 3 + Math.floor(rand() * 5) : 1 + Math.floor(rand() * 6);
  const play = settleAppearance(game, M, result, pitches, rand);
  if (game.complete) game.end = M; game.rng = g.s; return play;
}
export const inningsText = outs => Math.floor(outs / 3) + '.' + outs % 3;

function settleAppearance(game, M, result, pitches, rand, detail = null) {
  const a = game.half, b = 1 - a, atk = game.teams[a], def = game.teams[b], batter = atk.lineup[atk.next].player, pitcher = def.pitcher;
  const hit = atk.roster[batter], arm = def.roster[pitcher], bs = atk.batting[batter], ps = def.pitching[pitcher];
  const play = { n: game.plays.length + 1, M, inning: game.inning, half: a, batter, pitcher, result, pitches, before: { outs: game.outs, bases: clone(game.bases) }, runs: [], ...(detail ? { deliveries: detail.deliveries, started: detail.started, scoreBefore: detail.scoreBefore, bats: hit.bats, throws: arm.throws } : {}) };
  const score = runner => { atk.score++; atk.innings[game.inning - 1]++; atk.batting[runner.player].R++; def.pitching[runner.pitcher].R++; bs.RBI++; play.runs.push(runner.player); };
  bs.PA++; ps.BF++; if (!detail) ps.pitches += pitches;
  const runner = { player: batter, pitcher };
  if (result === 'BB') {
    bs.BB++; ps.BB++;
    if (game.bases[0]) { if (game.bases[1]) { if (game.bases[2]) score(game.bases[2]); game.bases[2] = game.bases[1]; } game.bases[1] = game.bases[0]; } game.bases[0] = runner;
  } else {
    bs.AB++;
    if (result === 'K' || result === 'OUT') { game.outs++; ps.outs++; if (result === 'K') { bs.K++; ps.K++; } }
    else {
      const n = { '1B': 1, '2B': 2, '3B': 3, HR: 4 }[result]; bs.H++; bs.TB += n; ps.H++;
      if (n === 2) bs.doubles++; if (n === 3) bs.triples++; if (n === 4) { bs.HR++; ps.HR++; }
      const next = [null, null, null];
      for (let i = 2; i >= 0; i--) { const r = game.bases[i]; if (!r) continue; let dest = i + n; if (n === 1 && i === 1 && atk.roster[r.player].ability.run > 60 && rand() < .3) dest++; if (dest >= 3) score(r); else next[dest] = r; }
      if (n === 4) score(runner); else next[n - 1] = runner;
      game.bases = next;
    }
  }
  atk.next = (atk.next + 1) % 9;
  // サヨナラの適用：本塁打以外は勝ち越し走者以降の得点を認めない。
  if (a === 1 && game.inning >= 9 && atk.score > def.score && result !== 'HR') {
    while (play.runs.length > 1 && atk.score - 1 > def.score) { const id = play.runs.pop(); atk.score--; atk.innings[game.inning - 1]--; atk.batting[id].R--; bs.RBI--; const original = [...play.before.bases, runner].find(r => r?.player === id); def.pitching[original.pitcher].R--; }
  }
  play.score = game.teams.map(t => t.score); play.after = { outs: game.outs, bases: clone(game.bases) }; game.plays.push(play);
  if (a === 1 && game.inning >= 9 && atk.score > def.score) game.complete = true;
  else if (game.outs === 3) {
    if (game.inning >= 9 && (a === 0 && game.teams[1].score > game.teams[0].score || a === 1 && (game.teams[0].score !== game.teams[1].score || game.inning >= 12))) game.complete = true;
    else { game.half = b; if (a === 1) game.inning++; game.outs = 0; game.bases = [null, null, null]; game.teams[b].innings[game.inning - 1] = 0; }
  }
  if (game.complete) game.end = M;
  return play;
}

// 1球の条件→判定→カウント更新→打席の決着、の順で進める。通常の実行では結果を先に決めない。
export function playPitch(game, M, forced = null) {
  if (game.complete) return null;
  if (game.v !== 2) throw Error('旧試合は打席単位で継続します');
  if (forced != null && !RESULTS[forced]) throw Error('無効な打席結果');
  const a = game.half, atk = game.teams[a], def = game.teams[1-a], batter = atk.lineup[atk.next].player, pitcher = def.pitcher;
  const pa = game.currentPA ??= { batter, pitcher, started: M, scoreBefore: game.teams.map(t=>t.score), balls:0, strikes:0, deliveries:[] };
  const rng = new Rng(0); rng.s = game.rng;
  const p = simulatePitch({ rng, batter:atk.roster[batter], pitcher:def.roster[pitcher], pitches:def.pitching[pitcher].pitches, balls:pa.balls, strikes:pa.strikes, defense:def.lineup.reduce((s,x)=>s+def.roster[x.player].ability.field,0)/9, forced });
  Object.assign(p, { seq: ++game.pitchSeq, M, appearance:game.plays.length+1, inAppearance:pa.deliveries.length+1, inning:game.inning, half:a, batter, pitcher, bats:atk.roster[batter].bats, throws:def.roster[pitcher].throws, outs:game.outs, bases:clone(game.bases), score:game.teams.map(t=>t.score), batterFatigue:atk.roster[batter].fatigue, pitcherFatigue:Math.min(100,def.roster[pitcher].fatigue+def.pitching[pitcher].pitches*.3) });
  if (forced) game.testOverrides = true;
  pa.deliveries.push(p); pa.balls=p.after.balls; pa.strikes=p.after.strikes;
  const ps=def.pitching[pitcher]; ps.pitches++; ps.measuredPitches=(ps.measuredPitches||0)+1; ps.velocitySum=(ps.velocitySum||0)+p.velocity; ps.maxVelocity=Math.max(ps.maxVelocity||0,p.velocity);
  if(p.type==='fastball'){ps.fastballs=(ps.fastballs||0)+1;ps.fastballVelocitySum=(ps.fastballVelocitySum||0)+p.velocity;}
  let play=null;
  if(p.result){play=settleAppearance(game,M,p.result,pa.deliveries.length,()=>rng.next(),pa);game.currentPA=null;}
  game.rng=rng.s;
  return { pitch:p, play };
}
// テスト・一括シミュレーション用。同じ1球処理を、打席が終わるまで実行する。
export function playAppearance(game, M, forced = null) {
  if(game.v!==2) return legacyAppearance(game,M,forced);
  if(game.complete)return null;
  for(let n=0;n<1000;n++){const e=playPitch(game,M,forced);if(e.play)return e.play;}
  throw Error('打席が終了しませんでした');
}
export function allPitches(game) {
  return [...game.plays.flatMap(pa=>(pa.deliveries||[]).map(p=>({...p,appearanceResult:pa.result}))),...(game.currentPA?.deliveries||[]).map(p=>({...p,appearanceResult:null}))];
}
