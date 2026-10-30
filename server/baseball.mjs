import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { checkGame } from '../dist/ballclub/save-format.js';
import { allPitches } from '../dist/ballclub/baseball.js';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const validLineage=x=>typeof x==='string'&&/^[\w-]{1,40}$/.test(x);
const validId=x=>typeof x==='string'&&/^G\d{1,9}$/.test(x);
const stablePitch=p=>JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k])=>k!=='appearanceResult')));
export class BaseballDatabase {
  constructor(path) {
    if(path!==':memory:'){mkdirSync(dirname(path),{recursive:true,mode:0o700});}
    this.db=new DatabaseSync(path);if(path!==':memory:')chmodSync(path,0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS games(lineage TEXT NOT NULL,id TEXT NOT NULL,day INTEGER NOT NULL,complete INTEGER NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,rows_json TEXT NOT NULL,PRIMARY KEY(lineage,id));
      CREATE TABLE IF NOT EXISTS pitches(lineage TEXT NOT NULL,game_id TEXT NOT NULL,seq INTEGER NOT NULL,day INTEGER NOT NULL,inning INTEGER NOT NULL,half INTEGER NOT NULL,batter TEXT NOT NULL,pitcher TEXT NOT NULL,balls INTEGER NOT NULL,strikes INTEGER NOT NULL,type TEXT NOT NULL,velocity REAL NOT NULL,x REAL NOT NULL,z REAL NOT NULL,zone TEXT NOT NULL,event TEXT NOT NULL,result TEXT,pa_result TEXT,payload TEXT NOT NULL,PRIMARY KEY(lineage,game_id,seq),FOREIGN KEY(lineage,game_id) REFERENCES games(lineage,id));
      CREATE INDEX IF NOT EXISTS pitch_batter ON pitches(lineage,batter,day);
      CREATE INDEX IF NOT EXISTS pitch_pitcher ON pitches(lineage,pitcher,day);
      CREATE TABLE IF NOT EXISTS chunks(lineage TEXT NOT NULL,day INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(lineage,day));`);
  }
  close(){this.db.close();}
  putGame(lineage,game,rows=[]) {
    if(!validLineage(lineage)||!validId(game?.id)||!Number.isInteger(game.day)||game.day<1||!Number.isFinite(game.start)||game.testOverrides)throw fail('試合データの形式が不正です');
    try{checkGame(game);}catch{throw fail('試合と投球記録の整合性を確認できません');}
    if(!Array.isArray(rows)||rows.length>30)throw fail('選手成績の形式が不正です');
    for(const row of rows){const b=game.teams[game.own].batting[row.player];if(!b||row.game!==game.id||row.day!==game.day||['PA','AB','H','BB','K','HR','R','RBI','TB'].some(k=>row[k]!==b[k]))throw fail('個人成績が試合記録と一致しません');}
    const payload=JSON.stringify(game),old=this.db.prepare('SELECT payload,complete FROM games WHERE lineage=? AND id=?').get(lineage,game.id);
    if(old){
      if(old.payload===payload)return {duplicate:true,pitches:game.pitchSeq||0};
      if(old.complete)throw fail('同じ試合IDの確定済みデータと異なります。既存の記録は上書きしません。',409);
      const before=JSON.parse(old.payload),a=allPitches(before),b=allPitches(game);
      if(before.day!==game.day||before.start!==game.start||before.own!==game.own||before.teams.some((t,i)=>JSON.stringify(t.roster)!==JSON.stringify(game.teams[i].roster)||JSON.stringify(t.original)!==JSON.stringify(game.teams[i].original)))throw fail('試合の登録選手・開始条件は途中で変更できません',409);
      if(before.v!==game.v||a.length>b.length||a.some((p,i)=>stablePitch(p)!==stablePitch(b[i]))||game.v===1&&before.plays.some((p,i)=>JSON.stringify(p)!==JSON.stringify(game.plays[i])))throw fail('保存済みの投球から分岐するデータは上書きできません',409);
    }
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.prepare('INSERT INTO games VALUES(?,?,?,?,?,?,?) ON CONFLICT(lineage,id) DO UPDATE SET complete=excluded.complete,revision=excluded.revision,payload=excluded.payload,rows_json=excluded.rows_json').run(lineage,game.id,game.day,+game.complete,game.pitchSeq||game.plays.length,payload,JSON.stringify(rows));
      const insert=this.db.prepare('INSERT INTO pitches VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(lineage,game_id,seq) DO UPDATE SET pa_result=excluded.pa_result,payload=excluded.payload');
      for(const p of allPitches(game))insert.run(lineage,game.id,p.seq,game.day,p.inning,p.half,p.batter,p.pitcher,p.before.balls,p.before.strikes,p.type,p.velocity,p.x,p.z,p.zone,p.event,p.result,p.appearanceResult,JSON.stringify(p));
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
    return {duplicate:false,pitches:game.pitchSeq||0};
  }
  game(lineage,id){const r=this.db.prepare('SELECT payload FROM games WHERE lineage=? AND id=?').get(lineage,id);return r?JSON.parse(r.payload):null;}
  games(lineage,limit=100,before=Infinity,beforeId=''){return this.db.prepare('SELECT payload FROM games WHERE lineage=? AND (day<? OR (day=? AND id<?)) ORDER BY day DESC,id DESC LIMIT ?').all(lineage,Number.isFinite(before)?before:2147483647,Number.isFinite(before)?before:2147483647,beforeId,limit).map(r=>{const g=JSON.parse(r.payload),own=g.teams[g.own],opp=g.teams[1-g.own];return {id:g.id,day:g.day,complete:g.complete,model:g.model||'appearance-v1',pitches:g.pitchSeq??null,score:[own.score,opp.score],opponent:opp.name};});}
  putChunk(lineage,chunk){
    if(!validLineage(lineage)||chunk?.lineage!==lineage||chunk.kind!=='ballclub-records'||!Number.isInteger(chunk.day)||!chunk.records||!['practice','sleeps','days','events','matches','games'].every(k=>Array.isArray(chunk.records[k]||[])))throw fail('日次記録の形式が不正です');
    // その日の試合は必ず個別の原本とも突合する。部分的なバックアップを保存済みにしない。
    const actual=this.db.prepare('SELECT id,payload FROM games WHERE lineage=? AND day=? AND complete=1').all(lineage,chunk.day);
    if(actual.some(g=>!chunk.records.games?.some(r=>r.game?.id===g.id&&JSON.stringify(r.game)===g.payload)))throw fail('日次記録に保存済みの試合原本が不足しています',409);
    const payload=JSON.stringify(chunk),old=this.db.prepare('SELECT payload FROM chunks WHERE lineage=? AND day=?').get(lineage,chunk.day);
    if(old&&old.payload!==payload)throw fail('確定済みの日次記録は上書きしません',409);
    if(!old)this.db.prepare('INSERT INTO chunks VALUES(?,?,?)').run(lineage,chunk.day,payload);
    return {duplicate:!!old};
  }
  chunk(lineage,day){const r=this.db.prepare('SELECT payload FROM chunks WHERE lineage=? AND day=?').get(lineage,day);return r?JSON.parse(r.payload):null;}
  chunks(lineage,from,to){return this.db.prepare('SELECT day,payload FROM chunks WHERE lineage=? AND day BETWEEN ? AND ? ORDER BY day').all(lineage,from,to).map(r=>({id:'local-day-'+r.day,day:r.day,players:JSON.parse(r.payload).players||[],local:true}));}
  status(lineage){return {games:this.db.prepare('SELECT count(*) AS n FROM games WHERE lineage=?').get(lineage).n,pitches:this.db.prepare('SELECT count(*) AS n FROM pitches WHERE lineage=?').get(lineage).n,days:this.db.prepare('SELECT count(*) AS n FROM chunks WHERE lineage=?').get(lineage).n};}
}
export function createBaseball({path=resolve('.local/baseball.sqlite')}={}) {
  let database;
  const db=()=>database??=new BaseballDatabase(path),json=(res,code,x)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(x));};
  async function body(req){let n=0;const parts=[];for await(const part of req){n+=part.length;if(n>3*1024*1024)throw fail('記録が大きすぎます',413);parts.push(part);}try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw fail('JSONを読めません');}}
  const handle=async(req,res,url)=>{
    if(!url.pathname.startsWith('/api/baseball/'))return false;
    try{
      const host=req.headers.host||'',origin=req.headers.origin;
      if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)||req.headers['sec-fetch-site']==='cross-site'||origin&&origin!==`http://${host}`)throw fail('このPCの球団画面から操作してください',403);
      if(req.method==='POST'&&!req.headers['content-type']?.startsWith('application/json'))throw fail('JSONで送信してください',415);
      const b=req.method==='POST'?await body(req):null,lineage=b?.lineage||url.searchParams.get('lineage');if(!validLineage(lineage))throw fail('進行の識別子が不正です');
      const route=url.pathname.slice('/api/baseball/'.length);
      if(route==='games'&&req.method==='POST'){json(res,200,{ok:true,...db().putGame(lineage,b.game,b.rows)});}
      else if(route==='records'&&req.method==='POST'){json(res,200,{ok:true,...db().putChunk(lineage,b.chunk)});}
      else if(route==='status'&&req.method==='GET')json(res,200,{ok:true,persistent:true,...db().status(lineage)});
      else if(route==='games'&&req.method==='GET')json(res,200,{ok:true,games:db().games(lineage,Math.max(1,Math.min(100,Number(url.searchParams.get('limit'))||100)),Number(url.searchParams.get('before'))||Infinity,url.searchParams.get('beforeId')||'')});
      else if(route==='game'&&req.method==='GET'){const id=url.searchParams.get('id');if(!validId(id))throw fail('試合IDが不正です');const game=db().game(lineage,id);if(!game)throw fail('試合が見つかりません',404);json(res,200,{ok:true,game});}
      else if(route==='records/index'&&req.method==='GET'){const from=Number(url.searchParams.get('fromDay'))||1,to=Number(url.searchParams.get('toDay'))||2147483647;json(res,200,{ok:true,files:db().chunks(lineage,from,to)});}
      else if(route==='records/day'&&req.method==='GET'){const day=Number(url.searchParams.get('day')),data=db().chunk(lineage,day);if(!data)throw fail('日次記録が見つかりません',404);json(res,200,{ok:true,data});}
      else if(route==='pitches.csv'&&req.method==='GET'){
        const id=url.searchParams.get('id');if(!validId(id))throw fail('試合IDが不正です');const g=db().game(lineage,id);if(!g)throw fail('試合が見つかりません',404);
        const cols=['game','day','seq','inning','half','outs','bases','awayScore','homeScore','batter','batterName','bats','pitcher','pitcherName','throws','balls','strikes','inAppearance','type','velocityKmh','x','z','zone','event','result','appearanceResult'];
        const csv=v=>'"'+(typeof v==='string'?v.replace(/^[=+@-]/,"'$&"):String(v??'')).replace(/"/g,'""')+'"';
        res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${id}-pitches.csv"`,'Cache-Control':'no-store'});res.write('\uFEFF'+cols.join(',')+'\r\n');
        for(const p of allPitches(g))res.write([id,g.day,p.seq,p.inning,p.half?'bottom':'top',p.outs,JSON.stringify(p.bases),...p.score,p.batter,g.teams[p.half].roster[p.batter].name,p.bats,p.pitcher,g.teams[1-p.half].roster[p.pitcher].name,p.throws,p.before.balls,p.before.strikes,p.inAppearance,p.type,p.velocity,p.x,p.z,p.zone,p.event,p.result,p.appearanceResult].map(csv).join(',')+'\r\n');res.end();
      }else throw fail('操作が見つかりません',404);
    }catch(e){json(res,e.status||500,{ok:false,message:e.status?e.message:'データベースへの保存・取得に失敗しました'});}
    return true;
  };
  handle.close=()=>database?.close();return handle;
}
