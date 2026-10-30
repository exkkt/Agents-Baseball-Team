// 人物ごとの性格・目標・記憶・生活のリズムと、判断要求（プロンプト・出力形式）・応答の検証・ルールによる代替判断。DOM に依存しない
import { MENUS, INTENSITY, ABILITIES, SELF_MENUS, condLabel, fatigueLabel, clamp } from './growth.js';

// 判断の対象になる人物（架空）。ability は 20〜99、growth は成長特性（1 が標準）。bed は普段の就寝時刻、sleepNeed は眠りたい長さ（分）
export const PLAYERS = {
  aoki: { pos: '外野手', main: 'batting', menus: ['batting', 'swing', 'fielding', 'running', 'stretch', 'rest', 'care'], young: true, ability: { bat: 52, field: 50, pitch: 30, run: 58 }, growth: { bat: 1.25, pitch: 0.6 }, fatigue: 18, persona: '負けず嫌いで練習熱心。2年目で、まだ控え。', goals: '打撃を伸ばして先発の座をつかみたい。', drive: 0.85, compliance: 0.45, bed: '23:00', sleepNeed: 440, free: ['locker-1', 'cafe-1-1'] },
  yamada: { pos: '遊撃手', main: 'fielding', menus: ['fielding', 'batting', 'swing', 'running', 'stretch', 'rest', 'care'], ability: { bat: 61, field: 72, pitch: 35, run: 60 }, growth: { field: 0.95, bat: 0.9 }, recovery: 0.95, stamina: 1.1, fatigue: 22, persona: '主将。計画的で、チーム全体を見て動く。', goals: '守備のリズムを保ち、シーズンを通して休まず出たい。', drive: 0.6, compliance: 0.7, bed: '22:30', sleepNeed: 450, free: ['cafe-0-0', 'dorm'] },
  mori: { pos: '二塁手', main: 'fielding', menus: ['fielding', 'batting', 'swing', 'running', 'stretch', 'rest', 'care'], young: true, ability: { bat: 54, field: 63, pitch: 32, run: 66 }, growth: { field: 1.15 }, fatigue: 15, persona: '素直で、コーチの助言をよく聞く。', goals: '併殺の送球を速くして、守備で信頼されたい。', drive: 0.55, compliance: 0.85, bed: '22:30', sleepNeed: 460, free: ['cafe-0-1', 'dorm'] },
  kobayashi: { pos: '一塁手', main: 'batting', menus: ['batting', 'swing', 'fielding', 'running', 'stretch', 'rest', 'care'], ability: { bat: 66, field: 55, pitch: 30, run: 42 }, growth: { bat: 0.9, run: 0.8 }, recovery: 1.05, fatigue: 25, persona: 'マイペースで、休養を大事にする。', goals: '長打力を落とさず、けがなく一年を過ごしたい。', drive: 0.35, compliance: 0.6, bed: '22:00', sleepNeed: 480, free: ['dorm', 'cafe-0-2'] },
  kubo: { pos: '外野手', main: 'running', menus: ['running', 'batting', 'swing', 'fielding', 'stretch', 'rest', 'care'], young: true, ability: { bat: 55, field: 58, pitch: 33, run: 74 }, growth: { run: 1.2 }, fatigue: 20, persona: '明るく、走塁で勝負するタイプ。', goals: '一歩目の速さを上げて、代走でも先発でも使われたい。', drive: 0.7, compliance: 0.65, bed: '23:00', sleepNeed: 440, free: ['cafe-0-3', 'locker-2'] },
  sato: { pos: '外野手', main: 'batting', menus: ['batting', 'swing', 'fielding', 'running', 'stretch', 'rest', 'care'], ability: { bat: 70, field: 60, pitch: 31, run: 62 }, growth: { bat: 0.8, run: 0.85 }, recovery: 0.85, fatigue: 58, persona: '主力の外野手。責任感が強く、つい無理をしがち。右太ももに張りがある。', goals: '主力として試合に出続けたい。', drive: 0.75, compliance: 0.4, bed: '22:30', sleepNeed: 450, free: ['cafe-1-3', 'dorm'] },
  endo: { pos: '投手', main: 'pitching', menus: ['pitching', 'running', 'stretch', 'rest', 'care'], ability: { bat: 25, field: 45, pitch: 64, run: 50 }, growth: { pitch: 1.1, bat: 0.5 }, stamina: 0.95, fatigue: 20, persona: '慎重で、肩の状態をいつも気にしている。', goals: '変化球の精度を上げ、次の登板で長いイニングを投げたい。', drive: 0.5, compliance: 0.75, bed: '22:00', sleepNeed: 470, free: ['dorm', 'cafe-1-2'] },
  kawaguchi: { pos: '捕手', main: 'catching', menus: ['catching', 'batting', 'swing', 'running', 'stretch', 'rest', 'care'], ability: { bat: 50, field: 62, pitch: 35, run: 40 }, growth: { field: 1.05 }, fatigue: 24, persona: '面倒見がよく、投手の調子をよく見ている。', goals: '投手陣を支え、打撃でも結果を出したい。', drive: 0.55, compliance: 0.7, bed: '22:30', sleepNeed: 450, free: ['cafe-1-0', 'dorm'] }
};
// 練習試合に必要な三塁手・控え野手・救援投手。既存選手と同じ生活・育成の仕組みで動く。
for (const [id, base, patch] of [
  ['tanaka', 'yamada', { pos: '三塁手', ability: { bat: 58, field: 64, pitch: 30, run: 55 }, persona: '堅実な三塁手。打球への反応を磨く。', goals: '守備から試合を支えたい。' }],
  ['ishikawa', 'mori', { pos: '内外野手', ability: { bat: 51, field: 58, pitch: 30, run: 65 }, persona: '複数の守備位置をこなす若手。', goals: '控えから先発を目指す。' }],
  ['hayashi', 'endo', { ability: { bat: 24, field: 40, pitch: 60, run: 45 }, persona: '救援投手。短いイニングに集中する。', goals: '救援でチームを支える。' }],
  ['takeda', 'endo', { ability: { bat: 28, field: 42, pitch: 62, run: 48 }, persona: '先発投手。ペース配分を大切にする。', goals: '安定した投球を続けたい。' }]
]) PLAYERS[id] = { ...PLAYERS[base], fatigue: 20, ...patch };
const ELIGIBLE = { aoki: ['LF','CF','RF'], yamada: ['SS','2B'], mori: ['2B','SS'], kobayashi: ['1B'], kubo: ['LF','CF','RF'], sato: ['LF','CF','RF'], endo: ['P'], kawaguchi: ['C'], tanaka: ['3B','1B'], ishikawa: ['C','1B','2B','3B','SS','LF','CF','RF'], hayashi: ['P'], takeda: ['P'] };
for (const [id, positions] of Object.entries(ELIGIBLE)) PLAYERS[id].positions = positions;
export const COACHES = {
  hcoach: { players: ['aoki', 'sato', 'kubo'], station: 'cage-coach', act: 'clip', persona: '打撃コーチ。選手の小さな変化に気づくが、無理はさせない主義。', goals: '担当の打者を伸ばしつつ、疲労で効率が落ちないよう管理する。' },
  fcoach: { players: ['yamada', 'mori', 'kobayashi', 'tanaka', 'ishikawa'], station: 'knock', act: 'knock', persona: '内野守備コーチ。数をこなすことを重視する昔気質。', goals: '内野の守備を安定させる。' },
  pcoach: { players: ['endo', 'kawaguchi', 'hayashi', 'takeda'], station: 'pen-coach', act: 'penwatch', persona: '投手コーチ。球数と張りを細かく記録する慎重派。', goals: '投手の肩を守りながら球質を上げる。' }
};
export const LEADERS = {
  manager: { persona: '監督。現場の声と記録の両方を見て決める。', goals: 'チーム全体の状態を整え、伸びている選手に機会を与える。' },
  gm: { persona: 'GM。長期的な育成と、主力の疲労管理を重視する。', goals: '若手の成長と、けがの予防を両立させる球団方針を示す。' },
  analyst: { persona: 'データアナリスト。記録にもとづいて淡々と事実を整理し、言えることと言えないことを分ける。', goals: '練習・睡眠・疲労の記録から、現場の判断に役立つ根拠を届ける。' }
};
export const AGENT_IDS = [...Object.keys(PLAYERS), ...Object.keys(COACHES), 'manager', 'gm', 'analyst'];
export const coachOf = id => Object.keys(COACHES).find(c => COACHES[c].players.includes(id));
export const FOCUS = { batting: '打撃重点', fielding: '守備重点', pitching: '投球重点', running: '走塁重点', recovery: '回復優先', balanced: 'バランスよく' };
export const POLICY = {
  balanced: { label: 'バランス', cap: 240 },
  develop_young: { label: '若手育成を優先', cap: 240, youngCap: 260 },
  manage_fatigue: { label: '疲労管理を優先', cap: 200 },
  win_now: { label: '主力の状態を優先', cap: 220 }
};
// 一つの相談の区切り（日次の回数制限ではない）。同じ報告・提案を保留できる回数、提案→返答→報告の連鎖の深さ
export const THREAD = { maxHolds: 2, maxDepth: 2, revisitAfter: 60 };
export const roleOf = id => PLAYERS[id] ? 'player' : COACHES[id] ? 'coach' : id;
export const clockOf = mod => `${String(Math.floor(((mod % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(((mod % 60) + 60) % 60).padStart(2, '0')}`;

