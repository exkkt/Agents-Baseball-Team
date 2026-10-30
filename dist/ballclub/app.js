// 画面の操作（再生・選択・詳細・出来事・判断キュー）。状態は Club と Director、見た目は Renderer に任せる
import { Club, STATUS } from './sim.js';
import { DemoDirector } from './director.js';
import { AgentDirector, KIND_LABEL, SOURCE_LABEL } from './brain.js';
import { LocalLLM } from './llm.js';
import { Stepper } from './stepper.js';
import { ABILITIES, INTENSITY, MENUS, condLabel, fatigueLabel, describeReport } from './growth.js';
import { PLAYERS, COACHES, FOCUS, POLICY, clockOf } from './agents.js';
import { Renderer, STATUS_COLOR } from './render.js';
import { mugshot } from './sprites.js';
import { SPOTS, spotAnchor } from './world.js';
import { mountDrive } from './drive-ui.js';
import { migrateSnapshot } from './save-format.js';
import { DriveArchive, archiveAdapter } from './drive-archive.js';
import { DataStore } from './data-store.js';
import { mountMatches } from './match-ui.js';
import { mountAnalysis } from './analysis-ui.js';
import { STAGE_LABEL } from './analyst.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON = { pause: '<svg viewBox="0 0 14 14"><rect x="2" y="1" width="3.5" height="12" fill="currentColor"/><rect x="8.5" y="1" width="3.5" height="12" fill="currentColor"/></svg>', play: '<svg viewBox="0 0 14 14"><path d="M3 1.5v11l9-5.5z" fill="currentColor"/></svg>' };
const SAVE_KEY = 'ballclub-agents-v1', SEED = 21, AUTO_KEY = SAVE_KEY + '-drive-auto';
const params = new URLSearchParams(location.search), DEMO = params.get('mode') === 'demo';
const llm = new LocalLLM();
const dataStore = new DataStore(), archive = new DriveArchive({local:dataStore}), driveAdapter = archiveAdapter(archive,dataStore);
const BASE_DATE = Date.UTC(2027, 1, 1); // 1日目＝2月1日（月）。春季キャンプの想定
const dateText = day => { const d = new Date(BASE_DATE + (day - 1) * 86400000); return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${'日月火水木金土'[d.getUTCDay()]}）`; };

let club, director, renderer, speed = 1, paused = false, selected = 'aoki', last = performance.now(), panelAt = 0, unsub = null, showAll = false, savedAt = null, ff = null, room = null, matchesRoom = null;
let mode = (() => { try { return localStorage.getItem(SAVE_KEY + '-mode') || 'llm'; } catch { return 'llm'; } })();
const stepper = new Stepper();

function boot({ fresh = false, snapshot = null } = {}) {
  club = new Club({ seed: SEED });
  director = null;
  if (DEMO) { new DemoDirector().start(club); selected = 'hcoach'; }
  else {
    let data = snapshot;
    if (!fresh && !snapshot) try { data = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { data = null; }
    // 旧版（v1）のセーブは、移行する前にこのブラウザへ1件そのまま退避してから新しい形式に直す
    if (data && data.v < 3) try { if (!localStorage.getItem(SAVE_KEY + '-backup-v' + data.v)) localStorage.setItem(SAVE_KEY + '-backup-v' + data.v, JSON.stringify(data)); } catch { /* 退避できなくても読み込みは続ける */ }
    try { director = data ? AgentDirector.restore(club, migrateSnapshot(data), { provider: llm, mode, archive: driveAdapter }) : null; } catch (e) { console.warn('セーブを読み込めませんでした', e); director = null; }
    if (!director) { club = new Club({ seed: SEED }); director = new AgentDirector({ seed: SEED, provider: llm, mode, archive: driveAdapter }).start(club); }
    else { savedAt = data.savedAt; if (data.v < 3) club.event('既存の進行・記録を引き継ぎ、練習試合と追加選手に対応した形式へ移行しました', { kind: 'system' }); }
  }
  if (unsub) unsub();
  unsub = club.on((type, e) => {
    if (type === 'event' && (showAll || !e.minor)) renderLog(e.id);
    if (type === 'event' && e.who?.includes(selected)) renderHistory();
    if (type === 'reason' && e.id === selected) renderPerson();
    if (type === 'pitch' && e.seq % 10 === 0) dataStore.flush(director).then(() => {saveLocal();renderRecords();});
    if (type === 'autosave') { save(); if (driveAuto() && archive.available()) archive.flush(director).then(renderRecords); }
    if (type === 'report' && room?.open) room.render();
  });
  if (renderer) renderer.setClub(club); else renderer = new Renderer($('world'), club);
  renderer.selected = selected; renderer.cam.follow = null;
  buildCast(); renderLog(); renderStory(); renderPerson(); renderHistory(); renderBadge(); renderQueue(); renderRecords(); if (matchesRoom?.open) matchesRoom.render(true);
}
function saveLocal() {
  if (!director) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(director.serialize())); savedAt = Date.now(); $('save-note').textContent = ` 自動保存：${club.day}日目 ${club.clock}（このブラウザ）`; }
  catch { $('save-note').textContent = ' ブラウザの保存領域が不足しています。記録を保護するため一時停止しました。'; paused=true; $('play').innerHTML=ICON.play; $('play').setAttribute('aria-label','再生'); $('paused').hidden=false; }
}

function save() { saveLocal(); if(director)dataStore.flush(director).then(()=>{saveLocal();renderRecords();}); }

// ── ループ（固定刻みで進め、毎フレーム描く）
function loop(now) {
  const dt = (now - last) / 1000; last = now;
  if (ff && !paused) runFastForward();
  else stepper.advance(club, dt, speed, paused);
  renderer.draw();
  if (now - panelAt > 200) { panelAt = now; renderClock(); renderPerson(); renderCastStatus(); renderStory(); renderQueue(); if (room?.open) room.render(); if (matchesRoom?.open) matchesRoom.render(); }
  requestAnimationFrame(loop);
}
// ── 朝まで早送り：同じ刻みをまとめて実行する（睡眠・回復・分析作業も途中を省かずに進む）。判断が必要になったら止める
const MORNING = 6 * 60 + 30;
function ffTarget() { const m = club.minutes, mod = ((m % 1440) + 1440) % 1440; return m - mod + (mod < MORNING ? MORNING : 1440 + MORNING); }
function canFastForward() { const mod = Math.floor(club.minutes) % 1440; return !!director && (mod >= 19 * 60 || mod < MORNING); }
function startFastForward() {
  if (!canFastForward()) { $('ff-note').textContent = '早送りは 19:00〜06:30 に使えます'; return; }
  ff = { until: ffTarget(), warnFrom: club.seq, startedAt: club.minutes }; $('ff').setAttribute('aria-pressed', 'true'); $('ff-note').textContent = `${clockOf(ff.until % 1440)} まで早送り中…`;
}
function stopFastForward(text) { ff = null; $('ff').setAttribute('aria-pressed', 'false'); $('ff-note').textContent = text || ''; }
function runFastForward() {
  const warn = () => club.events.some(e => e.id > ff.warnFrom && e.kind === 'warn');
  const r = stepper.fastForward(club, ff.until, { budgetMs: 22, now: () => performance.now(), stop: () => director.needsAttention() || warn() });
  if (r.stopped) { setPaused(true); stopFastForward(director.needsAttention() ? `${club.clock}：判断が必要になったため早送りを止めて一時停止しました（判断キューを確認してください）` : `${club.clock}：注意が必要な出来事があったため早送りを止めて一時停止しました`); }
  else if (r.done) { stopFastForward(`${club.clock} まで早送りしました（途中の睡眠・回復・作業も計算済み）`); save(); }
}

function renderClock() {
  $('clock').textContent = club.clock; $('day').textContent = `${club.day}日目`; $('date').textContent = dateText(club.day);
  const m = Math.floor(club.minutes + 1e-6) % 1440;
  $('period').textContent = m < 5 * 60 ? '深夜' : m < 7 * 60 ? '早朝・起床' : m < 9 * 60 ? '朝食・準備' : m < 12 * 60 ? '午前の練習' : m < 13 * 60 ? '昼休み' : m < 17 * 60 + 30 ? '午後の練習' : m < 18 * 60 + 30 ? '夕食・振り返り' : m < 22 * 60 ? '夜の自由時間' : '就寝';
  const match = director?.matches.fixture(); if (match && ['preparing','playing'].includes(match.status)) $('period').textContent = match.status === 'playing' ? '練習試合' : '試合の準備';
  $('ff').disabled = !canFastForward() && !ff;
}
function renderBadge() {
  const b = $('llm-badge');
  if (DEMO) { b.textContent = 'デモ台本・AI未接続'; b.className = 'badge warn'; b.title = '旧デモ台本（?mode=demo）。AIには接続していません。'; return; }
  const st = llm.state;
  if (mode === 'rules') { b.textContent = 'ルールで判断'; b.className = 'badge off'; b.title = 'すべての判断をルールで行っています（LLMは使っていません）。'; }
  else if (!st.checked) { b.textContent = 'LLM 確認中…'; b.className = 'badge off'; b.title = 'ローカルLLMの接続を確認しています。判断要求は確認が終わるまで待機します。'; }
  else if (st.ok && llm.available) { b.textContent = `ローカルLLM：${st.model}`; b.className = 'badge ok'; b.title = '判断（予定・提案・方針）をローカルLLMが決め、実行と数値計算はゲームが行います。'; }
  else { b.textContent = 'LLM未接続・ルールで代替中'; b.className = 'badge warn'; b.title = `ローカルLLMに接続できないため、判断をルールで代替しています（${st.error || '接続失敗'}）。LLMの判断として扱いません。`; }
  document.querySelectorAll('[data-mode]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.mode === mode)));
}

// ── 選択中の人物
let mugFor = '';
const bar = (el, v, max = 100) => { el.style.width = `${Math.max(0, Math.min(100, v / max * 100))}%`; };
const blockLine = b => `${MENUS[b.menu].label} ${b.minutes}分（${INTENSITY[b.intensity]?.label || ''}）`;
function renderPerson() {
  const p = club.person(selected); if (!p) return;
  const st = club.status(p);
  $('p-name').textContent = p.label; $('p-role').textContent = p.roleLabel;
  const chip = $('p-status'); chip.textContent = STATUS[st]; chip.style.setProperty('--c', STATUS_COLOR[st]);
  $('p-doing').textContent = club.doing(p); $('p-place').textContent = club.place_(p);
  const v = director?.personView(selected) || { managed: false };
  $('p-room').hidden = selected !== 'analyst' || !director;
  if (v.managed) {
    $('p-decision').innerHTML = `<span class="dstate s-${v.state}">${esc(v.text)}</span><small>今日のLLM呼び出し ${v.calls.today}回・累計 ${v.calls.total}回（統計。回数の上限はありません）</small>`;
    const focus = PLAYERS[selected] ? (v.dayFocus ? `${FOCUS[v.dayFocus]}` : v.life?.migrated ? '旧版から移行した日のため未設定（次の起床後に決める）' : '未定（起床後に決める）') + (v.focus ? `／監督からの明日の方針：${FOCUS[v.focus]}` : '') : v.staffPlan ? `${v.staffPlan.label}${v.staffPlan.watch ? `（${club.person(v.staffPlan.watch).name}を特に見る）` : ''}${v.staffPlan.note ? `「${v.staffPlan.note}」` : ''}` : selected === 'analyst' ? (director.analyst.current() ? `分析 ${director.analyst.current().id}（${STAGE_LABEL[director.analyst.current().stage]}）` : '定例分析と依頼への対応') : '未定（出勤後に決める）';
    $('p-focus').textContent = focus;
    $('p-next').textContent = PLAYERS[selected] ? (v.next.length ? v.next.map(b => b.menu === 'sleep' ? `就寝 ${b.text}` : `${b.half} ${blockLine(b)}`).join(' → ') : v.life?.state === 'asleep' ? `起床 ${clockOf(v.life.wakeAt % 1440)} のあと、その日の予定を決める` : '未定（必要になったら判断する）') : v.duty ? `勤務 ${clockOf(v.duty.arriveAt % 1440)}〜${clockOf(v.duty.leaveAt % 1440)}・` + (COACHES[selected] ? `担当：${COACHES[selected].players.map(id => club.person(id).name).join('・')}（10:30・15:00に振り返り）` : selected === 'manager' ? '17:30 に一日の振り返り' : selected === 'gm' ? '監督の報告を受けて球団方針を決める' : '分析の依頼に順番に対応') : '—';
    $('p-inbox').innerHTML = v.inbox.length ? v.inbox.map(i => `<li>${esc(i.fromLabel)}の${esc(i.kindLabel)}：${esc(i.text)}<small>${i.status === 'held' ? `保留中（${i.holds}回目・${esc(i.reason || '')}）` : i.needsDecision ? (i.urgent ? '急ぎ・すぐに検討' : '次の区切りで検討') : '共有のみ'}</small></li>`).join('') : '<li class="empty">なし</li>';
    $('p-changes').innerHTML = [...v.changes.map(ch => `<li><time>${esc(ch.time)}</time>${esc(ch.text)}${ch.reason ? `<small>理由：${esc(ch.reason)}・${esc(SOURCE_LABEL[ch.source] || ch.source)}</small>` : `<small>${esc(SOURCE_LABEL[ch.source] || ch.source)}</small>`}</li>`), ...v.recentItems.map(i => `<li><time>${esc(i.clock)}</time>${esc(i.fromLabel)}の${esc(i.kindLabel)}を${{ adopted: '採用', declined: '見送り', closed: '終了' }[i.status] || i.status}<small>${esc(i.end || i.reason || '')}</small></li>`)].join('') || '<li class="empty">なし</li>';
    const r = v.reason;
    $('p-reason').innerHTML = r && r.text ? `「${esc(r.text)}」<small>${esc(r.time)}・${esc(r.tag || SOURCE_LABEL[r.source])}</small>` : '—';
    $('p-src').textContent = r ? `直近の判断の出どころ：${r.tag || SOURCE_LABEL[r.source]}` : '判断はまだありません';
  } else {
    $('p-decision').textContent = DEMO ? 'デモ台本' : v.duty ? (p.away ? `勤務時間外（次の出勤 ${clockOf(v.duty.arriveAt % 1440)}）` : `定型の行動（ルール）・勤務 ${clockOf(v.duty.arriveAt % 1440)}〜${clockOf(v.duty.leaveAt % 1440)}`) : '定型の行動（ルール）';
    $('p-next').textContent = '—'; $('p-focus').textContent = '—'; $('p-inbox').innerHTML = '<li class="empty">—</li>'; $('p-changes').innerHTML = '<li class="empty">—</li>';
    $('p-reason').innerHTML = p.reason ? `「${esc(p.reason.text)}」<small>${esc(p.reason.time)} 時点・${DEMO ? 'デモ台本' : '定型の行動'}</small>` : '—';
    $('p-src').textContent = DEMO ? '行動の出どころ：デモ台本（AI未接続）' : '行動の出どころ：ルール（定型の行動・LLM不使用）';
  }
  const tr = v.tr;
  $('p-player').hidden = !tr;
  if (tr) {
    bar($('p-fat-bar'), tr.fatigue); $('p-fat-bar').style.background = tr.fatigue >= 70 ? '#e07a5f' : tr.fatigue >= 45 ? '#e9b35a' : '#79c49a';
    $('p-fat').textContent = `${tr.fatigue.toFixed(0)}（${fatigueLabel(tr.fatigue)}）`;
    const cb = $('p-cond-bar'), cv = tr.condition; cb.style.left = cv >= 0 ? '50%' : `${50 + cv * 50}%`; cb.style.width = `${Math.abs(cv) * 50}%`; cb.style.background = cv >= 0 ? '#79c49a' : '#7fb6e0';
    $('p-cond').textContent = `${condLabel(cv)}（${cv >= 0 ? '+' : ''}${cv.toFixed(2)}）`;
    const ls = tr.lastSleep, life = v.life;
    const sleepLine = ls ? `前回の睡眠：${clockOf(ls.start % 1440)}〜${clockOf(ls.end % 1440)}（${Math.floor(ls.minutes / 60)}時間${ls.minutes % 60}分${ls.kind === 'nap' ? '・仮眠' : ''}${ls.wakeups.length ? `・途中で${ls.wakeups.length}回目覚めた` : ''}）質 ${ls.quality.toFixed(2)}・疲労 ${ls.fatigue[0]}→${ls.fatigue[1]}` : `睡眠の記録はまだありません（質 ${tr.sleep.quality.toFixed(2)} は初期値・旧版の値）`;
    const plan = life?.state === 'asleep' ? `睡眠中・起床予定 ${clockOf(life.wakeAt % 1440)}` : life?.sched ? `今夜の就寝予定 ${clockOf(life.sched.bedAt % 1440)}` : '';
    $('p-sleep').textContent = `${sleepLine}。${plan}。練習に効く睡眠の質 ${tr.sleep.quality.toFixed(2)}・今日の揺らぎ ×${tr.dayLuck.toFixed(2)}（成長の効率。調子とは別）`;
    const prev = ls && ls.kind === 'main' ? ls : null;
    $('p-ability').innerHTML = Object.entries(ABILITIES).map(([k, name]) => `<tr><th>${name}</th><td>${tr.ability[k].toFixed(1)}${prev && prev.gains[k] > 0.0005 ? `<small>+${prev.gains[k].toFixed(2)}</small>` : ''}</td><td>${tr.today.exp[k] ? '+' + tr.today.exp[k].toFixed(1) : '—'}</td><td><i class="xp"><b style="width:${Math.min(100, tr.exp[k] / 60 * 100)}%"></b></i>${tr.exp[k].toFixed(1)}</td></tr>`).join('');
    const perf = tr.perf.cage ? `・打撃ケージの出来：芯 ${tr.perf.sharp}／好打 ${tr.perf.good}／${tr.perf.cage}球（調子と能力で決まり、成長には使わない）` : '';
    $('p-today').textContent = `今日の練習 ${tr.today.minutes}分／上限 ${v.cap}分${perf}。能力の小さな数字は前回の睡眠で定着した分。`;
    $('p-last').textContent = tr.last ? `${tr.last.time} ${describeReport(tr.last, '').replace(/^：/, '')}${tr.last.cut ? `（${tr.last.cut}）` : ''}` : 'まだありません';
  }
  const key = p.id + (p.look.cap && club.outdoors(p) ? 'cap' : '');
  if (mugFor !== key) {
    mugFor = key;
    const m = $('mug').getContext('2d'); m.clearRect(0, 0, 24, 22); m.drawImage(mugshot(p.look, p.look.headwear || (p.look.cap && club.outdoors(p) ? 'cap' : null)), 0, 0);
  }
  $('follow').setAttribute('aria-pressed', String(renderer.cam.follow === selected));
}
function renderHistory() {
  const list = club.events.filter(e => e.who?.includes(selected)).slice(-8).reverse();
  $('p-history').innerHTML = list.length ? list.map(e => `<li class="k-${e.kind}"><time>${e.day ? e.day + '日 ' : ''}${e.time}</time><span>${esc(e.text)}</span></li>`).join('') : '<li class="empty">まだありません</li>';
}
function select(id, { focus = false } = {}) {
  if (!club.person(id)) return;
  selected = id; renderer.selected = id;
  if (renderer.cam.follow && renderer.cam.follow !== id) renderer.cam.follow = id;
  if (focus) { const p = club.person(id); renderer.focus(p.x, p.y - 12, true); }
  mugFor = ''; renderPerson(); renderHistory(); renderCastStatus();
}

// ── 判断キュー
function renderQueue() {
  if (!director) { $('queue').innerHTML = '<p class="empty">デモ台本ではキューを使いません</p>'; return; }
  const q = director.queueView(), name = id => esc(club.person(id).name);
  $('q-sum').textContent = `処理中 ${q.inflight ? 1 : 0}・待ち ${q.queued.length}・同時実行の最大 ${q.maxActive}・LLM呼び出し 計${q.stats.calls}回`;
  const rows = [];
  if (q.inflight) rows.push(`<li class="run"><b>判断中</b>${name(q.inflight.who)}：${KIND_LABEL[q.inflight.kind]}<em>${q.inflight.secs}秒</em></li>`);
  q.queued.slice(0, 5).forEach((r, i) => rows.push(`<li><b>${i + 1}</b>${name(r.who)}：${KIND_LABEL[r.kind]}<em>${r.sleeping ? '起きてから' : r.deferred ? '混雑のため後回し' : `${r.waited}分待ち`}</em></li>`));
  if (q.queued.length > 5) rows.push(`<li class="more">ほか ${q.queued.length - 5}件</li>`);
  const recent = q.recent.slice(0, 4).map(r => `<li class="done"><b>${esc(r.clock)}</b>${name(r.who)}：${KIND_LABEL[r.kind]}<em class="src-${r.source}">${SOURCE_LABEL[r.source]}${r.source === 'llm' && r.ms ? ` ${(r.ms / 1000).toFixed(1)}秒` : ''}${r.applied ? '' : '・不採用'}</em></li>`);
  const html = `<ol>${rows.join('') || '<li class="empty">待っている判断はありません</li>'}</ol><h5>最近の判断</h5><ol>${recent.join('') || '<li class="empty">—</li>'}</ol><p class="pol">球団方針：${POLICY[director.policy].label}（練習上限 ${POLICY[director.policy].cap}分）。重複をまとめた要求 ${q.stats.merged}件・後回し ${q.stats.deferred}件・不要になり取り消し ${q.stats.expired}件</p>`;
  if ($('queue').dataset.html !== html) { $('queue').innerHTML = html; $('queue').dataset.html = html; }
}

// ── 人物一覧
function buildCast() {
  const box = $('cast'); box.innerHTML = '';
  for (const p of club.people.values()) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.id = p.id; b.setAttribute('aria-label', `${p.label}・${p.roleLabel}`);
    const cv = document.createElement('canvas'); cv.width = 24; cv.height = 22; cv.getContext('2d').drawImage(mugshot(p.look, p.look.headwear || (p.look.cap ? 'cap' : null)), 0, 0);
    const label = document.createElement('span'); label.textContent = p.role === 'player' || p.role === 'catcher' ? p.title : p.name;
    b.append(cv, label, document.createElement('i'));
    b.addEventListener('click', () => select(p.id, { focus: !renderer.atFit }));
    box.append(b);
  }
  renderCastStatus();
}
function renderCastStatus() {
  for (const b of $('cast').children) {
    const p = club.person(b.dataset.id), v = director?.personView(p.id);
    b.setAttribute('aria-pressed', String(p.id === selected));
    b.querySelector('i').style.setProperty('--c', STATUS_COLOR[club.status(p)]);
    b.classList.toggle('waiting', v?.state === 'queued'); b.classList.toggle('thinking', v?.state === 'thinking'); b.classList.toggle('away', !!p.away); b.classList.toggle('asleep', !!p.sleeping);
    b.title = `${p.label}：${p.away ? '勤務時間外' : p.sleeping ? '睡眠中' : STATUS[club.status(p)]}${v?.managed && (v.state === 'queued' || v.state === 'thinking') ? '・' + v.text : ''}`;
  }
}

// ── きょうの流れ・出来事
function renderStory() {
  const steps = club.story.steps, done = club.story.done, now = steps.find(s => !done.has(s.id));
  const html = steps.map(s => `<li class="${done.has(s.id) ? 'done' : s === now ? 'now' : ''}"><button type="button" data-who="${s.who}">${esc(s.label)}</button></li>`).join('');
  if ($('story').dataset.html !== html) { $('story').innerHTML = html; $('story').dataset.html = html; $('story').style.setProperty('--n', steps.length); }
}
const logItem = e => `<li class="k-${e.kind}${e.minor ? ' minor' : ''}"><button type="button" data-id="${e.id}"><time>${e.time}</time><span>${esc(e.text)}</span></button></li>`;
function renderLog(freshId) {
  const box = $('log'), list = club.events.filter(e => showAll || !e.minor);
  if (freshId == null) box.innerHTML = list.slice().reverse().map(logItem).join('');
  else {
    const e = club.events.find(x => x.id === freshId); if (!e) return;
    box.insertAdjacentHTML('afterbegin', logItem(e)); box.firstElementChild.classList.add('fresh');
    while (box.children.length > list.length) box.lastElementChild.remove();
  }
  renderStory();
}
$('log').addEventListener('click', ev => {
  const b = ev.target.closest('button'); if (!b) return;
  const e = club.events.find(x => x.id === Number(b.dataset.id)); if (!e) return;
  if (e.who?.length) select(e.who[0]);
  const at = e.spot && SPOTS[e.spot] ? spotAnchor(SPOTS[e.spot]) : e.who?.length ? club.person(e.who[0]) : null;
  if (at) { renderer.cam.follow = null; renderer.focus(at.x, at.y - 12, true); }
});
$('log-all').addEventListener('click', () => { showAll = !showAll; $('log-all').setAttribute('aria-pressed', String(showAll)); renderLog(); });
$('story').addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) select(b.dataset.who, { focus: true }); });

// ── 操作
function setPaused(v) {
  paused = v; $('play').innerHTML = paused ? ICON.play : ICON.pause; $('play').setAttribute('aria-label', paused ? '再生' : '一時停止'); $('paused').hidden = !paused;
  if (paused) save();
}
$('play').addEventListener('click', () => setPaused(!paused));
document.querySelectorAll('[data-speed]').forEach(b => b.addEventListener('click', () => {
  speed = Number(b.dataset.speed); document.querySelectorAll('[data-speed]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
}));
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
  if (DEMO) return;
  mode = b.dataset.mode; if (director) director.mode = mode;
  try { localStorage.setItem(SAVE_KEY + '-mode', mode); } catch { /* 保存できなくても切り替えは有効 */ }
  renderBadge();
}));
$('zoom-in').addEventListener('click', () => renderer.zoomBy(1));
$('zoom-out').addEventListener('click', () => renderer.zoomBy(-1));
$('zoom-fit').addEventListener('click', () => { renderer.fit(); renderPerson(); });
$('names').addEventListener('click', () => { renderer.showNames = !renderer.showNames; $('names').setAttribute('aria-pressed', String(renderer.showNames)); });
$('restart').addEventListener('click', () => {
  if (!DEMO && !confirm('このブラウザに保存した進行（日数・能力・記憶・記録・レポート）を消して、1日目の 06:00 から始めます。Driveに保存したファイルは消えません。よろしいですか？')) return;
  if (!DEMO) try { localStorage.removeItem(SAVE_KEY); } catch { /* 無視 */ }
  stopFastForward(); stepper.acc = 0; boot({ fresh: true }); save();
});
$('ff').addEventListener('click', () => { if (ff) stopFastForward('早送りを止めました'); else startFastForward(); });
$('open-room').addEventListener('click', () => room.toggle());
$('p-room').addEventListener('click', () => room.show(true));
$('follow').addEventListener('click', () => {
  if (renderer.cam.follow === selected) renderer.cam.follow = null;
  else { const p = club.person(selected); renderer.focus(p.x, p.y - 12, true); renderer.cam.follow = selected; }
  renderPerson();
});

// キャンバス：クリックで選択、ドラッグで移動、ホイールで拡大
const cv = $('world');
let down = null;
cv.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, moved: false }; cv.setPointerCapture(e.pointerId); });
cv.addEventListener('pointermove', e => {
  const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  if (down) {
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (!down.moved && Math.hypot(dx, dy) > 4 && !renderer.atFit) down.moved = true;
    if (down.moved) { renderer.pan(dx, dy); down.x = e.clientX; down.y = e.clientY; cv.className = 'grabbing'; }
    return;
  }
  const id = renderer.pick(x, y); renderer.hovered = id;
  cv.className = id ? 'pick' : renderer.atFit ? '' : 'grab';
});
cv.addEventListener('pointerup', e => {
  const r = cv.getBoundingClientRect();
  if (down && !down.moved) { const id = renderer.pick(e.clientX - r.left, e.clientY - r.top); if (id) select(id); }
  down = null; cv.className = renderer.atFit ? '' : 'grab';
});
cv.addEventListener('pointerleave', () => { renderer.hovered = null; });
cv.addEventListener('dblclick', e => {
  const r = cv.getBoundingClientRect(), id = renderer.pick(e.clientX - r.left, e.clientY - r.top);
  if (id) { select(id); const p = club.person(id); renderer.focus(p.x, p.y - 12, true); renderer.cam.follow = id; renderPerson(); }
});
cv.addEventListener('wheel', e => { e.preventDefault(); const r = cv.getBoundingClientRect(); renderer.zoomBy(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
window.addEventListener('keydown', e => {
  if (e.target.closest('input,textarea,select,button,a') || room?.open || matchesRoom?.open) return;
  const ids = [...club.people.keys()], i = ids.indexOf(selected);
  if (e.key === ' ') { e.preventDefault(); setPaused(!paused); }
  else if (e.key === '+' || e.key === '=') renderer.zoomBy(1);
  else if (e.key === '-') renderer.zoomBy(-1);
  else if (e.key === '0') renderer.fit();
  else if (e.key === 'f' || e.key === 'F') $('follow').click();
  else if (e.key === 'n' || e.key === 'N') $('names').click();
  else if (e.key === 'Escape') { renderer.cam.follow = null; renderPerson(); }
  else if (e.key === ']' || e.key === 'ArrowRight' && e.altKey) select(ids[(i + 1) % ids.length], { focus: !renderer.atFit });
  else if (e.key === '[' || e.key === 'ArrowLeft' && e.altKey) select(ids[(i - 1 + ids.length) % ids.length], { focus: !renderer.atFit });
});
window.addEventListener('pagehide', save);
new ResizeObserver(() => renderer?.resize()).observe(cv);

// LLM の接続状態は定期的に確かめる（推論中でも描画・操作は止まらない）
async function checkLLM() { if (!DEMO) { await llm.status(); renderBadge(); } }
setInterval(checkLLM, 20000);

setPaused(params.get('paused') === '1');
boot();
function restoreDriveSnapshot(input) {
  const data = migrateSnapshot(input);
  // 復元できることを別のClubで確かめてから、元の進行を退避して切り替える。
  AgentDirector.restore(new Club({ seed: data.seed }), structuredClone(data), { provider: null, mode: 'rules' });
  localStorage.setItem(SAVE_KEY + '-before-drive-load', JSON.stringify(director.serialize()));
  localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  if (director.inflight) director.inflight.dropped = true;
  stopFastForward(); stepper.acc = 0; boot({ snapshot: data }); save();
}
// ── Driveへの記録・レポートの送信（初期状態は手動。自動送信は画面で有効にしたときだけ）
function driveAuto() { try { return localStorage.getItem(AUTO_KEY) === 'on'; } catch { return false; } }
function renderRecords() {
  if (!director) return;
  const dbStatus=$('db-state');if(dbStatus)dbStatus.textContent=dataStore.error?`ローカル保存庫：${dataStore.error}。未保存の記録はブラウザに残しています。`:dataStore.counts?`このPCの保存庫：${dataStore.counts.games}試合・${dataStore.counts.pitches}球・${dataStore.counts.days}日分。Driveの自動送信は下の設定。`:'ローカル保存庫を確認中…';
  const st = director.records, synced = Object.keys(st.synced).length, a = archive.last;
  $('drive-auto').checked = driveAuto(); $('drive-auto').disabled = DEMO;
  $('drive-records').disabled = DEMO || !archive.available() || !st.outbox.length || archive.sending;
  $('drive-records').textContent = `記録を送る（未送信 ${st.outbox.length}件）`;
  $('drive-records-state').textContent = `Driveに保存済み ${synced}件・未送信 ${st.outbox.length}件` + (a ? (a.ok ? `。最後の送信：成功${a.duplicate ? '（すでに保存済みだったため重複は作らず）' : ''}` : `。最後の送信：失敗（${a.error}）。未送信分は残しています${driveAuto() ? '。時間をおいて自動で再送します' : '。「記録を送る」で再送できます'}`) : '') + (archive.available() ? '' : '。Driveに接続すると送信できます');
}
$('drive-auto').addEventListener('change', e => { try { localStorage.setItem(AUTO_KEY, e.target.checked ? 'on' : 'off'); } catch { /* 無視 */ } renderRecords(); if (e.target.checked && archive.available()) archive.flush(director).then(renderRecords); });
$('drive-records').addEventListener('click', async () => { $('drive-records').disabled = true; await archive.flush(director, { manual: true }); save(); renderRecords(); });
setInterval(() => { if (director && driveAuto() && archive.available() && director.records.outbox.length) archive.flush(director).then(() => { save(); renderRecords(); }); }, 20000);
mountDrive({ demo: DEMO, snapshot: () => { save(); return director.serialize(); }, restore: restoreDriveSnapshot, restoreBackup: () => {
  const previous = localStorage.getItem(SAVE_KEY + '-before-drive-load');
  if (!previous) throw Error('読み込み前のバックアップはまだありません。');
  restoreDriveSnapshot(JSON.parse(previous));
}, onConnected: v => { archive.connected = v; renderRecords(); } });
matchesRoom = mountMatches({ root: $('match-room'), getDirector: () => director, dataStore, save, isPaused: () => paused, togglePlay: () => setPaused(!paused), advanceTo: until => { if (director.needsAttention()) { ff = null; setPaused(false); $('ff-note').textContent = 'LLMの判断を処理しながら通常の速度で進めています。判断が終わったら早送りできます。'; return; } ff = { until, warnFrom: club.seq }; setPaused(false); $('ff').setAttribute('aria-pressed','true'); } });
$('open-matches').addEventListener('click', () => matchesRoom.show(true));
room = mountAnalysis({ root: $('analysis-room'), getDirector: () => director, getClub: () => club });
if(director)dataStore.check(director.records.lineage).then(()=>dataStore.flush(director)).then(()=>{saveLocal();renderRecords();});
checkLLM();
(document.fonts?.load ? Promise.race([document.fonts.load("500 12px 'Noto Sans JP'"), new Promise(r => setTimeout(r, 1200))]) : Promise.resolve()).finally(() => { last = performance.now(); requestAnimationFrame(loop); });
// 開発・検証用（判断の記録を書き出して再生に使える）
window.ballclub = { get club() { return club; }, get director() { return director; }, get renderer() { return renderer; }, llm, archive, snapshot: () => club.snapshot(), decisions: () => director?.decisions, save, room: () => room };
