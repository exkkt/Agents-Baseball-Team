// 球種・狙い・制球のばらつき・球速を先に決め、その球への反応から結果を導く簡略モデル。
// 実測データで学習した物理モデルではない。座標は捕手視点：x=-1..1が左右のゾーン端、z=0..1が下端..上端。
import { Rng, seedFor, clamp } from './growth.js';
export const PITCH_TYPES = { fastball:'ストレート', slider:'スライダー', curve:'カーブ', changeup:'チェンジアップ' };
export const PITCH_EVENTS = { ball:'ボール', called_strike:'見逃しストライク', swinging_strike:'空振り', foul:'ファウル', in_play:'インプレー' };
export function pitcherProfile(id, ability) {
  const r=new Rng(seedFor(41,id));
  return { fastball:Math.round((136+ability*.12+(r.next()-.5)*6)*10)/10, repertoire:['fastball','slider',r.next()<.5?'curve':'changeup'] };
}
export function zoneOf(x,z) {
  if(x < -1)return 'left';if(x>1)return 'right';if(z<0)return 'low';if(z>1)return 'high';
  return String(Math.min(2,Math.floor((1-z)*3))*3+Math.min(2,Math.floor((x+1)*1.5))+1);
}
export function zoneLabel(zone) { return ({left:'左のボールゾーン',right:'右のボールゾーン',low:'低いボールゾーン',high:'高いボールゾーン'}[zone] || `ゾーン${zone}`); }
const r3=n=>Math.round(n*1000)/1000;
export function simulatePitch({ rng, batter, pitcher, pitches, balls, strikes, defense, forced=null }) {
  const r=()=>rng.next(), normal=()=>rng.normal(), profile=pitcher.pitchingProfile||pitcherProfile('fallback',pitcher.ability.pitch);
  const fatigue=clamp(pitcher.fatigue+pitches*.3,0,100), bat=batter.ability.bat+batter.condition*7-batter.fatigue*.12, skill=pitcher.ability.pitch+pitcher.condition*7-fatigue*.14;
  const pick=r(), type=pick<(strikes===2?.45:.60)?'fastball':pick<.85?'slider':profile.repertoire[2];
  const velocity=Math.round(clamp(profile.fastball+({fastball:0,slider:-12,curve:-23,changeup:-15}[type])+normal()*1.4-fatigue*.035,90,170)*10)/10;
  const expand=strikes===2&&balls<3&&r()<.45, direction=r()<.5?-1:1;
  const target={x:expand?direction*1.2:[-.65,0,.65][Math.floor(r()*3)],z:expand&&r()<.4?-.12:[.22,.5,.78][Math.floor(r()*3)]};
  const scatter=clamp(.52-skill*.004,.13,.50), x=r3(target.x+normal()*scatter), z=r3(target.z+normal()*scatter*.65), zone=zoneOf(x,z), inside=/^[1-9]$/.test(zone);
  const edge=Math.abs(x)+Math.abs(z-.5), swing=r()<clamp((inside?.65:.20)+strikes*.055-balls*.025+(55-bat)*.0008,.04,.94);
  let event,result=null,after={balls,strikes}, battedBall=null;
  if(!swing) event=inside?'called_strike':'ball';
  else if(r()<clamp(.17+(skill-bat)*.003+(velocity-140)*.004+edge*.035+(inside?0:.13),.04,.65))event='swinging_strike';
  else if(r()<.31)event='foul';
  else {
    event='in_play';
    const hit=r()<clamp(.29+(bat-skill)*.003+(60-defense)*.001+(1-edge)*.045,.08,.65);
    if(!hit){result='OUT';battedBall=r()<.5?'ground':'fly';}
    else {const u=r(),hr=clamp(.08+(bat-55)*.002+(1-edge)*.025,.02,.25);result=u<hr?'HR':u<hr+.20?'2B':u<hr+.225?'3B':'1B';battedBall=result==='HR'?'fly':result==='1B'?(r()<.5?'ground':'line'):'line';}
  }
  // 明示的な結果指定は単体テストだけで使う。製品の試合進行からは渡さない。
  if(forced){event=forced==='BB'?'ball':forced==='K'?'swinging_strike':'in_play';result=event==='in_play'?forced:null;battedBall=forced==='HR'?'fly':event==='in_play'?'ground':null;}
  if(event==='ball'){after.balls++;if(after.balls===4)result='BB';}
  if(event==='called_strike'||event==='swinging_strike'){after.strikes++;if(after.strikes===3)result='K';}
  if(event==='foul'&&after.strikes<2)after.strikes++;
  return { type, velocity, target, x,z,zone,inside, before:{balls,strikes}, after,event,result,battedBall };
}
