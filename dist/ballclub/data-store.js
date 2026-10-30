// 認証情報を扱わない、ローカルSQLiteの窓口。保存成功の応答後だけブラウザの詳細を整理する。
import { chunkFor, chunkId } from './records.js';
export class DataStore {
  constructor({base='',fetchFn=(...a)=>fetch(...a)}={}){this.base=base;this.http=fetchFn;this.available=false;this.error=null;this.counts=null;this.pending=null;this.revisions=new Map();}
  async request(path,body){
    const r=await this.http(this.base+'/api/baseball/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
    const j=await r.json();if(!r.ok||!j.ok)throw Error(j.message||'ローカル保存庫に接続できません');return j;
  }
  async check(lineage){try{this.counts=await this.request('status?lineage='+encodeURIComponent(lineage));this.available=true;this.error=null;}catch(e){this.available=false;this.error=e.message;}return this.available;}
  async flush(director){
    this.next=director;
    if(this.pending)return this.pending;
    this.pending=(async()=>{let ok=false;while(this.next){const d=this.next;this.next=null;ok=await this.write(d);}return ok;})().finally(()=>{this.pending=null;});return this.pending;
  }
  async write(d){
    const s=d.records,lineage=s.lineage;s.localGames??={};s.localDays??={};
    try{
      if(!this.available&&!await this.check(lineage))return false;
      const games=[...s.games.map(r=>r.game),...(d.matches.st.active&&!d.matches.st.active.complete?[d.matches.st.active]:[])];
      for(const game of games){
        const key=lineage+':'+game.id,revision=[game.pitchSeq||game.plays.length,game.complete,game.substitutions.length].join(':');
        if(this.revisions.get(key)===revision)continue;
        await this.request('games',{lineage,game,rows:game.complete?s.matches.filter(r=>r.game===game.id):[]});
        this.revisions.set(key,revision);s.localGames[game.id]={revision,pitches:game.pitchSeq??null,complete:game.complete,day:game.day};
      }
      const days=[...new Set([...s.days.map(r=>r.day),...s.outbox.filter(r=>r.kind==='records').map(r=>r.day)])].filter(day=>day<d.day).sort((a,b)=>a-b);
      for(const day of days){const id=chunkId(s,day);if(s.localDays[id])continue;await this.request('records',{lineage,chunk:chunkFor(s,day)});s.localDays[id]=true;}
      // 直近3試合と当日分はブラウザにも残す。それ以前の原本はDBに確定保存した日だけ整理。
      const recent=new Set(s.games.slice(-3).map(r=>r.game.id)), pinned=Math.min(...Object.values(s.pins||{}),Infinity);
      s.games=s.games.filter(r=>recent.has(r.game.id)||r.day>=pinned||r.day>=d.day||!s.localGames[r.game.id]?.complete||!s.localDays[chunkId(s,r.day)]);
      this.counts=await this.request('status?lineage='+encodeURIComponent(lineage));this.error=null;this.available=true;return true;
    }catch(e){this.error=e.message;return false;}
  }
  async prepareChunk(store,day){return store.localDays?.[chunkId(store,day)]?(await this.request(`records/day?lineage=${encodeURIComponent(store.lineage)}&day=${day}`)).data:chunkFor(store,day);}
  async games(lineage,before){return (await this.request(`games?lineage=${encodeURIComponent(lineage)}${before?`&before=${before.day}&beforeId=${encodeURIComponent(before.id)}`:''}`)).games;}
  async game(lineage,id){return (await this.request(`game?lineage=${encodeURIComponent(lineage)}&id=${encodeURIComponent(id)}`)).game;}
  async search({lineage,fromDay,toDay}){return (await this.request(`records/index?lineage=${encodeURIComponent(lineage)}&fromDay=${fromDay}&toDay=${toDay}`)).files.map(f=>({...f,id:`local:${lineage}:${f.day}`,lineage}));}
  async fetchChunk(id,lineage){const parts=id.split(':');lineage=parts[1]||lineage;const day=Number(parts[2]);return (await this.request(`records/day?lineage=${encodeURIComponent(lineage)}&day=${day}`)).data;}
}
