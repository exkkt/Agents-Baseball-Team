import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Club } from '../dist/ballclub/sim.js';
import { AgentDirector } from '../dist/ballclub/brain.js';
import { createGame, ruleLineup, opponent, playPitch, playAppearance, allPitches, changePitcher } from '../dist/ballclub/baseball.js';
import { assertPitchGame } from '../dist/ballclub/pitch-validation.js';
import { zoneOf } from '../dist/ballclub/pitch-model.js';
import { checkGame, assertSnapshot } from '../dist/ballclub/save-format.js';
import { makeStore, addGame, chunkFor, queueChunk, trim, rowsFromChunk } from '../dist/ballclub/records.js';
import { query } from '../dist/ballclub/metrics.js';
import { summarizePitches, pitchPanel } from '../dist/ballclub/pitch-ui.js';
import { BaseballDatabase } from '../server/baseball.mjs';
import { DataStore } from '../dist/ballclub/data-store.js';
import { DriveArchive, archiveAdapter } from '../dist/ballclub/drive-archive.js';
const base=()=>{const c=new Club(),d=new AgentDirector({mode:'rules'}).start(c);return {c,d};};
function makeGame(seed=21,id='G1',day=1){const {d}=base(),roster=d.matches.roster();return createGame({id,day,start:(day-1)*1440+780,seed,roster,lineup:ruleLineup(roster),opponent:opponent(seed)});}
const finish=g=>{let at=g.start+(g.pitchSeq||0)*.5;for(let n=0;!g.complete&&n<10000;n++)playPitch(g,at+=.5);assert.ok(g.complete);return g;};
test('pitch model: 100 complete games have legal count chains, outcomes, coordinates and exact pitching totals',()=>{
 for(let seed=1;seed<=100;seed++){const g=finish(makeGame(seed));assertPitchGame(g);checkGame(g);assert.ok(g.pitchSeq>60);const rows=allPitches(g);assert.equal(rows.length,g.teams.reduce((s,t)=>s+Object.values(t.pitching).reduce((v,p)=>v+p.pitches,0),0));assert.ok(rows.every(p=>p.zone===zoneOf(p.x,p.z)&&p.result!==undefined));assert.ok(rows.some(p=>p.event==='ball'));assert.ok(rows.some(p=>p.event==='foul'));}
});
test('pitch model: saves in the middle of a count resume identically, without allowing a mid-at-bat pitching change',()=>{
 const g=makeGame();let M=g.start;while(!g.complete&&!(g.currentPA?.balls===1&&g.currentPA?.strikes===2))playPitch(g,M+=.5);assert.ok(g.currentPA);
 const side=1-g.half,relief=Object.keys(g.teams[side].roster).find(id=>g.teams[side].roster[id].positions.includes('P')&&!g.teams[side].usedPitchers.includes(id));assert.equal(changePitcher(g,side,relief),false);
 const saved=JSON.parse(JSON.stringify(g));assertPitchGame(saved);assert.deepEqual(finish(g),finish(saved));
 const broken=structuredClone(saved);broken.plays[0].deliveries[0].before.strikes=2;assert.throws(()=>assertPitchGame(broken));
});
test('pitch metrics: weighted average velocity and count/zone/type/inning splits agree with raw pitches, including archived data',()=>{
 const g=finish(makeGame()),s=makeStore({M:360,day:1,lineage:'test'});addGame(s,g);const rows=allPitches(g),ours=rows.filter(p=>p.half!==g.own),mean=ours.reduce((s,p)=>s+p.velocity,0)/ours.length;
 assert.equal(query({store:s},{metric:'avgVelocity'}).value,mean);assert.equal(query({store:s},{metric:'pitcherVelocity'}).value,mean);
 const fast=ours.filter(p=>p.type==='fastball');assert.equal(query({store:s},{metric:'avgFastball'}).value,fast.reduce((s,p)=>s+p.velocity,0)/fast.length);
 const bat=rows.filter(p=>p.half===g.own),stats=summarizePitches(bat);
 for(const groupBy of ['count','zone','pitchType','inning']){const q=query({store:s},{metric:'batterPitchAVG',groupBy});assert.equal(q.value,stats.AVG);assert.equal(q.groups.reduce((s,g)=>s+g.count,0),stats.AB);}
 const before=query({store:s},{metric:'pitcherVelocity',asOf:0});assert.equal(before.value,null);
 const archived=rowsFromChunk(chunkFor(s,1)),empty=makeStore({M:360,day:1});assert.equal(query({store:empty,extra:archived},{metric:'pitcherVelocity'}).value,mean);
 assert.equal(query({store:s,extra:archived},{metric:'pitcherVelocity'}).count,ours.length,'同じ原本を二重に集計しない');
});
test('legacy games: old appearance-only games keep their stats, with no invented pitch details or velocities',()=>{
 const g=makeGame();g.v=1;delete g.model;delete g.pitchSeq;delete g.currentPA;while(!g.complete)playAppearance(g,900);
 const s=makeStore({M:360,day:1});addGame(s,g);assert.equal(allPitches(g).length,0);assert.equal(query({store:s},{metric:'avgVelocity'}).value,null);assert.equal(query({store:s},{metric:'pitcherVelocity'}).value,null);assert.match(pitchPanel(g),/記録していません/);assert.ok(query({store:s},{metric:'gamePA'}).value>0);
 const db=new BaseballDatabase(':memory:');db.putGame('legacy',g,s.matches);assert.equal(db.status('legacy').pitches,0);db.close();
});
test('SQLite: partial checkpoints append, duplicates do not multiply, finalized records cannot be overwritten, and files survive reopen',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ballclub-pitch-db-')),path=join(dir,'records.sqlite');let db;
 try{
  db=new BaseballDatabase(path);const g=makeGame();playPitch(g,780);db.putGame('test',g);assert.ok(db.putGame('test',g).duplicate);
  const rewind=structuredClone(g);for(let i=0;i<15;i++)playPitch(g,781+i*.5);db.putGame('test',g);assert.equal(db.status('test').pitches,g.pitchSeq);assert.throws(()=>db.putGame('test',rewind),/分岐/);
  finish(g);db.putGame('test',g);const changed=structuredClone(g);changed.reason='different';assert.throws(()=>db.putGame('test',changed),/確定済み/);db.close();db=new BaseballDatabase(path);assert.deepEqual(db.game('test','G1'),g);assert.equal(db.status('other').games,0);assert.equal((await stat(path)).mode&0o777,0o600);
  const invalid=structuredClone(g);invalid.id='G2';invalid.plays[0].deliveries[0].velocity=999;assert.throws(()=>db.putGame('test',invalid),/整合性/);
 }finally{db?.close();await rm(dir,{recursive:true,force:true});}
});
test('retention: unsaved originals and pending backups never expire just because days passed',()=>{
 const s=makeStore({M:360,day:1,lineage:'test'});addGame(s,finish(makeGame()));queueChunk(s,1);trim(s,500);assert.equal(s.games.length,1);assert.equal(s.outbox.length,1);assert.ok(s.matches.length);
});
test('local archive: only confirmed originals leave browser cache, old data remains searchable and is used for Drive backup',async()=>{
 const db=new BaseballDatabase(':memory:'),s=makeStore({M:360,day:1,lineage:'test'});
 for(let day=1;day<=6;day++){addGame(s,finish(makeGame(21,'G'+day,day)));s.days.push({day,player:'aoki'});queueChunk(s,day);}
 let failing=true;
 const fetchFn=async(url,opt={})=>{if(failing)throw Error('ディスク保存に失敗');const u=new URL(url,'http://localhost'),b=opt.body?JSON.parse(opt.body):null,path=u.pathname.replace('/api/baseball/','');let j;
  if(path==='status')j=db.status(u.searchParams.get('lineage'));else if(path==='games'&&b)j=db.putGame(b.lineage,b.game,b.rows);else if(path==='records'&&b)j=db.putChunk(b.lineage,b.chunk);else if(path==='records/day')j={data:db.chunk(u.searchParams.get('lineage'),Number(u.searchParams.get('day')))};else if(path==='records/index')j={files:db.chunks(u.searchParams.get('lineage'),Number(u.searchParams.get('fromDay')),Number(u.searchParams.get('toDay')))};else throw Error(path);return new Response(JSON.stringify({ok:true,...j}));};
 const local=new DataStore({fetchFn}),d={records:s,day:8,matches:{st:{active:null}},analyst:{report:()=>null}};
 assert.equal(await local.flush(d),false);assert.equal(s.games.length,6);assert.ok(local.error);
 s.pins={active:1};failing=false;assert.ok(await local.flush(d));assert.equal(s.games.length,6,'分析中の原本は整理しない');s.pins={};assert.ok(await local.flush(d));assert.equal(s.games.length,3);assert.equal(db.status('test').games,6);assert.ok((await local.prepareChunk(s,1)).records.games[0].game.pitchSeq>0);
 const ar=new DriveArchive({local,fetchFn:async(url,opt)=>{const b=JSON.parse(opt.body);assert.equal(b.payload.records.games.length,1);assert.ok(b.payload.records.games[0].game.pitchSeq>0);return new Response(JSON.stringify({ok:true,file:{id:'fake-'+b.day}}));}});ar.connected=true;
 const view=archiveAdapter(ar,local);ar.connected=false;assert.ok(view.available());const found=await view.search({lineage:'test',fromDay:1,toDay:2});assert.equal(found.length,2);const data=await view.fetch(found[0].id);assert.equal(data.day,1);
 ar.connected=true;const sent=await ar.flush(d,{manual:true});assert.equal(sent.sent,6);assert.equal(s.outbox.length,0);db.close();
});
test('director: pitch-level in-progress snapshot validates and its completed pitch stats reach the analyst',()=>{
 const {c,d}=base();while(c.minutes<600)c.step(6);d.matches.schedule({start:660});while(c.minutes<681)c.step(6);assert.ok(d.matches.st.active.pitchSeq>0);assertSnapshot(d.serialize());
 while(c.minutes<1250)c.step(6);assert.equal(d.records.games.length,1);const g=d.records.games[0].game;assertPitchGame(g);assert.ok(d.analyst.st.reports.some(r=>r.facts.some(f=>f.metric==='avgFastball'&&f.value!==undefined)));assert.ok(d.analyst.st.jobs.some(j=>j.trigger==='postgame'));
});

