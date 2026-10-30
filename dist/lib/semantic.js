// The UI and the adviser execute this same registry. No arbitrary SQL/formula input.
const sum=(rows,fn)=>rows.reduce((n,r)=>n+fn(r),0);
const amount=(r,table,id)=>sum(r[table].filter(x=>!id||x.id===id),x=>x.amount);
const ratio=(a,b)=>b===0?null:a/b;
export const METRICS={
 revenue:{name:'売上高',description:'認識済みの全売上',formula:'Σ チケット・グッズ・スポンサー・飲食売上',unit:'円',dimensions:['category'],calc:r=>sum(r,x=>amount(x,'sales'))},
 goodsProfit:{name:'グッズ粗利益',description:'売れた商品の収益性',formula:'Σ グッズ売上 − Σ 販売数 × 取得単価',unit:'円',dimensions:['product'],calc:r=>sum(r,x=>sum(x.products,p=>p.sales-p.cogs))},
 grossProfit:{name:'粗利益',description:'売上からグッズと飲食の直接原価を差し引く',formula:'売上高 − グッズ売上原価 − 飲食原価',unit:'円',dimensions:[],calc:r=>sum(r,x=>amount(x,'sales')-amount(x,'costs','goods')-amount(x,'costs','food'))},
 operatingProfit:{name:'営業利益',description:'経営活動で得た利益。利息は含まない',formula:'Σ 売上 − Σ 費用（売上原価・年俸・人件費・球場・広告・育成）',unit:'円',dimensions:[],calc:r=>sum(r,x=>amount(x,'sales')-amount(x,'costs'))},
 margin:{name:'営業利益率',description:'期間全体の売上に対する営業利益',formula:'期間の営業利益 ÷ 期間の売上高',unit:'%',dimensions:[],calc:r=>ratio(METRICS.operatingProfit.calc(r),METRICS.revenue.calc(r))},
 payroll:{name:'年俸総額（月次費用）',description:'各契約の年額を12分割した費用',formula:'Σ 選手年俸の月割額（各月円単位四捨五入）',unit:'円',dimensions:[],calc:r=>sum(r,x=>amount(x,'costs','salary'))},
 payrollRatio:{name:'年俸売上比率',description:'同じ期間の年俸費用と売上を比較',formula:'Σ 月割年俸 ÷ Σ 売上高',unit:'%',dimensions:[],calc:r=>ratio(METRICS.payroll.calc(r),METRICS.revenue.calc(r))},
 attendance:{name:'平均観客数',description:'ホームゲーム1試合あたりの入場者数',formula:'Σ 入場者数 ÷ Σ ホーム試合数',unit:'人',dimensions:[],calc:r=>ratio(sum(r,x=>x.attendance),sum(r,x=>x.homeGames))},
 occupancy:{name:'座席稼働率',description:'ホーム開催分の座席の利用率',formula:'Σ 入場者数 ÷ Σ（ホーム試合数 × 定員）',unit:'%',dimensions:[],calc:r=>ratio(sum(r,x=>x.attendance),sum(r,x=>x.homeGames*x.capacity))},
 revenuePerFan:{name:'観客一人当たり売上',description:'来場に直接対応するチケット・飲食売上。ECを含むグッズとスポンサーを除外',formula:'Σ（チケット＋飲食売上）÷ Σ 入場者数',unit:'円',dimensions:[],calc:r=>ratio(sum(r,x=>amount(x,'sales','ticket')+amount(x,'sales','food')),sum(r,x=>x.attendance))},
 turnover:{name:'在庫回転率',description:'選択期間の販売原価と平均在庫金額の比率',formula:'Σ グッズ売上原価 ÷ 各月の期首・期末在庫平均の期間平均',unit:'回',dimensions:['product'],calc:r=>ratio(sum(r,x=>sum(x.products,p=>p.cogs)),r.length?sum(r,x=>(x.inventoryStart+x.inventoryEnd)/2)/r.length:0)},
 cash:{name:'月末現金残高',description:'対象期間の最後の月末現金。期間内で足し合わせない',formula:'最終月の期首現金 ＋ 入金 − 出金',unit:'円',dimensions:[],calc:r=>r.length?r.at(-1).endCash:null},
 cashChange:{name:'営業・仕入れ現金増減',description:'月次の営業入出金差額。月間に別途行った借入は財務履歴に記録',formula:'Σ 入金 − Σ 出金',unit:'円',dimensions:[],calc:r=>sum(r,x=>x.inflow-x.outflow)},
 inventory:{name:'在庫金額',description:'期末に残る商品の取得原価',formula:'最終月の Σ 在庫数量 × 取得単価',unit:'円',dimensions:['product'],calc:r=>r.length?r.at(-1).inventoryEnd:null}
};
METRICS.inventoryChange={name:'在庫増減額',description:'現金と利益の差をつくる在庫資産の増減',formula:'Σ（各月期末在庫金額 − 各月期首在庫金額）',unit:'円',dimensions:['product'],calc:r=>sum(r,x=>x.inventoryEnd-x.inventoryStart)};
METRICS.interest={name:'借入利息',description:'営業外費用として当月支出',formula:'Σ 月初借入残高 × 月利0.5%（円単位四捨五入）',unit:'円',dimensions:[],calc:r=>sum(r,x=>x.interest)};
for(const def of Object.values(METRICS)){def.grain=['month','season'];def.caveat='分母ゼロ・履歴なしはnull。比率は合計から算出。残高は期末値。月IDによる重複除去。';}
export const PLAYER_METRICS={
 average:{name:'打率',description:'打数に対する安打の割合',formula:'安打 ÷ 打数',unit:'率',grain:'season',dimensions:['player'],caveat:'打数ゼロはnull。四死球・失策・犠打は省略。',calc:p=>ratio(p.stats.hits,p.stats.ab)},
 era:{name:'防御率',description:'9イニングあたり自責点',formula:'自責点 × 27 ÷ 投球アウト数',unit:'点',grain:'season',dimensions:['player'],caveat:'投球アウト数ゼロはnull。失策なしのため失点をすべて自責点とする。',calc:p=>ratio(p.stats.er*27,p.stats.outs)},
 salaryPerWin:{name:'年俸／勝利',description:'勝利数で割った年俸コストの参考値',formula:'現在契約の年俸 ÷ 勝利数',unit:'円',grain:'season',dimensions:['player'],caveat:'勝利ゼロはnull。出場機会・守備貢献を考慮しない。',calc:p=>ratio(p.salary,p.stats.wins)},
 salaryPerHit:{name:'年俸／安打',description:'安打数で割った年俸コストの参考値',formula:'現在契約の年俸 ÷ 安打数',unit:'円',grain:'season',dimensions:['player'],caveat:'安打ゼロはnull。出場機会・守備貢献を考慮しない。',calc:p=>ratio(p.salary,p.stats.hits)}
};
export function query(state,{metric,from,to,groupBy}){
  const def=METRICS[metric];if(!def)throw Error('未登録の指標です。');
  if(groupBy&&!['month','season',...def.dimensions].includes(groupBy))throw Error('この指標では使えない分析軸です。');
  // Aggregate facts first. Never join line items to matches or contracts.
  const rows=[...new Map(state.months.filter(r=>(!from||r.id>=from)&&(!to||r.id<=to)).map(r=>[r.id,r])).values()].sort((a,b)=>a.id.localeCompare(b.id));
  const result={metric,name:def.name,value:rows.length?def.calc(rows):null,unit:def.unit,from:rows[0]?.id??null,to:rows.at(-1)?.id??null,count:rows.length,formula:def.formula};
  if(groupBy){const groups={};for(const row of rows){
    if(groupBy==='month'||groupBy==='season'){const key=groupBy==='month'?row.id:String(row.month>=4?row.year:row.year-1);(groups[key]??=[]).push(row);}
    else if(groupBy==='category')for(const x of row.sales)(groups[x.name]??=[]).push({...row,sales:[x]});
    else for(const p of row.products)(groups[p.name]??=[]).push({...row,products:[p],inventoryStart:p.opening*p.cost,inventoryEnd:p.closing*p.cost});
  }result.groups=Object.entries(groups).map(([key,rs])=>({key,value:def.calc(rs)}));}
  return result;
}
export function playerMetrics(p){return Object.fromEntries(Object.entries(PLAYER_METRICS).map(([id,m])=>[id,m.calc(p)]));}
export function latestMetrics(s){const id=s.months.at(-1)?.id;return Object.fromEntries(Object.keys(METRICS).map(metric=>[metric,query(s,{metric,from:id,to:id})]));}
export const RULES = [
 '金額は内部では整数の円、画面では原則「万円」に四捨五入。表示上の丸めで内訳合計と差が出る場合があります。指標のⓘで円単位の値を確認できます。チケット・商品単価は円。',
 '売上は当月に全額入金。売掛・税・減価償却は省略。年俸は契約年額を12分割して毎月費用・支出計上。',
 'グッズは当月初に仕入れて支払い、販売した分だけ原価計上。一定取得単価を使い、売れ残りは在庫資産。',
 '粗利益＝売上−グッズ原価−飲食原価。営業利益は年俸・人件費・球場・広告・育成も控除。借入利息は営業外費用。',
 '欠損・分母ゼロは「—」。観客数・率は合計分子÷合計分母。残高・在庫は最終月の値。月ID重複は一度だけ集計。',
 '会計年度は4月〜翌3月。試合は4〜9月、4球団各108試合。順位同率は得失点差、次に球団ID順。',
 '簡略試合は9イニング、四死球・失策・犠打なし。同点は記録付き決着本塁打。打点＝得点、投手1人が全失点を負担。',
 '負傷中は出場優先度を下げる（欠員時は限定出場）。疲労は打撃・投球に影響。育成は能力、人気はグッズ、勝敗・広告・価格はファンに影響。',
 '契約は10月に残年数を減らし、残0年の未更改選手は3月末に退団。更改した年俸は翌月から反映。自動更新はしない。',
 '日次は試合記録のみ。売上・費用は月次で確定し、日次の会計指標は未提供。選手別指標は打率・防御率・年俸／安打・年俸／勝利。'
];
