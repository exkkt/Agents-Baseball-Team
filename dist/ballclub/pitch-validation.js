import { allPitches } from './baseball.js';
import { PITCH_TYPES, PITCH_EVENTS, zoneOf } from './pitch-model.js';
const finite=Number.isFinite;
const check=ok=>{if(!ok)throw Error('投球記録の形式・集計が一致しません');};
export function assertPitchGame(game) {
  check(Number.isInteger(game.pitchSeq)&&game.pitchSeq>=0&&game.pitchSeq<=20000);
  const pitches=allPitches(game);check(pitches.length===game.pitchSeq);
  const appearances=[...game.plays,...(game.currentPA?[game.currentPA]:[])];
  let seq=0;
  for(let index=0;index<appearances.length;index++){
    const pa=appearances[index],finished=index<game.plays.length;
    check(Array.isArray(pa.deliveries)&&pa.deliveries.length<=1000&&(pa.deliveries.length>0||!finished));
    let balls=0,strikes=0;
    for(let i=0;i<pa.deliveries.length;i++){
      const p=pa.deliveries[i];
      check(p&&p.seq===++seq&&p.appearance===index+1&&p.inAppearance===i+1&&[0,1].includes(p.half)&&Number.isInteger(p.inning)&&p.inning>=1&&p.inning<=12);
      check(p.batter===pa.batter&&p.pitcher===pa.pitcher&&game.teams[p.half].roster[p.batter]&&game.teams[1-p.half].roster[p.pitcher]);
      check(PITCH_TYPES[p.type]&&PITCH_EVENTS[p.event]&&finite(p.velocity)&&p.velocity>=90&&p.velocity<=170&&finite(p.M));
      check(finite(p.x)&&finite(p.z)&&Math.abs(p.x)<=10&&Math.abs(p.z)<=10&&p.zone===zoneOf(p.x,p.z)&&p.inside===/^[1-9]$/.test(p.zone));
      check(p.before?.balls===balls&&p.before?.strikes===strikes&&Number.isInteger(p.outs)&&p.outs>=0&&p.outs<=2&&Array.isArray(p.bases)&&p.bases.length===3&&Array.isArray(p.score)&&p.score.length===2);
      if(p.event==='ball')balls++;
      if(['called_strike','swinging_strike'].includes(p.event))strikes++;
      if(p.event==='foul'&&strikes<2)strikes++;
      check(p.after?.balls===balls&&p.after?.strikes===strikes&&balls<=4&&strikes<=3);
      const terminal=balls===4?'BB':strikes===3?'K':p.event==='in_play'?p.result:null;
      if(p.event==='in_play')check(['OUT','1B','2B','3B','HR'].includes(p.result));
      check(p.result===terminal);
      if(terminal)check(finished&&i===pa.deliveries.length-1&&terminal===pa.result);
      else check(i<pa.deliveries.length-1||!finished);
    }
    if(finished)check(pa.pitches===pa.deliveries.length&&pa.deliveries.at(-1).result===pa.result);
    else check(pa.balls===balls&&pa.strikes===strikes&&pa.batter===game.teams[game.half].lineup[game.teams[game.half].next].player&&pa.pitcher===game.teams[1-game.half].pitcher);
  }
  if(game.complete)check(!game.currentPA);
  for(const [side,t] of game.teams.entries())for(const [id,ps] of Object.entries(t.pitching)){
    const rows=pitches.filter(p=>p.half===1-side&&p.pitcher===id),sum=rows.reduce((s,p)=>s+p.velocity,0),fast=rows.filter(p=>p.type==='fastball');
    check(ps.pitches===rows.length&&ps.measuredPitches===rows.length&&Math.abs(ps.velocitySum-sum)<.00001&&ps.fastballs===fast.length&&Math.abs(ps.fastballVelocitySum-fast.reduce((s,p)=>s+p.velocity,0))<.00001);
  }
  return game;
}
