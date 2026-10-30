import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState,advance,offerContract,marketSalary,standings,serialize,deserialize,adoptPolicy,borrow } from '../dist/lib/engine.js';
import { query,latestMetrics } from '../dist/lib/semantic.js';
import { advisorContext,forecast,RuleBasedAdvisor } from '../dist/lib/advisor.js';
const total=(items,fn)=>items.reduce((a,r)=>a+fn(r),0);
const financialCheck=s=>{
  for(const r of s.months){
    const revenue=total(r.sales,x=>x.amount),cost=total(r.costs,x=>x.amount);
    assert.equal(r.endCash,r.startCash+r.inflow-r.outflow);
    assert.equal(revenue-cost-(r.inventoryEnd-r.inventoryStart)-r.interest,r.inflow-r.outflow);
    for(const p of r.products){assert.equal(p.opening+p.purchased-p.sold,p.closing);assert.equal(p.sales,p.sold*p.price);assert.equal(p.cogs,p.sold*p.cost);assert.ok(p.closing>=0);}
  }
};
test('12 months playable, annual accounts and all baseball totals reconcile',()=>{
  let s=initialState();
  for(let i=0;i<12;i++){
    if(s.month===10) for(const p of s.players.filter(p=>p.team===0&&p.contract===0))s=offerContract(s,p.id,marketSalary(p),2);
    s=advance(s);
  }
  assert.equal(s.months.length,12);assert.equal(s.year,2027);assert.equal(s.month,3);
  financialCheck(s);
  const t=standings(s,2026);assert.equal(s.games.length,216);assert.equal(total(t,r=>r.w),216);assert.equal(total(t,r=>r.l),216);
  for(const row of t){assert.equal(row.w+row.l,108);const roster=s.players.filter(p=>p.team===row.id);assert.equal(total(roster,p=>p.stats.runs),row.runs);assert.equal(total(roster,p=>p.stats.rbi),row.runs);assert.equal(total(roster,p=>p.stats.er),row.allowed);assert.equal(total(roster,p=>p.stats.wins),row.w);assert.equal(total(roster,p=>p.stats.losses),row.l);assert.equal(total(roster,p=>p.stats.outs),108*27);}
  const annual=query(s,{metric:'revenue',from:'2026-04',to:'2027-03'});
  assert.equal(annual.value,total(s.months,r=>total(r.sales,x=>x.amount)));
  assert.equal(query(s,{metric:'cash',from:'2026-04',to:'2027-03'}).value,s.cash);
  assert.equal(s.seasons[0].completed,true);
});
test('save resumes with identical RNG, state and next outcome',()=>{
  const s=advance(advance(initialState()));assert.deepEqual(deserialize(serialize(s)),s);
  assert.deepEqual(advance(deserialize(serialize(s))),advance(s));
});
test('inventory purchases affect cash but not unsold expense',()=>{
  const low=initialState(),high=structuredClone(low);for(const p of low.products){low.policy.orders[p.id]=10000;high.policy.orders[p.id]=20000;}
  const a=advance(low),b=advance(high);
  assert.equal(latestMetrics(a).operatingProfit.value,latestMetrics(b).operatingProfit.value);
  const extra=total(low.products,p=>10000*p.cost);
  assert.equal(a.cash-b.cash,extra);
  assert.equal(b.months[0].inventoryEnd-a.months[0].inventoryEnd,extra);
  financialCheck(b);
});
test('price demand, training, payroll and popularity have visible effects',()=>{
  const a=initialState(),b=structuredClone(a);b.policy.ticket=5000;
  assert.ok(advance(b).months[0].attendance<advance(a).months[0].attendance);
  b.policy.training=20000000;
  assert.ok(advance(b).players[0].ability>advance(a).players[0].ability);
  const popular=structuredClone(a);popular.players.filter(p=>p.team===0).forEach(p=>p.popularity=100);
  assert.ok(advance(popular).months[0].attendance>advance(a).months[0].attendance);
  const p=a.players[0],c=offerContract(a,p.id,marketSalary(p)*2,3);
  assert.equal(c.players[0].contract,3);
  assert.notEqual(advance(c).months[0].costs.find(c=>c.id==='salary').amount,advance(a).months[0].costs.find(c=>c.id==='salary').amount);
});
test('ratio aggregates numerators, missing is not zero, duplication does not multiply revenue',()=>{
  let s=advance(advance(initialState()));
  assert.equal(query(initialState(),{metric:'revenue'}).value,null);
  const expected=query(s,{metric:'revenue'}).value;
  s.months.push(structuredClone(s.months[0]));
  assert.equal(query(s,{metric:'revenue'}).value,expected);
  assert.equal(query(s,{metric:'margin'}).value,query(s,{metric:'operatingProfit'}).value/expected);
  assert.equal(total(query(s,{metric:'revenue',groupBy:'category'}).groups,g=>g.value),expected);
  assert.equal(total(query(s,{metric:'goodsProfit',groupBy:'product'}).groups,g=>g.value),query(s,{metric:'goodsProfit'}).value);
  assert.throws(()=>query(s,{metric:'margin',groupBy:'product'}));
  while(s.month!==10)s=advance(s);
  assert.equal(query(s,{metric:'attendance',from:'2026-10',to:'2026-10'}).value,null);
});
test('adviser uses the UI registry, forecast is read-only and contains no future RNG',async()=>{
  const s=advance(initialState()),before=serialize(s),context=advisorContext(s);
  assert.ok(!('seed' in context));assert.ok(!('games' in context));assert.equal(context.metrics.revenue.value,latestMetrics(s).revenue.value);
  const f=forecast(context,s.policy);assert.ok(f.low<f.profit&&f.high>f.profit);
  const advice=await new RuleBasedAdvisor().analyze(context,'グッズは何個？');
  assert.equal(advice.facts[0].metric,'revenue');assert.equal(serialize(s),before);
  let adopted=adoptPolicy(s,advice.policy,advice.predicted,advice.title);assert.equal(adopted.actions[0].actual,undefined);
  adopted=advance(adopted);assert.equal(adopted.actions[0].actual.profit,latestMetrics(adopted).operatingProfit.value);
});
test('rejected offers, offseason recruitment and departure are explicit',()=>{
  let s=initialState(),p=s.players[0];s=offerContract(s,p.id,1000000,1);
  assert.equal(s.players[0].salary,p.salary);assert.ok(s.players[0].satisfaction<p.satisfaction);
  const candidate=s.freeAgents[0];s=offerContract(s,candidate.id,marketSalary(candidate),2);
  assert.ok(s.players.some(p=>p.id===candidate.id));assert.ok(!s.freeAgents.some(p=>p.id===candidate.id));
  s=advance(s);assert.throws(()=>offerContract(s,p.id,marketSalary(p)));
  while(s.month!==2)s=advance(s);
  assert.throws(()=>advance(s),/契約残0年/);
});
test('borrowing and interest reconcile without counting principal as revenue',()=>{
  const s=borrow(initialState());assert.equal(s.cash,330000000);assert.equal(s.debt,50000000);
  const a=advance(s),b=advance(initialState());assert.equal(a.months[0].interest,250000);
  assert.equal(query(a,{metric:'revenue'}).value,query(b,{metric:'revenue'}).value);
  assert.equal(a.cash-b.cash,49750000);financialCheck(a);
});
test('second season clears live stats while first season snapshot stays fixed',()=>{
  let s=initialState();for(let i=0;i<12;i++){if(s.month===10)for(const p of s.players.filter(p=>p.team===0))s=offerContract(s,p.id,marketSalary(p),3);s=advance(s);}
  const archive=structuredClone(s.seasons[0]);s=advance(s);
  assert.deepEqual(s.seasons[0],archive);assert.equal(standings(s,2027)[0].w+standings(s,2027)[0].l,18);
  assert.equal(total(s.players.filter(p=>p.team===0),p=>p.stats.wins)+total(s.players.filter(p=>p.team===0),p=>p.stats.losses),18);
});
test('invalid saves and policies fail without modifying the original state',()=>{
  assert.throws(()=>deserialize('{}'));const s=initialState(),before=serialize(s);const bad=structuredClone(s.policy);bad.orders.cap=-1;
  assert.throws(()=>adoptPolicy(s,bad,{}));assert.equal(serialize(s),before);
});
test('daily match schedule has no double bookings',()=>{
  const s=advance(initialState()),seen=new Set();
  for(const g of s.games)for(const team of [g.home,g.away]){const key=`${g.year}-${g.month}-${g.day}-${team}`;assert.ok(!seen.has(key));seen.add(key);}
});
test('superseded plans do not get attributed actual effects',()=>{
  let s=initialState();const f=forecast(advisorContext(s),s.policy);s=adoptPolicy(s,s.policy,f,'first');s=adoptPolicy(s,s.policy,f,'second');s=advance(s);
  assert.equal(s.actions[0].superseded,true);assert.equal(s.actions[0].actual,undefined);assert.ok(s.actions[1].actual);
});
test('cash adviser explains the exact profit-to-cash bridge from shared metrics',async()=>{
  const s=advance(borrow(initialState())),m=latestMetrics(s),advice=await new RuleBasedAdvisor().analyze(advisorContext(s),'売上と現金の差');
  assert.equal(m.operatingProfit.value-m.inventoryChange.value-m.interest.value,m.cashChange.value);
  assert.ok(advice.facts.some(f=>f.metric==='inventoryChange'));
  assert.ok(advice.facts.some(f=>f.metric==='interest'));
});
