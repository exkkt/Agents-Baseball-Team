import test from 'node:test';
import assert from 'node:assert/strict';
import { createBaseball } from '../server/baseball.mjs';
import { Readable } from 'node:stream';
import { Club } from '../dist/ballclub/sim.js';
import { AgentDirector } from '../dist/ballclub/brain.js';
import { createGame, ruleLineup, opponent, playPitch, allPitches } from '../dist/ballclub/baseball.js';
import { makeStore, addGame, chunkFor } from '../dist/ballclub/records.js';
let handle;
async function fixture(run){handle=createBaseball({path:':memory:'});try{await run('http://127.0.0.1:4173');}finally{handle.close();}}
async function request(address,opt={}){
 const url=new URL(address),req=Readable.from(opt.body?[Buffer.from(opt.body)]:[]);req.method=opt.method||'GET';req.headers={host:url.host,...(opt.headers||{})};let code=200,headers={},chunks=[];
 const res={writeHead(status,h){code=status;headers=h;},write(text){chunks.push(text);},end(text){if(text)chunks.push(text);}};
 await handle(req,res,url);return new Response(chunks.join(''),{status:code,headers});
}
const post=(base,path,data,origin)=>request(base+'/api/baseball/'+path,{method:'POST',headers:{'content-type':'application/json',...(origin?{origin}:{})},body:JSON.stringify(data)});
function sample(){const c=new Club(),d=new AgentDirector({mode:'rules'}).start(c),roster=d.matches.roster();return createGame({id:'G1',day:1,start:780,seed:21,roster,lineup:ruleLineup(roster),opponent:opponent(21)});}
test('baseball API handler: writes, checkpoints, history, original read, daily backups and CSV round trip',()=>fixture(async base=>{
 const game=sample();playPitch(game,780);
 let response=await post(base,'games',{lineage:'test',game});assert.equal(response.status,200);assert.equal((await response.json()).pitches,1);
 const bad=structuredClone(game);(bad.plays[0]?.deliveries||bad.currentPA.deliveries)[0].after.balls=4;
 assert.equal((await post(base,'games',{lineage:'test',game:bad})).status,400);
 let M=781;while(!game.complete)playPitch(game,M+=.5);
 const store=makeStore({M:360,day:1,lineage:'test'});addGame(store,game);
 response=await post(base,'games',{lineage:'test',game,rows:store.matches});assert.equal(response.status,200);
 const loaded=await request(base+'/api/baseball/game?lineage=test&id=G1').then(r=>r.json());assert.deepEqual(loaded.game,game);
 assert.equal((await request(base+'/api/baseball/games?lineage=test').then(r=>r.json())).games.length,1);
 assert.equal((await request(base+'/api/baseball/status?lineage=test').then(r=>r.json())).pitches,game.pitchSeq);
 const chunk=chunkFor(store,1);assert.equal((await post(base,'records',{lineage:'test',chunk})).status,200);
 assert.deepEqual((await request(base+'/api/baseball/records/day?lineage=test&day=1').then(r=>r.json())).data,chunk);
 const index=await request(base+'/api/baseball/records/index?lineage=test&fromDay=1&toDay=1').then(r=>r.json());assert.equal(index.files.length,1);
 const csv=await request(base+'/api/baseball/pitches.csv?lineage=test&id=G1').then(r=>r.text());assert.equal(csv.trim().split('\r\n').length,allPitches(game).length+1);assert.match(csv,/velocityKmh/);assert.match(csv,/"-\d/,'負の座標も数値として輸出する');
}));
test('baseball API handler: foreign origins, invalid IDs, corrupted pitches and overwriting finalized games are rejected',()=>fixture(async base=>{
 const g=sample();while(!g.complete)playPitch(g,900);
 assert.equal((await post(base,'games',{lineage:'test',game:g},'https://example.com')).status,403);
 assert.equal((await post(base,'games',{lineage:'../../private',game:g})).status,400);
 assert.equal((await post(base,'games',{lineage:'test',game:g})).status,200);
 const different=structuredClone(g);different.reason='overwrite';assert.equal((await post(base,'games',{lineage:'test',game:different})).status,409);
 const csv=await request(base+'/api/baseball/pitches.csv?lineage=test&id=../../secret');assert.equal(csv.status,400);
 assert.equal((await request(base+'/api/baseball/game?lineage=another&id=G1')).status,404);
}));