// ── 一日の時間割（その日の 0:00 からの分）。活動日は 04:00 で切り替わる（日次の集計・統計のリセットはここで一度だけ）
export const LIFE = { boundary: 240, wakeEarliest: 360, wakeLatest: 435, breakfast: 420, amStart: 540, lunch: 720, pmStart: 780, dinner: 1050, eveningFrom: 1095, washMinutes: 15, napFatigue: 55 };
export const BEDTIMES = { '21:30': 1290, '22:00': 1320, '22:30': 1350, '23:00': 1380, '23:30': 1410 };
// スタッフの勤務（出勤・退勤）。勤務外は家に帰っている（施設にいない）。夜 23:30〜06:30 は眠っているので判断を要求しない
export const STAFF = {
  cook: { arrive: 360, leave: 1170, label: '調理' },
  manager: { arrive: 465, leave: 1200, label: '監督' },
  trainer: { arrive: 480, leave: 1230, label: 'ケア' },
  hcoach: { arrive: 485, leave: 1170, label: '指導' }, fcoach: { arrive: 475, leave: 1165, label: '指導' }, pcoach: { arrive: 490, leave: 1175, label: '指導' },
  gm: { arrive: 510, leave: 1170, label: '編成' }, director: { arrive: 540, leave: 1110, label: '編成' },
  analyst: { arrive: 510, leave: 1140, overtimeUntil: 1410, label: '分析' }
};
export const STAFF_SLEEP = { from: 1410, to: 390 };
export const staffAsleep = mod => mod >= STAFF_SLEEP.from || mod < STAFF_SLEEP.to;
// スタッフの「今日の方針」（役職ごとに粒度を変える。選手の練習予定の形式は使わない）
export const STAFF_FOCUS = {
  coach: { watch_fatigue: '疲労の兆しを見逃さない', technique: '技術の細部を見る', develop_young: '若手に手をかける', steady: '予定どおり淡々と' },
  manager: { team_condition: 'チーム全体の状態を整える', young_chance: '伸びている選手を見極める', fatigue_control: '主力の疲労を抑える', check_records: '記録と現場の声を突き合わせる' },
  gm: { long_term: '長期の育成を見る', injury_prevention: 'けがの予防を優先', win_now: '主力の状態を優先', review_policy: '球団方針を点検する' }
};

