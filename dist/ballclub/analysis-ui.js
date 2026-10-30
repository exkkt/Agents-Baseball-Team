// オーナー向けの分析室。数値はすべて metrics.js の query()（小野アナリストと同じ定義）から取り、画面で計算し直さない
import { METRICS, query, compare, abilitySeries, fmt, withUnit, unitText, ABILITY_LABEL, FEW_DAYS } from './metrics.js';
import { coverage } from './records.js';
import { PLAYERS } from './agents.js';
import { MENUS } from './growth.js';
import { STAGE_ORDER, STAGE_LABEL, WORK, THEMES, LIMITS } from './analyst.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PIDS = Object.keys(PLAYERS);
// 選手の色は固定（並び順ではなく人物に結びつける）。暗い背景向けの検証済み8色
export const PLAYER_COLOR = Object.fromEntries(PIDS.map((p, i) => [p, ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767','#53b9b4','#cf9de8','#b9c75b','#e9a36c'][i]]));
const TABLE_METRICS = ['practiceMinutes', 'expGained', 'expPerHour', 'expVsExpected', 'abilityGain', 'wakeFatigue', 'bedFatigue', 'sleepQuality', 'sleepMinutes'];
const SUMMARY = ['practiceMinutes', 'expPerHour', 'abilityGain', 'wakeFatigue', 'sleepQuality'];
const STATUS_TEXT = { no_data: '記録なし', zero_denominator: '分母ゼロ（練習時間・見込みが0）' };
const DEC = { adopted: '採用', declined: '見送り', held: '保留', closed: '終了（進展なし）', pending: '判断待ち', shared: '共有のみ' };
const SRC = { llm: 'ローカルLLMの判断', rule: 'ルール', fallback: 'ルール代替（LLMの失敗時）', mixed: 'LLMとルール代替の混在', replay: '記録の再生' };
const LS = 'ballclub-analysis-view';

export function mountAnalysis({ root, getDirector, getClub }) {
  let open = false, view = load(), lastKey = '', selectedReport = null, hover = {};
  function load() { try { return { range: 7, players: PIDS.slice(), ability: 'bat', ...JSON.parse(localStorage.getItem(LS) || '{}') }; } catch { return { range: 7, players: PIDS.slice(), ability: 'bat' }; } }
  function keep() { try { localStorage.setItem(LS, JSON.stringify(view)); } catch { /* 保存できなくても表示は続ける */ } }
  const name = id => getClub().person(id)?.name || id;

  function period(d) {
    const cv = coverage(d.records), first = Math.min(...[cv.detailFrom, cv.legacyFrom].filter(x => x != null), d.day);
    const to = view.to && view.custom ? Math.min(view.to, d.day) : d.day, from = view.custom && view.from ? Math.max(first, view.from) : view.range === 'all' ? first : Math.max(first, to - view.range + 1);
    return { from: Math.min(from, to), to, first, cv };
  }
  function show(v) { open = v; root.hidden = !v; document.body.classList.toggle('room-open', v); if (v) { render(true); root.querySelector('.room-close')?.focus(); } }

  // 開いたときと条件を変えたときだけ全体を作り直す。進行中はデータの部分だけを更新し、依頼フォームの入力や開いた表は保つ
  function render(force = false) {
    if (!open) return;
    const d = getDirector(), c = getClub(); if (!d) { root.innerHTML = '<div class="room-inner"><p>デモ台本では分析室を使えません。</p><button class="room-close toggle">閉じる</button></div>'; root.querySelector('.room-close').addEventListener('click', () => show(false)); return; }
    const dataKey = `${d.records.seq}|${d.analyst.st.reports.length}|${JSON.stringify(d.analyst.st.reports.map(r => r.recommendations.map(x => x.status).join() + r.recipients.map(x => x.status).join()))}|${selectedReport}`;
    const viewKey = JSON.stringify(view);
    if (!force && root.dataset.view === viewKey && root.querySelector('.room-body')) {
      updateJob(d);
      if (dataKey !== lastKey && Date.now() - (root._at || 0) > 3000) { lastKey = dataKey; root._at = Date.now(); fill(d, c); }
      return;
    }
    root.dataset.view = viewKey; lastKey = dataKey; root._at = Date.now();
    const P = period(d), scrollY = root.querySelector('.room-body')?.scrollTop || 0;
    root.innerHTML = `<div class="room-inner" role="dialog" aria-modal="true" aria-label="分析室">
      <header class="room-head"><div><h2>分析室</h2><p id="room-asof"></p></div><button class="room-close toggle" aria-label="分析室を閉じる">閉じる</button></header>
      <div class="room-body">${filters(P)}<div id="room-data"></div>
        <section class="room-sec"><h3>小野アナリストのレポート</h3>${jobBox(d)}<div id="room-form">${requestForm(P, d)}</div><div id="room-reports"></div></section>
      </div></div>`;
    wireStatic(d);
    fill(d, c);
    const body = root.querySelector('.room-body'); if (body) body.scrollTop = scrollY;
  }
  function fill(d, c) {
    const P = period(d), src = { store: d.records }, players = view.players.length ? view.players : PIDS;
    const asOf = `${d.day}日目 ${c.clock} 時点（記録 #${d.records.seq} まで）`;
    const openKeys = new Set([...root.querySelectorAll('details[data-k][open]')].map(x => x.dataset.k));
    root.querySelector('#room-asof').textContent = `集計はゲームの記録から計算（画面と小野アナリストで同じ定義）。${asOf}。表示は数秒ごとに更新`;
    root.querySelector('#room-data').innerHTML = `${coverageNote(P, d)}
        <section class="room-sec"><h3>チーム全体の概要</h3>${summary(src, P, players, asOf)}</section>
        <section class="room-sec"><h3>練習・生活の選手比較表</h3>${table(src, P, players, asOf)}</section>
        <section class="room-sec"><h3>試合成績</h3><p class="fnote">終了した練習試合を集計。打席が少ない間は能力を断定できません。投球回は「回.アウト」。</p>${gameTable(src, P, players)}</section>
        <section class="room-sec charts"><h3>推移</h3>${abilityChart(src, P, players, asOf)}${dayChart(src, P, players, 'wakeFatigue', asOf, [0, null])}${dayChart(src, P, players, 'sleepQuality', asOf, [0, 1])}</section>
        <section class="room-sec"><h3>練習メニュー別の時間と成果</h3>${menus(src, P, players, asOf)}</section>`;
    root.querySelector('#room-reports').innerHTML = reports(d);
    for (const x of root.querySelectorAll('details[data-k]')) if (openKeys.has(x.dataset.k)) x.open = true;
    wireData(d);
  }
  function gameTable(src, P, players) {
    const metrics = ['gamePA','gameH','gameHR','gameAVG','gameOBP','gameSLG','gameOuts','gameERA','avgVelocity','avgFastball'];
    const rows = compare(src, {players, from:P.from, to:P.to, metrics});
    return `<div class="table-wrap"><table><thead><tr><th>選手</th>${metrics.map(m=>`<th>${METRICS[m].name}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr><th>${esc(name(r.player))}</th>${metrics.map(m=>`<td>${fmt(m,r.cells[m].value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function filters(P) {
    const opts = [3, 7, 14, 30].map(n => `<button class="toggle" data-range="${n}" aria-pressed="${!view.custom && view.range === n}">直近${n}日</button>`).join('') + `<button class="toggle" data-range="all" aria-pressed="${!view.custom && view.range === 'all'}">全期間</button>`;
    const days = []; for (let k = P.first; k <= P.to; k++) days.push(k);
    const sel = (id, v) => `<select id="${id}" aria-label="${id === 'f-from' ? '開始日' : '終了日'}">${days.map(k => `<option value="${k}" ${k === v ? 'selected' : ''}>${k}日目</option>`).join('')}</select>`;
    const chips = PIDS.map(p => `<button class="pchip" data-player="${p}" aria-pressed="${view.players.includes(p)}"><i style="--c:${PLAYER_COLOR[p]}"></i>${esc(name(p))}</button>`).join('');
    return `<div class="room-filters"><div class="frow" role="group" aria-label="対象期間">${opts}<span class="custom">${sel('f-from', P.from)}〜${sel('f-to', P.to)}</span></div>
      <div class="frow" role="group" aria-label="対象の選手">${chips}<button class="toggle" data-all="1">全員</button></div>
      <p class="fnote">対象期間：${P.from}〜${P.to}日目（活動日は 04:00 区切り。今日 ${P.to}日目の分は途中まで）</p></div>`;
  }
  function coverageNote(P, d) {
    const cv = P.cv, legacy = cv.legacyFrom != null ? `既存セーブから取り込んだ日別の記録：${cv.legacyFrom}〜${cv.legacyTo}日目（練習時間・経験・夜の計算の睡眠の質。メニュー内訳・就寝時刻・見込みはなし）。` : '';
    const trimmed = d.records.trimmed.practiceBefore != null ? `練習ごとの詳細は ${d.records.trimmed.practiceBefore}日目以降をこのPCに保存（それ以前はDriveへ送った記録から取得）。` : '';
    return `<p class="cov">詳細な記録は ${cv.detailFrom ?? '—'}日目から。${legacy}${trimmed}</p>`;
  }
  const cell = (r, m) => r.value == null ? `<span class="na" title="${esc(STATUS_TEXT[r.status] || '')}">—</span>` : esc(fmt(m, r.value));
  const sparse = r => r.sparse ? `<em class="few" title="記録が${FEW_DAYS}日分未満">少</em>` : '';
  function summary(src, P, players, asOf) {
    return `<div class="tiles">${SUMMARY.map(m => {
      const r = query(src, { metric: m, from: P.from, to: P.to, players });
      return `<div class="tile"><span>${esc(METRICS[m].name)}</span><b>${cell(r, m)}<small>${esc(unitText(m))}</small></b><p>${P.from}〜${P.to}日目・${players.length}人・記録${r.count}件${r.sparse ? '・<strong>記録が少ない</strong>' : ''}</p></div>`;
    }).join('')}</div><p class="cap">${esc(asOf)}。率は期間の合計どうしで計算（日ごとの率の平均ではない）。「—」は記録なし・分母ゼロ（確認できた0とは別）。</p>`;
  }
  function table(src, P, players, asOf) {
    const rows = compare(src, { players, from: P.from, to: P.to, metrics: TABLE_METRICS });
    return `<div class="tbl-wrap"><table class="cmp"><caption>${P.from}〜${P.to}日目・${esc(asOf)}。各セルは記録件数つき（セルに触れると表示）。</caption>
      <thead><tr><th scope="col">選手</th>${TABLE_METRICS.map(m => `<th scope="col" title="${esc(METRICS[m].formula)}">${esc(METRICS[m].name)}<small>${esc(METRICS[m].unit)}</small></th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr><th scope="row"><i style="--c:${PLAYER_COLOR[r.player]}"></i>${esc(name(r.player))}</th>${TABLE_METRICS.map(m => { const q = r.cells[m]; return `<td title="記録${q.count}件・${q.daysWithData}日分${q.notes.length ? '・' + esc(q.notes.join('／')) : ''}">${cell(q, m)}${sparse(q)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  // ── グラフ（SVG）。軸は1本だけ。ホバーで値・件数を表示し、「表」で同じ値を確認できる
  function lineSVG(id, series, { from, to, yMin, yMax, metric }) {
    const W = 640, H = 210, L = 44, R = 14, T = 12, B = 26, xs = to - from || 1;
    const all = series.flatMap(s => s.points.map(p => p.y)).filter(v => v != null);
    let lo = yMin ?? Math.min(...all), hi = yMax ?? Math.max(...all);
    if (!all.length) { lo = 0; hi = 1; }
    if (yMin == null) { const pad = (hi - lo) * 0.15 || 1; lo -= pad; hi += pad; } else if (yMax == null) hi = Math.max(lo + 10, Math.ceil(hi * 1.15 / 10) * 10);
    const X = x => L + (x - from) / xs * (W - L - R), Y = y => T + (1 - (y - lo) / (hi - lo || 1)) * (H - T - B);
    const ticks = 4, grid = Array.from({ length: ticks + 1 }, (_, k) => lo + (hi - lo) * k / ticks);
    const days = []; for (let k = from; k <= to; k++) days.push(k);
    const step = Math.ceil(days.length / 8);
    hover[id] = { series, X, from, to, metric };
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" data-chart="${id}" role="img" aria-label="${esc(series.map(s => s.label).join('・'))}の推移">
      ${grid.map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="grid"/><text x="${L - 6}" y="${(Y(v) + 3).toFixed(1)}" class="ytick">${esc(fmt(metric, v))}</text>`).join('')}
      ${days.filter((_, k) => k % step === 0).map(k => `<text x="${X(k).toFixed(1)}" y="${H - 8}" class="xtick">${k}日</text>`).join('')}
      ${series.map(s => { const pts = s.points.filter(p => p.y != null); const path = pts.map((p, k) => `${k ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(''); return `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${pts.map(p => `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="4" fill="${s.color}" stroke="var(--card)" stroke-width="2"/>`).join('')}`; }).join('')}
      <line class="cross" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>
      <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" class="hit"/></svg>`;
  }
  function chartBox(id, title, sub, svg, series, rowsHtml, legend = true) {
    return `<figure class="chart-box"><figcaption><b>${esc(title)}</b><span>${sub}</span></figcaption>
      ${legend && series.length > 1 ? `<div class="legend">${series.map(s => `<span><i style="--c:${s.color}"></i>${esc(s.label)}</span>`).join('')}</div>` : ''}
      <div class="chart-wrap">${svg}<div class="tip" hidden></div></div>
      <details data-k="tbl-${id}"><summary>表で見る</summary><div class="tbl-wrap">${rowsHtml}</div></details></figure>`;
  }
  function seriesTable(series, from, to, metric, countLabel = '件数') {
    const days = []; for (let k = from; k <= to; k++) days.push(k);
    return `<table class="cmp small"><thead><tr><th>日</th>${series.map(s => `<th>${esc(s.label)}</th>`).join('')}</tr></thead><tbody>${days.map(k => `<tr><th>${k}日目</th>${series.map(s => { const p = s.points.find(q => q.x === k); return `<td>${p && p.y != null ? esc(fmt(metric, p.y)) + (p.count != null ? `<small>（${countLabel}${p.count}）</small>` : '') : '<span class="na">—</span>'}</td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
  }
  function abilityChart(src, P, players, asOf) {
    const a = view.ability, series = players.map(p => ({ key: p, label: name(p), color: PLAYER_COLOR[p], points: abilitySeries(src, { player: p, from: P.from, to: P.to }).map(r => ({ x: r.day, y: r.end[a], count: null })) }));
    const n = series.reduce((k, s) => k + s.points.length, 0), gain = query(src, { metric: 'abilityGain', from: P.from, to: P.to, players, ability: a });
    const pick = Object.entries(ABILITY_LABEL).map(([k, v]) => `<button class="mini-toggle" data-ability="${k}" aria-pressed="${k === a}">${v}</button>`).join('');
    const sub = `${P.from}〜${P.to}日目・単位：能力値（20〜99）・各日の終わり（04:00）の値・記録${n}件・${esc(asOf)}。期間の成長量 ${esc(withUnit('abilityGain', gain.value))}（睡眠で定着した分）${n < FEW_DAYS ? '・<strong>記録が少ない</strong>' : ''}`;
    return `<div class="pick">${pick}</div>` + chartBox('ability', `能力の推移（${ABILITY_LABEL[a]}）`, sub, n ? lineSVG('ability', series, { from: P.from, to: P.to, metric: 'abilityGain' }) : '<p class="empty-chart">この期間の日別の能力の記録はまだありません（活動日の区切り 04:00 に記録されます）</p>', series, seriesTable(series, P.from, P.to, 'abilityGain'));
  }
  function dayChart(src, P, players, metric, asOf, [yMin, yMax]) {
    const series = players.map(p => { const q = query(src, { metric, from: P.from, to: P.to, players: [p], groupBy: 'day' }); return { key: p, label: name(p), color: PLAYER_COLOR[p], points: (q.groups || []).map(g => ({ x: g.key, y: g.value, count: g.count })), count: q.count }; });
    const n = series.reduce((k, s) => k + s.count, 0);
    const sub = `${P.from}〜${P.to}日目・単位：${esc(METRICS[metric].unit)}・${esc(METRICS[metric].formula)}・記録${n}件・${esc(asOf)}${n < FEW_DAYS ? '・<strong>記録が少ない</strong>' : ''}`;
    return chartBox(metric, METRICS[metric].name + 'の推移', sub, n ? lineSVG(metric, series, { from: P.from, to: P.to, yMin, yMax, metric }) : '<p class="empty-chart">この期間の記録はありません</p>', series, seriesTable(series, P.from, P.to, metric, '睡眠'));
  }
  function menus(src, P, players, asOf) {
    const mins = query(src, { metric: 'practiceMinutes', from: P.from, to: P.to, players, groupBy: 'menu' });
    const eff = query(src, { metric: 'expPerHour', from: P.from, to: P.to, players, groupBy: 'menu' }), vs = query(src, { metric: 'expVsExpected', from: P.from, to: P.to, players, groupBy: 'menu' });
    const groups = (mins.groups || []).filter(g => g.value != null).sort((a, b) => b.value - a.value), max = Math.max(1, ...groups.map(g => g.value));
    const label = k => MENUS[k]?.label || (k === '(内訳なし)' ? '内訳なし（既存セーブ）' : k);
    const get = (q, k) => q.groups?.find(g => g.key === k) || { value: null, status: 'no_data', count: 0 };
    const bars = groups.map(g => `<div class="hbar" tabindex="0" title="${esc(label(g.key))}：${esc(fmt('practiceMinutes', g.value))}分・記録${g.count}件"><span>${esc(label(g.key))}</span><i style="width:${(g.value / max * 100).toFixed(1)}%"></i><b>${esc(fmt('practiceMinutes', g.value))}分</b></div>`).join('');
    const rows = groups.map(g => `<tr><th scope="row">${esc(label(g.key))}</th><td>${cell(g, 'practiceMinutes')}</td><td>${cell(get(eff, g.key), 'expPerHour')}</td><td>${cell(get(vs, g.key), 'expVsExpected')}</td><td>${g.count}</td></tr>`).join('');
    return `<p class="cap">${P.from}〜${P.to}日目・${players.length}人・練習記録${mins.count}件・${esc(asOf)}${mins.sparse ? '・<strong>記録が少ない</strong>' : ''}</p>
      <div class="menu-grid"><div class="hbars" aria-label="メニュー別の練習時間">${bars || '<p class="empty-chart">記録がありません</p>'}</div>
      <div class="tbl-wrap"><table class="cmp"><thead><tr><th>メニュー</th><th>練習時間<small>分</small></th><th>1時間あたりの獲得経験<small>経験/時</small></th><th>見込みに対する成果<small>倍</small></th><th>記録件数</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }
  // ── 小野アナリストの作業とレポート
  function jobBox(d) {
    const j = d.analyst.st.jobs.find(x => STAGE_ORDER.includes(x.stage)), queued = d.analyst.st.jobs.filter(x => x.stage === 'queued');
    if (!j) return `<div class="job" id="job-box"><p>いま進めている分析はありません。${queued.length ? `着手待ち ${queued.length}件（出勤中なら順番に始めます）` : ''}</p></div>`;
    return `<div class="job" id="job-box">${jobInner(d, j, queued)}</div>`;
  }
  function jobInner(d, j, queued) {
    const k = STAGE_ORDER.indexOf(j.stage);
    const wait = j.pending === 'llm' ? `判断を待っている（${d.queue.findIndex(q => q.extra?.job === j.id) >= 0 ? 'LLMの順番待ち' : 'LLMが推論中'}）` : j.pending === 'drive' ? 'Driveから記録を取得している' : j.stage === 'report' ? (j.recipients || []).map(r => `${name(r.who)}：${r.status === 'delivered' ? '報告済み' : r.held || '報告に向かう'}`).join('、') : WORK[j.stage] ? `ゲーム内の作業 ${Math.min(j.work, WORK[j.stage] + (j.stage === 'collect' ? 5 * j.counts.fetch : 0))}／${WORK[j.stage] + (j.stage === 'collect' ? 5 * j.counts.fetch : 0)}分` : '';
    return `<p><b>${esc(j.id)}</b> ${esc(THEMES[j.request.theme])}（${esc(j.trigger === 'postgame' ? '試合後の分析' : j.trigger === 'owner' ? 'オーナーの依頼' : j.trigger === 'manager' ? '監督の依頼' : j.trigger === 'weekly' ? '週の振り返り' : '定例分析')}・${esc(j.startedClock || j.createdClock)} 着手${j.asOf ? `・データは${esc(j.asOf.day + '日目 ' + j.asOf.clock)}時点で固定` : ''}）</p>
      <ol class="stages">${STAGE_ORDER.map((s, i) => `<li class="${i < k ? 'done' : i === k ? 'now' : ''}">${STAGE_LABEL[s]}</li>`).join('')}</ol><p class="minor-line">現在：${STAGE_LABEL[j.stage]}。${esc(wait)}${queued.length ? `／着手待ち ${queued.length}件` : ''}</p>
      <p class="minor-line">調査：検索 ${j.counts.search}/${LIMITS.maxSearch}回・取得 ${j.counts.fetch}/${LIMITS.maxFetch}件・追加調査 ${j.counts.followups}/${LIMITS.maxFollowups}回</p>`;
  }
  function updateJob(d) {
    const box = root.querySelector('#job-box'); if (!box) return;
    const j = d.analyst.st.jobs.find(x => STAGE_ORDER.includes(x.stage)), queued = d.analyst.st.jobs.filter(x => x.stage === 'queued');
    const html = j ? jobInner(d, j, queued) : `<p>いま進めている分析はありません。${queued.length ? `着手待ち ${queued.length}件（${d.duty.analyst?.state === 'on' ? '順番に始めます' : '小野の出勤後に始めます'}）` : ''}</p>`;
    if (box.dataset.html !== html) { box.innerHTML = html; box.dataset.html = html; }
  }
  function requestForm(P, d) {
    return `<details class="req" ${view.formOpen ? 'open' : ''}><summary>分析を依頼する</summary><form id="req-form">
      <div class="frow">${PIDS.map(p => `<label class="pchip"><input type="checkbox" name="p" value="${p}" ${view.players.includes(p) && view.players.length <= LIMITS.maxPlayers ? 'checked' : ''}><i style="--c:${PLAYER_COLOR[p]}"></i>${esc(name(p))}</label>`).join('')}</div>
      <div class="frow"><label>テーマ <select name="theme">${Object.entries(THEMES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label>期間 <input name="from" type="number" min="${P.first}" max="${d.day}" value="${P.from}" inputmode="numeric">〜<input name="to" type="number" min="${P.first}" max="${d.day}" value="${P.to}" inputmode="numeric">日目</label></div>
      <label class="q">質問（任意・100字まで）<input name="question" maxlength="100" placeholder="例：最近の打撃練習の効率は落ちていないか"></label>
      <p class="minor-line">対象は最大${LIMITS.maxPlayers}人。小野が出勤中なら順番に着手し、勤務外なら出勤後に始めます。数値は共通の集計から計算し、LLMには計算させません。</p>
      <button class="toggle" type="submit">依頼する</button> <span id="req-msg" role="status"></span></form></details>`;
  }
  function reports(d) {
    const list = d.analyst.st.reports.slice().reverse();
    if (!list.length) return '<p class="minor-line">まだレポートはありません（定例分析は2日目以降の 09:30 ごろから。依頼からも作れます）。</p>';
    const sel = list.find(r => r.id === selectedReport) || list[0];
    return `<div class="rep-grid"><ol class="rep-list">${list.map(r => `<li><button data-report="${r.id}" aria-pressed="${r.id === sel.id}"><b>${esc(r.id)}</b> ${esc(r.title)}<small>${esc(r.createdClock)}・${esc(r.triggerLabel)}・${esc(SRC[r.generatedBy] || r.generatedBy)}</small></button></li>`).join('')}</ol>${reportDetail(sel)}</div>`;
  }
  function reportDetail(r) {
    const per = p => p ? `${p.from}〜${p.to}日目` : 'なし';
    const factRows = r.facts.map(f => `<tr><td>${esc(f.id)}</td><td>${esc(f.player ? name(f.player) : 'チーム')}</td><td>${esc(f.name)}${f.groupBy ? `（${esc(f.groupBy)}別）` : ''}</td><td>${f.period === 'current' ? '対象' : '比較'} ${per(f)}</td><td>${f.groupBy ? (f.groups || []).map(g => `${esc(MENUS[g.key]?.label || g.key)} ${esc(g.display)}`).join('、') : `${esc(f.display)}<small>${esc(unitText(f.metric))}</small>`}</td><td>${f.count}${f.sparse ? '<em class="few">少</em>' : ''}${f.legacy ? `<small>（既存セーブ${f.legacy}）</small>` : ''}</td></tr>`).join('');
    const recs = r.recommendations.map(x => `<li><b>${esc(x.label)}</b>${x.player ? `（${esc(name(x.player))}${x.focus ? '・' + esc(x.focus) : ''}）` : ''}${x.note ? `「${esc(x.note)}」` : ''}<span class="dec s-${x.status}">${esc(DEC[x.status] || x.status)}${x.decidedBy ? `・${esc(name(x.decidedBy))}` : x.decider ? `・判断：${esc(name(x.decider))}` : ''}</span>${x.reason ? `<small>理由「${esc(x.reason)}」</small>` : ''}${x.applied ? `<small>反映：${esc(x.applied)}</small>` : ''}<small>根拠の記録：${x.evidence === 'clear' ? '十分' : '少ない'}</small></li>`).join('');
    const rec = r.recipients.map(x => `<li>${esc(name(x.who))}：${x.status === 'delivered' ? `報告済み（${esc(x.deliveredAt)}）` : esc(x.held || '報告待ち')}</li>`).join('');
    return `<article class="rep" aria-label="レポート ${esc(r.id)}"><h4>${esc(r.id)}　${esc(r.title)}</h4>
      <dl class="facts2"><dt>作成</dt><dd>${esc(r.createdClock)}（${esc(r.triggerLabel)}）${r.question ? `／質問「${esc(r.question)}」` : ''}</dd><dt>対象期間</dt><dd>${per(r.period.current)}（比較：${per(r.period.baseline)}）</dd>
      <dt>対象選手</dt><dd>${r.players.map(name).map(esc).join('・')}</dd><dt>使った指標</dt><dd>${r.metrics.map(m => esc(METRICS[m].name)).join('、')}</dd>
      <dt>データ</dt><dd>${esc(r.asOf.day + '日目 ' + r.asOf.clock)} 時点で固定・参照した記録 ${r.data.records}件（既存セーブ ${r.data.legacy}件・保存庫から ${r.data.archiveRows}件／${r.data.archiveFiles}ファイル）・集計 ${r.data.queries}件・追加調査 ${r.data.followups}回</dd>
      <dt>判断の出どころ</dt><dd>${esc(SRC[r.generatedBy] || r.generatedBy)}（調査計画：${esc(SRC[r.planBy] || r.planBy)}・考察：${esc(SRC[r.writeBy] || r.writeBy)}）</dd></dl>
      <h5>確認できた事実</h5><ul class="finds">${r.findings.map(f => `<li><span>${esc(f.factText)}</span>${f.note ? `<small>${esc(f.note)}</small>` : ''}</li>`).join('')}</ul>
      <h5>小野の考察</h5><p>${esc(r.insight || '（考察なし）')}</p>
      <h5>提案と関係者の判断</h5><ul class="recs">${recs || '<li>提案なし</li>'}</ul>
      <h5>データ不足・不確実な点</h5><ul class="cav">${r.caveats.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      <h5>報告先と報告状況</h5><ul class="cav">${rec}</ul>
      <details data-k="facts-${esc(r.id)}"><summary>集計値（${r.facts.length}件）</summary><div class="tbl-wrap"><table class="cmp small"><thead><tr><th>ID</th><th>選手</th><th>指標</th><th>期間</th><th>値</th><th>記録</th></tr></thead><tbody>${factRows}</tbody></table></div></details>
      <details data-k="tools-${esc(r.id)}"><summary>調べた手順（${r.toolLog.length}件）</summary><ol class="cav">${r.toolLog.map(t => `<li>${esc(t.at)} ${esc(t.tool)}：${esc(t.result)}</li>`).join('')}</ol>${r.issues.length ? `<p class="minor-line">検証で除外・調整：${r.issues.map(esc).join('、')}</p>` : ''}</details></article>`;
  }

  function wireStatic(d) {
    root.querySelector('.room-close')?.addEventListener('click', () => show(false));
    root.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => { view.range = b.dataset.range === 'all' ? 'all' : Number(b.dataset.range); view.custom = false; keep(); render(true); }));
    for (const id of ['f-from', 'f-to']) root.querySelector('#' + id)?.addEventListener('change', () => { view.custom = true; view.from = Number(root.querySelector('#f-from').value); view.to = Number(root.querySelector('#f-to').value); if (view.from > view.to) [view.from, view.to] = [view.to, view.from]; keep(); render(true); });
    root.querySelectorAll('.pchip[data-player]').forEach(b => b.addEventListener('click', () => { const p = b.dataset.player; view.players = view.players.includes(p) ? view.players.filter(x => x !== p) : PIDS.filter(x => x === p || view.players.includes(x)); keep(); render(true); }));
    root.querySelector('[data-all]')?.addEventListener('click', () => { view.players = PIDS.slice(); keep(); render(true); });
    root.querySelector('.req')?.addEventListener('toggle', e => { view.formOpen = e.target.open; keep(); });
    root.querySelector('#req-form')?.addEventListener('submit', e => {
      e.preventDefault();
      const f = new FormData(e.target), players = f.getAll('p'), msg = root.querySelector('#req-msg');
      if (!players.length) { msg.textContent = '選手を1人以上選んでください'; return; }
      if (players.length > LIMITS.maxPlayers) { msg.textContent = `選手は${LIMITS.maxPlayers}人までです`; return; }
      let from = Number(f.get('from')), to = Number(f.get('to')); if (from > to) [from, to] = [to, from];
      const r = d.analyst.request({ trigger: 'owner', by: 'owner', players, from, to, theme: f.get('theme'), question: String(f.get('question') || '') });
      msg.textContent = r.ok ? `受け付けました（${r.id}）。進み具合は上の欄に表示します` : r.message; updateJob(d);
    });
  }
  function wireData(d) {
    root.querySelectorAll('[data-ability]').forEach(b => b.addEventListener('click', () => { view.ability = b.dataset.ability; keep(); render(true); }));
    root.querySelectorAll('[data-report]').forEach(b => b.addEventListener('click', () => { selectedReport = b.dataset.report; lastKey = ''; root._at = 0; fill(d, getClub()); }));
    root.querySelectorAll('svg.chart').forEach(svg => {
      const id = svg.dataset.chart, H = hover[id], tip = svg.parentElement.querySelector('.tip'), cross = svg.querySelector('.cross');
      const move = ev => {
        const r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width * 640;
        let best = H.from, bd = Infinity; for (let k = H.from; k <= H.to; k++) { const dd = Math.abs(H.X(k) - x); if (dd < bd) { bd = dd; best = k; } }
        const vals = H.series.map(s => ({ s, p: s.points.find(q => q.x === best) })).filter(o => o.p && o.p.y != null);
        cross.setAttribute('x1', H.X(best)); cross.setAttribute('x2', H.X(best)); cross.setAttribute('visibility', 'visible');
        tip.hidden = false; tip.innerHTML = `<b>${best}日目</b>${vals.length ? vals.map(o => `<span><i style="--c:${o.s.color}"></i>${esc(o.s.label)} ${esc(fmt(H.metric, o.p.y))}${o.p.count != null ? `<small>（${o.p.count}件）</small>` : ''}</span>`).join('') : '<span>記録なし</span>'}`;
        const left = (H.X(best) / 640) * r.width; tip.style.left = `${Math.min(r.width - 150, Math.max(0, left + 10))}px`;
      };
      svg.addEventListener('pointermove', move); svg.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
    });
  }
  root.addEventListener('keydown', e => { if (e.key === 'Escape') show(false); });
  return { show, toggle: () => show(!open), render, get open() { return open; } };
}
