import { allPitches, RESULTS } from './baseball.js';
import { PITCH_TYPES, PITCH_EVENTS, zoneLabel } from './pitch-model.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function summarizePitches(rows){
  const terminal=rows.filter(p=>p.result),ab=terminal.filter(p=>p.result!=='BB'),hits=ab.filter(p=>['1B','2B','3B','HR'].includes(p.result));
  const fast=rows.filter(p=>p.type==='fastball'),mean=rs=>rs.length?rs.reduce((s,p)=>s+p.velocity,0)/rs.length:null;
  return {pitches:rows.length,avg:mean(rows),fastball:mean(fast),max:rows.length?Math.max(...rows.map(p=>p.velocity)):null,AB:ab.length,H:hits.length,HR:hits.filter(p=>p.result==='HR').length,AVG:ab.length?hits.length/ab.length:null};
}
export function pitchPanel(game, filters={}) {
  if(game.v!==2)return '<section class="room-sec"><h3>投球データ</h3><p>この試合は旧方式で行われたため、1球ごとのカウント・球速・コースは記録していません。</p></section>';
  const all=allPitches(game),rows=all.filter(p=>(!filters.batter||p.batter===filters.batter)&&(!filters.pitcher||p.pitcher===filters.pitcher)&&(!filters.count||`${p.before.balls}-${p.before.strikes}`===filters.count)&&(!filters.type||p.type===filters.type)&&(!filters.zone||p.zone===filters.zone));
  const stats=summarizePitches(rows),num=n=>n==null?'—':n.toFixed(1),names=Object.assign({},...game.teams.map(t=>Object.fromEntries(Object.entries(t.roster).map(([id,p])=>[id,p.name]))));
  const select=(key,label,options)=>`<label>${label} <select data-pitch-filter="${key}" aria-label="${label}"><option value="">すべて</option>${options.map(([v,n])=>`<option value="${esc(v)}" ${filters[key]===v?'selected':''}>${esc(n)}</option>`).join('')}</select></label>`;
  const page=Math.min(filters.page||0,Math.max(0,Math.ceil(rows.length/100)-1)),shown=rows.slice(page*100,(page+1)*100);
  const zones=Array.from({length:9},(_,i)=>{const z=String(i+1),ps=rows.filter(p=>p.zone===z),s=summarizePitches(ps);return `<div style="--heat:${Math.min(.85,.1+ps.length/Math.max(1,rows.length)*3)}"><b>${z}</b><span>${ps.length}球</span><small>安打${s.H} / 打数${s.AB}</small></div>`;}).join('');
  return `<section class="room-sec"><h3>1球ごとの記録</h3><p class="fnote">球種・球速・位置を先に計算し、その球への反応から結果を決定。ゲーム内の簡略モデルであり実測値ではありません。</p>
    <div class="frow pitch-filters">${select('batter','打者',Object.entries(names))}${select('pitcher','投手',[...new Set(all.map(p=>p.pitcher))].map(id=>[id,names[id]]))}${select('count','投球前のカウント',Array.from({length:12},(_,i)=>[`${Math.floor(i/3)}-${i%3}`,`${Math.floor(i/3)}ボール ${i%3}ストライク`]))}${select('type','球種',Object.entries(PITCH_TYPES))}${select('zone','コース',[...Array.from({length:9},(_,i)=>[String(i+1),'ゾーン'+(i+1)]),...['left','right','high','low'].map(z=>[z,zoneLabel(z)])])}</div>
    <p class="pitch-summary">対象 ${stats.pitches}球 ／ 平均 ${num(stats.avg)} km/h ／ ストレート平均 ${num(stats.fastball)} km/h ／ 最速 ${num(stats.max)} km/h</p>
    <p class="fnote">選択条件に一致した終球：${stats.AB}打数 ${stats.H}安打 ${stats.HR}本塁打（打率 ${stats.AVG==null?'—':stats.AVG.toFixed(3)}）。カウントはボール−ストライクの順。</p>
    <div class="pitch-zones">${zones}</div><p class="fnote">捕手視点：左→右、上段→高め、下段→低め。ボールゾーン ${rows.filter(p=>!p.inside).length}球。内角・外角は左右打者で逆になるため、座標と打者の左右を原本に保存します。</p>
    <p><a class="toggle" download href="/api/baseball/pitches.csv?lineage=LINEAGE&id=${encodeURIComponent(game.id)}">DB保存済みの全投球をCSVでダウンロード</a></p>
    <p class="fnote">表示 ${rows.length? page*100+1:0}〜${Math.min(rows.length,(page+1)*100)} / ${rows.length}球。CSVはフィルターにかかわらずこの試合の保存済み全投球です。</p>
    <div class="frow"><button class="toggle" data-pitch-page="${page-1}" ${page===0?'disabled':''}>前の100球</button><button class="toggle" data-pitch-page="${page+1}" ${(page+1)*100>=rows.length?'disabled':''}>次の100球</button></div>
    <div class="match-table"><table><thead><tr><th>球</th><th>場面</th><th>打者 / 投手</th><th>B−S</th><th>球種</th><th>km/h</th><th>コース</th><th>判定</th><th>終球の結果</th></tr></thead><tbody>${shown.map(p=>`<tr><td>${p.seq}</td><td>${p.inning}回${p.half?'裏':'表'} ${p.outs}死 ${p.bases.map((r,i)=>r?i+1:'').filter(Boolean).join('・')||'走者なし'} ／ ${p.score.join('−')}</td><td>${esc(names[p.batter])}(${p.bats}) / ${esc(names[p.pitcher])}(${p.throws})</td><td>${p.before.balls}−${p.before.strikes}</td><td>${PITCH_TYPES[p.type]}</td><td>${p.velocity.toFixed(1)}</td><td>${zoneLabel(p.zone)}<small>x ${p.x.toFixed(3)}, z ${p.z.toFixed(3)}</small></td><td>${PITCH_EVENTS[p.event]}</td><td>${p.result?RESULTS[p.result]:'—'}</td></tr>`).join('')}</tbody></table></div></section>`;
}