export function makeAgent(id) {
  const P = PLAYERS[id] || COACHES[id] || LEADERS[id];
  return { id, persona: P.persona, goals: P.goals, knows: [], recent: [], plan: { focus: null, morning: [], afternoon: [], evening: [], bedtime: null }, block: null, rev: 0, reason: null, decision: { state: 'idle' }, focus: null, policy: null, inbox: [], changes: [], calls: { today: 0, total: 0, byKind: {} }, limits: {}, staffPlan: null, life: null };
}
const push = (arr, item, max) => { arr.push(item); while (arr.length > max) arr.shift(); };
export const remember = (agent, text, time) => push(agent.knows, { time, text }, 8); // 自分が知っている情報（報告・方針・提案）
export const note = (agent, text, time) => push(agent.recent, { time, text }, 8); // 自分の直近の出来事
export const changed = (agent, entry) => push(agent.changes, entry, 6); // 予定の変更とその理由

// ── 出力形式（Ollama の format に渡す JSON Schema）
const blockSchema = (menus, max = 90) => ({ type: 'object', properties: { menu: { type: 'string', enum: menus }, minutes: { type: 'integer', minimum: 10, maximum: max }, intensity: { type: 'string', enum: Object.keys(INTENSITY) } }, required: ['menu', 'minutes', 'intensity'] });
const reasonSchema = { type: 'string', maxLength: 60 };
export const eveningMenus = menus => [...menus.filter(m => SELF_MENUS.includes(m)), 'care', 'rest', 'free'];
export function schemaFor(kind, ctx) {
  switch (kind) {
    case 'day_plan': return { type: 'object', properties: { focus: { type: 'string', enum: Object.keys(FOCUS) }, morning: { type: 'array', maxItems: 5, items: blockSchema(ctx.menus) }, afternoon: { type: 'array', maxItems: 6, items: blockSchema(ctx.menus) }, evening: { type: 'array', maxItems: 3, items: blockSchema(ctx.eveningMenus, 60) }, bedtime: { type: 'string', enum: Object.keys(BEDTIMES) }, reason: reasonSchema }, required: ['focus', 'morning', 'afternoon', 'evening', 'bedtime', 'reason'] };
    case 'next': case 'fatigue': return { type: 'object', properties: { blocks: { type: 'array', maxItems: 4, items: blockSchema(ctx.menus) }, reason: reasonSchema }, required: ['blocks', 'reason'] };
    case 'consider': return { type: 'object', properties: { decisions: { type: 'array', maxItems: 6, items: { type: 'object', properties: { id: { type: 'string', enum: ctx.items.map(i => i.id) }, choice: { type: 'string', enum: ['adopt', 'decline', 'hold'] }, reason: { type: 'string', maxLength: 40 } }, required: ['id', 'choice', 'reason'] } }, reason: reasonSchema }, required: ['decisions', 'reason'] };
    case 'review': return { type: 'object', properties: { proposals: { type: 'array', maxItems: 2, items: { type: 'object', properties: { player: { type: 'string', enum: ctx.players }, menu: { type: 'string', enum: ctx.allMenus }, minutes: { type: 'integer', minimum: 10, maximum: 60 }, intensity: { type: 'string', enum: Object.keys(INTENSITY) }, message: { type: 'string', maxLength: 40 } }, required: ['player', 'menu', 'minutes', 'intensity', 'message'] } }, note: { type: 'string', maxLength: 60 }, reason: reasonSchema }, required: ['proposals', 'note', 'reason'] };
    case 'day_review': return { type: 'object', properties: { tomorrow: { type: 'array', maxItems: 12, items: { type: 'object', properties: { player: { type: 'string', enum: ctx.players }, focus: { type: 'string', enum: Object.keys(FOCUS) } }, required: ['player', 'focus'] } }, report: { type: 'string', maxLength: 60 }, ask_analyst: { type: 'string', enum: ['none', ...ctx.players] }, reason: reasonSchema }, required: ['tomorrow', 'report', 'ask_analyst', 'reason'] };
    case 'policy': return { type: 'object', properties: { policy: { type: 'string', enum: Object.keys(POLICY) }, message: { type: 'string', maxLength: 50 }, reason: reasonSchema }, required: ['policy', 'message', 'reason'] };
    case 'staff_plan': return { type: 'object', properties: { focus: { type: 'string', enum: Object.keys(STAFF_FOCUS[ctx.role]) }, watch: { type: 'string', enum: ['none', ...(ctx.players || [])] }, note: { type: 'string', maxLength: 40 }, reason: reasonSchema }, required: ['focus', 'watch', 'note', 'reason'] };
  }
  throw Error('unknown kind ' + kind);
}

