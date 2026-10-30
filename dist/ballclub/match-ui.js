import { RESULTS, inningsText } from './baseball.js';
import { pitchPanel } from './pitch-ui.js';
import { clockOf } from './agents.js';
const sourceName = s => ({llm:'ローカルLLM',rule:'ルール',fallback:'ルール代替',replay:'記録の再生'}[s] || s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export function mountMatches({ root, getDirector, dataStore, save, advanceTo, isPaused, togglePlay }) {
  let open = false, selected = 'live', key = '', message = '', history = [], remote = {}, historyLineage = null, filters = {};
  async function loadHistory(more=false) { const d=getDirector();if(!d||!dataStore)return;const lineage=d.records.lineage;try{if(historyLineage!==lineage){history=[];remote={};historyLineage=lineage;}await dataStore.flush(d);const last=more?history.at(-1):null;const rows=await dataStore.games(lineage,last);if(getDirector().records.lineage!==lineage)return;history=more?[...history,...rows]:rows;render(true);}catch(e){message=e.message;render(true);} }
  root.innerHTML = '<div class="room-inner" role="dialog" aria-modal="true" aria-label="試合"><header class="room-head"><div><h2>練習試合</h2><p>箱庭の選手が出場。打席の記録から得点・成績を積算します。</p></div><button class="toggle" data-close>閉じる</button></header><div class="room-body"><div class="frow"><button class="toggle" data-play>再生</button><button class="toggle" data-schedule>練習試合を予約</button><button class="toggle" data-advance>次の区切りまで早送り</button><label>表示 <select aria-label="表示する試合" data-select><option value="live">進行中・直近の試合</option></select></label><button class="toggle" data-history>保存庫の過去試合</button></div><p role="status" data-message></p><div data-content></div></div></div>';
  function show(v) { open = v; root.hidden = !v; document.body.classList.toggle('room-open', v); if (v) { render(true); loadHistory(); root.querySelector('[data-close]').focus(); } else document.getElementById('open-matches')?.focus(); }
  root.querySelector('[data-play]').onclick = () => { togglePlay(); render(true); };
  root.querySelector('[data-close]').onclick = () => show(false);
  root.addEventListener('keydown', e => { if (e.key === 'Escape') show(false); if(e.key==='Tab'){const nodes=[...root.querySelectorAll('button:not(:disabled),select')];const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}} });
  root.querySelector('[data-history]').onclick=()=>loadHistory(history.length>0);
  root.addEventListener('change',e=>{const k=e.target.dataset.pitchFilter;if(k){filters={...filters,[k]:e.target.value,page:0};render(true);}});
  root.addEventListener('click',e=>{const b=e.target.closest('[data-pitch-page]');if(b){filters.page=Number(b.dataset.pitchPage);render(true);}});
  root.querySelector('[data-select]').onchange = async e => { selected = e.target.value; filters={};render(true);if(selected!=='live'&&!getDirector().records.games.some(r=>r.game.id===selected)&&dataStore){try{const id=selected;remote[id]=await dataStore.game(getDirector().records.lineage,id);render(true);}catch(e){message=e.message;render(true);}} };
  root.querySelector('[data-schedule]').onclick = () => {
    const d = getDirector(); if (!d) return;
    const mod = d.mod(), today = mod <= 930, day = today ? d.day : d.day + 1;
    const r = d.matches.schedule({ day, start: today ? Math.max(d.M + 30, d.base() + 540) : d.base() + 1440 + 780, manual: true });
    message = r.ok ? '予約しました。開始30分前に監督がメンバーを選びます。' : r.message;
    save(); render(true);
  };
  root.querySelector('[data-advance]').onclick = () => {
    const d = getDirector(), f = d?.matches.fixture(); if (!f) return;
    advanceTo(Math.max(d.M + 1, f.status === 'playing' ? d.M + 20 : f.status === 'preparing' ? f.start : f.start - 30));
    message = '途中の生活・回復も計算します。LLMの判断が必要な区切りで早送りを止めます。'; render(true);
  };
  function table(team) {
    const ids = [...new Set([...team.original.map(x => x.player), ...team.usedPitchers])];
    return `<section class="room-sec"><h3>${esc(team.name)}</h3><div class="match-table"><table><thead><tr><th>打順・守備</th><th>選手</th><th>打数</th><th>安打</th><th>本塁打</th><th>四球</th><th>三振</th><th>得点</th><th>打点</th></tr></thead><tbody>${ids.map(id=>{const b=team.batting[id],i=team.original.findIndex(x=>x.player===id);return `<tr><td>${i<0?'救援':`${i+1} ${team.original[i].position}`}</td><th>${esc(team.roster[id].name)}</th>${['AB','H','HR','BB','K','R','RBI'].map(k=>`<td>${b[k]}</td>`).join('')}</tr>`;}).join('')}</tbody></table></div><div class="match-table"><table><thead><tr><th>投手</th><th>投球回</th><th>球数</th><th>被安打</th><th>四球</th><th>奪三振</th><th>失点</th><th>平均km/h</th><th>直球平均km/h</th></tr></thead><tbody>${team.usedPitchers.map(id=>{const p=team.pitching[id];return `<tr><th>${esc(team.roster[id].name)}</th><td>${inningsText(p.outs)}</td>${['pitches','H','BB','K','R'].map(k=>`<td>${p[k]}</td>`).join('')}<td>${p.measuredPitches?(p.velocitySum/p.measuredPitches).toFixed(1):'—'}</td><td>${p.fastballs?(p.fastballVelocitySum/p.fastballs).toFixed(1):'—'}</td></tr>`;}).join('')}</tbody></table></div></section>`;
  }
  function diamond(g) {
    const atk=g.teams[g.half],def=g.teams[1-g.half],next=atk.lineup[atk.next],positions={P:[180,190],C:[180,305],'1B':[275,205],'2B':[230,132],'3B':[85,205],SS:[130,132],LF:[62,80],CF:[180,42],RF:[298,80]};
    const label=(x,y,s,color='#dfefe2')=>`<g><circle cx="${x}" cy="${y}" r="15" fill="#284a3c" stroke="${color}"/><text x="${x}" y="${y+4}" text-anchor="middle" fill="white" font-size="11">${esc(s)}</text></g>`;
    return `<svg class="match-field" viewBox="0 0 360 335" role="img" aria-label="${g.inning}回${g.half?'裏':'表'}、${g.outs}アウト。現在の守備と走者"><path d="M180 305 L20 130 Q180 -80 340 130 Z" fill="#23573f"/><path d="M180 290 L290 180 L180 70 L70 180 Z" fill="#8d7956"/><path d="M180 255 L255 180 L180 105 L105 180 Z" fill="#41714f"/>${def.lineup.map(x=>label(...positions[x.position],def.roster[x.player].name)).join('')}${g.bases.map((r,i)=>r?label(...[[290,180],[180,70],[70,180]][i],atk.roster[r.player].name,'#ffcb68'):'').join('')}<text x="12" y="328" fill="#eee" font-size="12">打者：${esc(atk.roster[next.player].name)} ／ 投手：${esc(def.roster[def.pitcher].name)}</text></svg>`;
  }
  function render(force = false) {
    if (!open) return; const d=getDirector(); if(!d) {root.querySelector('[data-content]').textContent='デモ台本では試合は利用できません。';return;}
    const st=d.matches.st, f=d.matches.fixture(), games=d.records.games||[], g=selected==='live'?(st.active||games.at(-1)?.game):(games.find(r=>r.game.id===selected)?.game||remote[selected]);
    const k=JSON.stringify([d.M,isPaused(),selected,g?.plays.length,g?.pitchSeq,g?.complete,filters,history.length,f?.status,st.pitching,message]);if(!force&&k===key)return;key=k;
    root.querySelector('[data-play]').textContent=isPaused()?'再生':'一時停止';
    root.querySelector('[data-message]').textContent=message;
    const select=root.querySelector('[data-select]'), options=[...new Map([...history,...games.map(r=>({id:r.game.id,day:r.day}))].map(r=>[r.id,r])).values()].sort((a,b)=>b.day-a.day||Number(b.id.slice(1))-Number(a.id.slice(1))), optionsKey=options.map(r=>r.id).join(',');if(select.dataset.games!==optionsKey){select.dataset.games=optionsKey;select.innerHTML='<option value="live">進行中・直近の試合</option>'+options.map(r=>`<option value="${esc(r.id)}">${r.day}日目 ${esc(r.id)}</option>`).join('');}select.value=selected;
    root.querySelector('[data-advance]').disabled=!f;root.querySelector('[data-schedule]').disabled=!!f;
    const status={scheduled:'試合予定',preparing:'試合準備・メンバー選定',playing:'試合中',complete:'終了'};
    const schedule=`<section class="room-sec"><h3>日程</h3><p>定期の練習試合：週の2・5日目 13:00。手動でも予約できます。</p>${st.fixtures.slice(-8).reverse().map(x=>`<p>${x.day}日目 ${clockOf(x.start%1440)} ／ ${esc(x.id)} ／ ${status[x.status]}${x.lineup?` ／ 起用：${esc(sourceName(x.source))}`:''}</p>`).join('')||'<p>まだ試合はありません。「練習試合を予約」で最初の試合を組めます。</p>'}</section>`;
    if(!g){root.querySelector('[data-content]').innerHTML=schedule+(f?.lineup?`<section class="room-sec"><h3>監督が決めたメンバー</h3><p>${esc(f.reason)}</p><ol class="match-plays">${f.lineup.map(x=>`<li>${esc(d.c.person(x.player).name)} ／ ${esc(x.position)}</li>`).join('')}</ol></section>`:'');return;}
    const innings=Math.max(9,g.inning), now=g.complete?'試合終了':`${g.inning}回${g.half?'裏':'表'} ${g.outs}アウト${g.currentPA?` ／ ${g.currentPA.balls}ボール ${g.currentPA.strikes}ストライク`:''}${st.pitching?' ／ 監督が継投を検討中':''}`;
    root.querySelector('[data-content]').innerHTML=`${schedule}<section class="room-sec"><h3>${g.day}日目 ${esc(g.id)}・${now}</h3><div class="match-table"><table class="scoreboard"><thead><tr><th>チーム</th>${Array.from({length:innings},(_,i)=>`<th>${i+1}</th>`).join('')}<th>計</th><th>安</th></tr></thead><tbody>${g.teams.map((t,side)=>`<tr><th>${esc(t.name)}</th>${Array.from({length:innings},(_,i)=>`<td>${t.innings[i]??(g.complete&&i===g.inning-1&&side===1?'×':'—')}</td>`).join('')}<th>${t.score}</th><td>${Object.values(t.batting).reduce((s,b)=>s+b.H,0)}</td></tr>`).join('')}</tbody></table></div><p class="fnote">起用：${esc(sourceName(g.source))} ／ ${esc(g.reason)}。9回制、延長12回同点で終了。DH・盗塁・失策・犠打・死球は省略した${g.v===2?'投球単位':'旧打席単位'}のモデルです。</p>${g.complete?'':diamond(g)}</section><section class="room-sec"><h3>直近の打席</h3><ol class="match-plays">${g.plays.slice(-12).reverse().map(p=>`<li>${p.inning}回${p.half?'裏':'表'} ${esc(g.teams[p.half].roster[p.batter].name)}：${RESULTS[p.result]}${p.runs.length?` ／ ${p.runs.length}得点`:''}（${p.score.join('−')}）</li>`).join('')||'<li>試合開始を待っています。</li>'}</ol></section>${pitchPanel(g,filters).replace('LINEAGE',encodeURIComponent(d.records.lineage))}${g.teams.map(table).join('')}`;
  }
  return { show, render, get open(){return open;} };
}
