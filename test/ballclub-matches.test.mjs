import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PLAYERS } from '../dist/ballclub/agents.js';
import { Club } from '../dist/ballclub/sim.js';
import { AgentDirector } from '../dist/ballclub/brain.js';
import { ruleLineup, validLineup, createGame, opponent, playAppearance, changePitcher } from '../dist/ballclub/baseball.js';
import { matchValidate, matchRule } from '../dist/ballclub/matches.js';
import { assertSnapshot, migrateSnapshot } from '../dist/ballclub/save-format.js';
import { makeStore, addGame, chunkFor, rowsFromChunk } from '../dist/ballclub/records.js';
import { query, fmt } from '../dist/ballclub/metrics.js';
const roster = () => Object.fromEntries(Object.entries(PLAYERS).map(([id,p])=>[id,{...p,name:id,fatigue:p.fatigue,condition:0}]));
const game = (seed=21,home=true) => {const r=roster(); return createGame({id:'G1',day:1,start:780,seed,roster:r,lineup:ruleLineup(r),opponent:opponent(seed),home});};
const finish = g => {let M=780;while(!g.complete&&g.plays.length<1500)playAppearance(g,M+=2);assert.ok(g.complete);return g;};
const total = (rs,k) => Object.values(rs).reduce((s,r)=>s+r[k],0);
function reconcile(g) {
  for (const [i,t] of g.teams.entries()) {
    const ps=g.plays.filter(p=>p.half===i), opp=g.teams[1-i];
    assert.equal(t.score,t.innings.reduce((a,b)=>a+b,0));assert.equal(t.score,total(t.batting,'R'));
    assert.equal(t.score,total(t.batting,'RBI'));assert.equal(t.score,ps.reduce((s,p)=>s+p.runs.length,0));
    assert.equal(t.score,total(opp.pitching,'R'));assert.equal(ps.length,total(t.batting,'PA'));
    assert.equal(ps.length,total(t.batting,'AB')+total(t.batting,'BB'));assert.equal(ps.length,total(opp.pitching,'BF'));
    assert.equal(total(t.batting,'H'),total(opp.pitching,'H'));assert.equal(total(t.batting,'K'),total(opp.pitching,'K'));
    assert.equal(ps.filter(p=>['OUT','K'].includes(p.result)).length,total(opp.pitching,'outs'));
    assert.equal(ps.reduce((s,p)=>s+p.pitches,0),total(opp.pitching,'pitches'));
    assert.equal(total(t.batting,'TB'),total(t.batting,'H')+total(t.batting,'doubles')+total(t.batting,'triples')*2+total(t.batting,'HR')*3);
  }
}
test('games: 200 seeds, both home/away, all runs, innings, batting and pitching reconcile',()=>{for(let seed=1;seed<=200;seed++)reconcile(finish(game(seed,seed%2===0)));});
test('games: valid nine-player lineup, duplicate and unsuitable position rejected; pitching cannot re-enter',()=>{
 const r=roster(), l=ruleLineup(r);assert.ok(validLineup(l,r));assert.equal(validLineup([...l.slice(0,8),l[0]],r),false);
 const wrong=structuredClone(l);wrong.find(x=>x.position==='P').player='sato';assert.equal(validLineup(wrong,r),false);
 const full={ctx:{roster:r}};assert.equal(matchValidate('match_lineup',JSON.stringify({lineup:Array(9).fill(null)}),full).ok,false);assert.equal(matchValidate('match_lineup',JSON.stringify({lineup:wrong}),full).ok,false);
 const checked=matchValidate('match_lineup',JSON.stringify({lineup:l,reason:'自軍は999点でリード'}),full);assert.ok(checked.ok);assert.ok(!checked.decision.reason.includes('999'));assert.ok(checked.issues.length);
 const g=game(),side=g.own,t=g.teams[side],old=t.pitcher,relief=Object.keys(r).find(id=>r[id].positions.includes('P')&&id!==old);
 assert.ok(changePitcher(g,side,relief));assert.equal(changePitcher(g,side,old),false);reconcile(finish(g));
});
test('games: walks force only occupied bases; inherited runners are charged to original pitcher',()=>{
 const g=game();g.half=1-g.own;const side=g.own,t=g.teams[side],old=t.pitcher;
 for(let i=0;i<3;i++)playAppearance(g,780+i,'BB');assert.equal(g.bases.filter(Boolean).length,3);
 const relief=Object.keys(t.roster).find(id=>t.roster[id].positions.includes('P')&&id!==old);changePitcher(g,side,relief);
 playAppearance(g,785,'HR');assert.equal(t.pitching[old].R,3);assert.equal(t.pitching[relief].R,1);reconcile(g);
});
test('games: skip bottom ninth, walk-off and twelve-inning tie terminate correctly',()=>{
 const tie=game();for(let n=0;n<72;n++)playAppearance(tie,780+n,'OUT');assert.ok(tie.complete);assert.equal(tie.inning,12);assert.equal(tie.plays.length,72);
 const skip=game();while(!(skip.inning===8&&skip.half===1))playAppearance(skip,780,'OUT');playAppearance(skip,780,'HR');while(!skip.complete)playAppearance(skip,780,'OUT');assert.equal(skip.inning,9);assert.equal(skip.half,0);assert.equal(skip.teams[1].innings[8],undefined);reconcile(skip);
 const walk=game();while(!(walk.inning===9&&walk.half===1))playAppearance(walk,780,'OUT');playAppearance(walk,780,'HR');assert.ok(walk.complete);assert.equal(walk.outs,0);reconcile(walk);
 const loaded=game();while(!(loaded.inning===9&&loaded.half===1))playAppearance(loaded,780,'OUT');for(let i=0;i<3;i++)playAppearance(loaded,780,'BB');playAppearance(loaded,780,'3B');assert.ok(loaded.complete);assert.equal(loaded.teams[1].score,1);assert.equal(loaded.plays.at(-1).runs.length,1);reconcile(loaded);
});
test('games: ability, form and fatigue change aggregate results; identical seed resumes identically',()=>{
 const first=game();for(let i=0;i<31;i++)playAppearance(first,780+i*2);const saved=structuredClone(first);assert.deepEqual(finish(first),finish(saved));
 let high=0,low=0;for(let seed=1;seed<=100;seed++){for(const good of [false,true]){const g=game(seed);for(const p of Object.values(g.teams[g.own].roster)){p.ability.bat=good?85:35;p.condition=good?.8:-.8;p.fatigue=good?5:85;}finish(g);if(good)high+=total(g.teams[g.own].batting,'H');else low+=total(g.teams[g.own].batting,'H');}}
 assert.ok(high>low*1.5,`${high} vs ${low}`);
});
test('games: completed records, analysis ratios, asOf and Drive chunks use exactly the same stats',()=>{
 const g=finish(game()),s=makeStore({M:360,day:1});assert.equal(addGame(s,{...g,complete:false}),false);assert.ok(addGame(s,g));assert.equal(addGame(s,g),false);
 const ids=Object.keys(PLAYERS),own=g.teams[g.own],opt={players:ids,from:1,to:1,metric:'gameAVG'};
 assert.equal(query({store:s},opt).value,total(own.batting,'H')/total(own.batting,'AB'));assert.equal(query({store:s},{...opt,asOf:0}).value,null);
 const ch=chunkFor(s,1),remote=makeStore({M:360,day:1});assert.equal(ch.records.games[0].game.plays.length,g.plays.length);
 assert.equal(query({store:remote,extra:rowsFromChunk(ch)},opt).value,query({store:s},opt).value);assert.equal(fmt('gameOuts',17),'5.2');
});
const until=(c,M)=>{while(c.minutes<M-1e-5)c.step(6);};
test('games: practice → manager lineup → real game → records → analyst and save/resume',()=>{
 const c=new Club({seed:21}),d=new AgentDirector({mode:'rules'}).start(c);until(c,600);
 assert.ok(d.matches.schedule({start:660,manual:true}).ok);until(c,690);assert.ok(d.matches.st.active);assert.ok(d.decisions.some(r=>r.kind==='match_lineup'&&r.applied));
 const start=d.serialize();assertSnapshot(start);const c2=new Club(),d2=AgentDirector.restore(c2,structuredClone(start),{mode:'rules'});
 until(c,1250);until(c2,1250);assert.deepEqual(d.records.games,d2.records.games);assert.equal(d.records.games.length,1);reconcile(d.records.games[0].game);
 const g=d.records.games[0].game;assert.ok(!d.records.practice.some(p=>p.end>g.start&&p.start<g.end),'試合中に練習実績を積まない');
 assert.ok(d.analyst.st.jobs.some(j=>j.trigger==='postgame'&&j.request.theme==='game'));assert.ok(d.records.matches.length>=9);
 const report=d.analyst.st.reports.find(r=>r.theme==='game');assert.ok(report);assert.ok(report.facts.some(f=>f.metric==='gameAVG'));
 assert.ok(report.recipients.some(r=>r.who==='manager'&&r.status==='delivered'));assert.ok(report.recipients.some(r=>PLAYERS[r.who]&&r.status==='delivered'),'分析を選手にも伝える');
 assert.ok(Object.keys(d.trainees).every(id=>d.trainees[id].fatigue<=100));assert.equal(d.maxActive,0);
});
test('games: v2 eight-player save expands without resetting clock, skills or memories; corrupt current save rejected',async()=>{
 const old=JSON.parse(await readFile(new URL('./fixtures/save-v1.json',import.meta.url),'utf8'));
 const migrated=migrateSnapshot(old),v2=structuredClone(migrated);v2.v=2;delete v2.matches;delete v2.records.matches;delete v2.records.games;
 for(const id of ['tanaka','ishikawa','hayashi','takeda']){delete v2.trainees[id];delete v2.agents[id];delete v2.people[id];delete v2.records.open[id];}
 const v3=migrateSnapshot(v2);assert.equal(v3.gm,v2.gm);assert.equal(v3.day,v2.day);assert.deepEqual(v3.trainees.aoki,v2.trainees.aoki);assert.deepEqual(v3.agents.manager,JSON.parse(JSON.stringify(v2.agents.manager)));assert.equal(Object.keys(v3.trainees).length,12);assertSnapshot(v3);
 const c=new Club(),d=AgentDirector.restore(c,v3,{mode:'rules'});until(c,v3.gm+60);assert.ok(d.trainees.tanaka);
 const bad=structuredClone(d.serialize());bad.matches.active={v:1};assert.throws(()=>assertSnapshot(bad));
});
test('games: a late LLM lineup cannot overwrite the fallback lineup; only one inference is active',async()=>{
 const c=new Club(),d=new AgentDirector({mode:'rules'}).start(c);until(c,600);d.matches.schedule({start:660});until(c,629);
 let resolve;d.mode='llm';d.provider={available:true,decide:()=>new Promise(r=>{resolve=r;})};until(c,630);
 await new Promise(r=>setImmediate(r));assert.equal(typeof resolve,'function');assert.equal(d.inflight.kind,'match_lineup');assert.equal(d.maxActive,1);
 until(c,676);const f=d.matches.fixture();assert.equal(f.source,'fallback');const before=structuredClone(d.matches.st.active.teams[d.matches.st.active.own].original);
 resolve({ok:true,text:JSON.stringify({lineup:ruleLineup(d.matches.roster()),reason:'若手に機会を与える'}),ms:1000});await new Promise(r=>setImmediate(r));
 d.mode='rules';until(c,677);assert.deepEqual(d.matches.st.active.teams[d.matches.st.active.own].original,before);
 assert.ok(d.decisions.some(r=>r.kind==='match_lineup'&&!r.applied));assert.equal(d.maxActive,1);
});