// ── 応答の検証。許可された ID・範囲内の値だけを受け入れ、調整した点は issues に残す
export const cleanText = (s, n) => typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n) : '';
export function parseJSON(text) {
  if (typeof text !== 'string') return null;
  try { return JSON.parse(text); } catch { /* 前後に余計な文字があれば中の {} を試す */ }
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; } }
  return null;
}
function blocksOf(list, menus, issues, label, max = 90) {
  if (!Array.isArray(list)) { if (list != null) issues.push(`${label}が配列ではない`); return []; }
  const out = [];
  for (const b of list.slice(0, 6)) {
    if (!b || typeof b !== 'object') { issues.push(`${label}に不正な要素`); continue; }
    if (!menus.includes(b.menu)) { issues.push(`許可されていないメニュー「${cleanText(String(b.menu), 20)}」を除外`); continue; }
    let m = Number(b.minutes);
    if (!Number.isFinite(m)) { issues.push(`${MENUS[b.menu].label}の時間が数値でないため除外`); continue; }
    const r = clamp(Math.round(m / 5) * 5, 10, max); if (m < 10 || m > max) issues.push(`${MENUS[b.menu].label}の時間 ${cleanText(String(b.minutes), 8)}分→${r}分`);
    let it = b.intensity; if (!INTENSITY[it]) { issues.push(`強度「${cleanText(String(it), 10)}」→通常`); it = 'normal'; }
    out.push({ menu: b.menu, minutes: r, intensity: it });
  }
  return out;
}
export function validate(kind, text, ctx) {
  const issues = [], j = typeof text === 'object' && text ? text : parseJSON(text);
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { ok: false, issues: ['JSONとして読めない応答'] };
  const reason = cleanText(j.reason, 60);
  if (!reason) issues.push('理由が空');
  switch (kind) {
    case 'day_plan': {
      const morning = blocksOf(j.morning, ctx.menus, issues, '午前'), afternoon = blocksOf(j.afternoon, ctx.menus, issues, '午後'), evening = blocksOf(j.evening, ctx.eveningMenus, issues, '夜', 60);
      if (!morning.length && !afternoon.length) return { ok: false, issues: [...issues, '有効な予定がない'] };
      let focus = j.focus; if (!FOCUS[focus]) { if (focus != null) issues.push(`方針「${cleanText(String(focus), 12)}」→バランスよく`); focus = 'balanced'; }
      let bedtime = j.bedtime; if (!BEDTIMES[bedtime]) { issues.push(`就寝時刻「${cleanText(String(bedtime), 8)}」→普段の時刻`); bedtime = ctx.usualBed; }
      return { ok: true, decision: { focus, morning, afternoon, evening, bedtime, reason }, issues };
    }
    case 'next': case 'fatigue': {
      const blocks = blocksOf(j.blocks, ctx.menus, issues, '予定');
      if (!blocks.length) return { ok: false, issues: [...issues, '有効な予定がない'] };
      return { ok: true, decision: { blocks, reason }, issues };
    }
    case 'consider': {
      const ids = new Set(ctx.items.map(i => i.id)), seen = new Set(), decisions = [];
      for (const d of Array.isArray(j.decisions) ? j.decisions.slice(0, 6) : []) {
        if (!d || !ids.has(d.id) || seen.has(d.id)) { issues.push(`対象外・重複の項目「${cleanText(String(d?.id), 12)}」を除外`); continue; }
        if (!['adopt', 'decline', 'hold'].includes(d.choice)) { issues.push(`選択「${cleanText(String(d.choice), 10)}」→保留`); d.choice = 'hold'; }
        seen.add(d.id); decisions.push({ id: d.id, choice: d.choice, reason: cleanText(d.reason, 40) });
      }
      // 答えのなかった項目は「保留」として次の区切りに回す（勝手に採用しない）
      for (const it of ctx.items) if (!seen.has(it.id)) { issues.push(`「${it.id}」に答えがないため保留`); decisions.push({ id: it.id, choice: 'hold', reason: '判断が示されなかった' }); }
      return { ok: true, decision: { decisions, reason }, issues };
    }
    case 'review': {
      const proposals = [];
      for (const p of Array.isArray(j.proposals) ? j.proposals.slice(0, 2) : []) {
        if (!p || !ctx.players.includes(p.player)) { issues.push(`担当外の選手「${cleanText(String(p?.player), 20)}」への提案を除外`); continue; }
        const [b] = blocksOf([p], ctx.menusOf[p.player], issues, '提案');
        if (!b) continue;
        b.minutes = Math.min(b.minutes, 60);
        proposals.push({ player: p.player, ...b, message: cleanText(p.message, 40) || `${MENUS[b.menu].label}をやろう` });
      }
      if (!Array.isArray(j.proposals)) issues.push('proposals が配列ではない');
      return { ok: true, decision: { proposals, note: cleanText(j.note, 60), reason }, issues };
    }
    case 'day_review': {
      const tomorrow = [], seen = new Set();
      for (const t of Array.isArray(j.tomorrow) ? j.tomorrow.slice(0, 8) : []) {
        if (!t || !ctx.players.includes(t.player) || seen.has(t.player)) { issues.push('対象外・重複の選手を除外'); continue; }
        if (!FOCUS[t.focus]) { issues.push(`方針「${cleanText(String(t.focus), 12)}」を除外`); continue; }
        seen.add(t.player); tomorrow.push({ player: t.player, focus: t.focus });
      }
      const ask = ctx.players.includes(j.ask_analyst) ? j.ask_analyst : null;
      if (j.ask_analyst && j.ask_analyst !== 'none' && !ask) issues.push('分析依頼の対象が選手一覧にないため依頼しない');
      return { ok: true, decision: { tomorrow, report: cleanText(j.report, 60), ask, reason }, issues };
    }
    case 'policy':
      if (!POLICY[j.policy]) return { ok: false, issues: [...issues, `方針「${cleanText(String(j.policy), 16)}」は選択肢にない`] };
      return { ok: true, decision: { policy: j.policy, message: cleanText(j.message, 50), reason }, issues };
    case 'staff_plan': {
      const opts = STAFF_FOCUS[ctx.role];
      if (!opts[j.focus]) return { ok: false, issues: [...issues, `方針「${cleanText(String(j.focus), 16)}」は選択肢にない`] };
      const watch = (ctx.players || []).includes(j.watch) ? j.watch : null;
      if (j.watch && j.watch !== 'none' && !watch) issues.push('注目する選手が担当外のため外した');
      return { ok: true, decision: { focus: j.focus, watch, note: cleanText(j.note, 40), reason }, issues };
    }
  }
  return { ok: false, issues: ['不明な判断の種類'] };
}

