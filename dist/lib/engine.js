// Money is stored in integer yen. Inventory is valued at fixed acquisition cost.
export const VERSION = 1;
export const TEAM_NAMES = ['こもれびベアーズ', '港町ペリカンズ', '月見フォックス', '青空ホエールズ'];
export const POSITIONS = ['捕手','一塁','二塁','三塁','遊撃','左翼','中堅','右翼','DH','控え','投手','投手','投手','投手','投手'];
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export function random(s) { s.seed = (Math.imul(s.seed, 1664525) + 1013904223) >>> 0; return s.seed / 4294967296; }
export const emptyStats = () => ({ games:0, ab:0, hits:0, hr:0, runs:0, rbi:0, wins:0, losses:0, outs:0, er:0 });
export const marketSalary = p => Math.round((p.ability * 1080000 + p.popularity * 360000 + p.stats.hr * 600000 + p.stats.wins * 1200000) / 100000) * 100000;
export const ECONOMY = { staff:20000000, stadium:30000000, perHomeGame:4000000 };
const names = ['森野 はる','日向 陸','小麦 湊','若葉 颯','星川 凪','風間 蓮','橘 ひなた','朝倉 律','白石 空','桃井 悠','青葉 岳','雨宮 澄','月岡 朔','夏目 晴','水瀬 葵'];
export function makePlayer(i, team, year=2026) {
  const ability = 46 + (i * 13 + team * 7) % 33;
  return { id:`${team}-${i}-${year}`, name:team ? `${['港','月','空'][team-1]}${names[i%15]}` : names[i%15], team, age:21+(i*3)%14, position:POSITIONS[i%15], ability, popularity:40+(i*7)%47, potential:45+(i*11)%49, salary:(10+(i*3)%12)*6000000, contract:1+(i%2), satisfaction:76, fatigue:0, injury:0, stats:emptyStats(), offerMessage:'' };
}
export function initialState(seed=20261021) {
  return { version:VERSION, seed, year:2026, month:3, cash:280000000, debt:0, fans:57,
    policy:{ticket:2400, ads:4000000, training:5000000, orders:{cap:1800, shirt:1200, towel:2200}},
    products:[{id:'cap',name:'ベアーズキャップ',icon:'🧢',price:2800,cost:1000,stock:1200},{id:'shirt',name:'応援ユニフォーム',icon:'👕',price:5800,cost:2400,stock:800},{id:'towel',name:'こもれびタオル',icon:'🧣',price:1800,cost:600,stock:1800}],
    players:TEAM_NAMES.flatMap((_,t)=>Array.from({length:15},(_,i)=>makePlayer(i,t))),
    freeAgents:Array.from({length:6},(_,i)=>({...makePlayer(i+9,0,2025), id:`fa-${i}`, name:['桜庭 新','大河 悠人','宮本 麦','花村 光','秋山 奏','冬木 蒼'][i],contract:0})),
    games:[], months:[], seasons:[], actions:[], notices:[], seasonPrepared:false };
}
export function nextDate(s) { return {year:s.year+(s.month===12?1:0),month:s.month===12?1:s.month+1}; }
export const isSeason = month => month >= 4 && month <= 9;
export const periodKey = (y,m) => `${y}-${String(m).padStart(2,'0')}`;
export function standings(s, year=s.year) {
  const rows=TEAM_NAMES.map((name,id)=>({id,name,w:0,l:0,runs:0,allowed:0}));
  s.games.filter(g=>g.year===year).forEach(g=>{ rows[g.home].runs+=g.homeRuns; rows[g.away].runs+=g.awayRuns; rows[g.home].allowed+=g.awayRuns; rows[g.away].allowed+=g.homeRuns; rows[g.homeRuns>g.awayRuns?g.home:g.away].w++; rows[g.homeRuns>g.awayRuns?g.away:g.home].l++; });
  return rows.sort((a,b)=>b.w-a.w || (b.runs-b.allowed)-(a.runs-a.allowed) || a.id-b.id);
}
function batting(s, lineup, pitcher) {
  const box=Object.fromEntries(lineup.map(p=>[p.id,emptyStats()]));
  let runs=0, order=0, outsTotal=0;
  for (let inning=0;inning<9;inning++) {
    let outs=0, bases=[null,null,null], appearances=0;
    while(outs<3 && appearances++<80) {
      const p=lineup[order++%lineup.length], b=box[p.id]; b.ab++;
      const chance=clamp(.25+(p.ability-p.fatigue*.12-pitcher.ability+pitcher.fatigue*.12)*.002,.13,.40);
      if(random(s)>chance){outs++;outsTotal++;continue;}
      b.hits++;
      const roll=random(s), distance=roll<.12?4:roll<.36?2:1;
      if(distance===4) b.hr++;
      for(let step=0;step<distance;step++){
        const scorer=bases.pop(); if(scorer){box[scorer].runs++; b.rbi++;runs++;}
        bases.unshift(step===0?p.id:null);
      }
    }
  }
  Object.values(box).forEach(b=>b.games=1);
  return { runs,box,outs:outsTotal };
}
function playGame(s, home, away, index) {
  const lineup=t=>s.players.filter(p=>p.team===t && p.position!=='投手').sort((a,b)=>(a.injury-b.injury)||(b.ability-b.fatigue*.2)-(a.ability-a.fatigue*.2)).slice(0,9);
  const pitcher=t=>{const pool=s.players.filter(p=>p.team===t && p.position==='投手').sort((a,b)=>a.injury-b.injury);const healthy=pool.filter(p=>!p.injury);return (healthy.length?healthy:pool)[index%(healthy.length||pool.length)];};
  const hl=lineup(home), al=lineup(away), hp=pitcher(home), ap=pitcher(away);
  const h=batting(s,hl,ap), a=batting(s,al,hp);
  // A tied game is resolved with a single recorded sudden-death home run.
  if(h.runs===a.runs) { const side=random(s)<.5?h:a, l=side===h?hl:al, b=side.box[l[0].id];b.ab++;b.hits++;b.hr++;b.runs++;b.rbi++;side.runs++; }
  for(const result of [h,a]) for(const [id,stats] of Object.entries(result.box)){const p=s.players.find(p=>p.id===id);for(const key of Object.keys(stats))p.stats[key]+=stats[key];}
  for(const [p,result,win] of [[hp,a,h.runs>a.runs],[ap,h,a.runs>h.runs]]) {p.stats.games++;p.stats.outs+=result.outs;p.stats.er+=result.runs;p.stats[win?'wins':'losses']++;}
  const pair=[home,away].sort().join('-'),round=({'0-1':0,'2-3':0,'0-2':1,'1-3':1,'0-3':2,'1-2':2})[pair];
  s.games.push({id:`g-${s.year}-${s.month}-${home}-${away}-${index}`,year:s.year,month:s.month,day:1+round*8+index,home,away,homeRuns:h.runs,awayRuns:a.runs});
}
export function validatePolicy(p) {
  if(!Number.isFinite(p.ticket)||p.ticket<1000||p.ticket>6000)throw Error('チケットは1,000〜6,000円で設定してください。');
  for(const key of ['ads','training'])if(!Number.isFinite(p[key])||p[key]<0||p[key]>30000000)throw Error('予算は0〜3,000万円です。');
  for(const id of ['cap','shirt','towel'])if(!Number.isInteger(p.orders[id])||p.orders[id]<0||p.orders[id]>30000)throw Error('仕入れは0〜30,000個の整数です。');
}
export function advance(original) {
  const s=structuredClone(original); validatePolicy(s.policy);const date=nextDate(s);s.year=date.year;s.month=date.month;s.notices=[];
  if(s.month===4){s.players.forEach(p=>p.stats=emptyStats());s.seasonPrepared=false;}
  const startCash=s.cash, inventoryStart=s.products.reduce((a,p)=>a+p.stock*p.cost,0);
  const roster=s.players.filter(p=>p.team===0);
  if(roster.filter(p=>p.position==='投手').length<2 || roster.filter(p=>p.position!=='投手').length<9)throw Error('開幕に必要な野手9人・投手2人を確保してください。補強画面から契約できます。');
  s.players.forEach(p=>{p.injury=Math.max(0,p.injury-1);p.fatigue=clamp(p.fatigue+(isSeason(s.month)?8:-25)-(p.team===0?s.policy.training/2000000:3),0,80);if(isSeason(s.month)&&random(s)<.035){p.injury=2;if(p.team===0)s.notices.push(`${p.name}が負傷。今月は出場優先度が下がります。`);}const development=(p.team===0?s.policy.training/5000000:1)*(p.potential/100)*(p.age<29?.4:.08);p.ability=clamp(p.ability+development-(p.age>31?.16:0),20,95);});
  const gamesBefore=s.games.length;
  if(isSeason(s.month)) for(let h=0;h<4;h++)for(let a=h+1;a<4;a++)for(let i=0;i<6;i++)playGame(s,i%2?h:a,i%2?a:h,i);
  const games=s.games.slice(gamesBefore).filter(g=>g.home===0||g.away===0);
  const wins=games.filter(g=>(g.home===0?g.homeRuns>g.awayRuns:g.awayRuns>g.homeRuns)).length;
  const homeGames=games.filter(g=>g.home===0).length;
  const popularity=roster.reduce((a,p)=>a+p.popularity,0)/roster.length;
  const seasonFactor=({4:.92,5:1.04,6:.91,7:1.08,8:1.16,9:1.02})[s.month]||.15;
  const demand=16000*(.65+s.fans/150)*(.8+popularity/250)*Math.exp(-(s.policy.ticket-2400)/2600)*(1+s.policy.ads/40000000)*seasonFactor*(.88+random(s)*.24);
  const attendance=Math.round(clamp(demand,0,24000))*homeGames;
  const ticket=attendance*s.policy.ticket, food=Math.round(attendance*750), sponsor=Math.round(8000000*(.8+s.fans/200));
  const productRows=s.products.map(p=>{
    const opening=p.stock, purchased=s.policy.orders[p.id];p.stock+=purchased;
    const desired=Math.round((attendance*.014+500)*(p.id==='shirt'?.65:p.id==='towel'?1.5:1)*(1+popularity/150)*(isSeason(s.month)?1:.23));
    const sold=Math.min(p.stock,desired);p.stock-=sold;
    return {id:p.id,name:p.name,opening,purchased,sold,closing:p.stock,unmet:desired-sold,price:p.price,cost:p.cost,sales:sold*p.price,cogs:sold*p.cost,purchaseCash:purchased*p.cost};
  });
  const salary=roster.reduce((a,p)=>a+Math.round(p.salary/12),0);
  const sales=[{id:'ticket',name:'チケット',amount:ticket},{id:'goods',name:'グッズ',amount:productRows.reduce((a,p)=>a+p.sales,0)},{id:'sponsor',name:'スポンサー',amount:sponsor},{id:'food',name:'飲食',amount:food}];
  const costs=[{id:'goods',name:'グッズ売上原価',amount:productRows.reduce((a,p)=>a+p.cogs,0)},{id:'food',name:'飲食原価',amount:Math.round(food*.4)},{id:'salary',name:'選手年俸（月割）',amount:salary},{id:'staff',name:'スタッフ人件費',amount:ECONOMY.staff},{id:'stadium',name:'球場運営費',amount:ECONOMY.stadium+homeGames*ECONOMY.perHomeGame},{id:'ads',name:'広告費',amount:s.policy.ads},{id:'training',name:'育成費',amount:s.policy.training}];
  const revenue=sales.reduce((a,r)=>a+r.amount,0), cost=costs.reduce((a,r)=>a+r.amount,0), purchases=productRows.reduce((a,p)=>a+p.purchaseCash,0);
  const interest=Math.round(s.debt*.005), outflow=cost-costs[0].amount+purchases+interest;
  s.cash+=revenue-outflow;
  const row={id:periodKey(s.year,s.month),year:s.year,month:s.month,startCash,endCash:s.cash,inflow:revenue,outflow,interest,sales,costs,products:productRows,attendance,homeGames,capacity:24000,wins,losses:games.length-wins,inventoryStart,inventoryEnd:s.products.reduce((a,p)=>a+p.stock*p.cost,0),policy:structuredClone(s.policy),annualPayroll:roster.reduce((a,p)=>a+p.salary,0),factors:{season:seasonFactor,winRate:games.length?wins/games.length:null},fans:s.fans};
  s.months.push(row);
  s.fans=clamp(s.fans+(games.length?(wins/games.length-.5)*7:0)+(s.policy.ads/4000000-1)*.7-(s.policy.ticket>3600?1.5:0),20,95);
  for(const a of s.actions.filter(a=>a.target===row.id && !a.actual&&!a.superseded)){a.actual={revenue,profit:revenue-cost,cash:s.cash,attendance:homeGames?attendance/homeGames:null};a.review=`${row.id}：季節係数 ${seasonFactor}、月間 ${wins}勝。施策単独の因果効果は未確認。`;}
  if(s.cash<0)s.notices.push('資金が不足しています。仕入れ・予算を見直すか、資金調達を利用してください。');
  if(s.month===9){s.seasons.push({year:s.year,table:standings(s),players:structuredClone(roster),completed:false});s.notices.push('レギュラーシーズン終了！ 年間成績を確認できます。');}
  if(s.month===10){s.players.forEach(p=>{p.age++;p.contract=Math.max(0,p.contract-1);});s.seasonPrepared=true;s.notices.push('契約更改期間です。契約残0年の選手は3月末に退団します。');}
  if(s.month===3){
    const departing=s.players.filter(p=>p.team===0&&p.contract===0);
    const remaining=s.players.filter(p=>!departing.includes(p));
    if(remaining.filter(p=>p.team===0&&p.position!=='投手').length<9||remaining.filter(p=>p.team===0&&p.position==='投手').length<2)throw Error('3月末の退団で人数が足りなくなります。契約残0年の選手の更改、または補強を先に行ってください。');
    s.players=remaining;s.freeAgents.push(...departing);
    departing.forEach(p=>s.notices.push(`${p.name}が契約満了で退団しました。`));
    const season=s.seasons.find(x=>x.year===s.year-1);if(season)season.completed=true;
  }
  return s;
}
export function offerContract(original,id,salary,years=1) {
  if(isSeason(original.month))throw Error('契約更改・補強は10月〜3月に行えます。');
  if(!Number.isInteger(salary)||salary<1000000||salary>200000000||![1,2,3].includes(years))throw Error('年俸は100〜20,000万円、契約は1〜3年です。');
  const s=structuredClone(original), p=s.players.find(p=>p.id===id&&p.team===0)||s.freeAgents.find(p=>p.id===id);if(!p)throw Error('選手が見つかりません。');
  const market=marketSalary(p);
  if(salary<market*.8){p.satisfaction=clamp(p.satisfaction-15,0,100);p.offerMessage=`提示を拒否。市場目安 ${Math.round(market/10000).toLocaleString()}万円の80%以上が目安です。契約満了まで未更改なら退団します。`;}
  else {p.salary=salary;p.contract=years;p.satisfaction=clamp(75+(salary/market-1)*35,30,100);p.offerMessage=`${years}年契約で合意しました。`;if(s.freeAgents.includes(p)){s.freeAgents=s.freeAgents.filter(x=>x.id!==id);s.players.push(p);}}
  s.notices=[`${p.name}：${p.offerMessage}`];return s;
}
export function borrow(original) { const s=structuredClone(original);if(s.debt>=150000000)throw Error('借入上限は15,000万円です。');s.debt+=50000000;s.cash+=50000000;s.actions.push({id:`loan-${s.actions.length}`,kind:'finance',period:periodKey(s.year,s.month),amount:50000000,title:'運転資金を5,000万円借入',note:'翌月から月利0.5%。利益には含めず、財務入金として記録。'});return s; }
export function adoptPolicy(original,policy,forecast,title='経営方針を変更') {
  validatePolicy(policy);const s=structuredClone(original);const d=nextDate(s),target=periodKey(d.year,d.month);
  s.actions.filter(a=>a.target===target&&!a.actual&&a.kind==='policy').forEach(a=>a.superseded=true);
  s.actions.push({id:`a-${s.actions.length}`,kind:'policy',period:periodKey(s.year,s.month),target,title,policy:structuredClone(policy),forecast:structuredClone(forecast),before:structuredClone(s.policy)});
  s.policy=structuredClone(policy);return s;
}
export function serialize(s){return JSON.stringify(s);}
export function deserialize(text){
  const s=JSON.parse(text);
  const walk=value=>{if(typeof value==='number'&&!Number.isFinite(value))throw Error('数値が不正です。');if(typeof value==='string'&&/[<>]/.test(value))throw Error('セーブデータに使用できない文字があります。');if(value&&typeof value==='object')for(const v of Object.values(value))walk(v);};walk(s);
  if(s?.version!==VERSION||!Number.isInteger(s.year)||!Number.isInteger(s.month)||s.month<1||s.month>12||!Number.isFinite(s.cash)||!Number.isInteger(s.seed))throw Error('対応していないセーブデータです。');
  for(const key of ['players','freeAgents','products','months','games','seasons','actions','notices'])if(!Array.isArray(s[key]))throw Error('セーブデータが破損しています。');
  validatePolicy(s.policy);
  if(s.products.length!==3||s.products.some(p=>!['cap','shirt','towel'].includes(p.id)||!Number.isInteger(p.stock)||p.stock<0||!Number.isFinite(p.cost))||new Set(s.products.map(p=>p.id)).size!==3)throw Error('在庫データが不正です。');
  if(s.players.some(p=>!p.stats||!Number.isFinite(p.salary)||!Number.isFinite(p.ability)))throw Error('選手データが不正です。');
  const safeId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(id);
  if([...s.players,...s.freeAgents].some(p=>!safeId(p.id)||!Number.isFinite(p.popularity)||!Number.isInteger(p.contract)||!p.stats||Object.keys(emptyStats()).some(k=>!Number.isInteger(p.stats[k])||p.stats[k]<0)))throw Error('選手の記録が不正です。');
  if(!Number.isFinite(s.debt)||s.debt<0||!Number.isFinite(s.fans)||s.months.some(r=>!safeId(r.id)||!Array.isArray(r.sales)||!Array.isArray(r.costs)||!Array.isArray(r.products)||!Number.isFinite(r.endCash)))throw Error('決算データが不正です。');
  return s;
}