test('analyst: old pitch detail is collected from the local database even when Drive retrieval was not selected',async()=>{
 const {d}=base(),old=makeStore({M:360,day:1,lineage:d.records.lineage});addGame(old,finish(makeGame(21,'G1',1)));
 addGame(d.records,finish(makeGame(21,'G9',9)));d.records.days.push({day:1,player:'aoki'});d.day=10;
 let searched;d.archive={available:()=>true,localAvailable:()=>true,search:async q=>{searched=q;return [{id:'local:test:1',day:1}];},fetch:async()=>chunkFor(old,1)};
 const result=d.analyst.request({trigger:'owner',by:'owner',theme:'pitch_detail'}),j=d.analyst.job(result.id);
 j.plan={players:['endo'],metrics:['pitcherVelocity'],current:{from:1,to:1},baseline:null,archive:false};j.asOf={seq:d.records.seq};j.stage='collect';d.analyst.collect(j);
 for(let i=0;i<10&&j.pending;i++)await new Promise(r=>setImmediate(r));
 assert.equal(searched.toDay,1);assert.equal(searched.localOnly,true);assert.ok(j.archiveRows.some(r=>r.t==='pitch'));assert.ok(query({store:d.records,extra:j.archiveRows},{metric:'pitcherVelocity',from:1,to:1}).value>0);
});