// ── プロンプト。その人物の状態・記憶・選択肢だけを渡す（他人の記憶や全員の履歴は渡さない）
const TRIGGER = { day_plan: '起床した。今日の方針と一日の予定（練習・夜の過ごし方・就寝時刻）を決める', next: '予定が終わり、次の行動が決まっていない', fatigue: '疲労が基準（70）を超えた。予定を見直す', consider: '届いている報告・提案のうち、判断が必要なものを区切りでまとめて検討する', review: '担当選手の練習結果を振り返る', day_review: '一日の練習が終わった。全体を振り返り、明日の方針を決める', policy: '監督から一日の報告と相談を受けた', staff_plan: '出勤した。今日の仕事の方針を決める' };
const lines = (arr, empty = '（なし）') => arr.length ? arr.map(x => `- ${x.time ? x.time + ' ' : ''}${x.text}`).join('\n') : empty;
const abilityLine = tr => Object.entries(ABILITIES).map(([k, v]) => `${v} ${tr.ability[k].toFixed(1)}`).join('、');
const blockText = b => b ? `${MENUS[b.menu].label}（${INTENSITY[b.intensity]?.label || ''}・${b.minutes}分）` : 'なし';
export function playerSummary(id, tr, ag, view) {
  const rep = tr.last && tr.last.kind === 'practice' ? `直近の練習 ${tr.last.label}${tr.last.minutes}分：経験 +${tr.last.gained.toFixed(1)}（見込み ${tr.last.expected.toFixed(1)}）` : '直近の練習 なし';
  const state = ag.life?.state === 'asleep' ? '睡眠中' : ag.block ? blockText(ag.block) : '待機';
  return `${view.label}(${id})：疲労 ${tr.fatigue.toFixed(0)}（${fatigueLabel(tr.fatigue)}）・調子 ${condLabel(tr.condition)}・今日の練習 ${tr.today.minutes}分・いま ${state}・${rep}`;
}
export function itemLine(it) {
  return `- id=${it.id}（${it.fromLabel || it.from}から・${it.kindLabel}${it.urgent ? '・急ぎ' : ''}）：${it.text}${it.change ? ` → 採用すると「${it.changeText}」` : ''}${it.holds ? `（これまで${it.holds}回保留）` : ''}`;
}
export function buildPrompt(kind, req) {
  const { view, tr, ag, ctx } = req;
  const sys = [
    `あなたは架空の野球球団の育成シミュレーションに登場する「${view.label}」（${view.roleLabel}）として判断します。`,
    `性格：${ag.persona}`, `目標・方針：${ag.goals}`,
    'ルール：疲労・経験・能力などの数値はゲームが計算済みです。数値を作ったり、増減量を決めたりしないでください。選べるのは提示された選択肢（ID）だけです。提示された事実にない原因を断定しないでください。出力は指定された JSON だけにし、reason にはあなたの判断理由を一人称・日本語40字以内で書きます。'
  ].join('\n');
  const u = [`いま：${ctx.day}日目 ${ctx.clock}。判断のきっかけ：${TRIGGER[kind]}`];
  if (tr) {
    u.push(`あなたの状態：疲労 ${tr.fatigue.toFixed(0)}/100（${fatigueLabel(tr.fatigue)}）、調子 ${condLabel(tr.condition)}、昨夜の睡眠の質 ${tr.sleep.quality.toFixed(2)}（0〜1）${ctx.lastSleep ? `・${ctx.lastSleep}` : ''}`);
    u.push(`能力：${abilityLine(tr)}（20〜99）`);
    u.push(`今日の練習：計 ${tr.today.minutes}分（球団の上限 ${ctx.cap}分。残り ${Math.max(0, ctx.cap - tr.today.minutes)}分）。いまの行動：${ag.block ? blockText(ag.block) : '待機'}${ag.plan?.focus ? `。今日の方針：${FOCUS[ag.plan.focus]}` : ''}`);
    if (tr.last?.kind === 'practice') u.push(`直近の練習結果：${tr.last.label} ${tr.last.minutes}分で経験 +${tr.last.gained.toFixed(1)}（条件から見た見込み ${tr.last.expected.toFixed(1)}）`);
    if (ctx.limits) u.push(`守ること：${ctx.limits}`);
  }
  if (ctx.match) u.push(`今日は練習試合。開始 ${clockOf(ctx.match.start % 1440)}、30分前から準備。試合の間は通常練習を中断する。午前から強い負荷をかけすぎない。`);
  if (ctx.team) u.push('担当・チームの選手の状態（ゲームの計算結果）：\n' + ctx.team.map(s => '- ' + s).join('\n'));
  u.push('知っていること：\n' + lines(ag.knows));
  u.push('直近の出来事：\n' + lines(ag.recent.slice(-5)));
  if (ctx.menus && kind !== 'consider') u.push('選べる練習メニュー（menu）：\n' + ctx.menus.map(m => `- ${m}：${MENUS[m].label}（${MENUS[m].note}）`).join('\n') + '\n強度（intensity）：light=軽め、normal=通常、hard=強め（伸びやすいが疲れやすい。疲労60以上では球団の制約で通常に下がる）');
  switch (kind) {
    case 'day_plan': u.push(`今日の方針（focus）：${Object.entries(FOCUS).map(([k, v]) => `${k}=${v}`).join('、')}${ag.focus ? `。監督からの方針は「${FOCUS[ag.focus]}」` : ''}`,
      `午前（09:00〜12:00）は残り ${ctx.avail.morning}分、午後（13:00〜17:30）は ${ctx.avail.afternoon}分。12:00〜13:00は昼食、17:30から夕食。各メニューは10〜90分。練習の合計は上限を超えないように。休む時間も rest・care・stretch として予定に入れ、配列を空にしない。`,
      `夜（夕食後〜就寝）：evening に自主練・ケア・休養を0〜3件（各10〜60分）。選べる menu：${ctx.eveningMenus.map(m => `${m}=${MENUS[m].label}`).join('、')}。自主練は疲労がたまり、寝る直前の練習は睡眠の質を下げます。毎晩やるのが得とは限りません。`,
      `就寝時刻（bedtime）：${Object.keys(BEDTIMES).join('・')}。普段は ${ctx.usualBed}。遅く寝るほど睡眠が短くなり、起床は 06:00〜07:15 です。`,
      '出力：{"focus":"…","morning":[{"menu":"…","minutes":数値,"intensity":"…"}],"afternoon":[…],"evening":[…],"bedtime":"22:30","reason":"…"}'); break;
    case 'next': case 'fatigue': u.push(`この時間帯の残りは ${ctx.avail.now}分。各メニューは10〜90分。休むなら rest・care・stretch を入れ、配列を空にしない。`, '出力：{"blocks":[{"menu":"…","minutes":数値,"intensity":"…"}],"reason":"…"}'); break;
    case 'consider': u.push('検討する項目（報告・提案）。adopt=採用（変更を予定や方針に反映）、decline=見送り、hold=情報不足などで保留。採用しても完了済みの予定は変わらず、残りの予定だけが調整されます。\n' + ctx.items.map(itemLine).join('\n'), '出力：{"decisions":[{"id":"…","choice":"adopt|decline|hold","reason":"…"}],"reason":"…"}'); break;
    case 'review': u.push('担当選手ごとに使えるメニュー：\n' + ctx.players.map(p => `- ${p}：${ctx.menusOf[p].join(', ')}`).join('\n'), ctx.watch ? `今日特に見ている選手：${ctx.watch}` : '', ctx.skip?.length ? `今は送れない提案：${ctx.skip.join('、')}` : '', '必要なら、いまの予定に代えて行う練習を最大2件提案します（不要なら空配列）。急ぎでない提案は、選手が次の区切りで検討します。minutes は10〜60。message は選手への一言（40字以内）。note は監督への報告（60字以内）。', '出力：{"proposals":[{"player":"…","menu":"…","minutes":数値,"intensity":"…","message":"…"}],"note":"…","reason":"…"}'); break;
    case 'day_review': u.push(`明日の方針（focus）：${Object.entries(FOCUS).map(([k, v]) => `${k}=${v}`).join('、')}`, '選手ごとに明日の方針を決め、GMへの報告（report、60字以内）を書きます。記録を詳しく調べたい選手がいれば ask_analyst にその選手のIDを入れるとアナリストに分析を依頼します（不要なら "none"）。', '出力：{"tomorrow":[{"player":"…","focus":"…"}],"report":"…","ask_analyst":"none","reason":"…"}'); break;
    case 'policy': u.push(`球団方針（policy）：${Object.entries(POLICY).map(([k, v]) => `${k}=${v.label}（練習上限 ${v.cap}分${v.youngCap ? `、若手 ${v.youngCap}分` : ''}）`).join('、')}`, 'message は監督への返答（50字以内）。', '出力：{"policy":"…","message":"…","reason":"…"}'); break;
    case 'staff_plan': u.push(`今日の方針（focus）：${Object.entries(STAFF_FOCUS[ctx.role]).map(([k, v]) => `${k}=${v}`).join('、')}`, ctx.players ? `特に見る選手（watch）：${ctx.players.join(', ')}、または "none"` : 'watch は "none"', 'note は今日の一言（40字以内）。', '出力：{"focus":"…","watch":"none","note":"…","reason":"…"}'); break;
  }
  return { system: sys, user: u.filter(Boolean).join('\n\n'), schema: schemaFor(kind, ctx) };
}

