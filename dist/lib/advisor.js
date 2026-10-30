import { latestMetrics, query, playerMetrics } from './semantic.js';
import { nextDate, isSeason, periodKey, clamp, ECONOMY } from './engine.js';
// Public snapshot deliberately excludes RNG state and future simulated outcomes.
export function advisorContext(s) {
  return {period:s.months.at(-1)?.id??null,next:nextDate(s),cash:s.cash,debt:s.debt,fans:s.fans,policy:structuredClone(s.policy),products:structuredClone(s.products),
    players:s.players.filter(p=>p.team===0).map(p=>{const {id,name,age,position,salary,ability,popularity,contract,stats}=p;return {id,name,age,position,salary,ability,popularity,contract,stats:structuredClone(stats),metrics:playerMetrics(p)};}),
    metrics:latestMetrics(s),history:s.months.slice(-12).map(r=>({period:r.id,metrics:Object.fromEntries(['revenue','operatingProfit','attendance','cashChange'].map(metric=>[metric,query(s,{metric,from:r.id,to:r.id}).value])),policy:r.policy,products:r.products}))};
}
export function forecast(context, policy) {
  const {next,cash,fans,players,products}=context, active=isSeason(next.month), homeGames=active?9:0;
  const seasonal=({4:.92,5:1.04,6:.91,7:1.08,8:1.16,9:1.02})[next.month]||.15;
  const pop=players.reduce((n,p)=>n+p.popularity,0)/players.length;
  const attendance=Math.round(clamp(16000*(.65+fans/150)*(.8+pop/250)*Math.exp(-(policy.ticket-2400)/2600)*(1+policy.ads/40000000)*seasonal,0,24000))*homeGames;
  const goods=products.map(p=>{const demand=Math.round((attendance*.014+500)*(p.id==='shirt'?.65:p.id==='towel'?1.5:1)*(1+pop/150)*(active?1:.23));const sold=Math.min(p.stock+policy.orders[p.id],demand);return {id:p.id,demand,sold,revenue:sold*p.price,cogs:sold*p.cost,purchases:policy.orders[p.id]*p.cost};});
  const revenue=attendance*(policy.ticket+750)+Math.round(8000000*(.8+fans/200))+goods.reduce((n,p)=>n+p.revenue,0);
  const costs=players.reduce((n,p)=>n+Math.round(p.salary/12),0)+ECONOMY.staff+ECONOMY.stadium+homeGames*ECONOMY.perHomeGame+policy.ads+policy.training+attendance*300+goods.reduce((n,p)=>n+p.cogs,0);
  const profit=Math.round(revenue-costs), endCash=Math.round(cash+profit+goods.reduce((n,p)=>n+p.cogs-p.purchases,0)-context.debt*.005);
  const uncertainty=active?Math.round(attendance*(policy.ticket+450)*.16):Math.round(revenue*.08);
  return {period:periodKey(next.year,next.month),revenue,profit,cash:endCash,attendance:homeGames?attendance/homeGames:null,low:profit-uncertainty,high:profit+uncertainty,goods,assumptions:`ホーム${homeGames}試合・季節係数${seasonal}・現在のファンと契約を固定。客数±16%相当の感度幅（統計的信頼区間ではありません）。けが・勝敗による翌月以降の効果は未反映。`};
}
const wan=n=>n==null?'—':`${(n/10000).toLocaleString('ja-JP',{maximumFractionDigits:0})}万円`;
export class RuleBasedAdvisor {
  label='ルールベースのデモ';
  async analyze(context, question='全体') {
    const m=context.metrics, baseline=forecast(context,context.policy), policy=structuredClone(context.policy);
    const goods=/グッズ|仕入|在庫/.test(question), ticket=/チケット|値上|価格/.test(question), roster=/年俸|選手|優勝/.test(question), cash=/現金|売上/.test(question);
    let title, action, hypothesis, alternative;
    if(goods||(!ticket&&!roster&&!cash)){
      for(const p of context.products){const demand=baseline.goods.find(g=>g.id===p.id).demand;policy.orders[p.id]=Math.max(0,Math.ceil(demand*1.15-p.stock));}
      const increased=context.products.reduce((n,p)=>n+(policy.orders[p.id]-context.policy.orders[p.id])*p.cost,0)>0;
      title=increased?'欠品する前に、仕入れを整える。':'在庫を使って、仕入れを軽く。';action='翌月需要の1.15倍を目安に、手元在庫を引いた数量を仕入れる。';hypothesis=increased?'需要に対して仕入れ不足の可能性があります。追加仕入れで販売機会を取り戻せる見込みです。':'過剰在庫がある商品では仕入れ抑制が資金繰りを改善する可能性。';alternative='欠品を避けるなら需要の1.4倍を確保するが、現金の拘束が増える。';
    }else if(ticket){policy.ticket=Math.min(6000,policy.ticket+200);title='200円の値上げを、小さく試す。';action='チケット単価を200円上げて1か月比較する。';hypothesis='単価上昇と需要減が同時に起こるため、増益とは限らない。';alternative='価格を据え置き、広告費を100万円増額して客数を試す。';}
    else if(roster){policy.training=Math.min(30000000,policy.training+2000000);title='来季の強さに、育成を積み立てる。';action='育成を月200万円増やす。契約更改では能力・出場実績・市場目安を選手別に比較する。';hypothesis='若手の能力向上が期待できるが、勝率改善や優勝は保証できない。';alternative='黒字優先なら育成を据え置く。補強は翌年の年俸費用12か月分を確保してから。';}
    else{for(const p of context.products)policy.orders[p.id]=Math.max(0,baseline.goods.find(g=>g.id===p.id).demand-p.stock);title='利益と現金の差は、在庫まで見る。';action='在庫を充当し、翌月に必要な数量だけ追加仕入れする。';hypothesis='売上が増えても、仕入れ支払いが売上原価を上回ると利益ほど現金は増えない。';alternative='仕入れを維持し、広告費を抑制する。ただし中期のファン獲得に影響する。';}
    const predicted=forecast(context,policy),previous=context.history.at(-2);
    const facts=context.period?[
      {metric:'revenue',text:`売上高 ${wan(m.revenue.value)}`},{metric:'operatingProfit',text:`営業利益 ${wan(m.operatingProfit.value)}`},{metric:'cashChange',text:`営業・仕入れ現金増減 ${wan(m.cashChange.value)}`},{metric:'inventory',text:`期末在庫 ${wan(m.inventory.value)}`}
    ]:[];
    if(context.period&&cash){facts.push({metric:'inventoryChange',text:`在庫増減 ${wan(m.inventoryChange.value)}`},{metric:'interest',text:`借入利息 ${wan(m.interest.value)}`});
      hypothesis=`確認できた会計上の差：営業利益 ${wan(m.operatingProfit.value)} − 在庫増減 ${wan(m.inventoryChange.value)} − 利息 ${wan(m.interest.value)} ＝ 現金増減 ${wan(m.cashChange.value)}。${previous?`${previous.period}比の売上増減は ${wan(m.revenue.value-previous.metrics.revenue)}。`:'売上が増えたかは前月データ不足で未確認。'} 需要変化の原因は対照データがないため断定できません。`;
    }
    if(context.period&&roster)facts.push({metric:'payroll',text:`月割年俸費用 ${wan(m.payroll.value)}`},{metric:'payrollRatio',text:`年俸売上比率 ${m.payrollRatio.value===null?'—':(m.payrollRatio.value*100).toFixed(1)+'%'}`});
    return {label:this.label,title,question,period:context.period, facts:context.period?[
      ...facts]:[],
      lack:context.history.length<2?'比較できる月次履歴が不足しています。初期条件を使った試算です。':'前月比較は季節・勝敗も変わるため、施策だけの因果効果とは断定できません。',
      hypothesis,action,alternative,policy,predicted,baseline,
      comparison:`現方針との比較：予測営業利益 ${wan(predicted.profit-baseline.profit)}、予測月末現金 ${wan(predicted.cash-baseline.cash)}。`,
      risk:'予測は需要モデルの仮定に依存します。天候相当の需要変動・けが・勝敗で実績は変わります。仕入れ削減は欠品リスクがあります。',
      verify:`${predicted.period}決算で営業利益・現金増減・在庫・平均観客数を確認。育成効果はシーズン末にも確認。`};
  }
}
// Replace with a server-backed adapter implementing analyze(publicContext, question).
// Model outputs must cite registered metric IDs; do not accept model-authored SQL/formulae.
export let advisorProvider = new RuleBasedAdvisor();
export function setAdvisorProvider(provider){if(typeof provider?.analyze!=='function')throw Error('analyze(context, question) が必要です。');advisorProvider=provider;}