// ── ルールによる判断（LLM を使わないとき・失敗したときの代替）。状態から決定的に決める
const secondaryOf = id => ({ batting: 'swing', fielding: 'swing', running: 'swing', pitching: 'running', catching: 'swing' })[PLAYERS[id].main];
function fit(blocks, avail) { const out = []; let left = avail; for (const b of blocks) { if (left < 10) break; const m = Math.min(b.minutes, left); if (m >= 10) { out.push({ ...b, minutes: Math.floor(m / 5) * 5 }); left -= m; } } return out; }
export function rulePlan(id, tr, ag, avail) {
  const P = PLAYERS[id], focus = ag.plan?.focus && ag.plan.focus !== 'balanced' ? ag.plan.focus : ag.focus;
  const main = focus && focus !== 'balanced' && focus !== 'recovery' && P.menus.includes(focus) ? focus : P.main, sec = secondaryOf(id);
  const f = tr.fatigue, strong = P.drive >= 0.7 && f < 35 ? 'hard' : 'normal';
  if (focus === 'recovery' || f >= 70) return fit([{ menu: 'care', minutes: 30, intensity: 'normal' }, { menu: 'stretch', minutes: 20, intensity: 'light' }, { menu: main, minutes: 30, intensity: 'light' }, { menu: 'rest', minutes: 30, intensity: 'normal' }], avail);
  if (f >= 50) return fit([{ menu: main, minutes: 40, intensity: 'normal' }, { menu: 'rest', minutes: 15, intensity: 'normal' }, { menu: sec, minutes: 30, intensity: 'light' }, { menu: 'stretch', minutes: 20, intensity: 'light' }, { menu: 'rest', minutes: 30, intensity: 'normal' }], avail);
  return fit([{ menu: main, minutes: 50, intensity: strong }, { menu: 'rest', minutes: 10, intensity: 'normal' }, { menu: sec, minutes: 40, intensity: 'normal' }, { menu: 'stretch', minutes: 15, intensity: 'light' }, { menu: main, minutes: 30, intensity: 'normal' }, { menu: 'rest', minutes: 20, intensity: 'normal' }], avail);
}
// 夜の過ごし方：練習熱心で疲れていなければ短い自主練、疲れていればケアと早寝
export function ruleEvening(id, tr) {
  const P = PLAYERS[id], f = tr.fatigue, self = P.menus.filter(m => SELF_MENUS.includes(m) && m !== 'stretch')[0];
  if (f >= 60) return { evening: [{ menu: 'care', minutes: 20, intensity: 'normal' }, { menu: 'stretch', minutes: 15, intensity: 'light' }], bedtime: '22:00' };
  if (P.drive >= 0.7 && f < 45 && self) return { evening: [{ menu: self, minutes: 20, intensity: 'normal' }, { menu: 'stretch', minutes: 15, intensity: 'light' }], bedtime: P.bed };
  return { evening: [{ menu: 'stretch', minutes: 15, intensity: 'light' }], bedtime: P.bed };
}
export function ruleDecision(kind, req) {
  const { who, tr, ag, ctx } = req;
  switch (kind) {
    case 'day_plan': {
      const focus = ag.focus || (tr.fatigue >= 70 ? 'recovery' : 'balanced'), tmp = { ...ag, plan: { ...ag.plan, focus } }, ev = ruleEvening(who, tr);
      return { focus, morning: rulePlan(who, tr, tmp, ctx.avail.morning), afternoon: rulePlan(who, tr, tmp, ctx.avail.afternoon), evening: ev.evening, bedtime: ev.bedtime, reason: ag.focus === 'recovery' ? '監督の方針（回復優先）に合わせ、ケアを先に軽めに動く' : tr.fatigue >= 70 ? '疲労が高いので、ケアを先にして軽めに動く' : ag.focus && ag.focus !== 'balanced' ? `監督の方針（${FOCUS[ag.focus]}）に合わせて練習する` : '自分の主な練習を中心に、休憩をはさんで進める' };
    }
    case 'next': return { blocks: rulePlan(who, tr, ag, ctx.avail.now), reason: '予定が空いたので、いつもの流れで続ける' };
    case 'fatigue': return { blocks: fit([{ menu: 'care', minutes: 20, intensity: 'normal' }, { menu: 'rest', minutes: 20, intensity: 'normal' }, { menu: PLAYERS[who].main, minutes: 30, intensity: 'light' }], ctx.avail.now), reason: '疲労が基準を超えたので、ケアと休憩を入れる' };
    case 'consider': return { decisions: ctx.items.map(it => ruleConsider(who, tr, it)), reason: '急ぎかどうかと自分の状態で決めた' };
    case 'review': {
      const proposals = [];
      for (const pid of ctx.players) {
        const s = ctx.states[pid]; if (!s || proposals.length >= 1 || ctx.skipIds?.includes(pid)) continue;
        if (s.fatigue >= 65 && s.block && MENUS[s.block.menu].kind === 'practice' && s.block.intensity !== 'light') proposals.push({ player: pid, menu: 'stretch', minutes: 20, intensity: 'light', message: '疲れが出ている。いったん体をほぐそう' });
        else if (s.lastCond != null && s.lastCond < 0.7 && s.fatigue >= 45) proposals.push({ player: pid, menu: 'rest', minutes: 15, intensity: 'normal', message: '少し休んでから続けよう' });
      }
      return { proposals, note: proposals.length ? '疲労の高い選手に調整を入れた' : '担当選手は予定どおり', reason: '疲労と直近の練習結果を基準に判断した' };
    }
    case 'day_review': return { tomorrow: ctx.players.map(pid => ({ player: pid, focus: ctx.states[pid].fatigue >= 55 ? 'recovery' : 'balanced' })), report: '疲労の高い選手は明日回復優先にする', ask: null, reason: '疲労55以上を回復優先にした' };
    case 'policy': return { policy: ctx.avgFatigue >= 50 ? 'manage_fatigue' : 'develop_young', message: ctx.avgFatigue >= 50 ? '疲労が溜まっている。上限を下げよう' : '若手に練習量を確保しよう', reason: `平均疲労 ${ctx.avgFatigue.toFixed(0)} を基準に決めた` };
    case 'staff_plan': {
      const first = Object.keys(STAFF_FOCUS[ctx.role])[0], tired = (ctx.states ? Object.entries(ctx.states) : []).sort((a, b) => b[1].fatigue - a[1].fatigue)[0];
      return { focus: first, watch: ctx.players && tired && tired[1].fatigue >= 50 ? tired[0] : null, note: 'いつもの流れで進める', reason: '前日からの状態を見て決めた' };
    }
  }
  return null;
}
// 報告・提案への返答（ルール）。急ぎ・疲労が高い・素直な性格なら採用、情報が足りなければ保留
export function ruleConsider(who, tr, it) {
  const P = PLAYERS[who];
  if (it.kind === 'proposal') { const yes = it.urgent || (tr && tr.fatigue >= 55) || (P?.compliance ?? 0.6) >= 0.5; return { id: it.id, choice: yes ? 'adopt' : 'decline', reason: yes ? 'コーチの提案どおりにする' : 'いまの練習をもう少し続けたい' }; }
  if (it.kind === 'analysis') {
    if (it.evidence === 'weak') return { id: it.id, choice: 'hold', reason: '記録が少ないので様子を見る' };
    if (P) { const yes = (P.compliance ?? 0.6) >= 0.5 || (tr && tr.fatigue >= 55); return { id: it.id, choice: yes ? 'adopt' : 'decline', reason: yes ? '分析の提案を試してみる' : '今の調整を続けたい' }; }
    return { id: it.id, choice: 'adopt', reason: '根拠が示されているので採用する' };
  }
  return { id: it.id, choice: 'hold', reason: '内容を確かめてから決める' };
}
