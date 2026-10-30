// AI判断で動く Director。LLM（または代替のルール）は「一日の方針と予定」「区切りでの見直し」を決めるだけで、
// 移動・練習・食事・睡眠・時間経過・疲労と経験の更新はこのファイルと growth.js が行う。
// 判断要求はキューで 1 件ずつ処理し、待っている間もほかの人物とゲーム時間は進み続ける。DOM に依存しない
import { ROUTINES } from './director.js';
import { MENUS, INTENSITY, makeTrainee, applyMinute, idleMinute, blockLuck, blockReport, describeReport, cageForm, ABILITIES, startSleep, sleepMinute, endSleep, wakeDuringSleep, newPracticeDay, Rng, seedFor } from './growth.js';
import { PLAYERS, COACHES, AGENT_IDS, POLICY, FOCUS, LIFE, BEDTIMES, STAFF, STAFF_FOCUS, THREAD, coachOf, roleOf, makeAgent, remember, note, changed, buildPrompt, validate, ruleDecision, playerSummary, eveningMenus, clockOf, staffAsleep } from './agents.js';
import { makeStore, addPractice, addSleep, addEvent, openDay, closeDay, trim, queueChunk, coverage } from './records.js';
import { Analyst, ANALYSIS_KINDS, analysisPrompt, analysisValidate, analysisRule } from './analyst.js';
import { ERROR_TEXT } from './llm.js';

import { Matches, MATCH_KINDS, matchPrompt, matchValidate, matchRule, safeMatchReason } from './matches.js';

export const SAVE_VERSION = 3;
// 一日の区切り（その日の 0:00 からの分）。練習の時間帯は従来どおり。活動日は 04:00 で切り替わる
export const DAY = { boundary: LIFE.boundary, breakfast: LIFE.breakfast, start: LIFE.amStart, reviewAm: 630, lunch: LIFE.lunch, afternoon: LIFE.pmStart, reviewPm: 900, end: LIFE.dinner, evening: LIFE.eveningFrom, meetingEnd: 1100 };
export const PHASES = [
  { id: 'wake', label: '起床・朝食', at: 360, who: 'yamada' }, { id: 'am', label: '午前練習', at: 540, who: 'hcoach' }, { id: 'lunch', label: '昼休み', at: 720, who: 'cook' },
  { id: 'pm', label: '午後練習', at: 780, who: 'fcoach' }, { id: 'review', label: '夕食・振り返り', at: 1050, who: 'manager' }, { id: 'evening', label: '夜の自由時間', at: 1110, who: 'aoki' }, { id: 'night', label: '就寝', at: 1320, who: 'kobayashi' }
];
const PRIORITY = { match_lineup: 60, match_pitching: 65, fatigue: 30, consider: 14, day_plan: 22, next: 20, review: 12, staff_plan: 10, day_review: 11, policy: 9, analysis_plan: 9, analysis_more: 9, analysis_write: 10 };
// 混雑時に後回しにできる判断（ルールへは切り替えない）
const DEFERRABLE = ['consider', 'review', 'staff_plan', 'analysis_plan', 'analysis_more', 'analysis_write'];
const AGING = 2, CONGESTED = 10, DEFER_MIN = 15;
export const KIND_LABEL = { match_lineup: '試合の打順・守備位置', match_pitching: '試合の投手交代', day_plan: '一日の方針と予定', next: '次の予定', fatigue: '疲労による見直し', consider: '報告・提案の検討', proposal: 'コーチの提案への返答', review: '練習結果の振り返り', day_review: '一日の振り返り', policy: '球団方針', staff_plan: '今日の仕事の方針', analysis_plan: '分析の調査計画', analysis_more: '追加の調査', analysis_write: '分析の考察' };
export const SOURCE_LABEL = { llm: 'ローカルLLM', rule: 'ルール', fallback: 'ルール代替', limit: 'ルール（旧版の回数上限）', replay: '記録の再生', constraint: '制約', schedule: '予定・ルール' };
const SUBST = { batting: ['swing', 'running', 'stretch', 'rest'], swing: ['running', 'stretch', 'rest'], fielding: ['swing', 'running', 'stretch', 'rest'], pitching: ['running', 'stretch', 'rest'], catching: ['swing', 'stretch', 'rest'], running: ['swing', 'stretch', 'rest'], stretch: ['rest'], care: ['stretch', 'rest'], rest: [], free: [] };
const HOME_FIELD = { yamada: 'short', mori: 'second', kobayashi: 'first' };
const STAFF_START = { gm: ['gm-seat', 'pc'], director: ['dir-seat', 'read'], analyst: ['ana-seat', 'pc'], manager: ['bench-1', 'observe'], hcoach: ['cage-coach', 'clip'], fcoach: ['knock', 'knock'], pcoach: ['pen-coach', 'penwatch'], trainer: ['care-seat', 'record'], cook: ['cook', 'cook'] };
const BACKGROUND = ['gm', 'director', 'manager', 'cook'];
const LUNCH_SEATS = ['cafe-0-0', 'cafe-0-1', 'cafe-0-2', 'cafe-0-3', 'cafe-1-0', 'cafe-1-1', 'cafe-1-2', 'cafe-1-3', 'cafe-3-0', 'cafe-3-1', 'cafe-3-2', 'cafe-3-3'];
const STAFF_SEATS = { hcoach: 'cafe-2-0', fcoach: 'cafe-2-1', pcoach: 'cafe-2-2', analyst: 'cafe-2-3' };
const PREP_SPOTS = ['locker-1', 'locker-2', 'locker-front', 'bench-2', 'bench-3', 'bench-4', 'bench-front', 'bench-side'];
const NAP_SPOTS = ['locker-1', 'locker-2', 'bench-2', 'bench-3'];
const WINDOWS = ['morning', 'afternoon', 'evening'];
const WIN_LABEL = { morning: '午前', afternoon: '午後', evening: '夜' };
const SLOT_TEXT = { wash: '起きて身支度をしている', morning_free: '食堂で朝食を待っている', breakfast: '朝食をとっている', prep: '練習の準備をしている（着替え・用具）', lunch: '昼食をとっている', dinner: '夕食をとって、体を休めている' };
const blockText = b => `${MENUS[b.menu].label}${b.minutes ? ` ${b.minutes}分` : ''}（${INTENSITY[b.intensity]?.label || ''}）`;
const fitTo = (blocks, avail) => { const out = []; let left = avail; for (const b of blocks) { if (left < 10) break; const m = Math.min(b.minutes, left); out.push({ ...b, minutes: m }); left -= m; } return out; };
const clone = o => JSON.parse(JSON.stringify(o));
const PLAYER_IDS = Object.keys(PLAYERS);
const modOf = M => ((M % 1440) + 1440) % 1440;
export const activityDayOf = M => Math.floor((M - LIFE.boundary) / 1440) + 1;

export class AgentDirector {
  constructor({ seed = 21, provider = null, mode = 'llm', replay = null, archive = null } = {}) {
    this.seed = seed; this.provider = provider; this.mode = mode; this.replay = replay ? clone(replay) : null; this.archive = archive;
    this.label = 'AI判断'; this.connected = true;
    this.queue = []; this.inflight = null; this.inbox = []; this.reqSeq = 0; this.blockSeq = 0; this.itemSeq = 0; this.active = 0; this.maxActive = 0; this.keyCount = {};
    this.decisions = []; this.reserved = {}; this.day = 1; this.lastMinute = -1; this.policy = 'balanced'; this.locked = new Set(); this.threads = {};
    this.hardTimeoutMs = 120000;
    this.trainees = {}; this.agents = {}; this.duty = {}; this.stats = { llm: 0, rule: 0, fallback: 0, replay: 0, invalid: 0, stale: 0, merged: 0, deferred: 0, expired: 0, calls: 0 };
    this.records = null; this.analyst = new Analyst(this); this.matches = new Matches(this);
  }

  // ── 準備（1日目 06:00。選手は寮で眠っていて、スタッフはまだ家にいる）
  start(c) {
    for (const id of PLAYER_IDS) this.trainees[id] = makeTrainee({ id, ...PLAYERS[id] }, this.seed);
    for (const id of AGENT_IDS) this.agents[id] = makeAgent(id);
    this.attach(c);
    this.day = activityDayOf(this.M);
    this.records = makeStore({ M: this.M, day: this.day });
    for (const id of PLAYER_IDS) openDay(this.records, id, this.day, this.trainees[id], this.M);
    PLAYER_IDS.forEach((id, i) => {
      const ag = this.agents[id], P = PLAYERS[id];
      ag.life = { state: 'asleep', initial: true, slot: null, sched: null, bed: i, sleepSeq: 0, rng: new Rng(seedFor(this.seed, 'life:' + id)).s, wakeAt: Math.max(this.M, Math.min(LIFE.wakeLatest, BEDTIMES[P.bed] - 1440 + P.sleepNeed)), wakeup: null, napped: false };
      c.place(id, `dorm-${i}`, 'lie'); const p = c.person(id); p.sleeping = true; p.doingText = '寮の自室で眠っている';
    });
    for (const id of Object.keys(STAFF)) { this.planDuty(id, this.M); const p = c.person(id); p.away = true; p.doingText = '勤務時間外（帰宅中）'; c.place(id, 'exit', 'idle'); }
    this.locked = new Set(['hcoach', 'fcoach', 'pcoach', 'trainer', 'analyst']);
    this.log(`${this.day}日目の朝。選手は寮で眠っている（起床は人によって 06:00〜07:15）`, { kind: 'day', spot: 'dorm-0' });
    this.lastMinute = this.M;
    return this;
  }
  attach(c) {
    this.c = c; c.director = this; c.story.steps = PHASES; c.lineup = null; c.maxEvents = 400;
    if (this.unsub) this.unsub();
    this.unsub = c.on((type, h) => { if (type !== 'hit') return; const tr = this.trainees[h.id]; if (tr) { tr.perf.cage++; if (h.good) tr.perf.good++; if (h.sharp) tr.perf.sharp++; } });
  }
  get M() { return Math.floor(this.c.minutes + 1e-6); }
  mod(M = this.M) { return modOf(M); }
  base(M = this.M) { return M - modOf(M); }
  clockAt(mod) { return clockOf(mod); }
  cap(id) { const P = POLICY[this.policy]; return PLAYERS[id]?.young && P.youngCap ? P.youngCap : P.cap; }
  view(id) { return this.c.person(id); }
  log(text, opts = {}) { return this.c.event(text, opts); }
  lifeRand(id) { const ag = this.agents[id], g = new Rng(0); g.s = ag.life.rng; return () => { const v = g.next(); ag.life.rng = g.s; return v; }; }
  awake(id) { const ag = this.agents[id]; if (PLAYERS[id]) return ag.life?.state === 'awake'; return !staffAsleep(this.mod()); }
  onSite(id) { const p = this.c.person(id); return !p.away && !p.sleeping && this.awake(id); }

  // ── 毎ステップ（描画とは独立に、ゲーム内の 1 分ごとに処理する）
  update(c) {
    let guard = 0;
    while (this.lastMinute < this.M && guard++ < 1500) { this.lastMinute++; this.minute(c, this.lastMinute); }
    this.pump();
  }
  minute(c, M) {
    const mod = modOf(M);
    if (mod === DAY.boundary) this.rollover(c, M);
    this.drainInbox(c, M);
    this.matches.minute(c, M);
    if (mod === DAY.reviewAm || mod === DAY.reviewPm) for (const id of Object.keys(COACHES)) if (this.onSite(id)) this.enqueue('review', id, { topic: `${mod}` });
    if (mod === DAY.end) this.evening(c);
    if (mod === DAY.meetingEnd) { this.locked.delete('manager'); this.locked.delete('gm'); }
    for (const id of PLAYER_IDS) this.playerMinute(c, id, M);
    this.staffMinute(c, M);
    this.analyst.minute(c, M);
    this.resolveRules(c, M);
    const now = mod < PHASES[0].at ? PHASES.at(-1) : PHASES.filter(p => p.at <= mod).pop();
    c.story.done = new Set(PHASES.filter(p => p.at < now.at).map(p => p.id));
    if (M % 30 === 0) c.emit('autosave', { M });
  }

  // ── 活動日の区切り（04:00）：日次の記録を閉じ、統計と練習量を新しい日に切り替える。一度だけ行う
  rollover(c, M) {
    if (this.rolledAt === M) return; this.rolledAt = M;
    const prev = this.day;
    for (const id of PLAYER_IDS) closeDay(this.records, id, this.trainees[id], M);
    queueChunk(this.records, prev);
    this.day = activityDayOf(M);
    for (const id of PLAYER_IDS) { newPracticeDay(this.trainees[id]); openDay(this.records, id, this.day, this.trainees[id], M); }
    for (const ag of Object.values(this.agents)) ag.calls.today = 0;
    this.keyCount = {};
    for (const [k, t] of Object.entries(this.threads)) if (t.status === 'closed' && t.closedDay < this.day - 2) delete this.threads[k];
    trim(this.records, this.day);
    for (const id of Object.keys(STAFF)) this.planDuty(id, M);
    this.log(`${this.day}日目（活動日）が始まった。前日の記録を閉じ、日次の集計と判断回数の統計を切り替えた`, { kind: 'day', minor: true });
  }

  // ── 選手の 1 分：生活の時間割（起床・食事・練習・夜・就寝）と予定の実行
  playerMinute(c, id, M) {
    const ag = this.agents[id], tr = this.trainees[id], p = c.person(id), life = ag.life;
    if (this.matches.holds(id)) { this.matches.holdMinute(c, id); return; }
    if (life.state === 'asleep') { this.sleepTick(c, id, M); return; }
    const slot = this.slotOf(id, M);
    if (slot !== life.slot) this.enterSlot(c, id, slot, M);
    const blk = ag.block;
    if (!blk) { idleMinute(tr); this.advance(c, id, M); return; }
    if (blk.phase === 'moving') {
      if (p.at === blk.spot && !c.busy(id) && p.activity === blk.act) { blk.phase = 'active'; this.arrived(c, id, blk, M); if (ag.life.state === 'asleep') return; }
      else { idleMinute(tr); if (++blk.walk > 20) { this.finish(c, id, '目的地に着けなかった'); this.advance(c, id, M); } this.showDoing(p, blk); return; }
    }
    if (blk.nap) { this.napTick(c, id, M); return; }
    if (blk.bed) return; // 寝床へ向かう途中（到着で眠る）
    const Mn = MENUS[blk.menu], f0 = tr.fatigue, coach = this.coachPresent(c, blk.menu);
    applyMinute(tr, blk, { coach, trainer: this.trainerPresent(c, blk.spot), minuteOfDay: modOf(M), at: Mn.kind === 'practice' ? M : null });
    blk.done++; if (coach && Mn.kind === 'practice') blk.coachMin = (blk.coachMin || 0) + 1;
    if (blk.menu === 'batting') p.form = cageForm(tr);
    if (Mn.kind === 'practice') {
      // 即時に必要なゲーム上の制約は、LLMの順番を待たずにここで適用する
      if (tr.fatigue >= 88) { this.forceRest(c, id, `疲労 ${tr.fatigue.toFixed(0)} が上限に近いため、練習を止めて休憩（制約）`); return; }
      if (tr.fatigue >= 75 && blk.intensity !== 'light') { blk.intensity = 'light'; this.constraintNote(id, `疲労 ${tr.fatigue.toFixed(0)} のため強度を軽めに下げた（制約）`); }
      const win = this.winOf(id, M);
      if (f0 < 70 && tr.fatigue >= 70 && win && !ag.life.fatigueAsked?.[win]) { (ag.life.fatigueAsked ??= {})[win] = true; this.enqueue('fatigue', id, { topic: win, urgent: true, extra: { win } }); }
      if (tr.today.minutes >= this.cap(id)) { this.finish(c, id, '今日の練習上限に達した'); this.constraintNote(id, `今日の練習が上限 ${this.cap(id)}分に達したため、以降は休養のみ（制約）`); this.advance(c, id, M); return; }
    }
    if (!blk.wait && blk.done >= blk.minutes) { this.finish(c, id); this.advance(c, id, M); return; }
    this.showDoing(p, blk);
    if (blk.wait && !blk.life) this.advance(c, id, M);
    if (blk.life && blk.menu === 'free' && this.winOf(id, M)) this.advance(c, id, M);
    if (blk.life && blk.menu === 'meal' && ag.life.slot === 'lunch') this.advance(c, id, M); // 食べ終わったら仮眠するか決める
  }
  showDoing(p, blk) {
    const left = blk.wait ? '' : `・残り${Math.max(0, blk.minutes - blk.done)}分`;
    p.doingText = blk.text ? blk.text : `${blk.self ? '自主練：' : ''}${MENUS[blk.menu].label}をしている（${INTENSITY[blk.intensity].label}${left}）`;
    if (blk.phase === 'moving') p.doingText = null;
  }

  // ── 一日の時間割（起床時に決める。就寝時刻は予定の判断で変わる）
  schedule(id, wakeM) {
    const ag = this.agents[id], P = PLAYERS[id], base = this.base(wakeM + 120), r = this.lifeRand(id);
    const wash = wakeM + LIFE.washMinutes, breakfastAt = Math.max(wash, base + LIFE.breakfast + Math.floor(r() * 20)), dinnerUntil = base + LIFE.dinner + 40 + Math.floor(r() * 12);
    return { wake: wakeM, wash, breakfastAt, breakfastUntil: breakfastAt + 25, amStart: base + LIFE.amStart, lunchAt: base + LIFE.lunch, pmStart: base + LIFE.pmStart, pmEnd: base + LIFE.dinner, dinnerUntil, bedAt: base + BEDTIMES[ag.plan.bedtime || P.bed] };
  }
  slotOf(id, M) {
    const s = this.agents[id].life.sched; if (!s) return 'evening';
    if (M < s.wash) return 'wash'; if (M < s.breakfastAt) return 'morning_free'; if (M < s.breakfastUntil) return 'breakfast'; if (M < s.amStart) return 'prep';
    if (M < s.lunchAt) return 'morning'; if (M < s.pmStart) return 'lunch'; if (M < s.pmEnd) return 'afternoon'; if (M < s.dinnerUntil) return 'dinner';
    if (M < s.bedAt) return 'evening'; return 'bed';
  }
  winOf(id, M = this.M) { const s = this.agents[id].life?.state === 'awake' && this.slotOf(id, M); return WINDOWS.includes(s) ? s : null; }
  winRange(id, win) { const s = this.agents[id].life.sched; return win === 'morning' ? [s.amStart, s.lunchAt] : win === 'afternoon' ? [s.pmStart, s.pmEnd] : [s.dinnerUntil, s.bedAt - 10]; }
  avail(id, win, M = this.M) { const [a, b] = this.winRange(id, win); return Math.max(0, b - Math.max(M, a)); }
  enterSlot(c, id, slot, M) {
    const ag = this.agents[id], life = ag.life, prev = life.slot;
    life.slot = slot;
    if (WINDOWS.includes(prev)) {
      if (ag.block && !ag.block.wait) this.finish(c, id, prev === 'evening' ? '就寝時刻' : prev === 'morning' ? '昼休みで区切り' : '練習時間の終了');
      if (ag.plan[prev]?.length) { note(ag, `${WIN_LABEL[prev]}の残り予定（${ag.plan[prev].map(blockText).join('・')}）は時間切れ`, c.clock); ag.plan[prev] = []; }
      // その時間帯の「次の予定」の判断は不要になったので取り消す（ルールへの切り替えではない）
      for (const r of this.queue.filter(r => r.who === id && (r.kind === 'next' || r.kind === 'fatigue') && r.extra?.win === prev)) { this.queue.splice(this.queue.indexOf(r), 1); this.stats.expired++; this.record(r, { source: 'rule', decision: null, issues: [] }, false, '時間帯が終わったため不要'); ag.decision = { state: 'idle' }; }
    } else if (ag.block) this.finish(c, id);
    ag.block = null; this.release(id);
    const i = life.bed, seat = LUNCH_SEATS[i];
    switch (slot) {
      case 'wash': this.lifeBlock(c, id, { menu: 'prep', spot: `dorm-side-${i}`, act: 'idle', text: SLOT_TEXT.wash }); break;
      case 'morning_free': this.lifeBlock(c, id, { menu: 'free', spot: seat, act: 'sitidle', text: SLOT_TEXT.morning_free }); break;
      case 'breakfast': case 'lunch': case 'dinner': this.lifeBlock(c, id, { menu: 'meal', spot: seat, act: 'eat', text: SLOT_TEXT[slot], delay: (i % 4) * 0.8 }); if (slot === 'dinner') this.adjustBedtime(c, id); break;
      case 'prep': { const spot = PREP_SPOTS.find(s => !this.reserved[s]) || 'bench-front', sit = spot.startsWith('locker-') && spot !== 'locker-front' || /^bench-\d/.test(spot); this.lifeBlock(c, id, { menu: 'prep', spot, act: sit ? 'tie' : 'idle', text: SLOT_TEXT.prep }); break; }
      case 'morning': case 'afternoon': case 'evening': this.breakpoint(c, id); this.advance(c, id, M); break;
      case 'bed': this.lifeBlock(c, id, { menu: 'free', spot: `dorm-${i}`, act: 'lie', text: '寮の自室へ戻って寝る準備', bed: true }); break;
    }
  }
  // 時間割の行動（食事・身支度・自由時間・就寝）。予定とルールで実行し、LLM は使わない
  lifeBlock(c, id, { menu, spot, act, text, delay = 0, bed = false, nap = false }) {
    const ag = this.agents[id];
    this.release(id); this.reserved[spot] = id;
    ag.block = { id: ++this.blockSeq, menu, minutes: 0, intensity: 'normal', wait: true, life: true, text, source: 'schedule', done: 0, walk: 0, phase: 'moving', spot, act, luck: 1, bed, nap };
    c.replace(id, ...(delay ? [{ do: 'wait', for: delay }] : []), { do: 'goto', spot, then: act });
  }
  arrived(c, id, blk, M) {
    if (blk.bed) this.fallAsleep(c, id, M);
    else if (blk.nap) { const tr = this.trainees[id], life = this.agents[id].life; life.sleepSeq++; startSleep(tr, { M, id: `N-${id}-${this.day}-${life.sleepSeq}`, kind: 'nap' }); life.napStartDay = this.day; c.person(id).sleeping = true; c.person(id).doingText = '昼休みに仮眠をとっている'; }
  }
  // 就寝時刻の調整（プログラム）：夕食の時点で疲れていれば早めに寝る
  adjustBedtime(c, id) {
    const ag = this.agents[id], tr = this.trainees[id], s = ag.life.sched; if (!s) return;
    if (tr.fatigue >= 70 && s.bedAt > this.base(s.wake + 120) + BEDTIMES['22:00']) {
      s.bedAt = this.base(s.wake + 120) + BEDTIMES['22:00']; ag.plan.evening = fitTo(ag.plan.evening, this.avail(id, 'evening'));
      this.planChange(id, `疲労 ${tr.fatigue.toFixed(0)} のため、就寝を 22:00 に早めた`, 'constraint');
    }
  }

  // ── 睡眠（実際に始まって終わる行動）。眠っている人には通常の判断を要求しない
  fallAsleep(c, id, M) {
    const ag = this.agents[id], tr = this.trainees[id], life = ag.life, p = c.person(id), r = this.lifeRand(id), P = PLAYERS[id];
    const lateLoad = (tr.today.practiceLog || []).filter(t => M - t <= 90).length;
    life.sleepSeq++; life.sleepStartDay = this.day;
    const s = startSleep(tr, { M, id: `S-${id}-${this.day}-${life.sleepSeq}`, kind: 'main', lateLoad });
    const next = this.base(M + 600), need = P.sleepNeed + (tr.fatigue >= 70 ? 15 : 0);
    life.wakeAt = Math.max(next + LIFE.wakeEarliest, Math.min(next + LIFE.wakeLatest, M + need));
    life.wakeup = r() < 0.12 + (tr.fatigue >= 70 ? 0.1 : 0) + Math.min(0.1, tr.today.hardLate * 0.002) ? { at: M + 120 + Math.floor(r() * 180), len: 5 + Math.floor(r() * 11) } : null;
    life.state = 'asleep'; life.slot = 'sleep'; ag.block = null;
    p.sleeping = true; p.doingText = '寮の自室で眠っている';
    note(ag, `${c.clock} に就寝（疲労 ${tr.fatigue.toFixed(0)}・起床予定 ${clockOf(life.wakeAt)}${lateLoad ? `・寝る前90分以内の練習 ${lateLoad}分` : ''}）`, c.clock);
    this.log(`${p.label}が就寝（起床予定 ${clockOf(life.wakeAt)}）`, { who: [id], kind: 'record', minor: true, spot: `dorm-${life.bed}` });
    void s;
  }
  sleepTick(c, id, M) {
    const ag = this.agents[id], tr = this.trainees[id], life = ag.life, p = c.person(id);
    if (life.initial) { if (M >= life.wakeAt) this.wakeUp(c, id, M); return; }
    if (life.wakeup && M === life.wakeup.at) { wakeDuringSleep(tr, M, life.wakeup.len); p.sleeping = false; p.doingText = '夜中に目が覚めた'; this.log(`${p.label}が夜中に目を覚ました（${life.wakeup.len}分ほど）`, { who: [id], kind: 'record', minor: true }); }
    sleepMinute(tr);
    if (tr.asleep && !tr.asleep.awakeLeft && !p.sleeping) { p.sleeping = true; p.doingText = '寮の自室で眠っている'; }
    if (M >= life.wakeAt) this.wakeUp(c, id, M);
  }
  wakeUp(c, id, M, reason = 'wake') {
    const ag = this.agents[id], tr = this.trainees[id], life = ag.life, p = c.person(id);
    const rec = endSleep(tr, { M, day: this.day, reason });
    if (rec) addSleep(this.records, { player: id, rec, startDay: life.sleepStartDay ?? this.day, forDay: this.day });
    life.state = 'awake'; life.initial = false; life.slot = null; life.napped = false; life.fatigueAsked = {}; life.wakeup = null;
    ag.plan = { focus: null, morning: [], afternoon: [], evening: [], bedtime: null };
    life.sched = this.schedule(id, M);
    p.sleeping = false;
    const text = rec ? `起床。睡眠 ${Math.floor(rec.minutes / 60)}時間${rec.minutes % 60}分・質 ${rec.quality.toFixed(2)}${rec.wakeups.length ? `・夜中に${rec.wakeups.length}回目覚めた` : ''}、疲労 ${rec.fatigue[0]}→${rec.fatigue[1]}` : '起床（記録開始前からの睡眠のため、睡眠の記録はなし）';
    note(ag, text, c.clock);
    this.log(`${p.label}：${text}`, { who: [id], kind: 'record', minor: true });
    this.enqueue('day_plan', id, { topic: `d${this.day}` });
    this.breakpoint(c, id);
  }
  napTick(c, id, M) {
    const tr = this.trainees[id], ag = this.agents[id], s = ag.life.sched;
    if (tr.asleep) sleepMinute(tr);
    if (M >= s.pmStart - 6) {
      const rec = endSleep(tr, { M, day: this.day, reason: 'wake' });
      if (rec) { addSleep(this.records, { player: id, rec, startDay: ag.life.napStartDay ?? this.day, forDay: this.day }); this.log(`${c.person(id).label}：仮眠 ${rec.minutes}分（疲労 ${rec.fatigue[0]}→${rec.fatigue[1]}）`, { who: [id], kind: 'record', minor: true }); }
      c.person(id).sleeping = false; ag.block = null;
      this.lifeBlock(c, id, { menu: 'free', spot: c.person(id).at || 'locker-1', act: 'sitidle', text: '仮眠から起きて午後に備えている' });
    }
  }

  // ── 予定済みの次の行動へ移る（LLM は使わない）。予定がなければ判断を要求し、その間は安全に待機する
  advance(c, id, M = this.M) {
    if (this.matches.holds(id)) return;
    const ag = this.agents[id], win = this.winOf(id, M);
    if (ag.block && !ag.block.wait) return;
    if (!win) {
      // 昼休み：食べ終わって疲れていれば仮眠（時間割の行動）
      if (ag.life.slot === 'lunch' && ag.block?.menu === 'meal' && M - ag.life.sched.lunchAt >= 30 && !ag.life.napped) {
        ag.life.napped = true;
        if (this.trainees[id].fatigue >= LIFE.napFatigue && ag.life.sched.pmStart - M >= 20) { const spot = NAP_SPOTS.find(s => !this.reserved[s]); if (spot) this.lifeBlock(c, id, { menu: 'rest', spot, act: 'sitidle', text: '仮眠の場所へ', nap: true }); }
      }
      return;
    }
    if (ag.plan[win].length) { if (ag.block) this.finish(c, id); this.breakpoint(c, id); this.startBlock(c, id, ag.plan[win].shift()); return; }
    if (win === 'evening') { if (!ag.block || ag.block.menu !== 'free') this.freeTime(c, id); return; }
    if (this.pending(id)) { if (!ag.block) this.startWait(id); return; }
    if (this.avail(id, win, M) >= 20) { this.enqueue('next', id, { topic: `${win}`, extra: { win } }); if (!ag.block) this.startWait(id); return; }
    if (!ag.block) this.startWait(id, '残りが短いので休んでいる');
  }
  freeTime(c, id) {
    const ag = this.agents[id], P = PLAYERS[id], pick = P.free[this.agents[id].life.sleepSeq % P.free.length];
    if (pick === 'dorm') this.lifeBlock(c, id, { menu: 'free', spot: `dorm-${ag.life.bed}`, act: 'lie', text: '寮の自室でくつろいでいる' });
    else this.lifeBlock(c, id, { menu: 'free', spot: this.reserved[pick] && this.reserved[pick] !== id ? LUNCH_SEATS[ag.life.bed] : pick, act: 'sitidle', text: pick.startsWith('locker') ? 'ロッカーで道具の手入れをしている' : '食堂でくつろいでいる' });
  }
  startWait(id, text = '判断待ち：ベンチで待機（休憩扱い）') { this.startBlock(this.c, id, { menu: 'rest', minutes: 0, intensity: 'normal', wait: true, text, source: 'rule' }); }
  startBlock(c, id, b) {
    const ag = this.agents[id], tr = this.trainees[id], P = PLAYERS[id], win = this.winOf(id);
    const blk = { id: ++this.blockSeq, menu: b.menu, minutes: b.minutes, intensity: b.intensity || 'normal', wait: !!b.wait, text: b.text || null, source: b.source || ag.planSource || 'rule', done: 0, walk: 0, phase: 'moving', acc: null, luck: 1, startM: this.M, self: win === 'evening' && MENUS[b.menu].kind === 'practice', origin: b.origin || null };
    if (blk.menu === 'free') { this.freeTime(c, id); ag.block.minutes = b.minutes; ag.block.wait = false; ag.block.life = false; ag.block.text = '自由時間'; return ag.block; }
    if (MENUS[blk.menu].kind === 'practice') {
      if (blk.intensity === 'hard' && tr.fatigue >= 60) { blk.intensity = 'normal'; this.constraintNote(id, `疲労 ${tr.fatigue.toFixed(0)} のため「強め」を「通常」に下げた（制約）`); }
      if (blk.intensity === 'hard' && ag.limits.noHardUntil >= this.day) { blk.intensity = 'normal'; this.constraintNote(id, `採用した方針（${ag.limits.noHardBy}）により「強め」を「通常」に下げた`); }
      const left = this.cap(id) - tr.today.minutes;
      if (left < 10) { this.constraintNote(id, `今日の練習が上限 ${this.cap(id)}分に達したため、${MENUS[blk.menu].label}を休憩に変更（制約）`); Object.assign(blk, { menu: 'rest', intensity: 'normal' }); }
      else blk.minutes = Math.min(blk.minutes, left);
    }
    let choice = this.pickSpot(id, blk.menu);
    if (!choice) {
      const from = blk.menu;
      for (const alt of SUBST[from] || []) { if (alt !== 'rest' && alt !== 'stretch' && !P.menus.includes(alt)) continue; choice = this.pickSpot(id, alt); if (choice) { blk.menu = alt; break; } }
      if (choice) this.log(`${this.view(id).label}：${MENUS[from].label}の場所が使用中のため、${MENUS[blk.menu].label}に変更（ルール）`, { who: [id], kind: 'record', minor: true });
    }
    if (!choice) { blk.menu = 'rest'; choice = { spot: 'bench-front', act: 'idle' }; }
    this.release(id); this.reserved[choice.spot] = id;
    blk.spot = choice.spot; blk.act = blk.intensity === 'light' && choice.lightAct ? choice.lightAct : choice.act;
    if (MENUS[blk.menu].kind === 'practice') blk.luck = blockLuck(tr);
    ag.block = blk;
    c.replace(id, { do: 'goto', spot: blk.spot, then: blk.act, gait: 'walk' });
    this.showDoing(c.person(id), blk);
    return blk;
  }
  pickSpot(id, menu) {
    const p = this.c.person(id), free = s => !this.reserved[s.spot] || this.reserved[s.spot] === id, opts = MENUS[menu].spots.filter(free);
    return opts.find(s => s.spot === HOME_FIELD[id]) || opts.find(s => s.spot === p.at) || opts[0] || null;
  }
  release(id) { for (const k of Object.keys(this.reserved)) if (this.reserved[k] === id) delete this.reserved[k]; }
  finish(c, id, why = null) {
    const ag = this.agents[id], tr = this.trainees[id], blk = ag.block; if (!blk) return;
    ag.block = null; this.release(id);
    if (blk.nap && tr.asleep) { const rec = endSleep(tr, { M: this.M, day: this.day, reason: 'interrupted' }); if (rec) addSleep(this.records, { player: id, rec, startDay: ag.life.napStartDay ?? this.day, forDay: this.day }); c.person(id).sleeping = false; }
    if (blk.wait || !blk.acc || !blk.acc.minutes) return;
    const rep = blockReport(tr, blk), name = this.view(id).label;
    rep.time = c.clock; rep.day = this.day; rep.source = blk.source; rep.cut = why; rep.self = blk.self;
    if (rep.kind === 'practice') {
      tr.last = rep;
      const rec = addPractice(this.records, { player: id, day: this.day, start: blk.startM, end: this.M, rep, sleepId: tr.sleep.id || null, source: blk.source, self: blk.self, cut: why, coachMinutes: blk.coachMin || 0 });
      rep.rid = rec.rid;
    }
    tr.reports = [...(tr.reports || []), rep].slice(-12);
    const text = (blk.self ? '自主練：' : '') + describeReport(rep, name) + (why ? `（${why}）` : '');
    note(ag, text.replace(name + '：', ''), c.clock);
    const coach = rep.kind === 'practice' && !blk.self ? (MENUS[rep.menu].coach && COACHES[MENUS[rep.menu].coach]?.players.includes(id) ? MENUS[rep.menu].coach : coachOf(id)) : null;
    if (coach && this.onSite(coach)) remember(this.agents[coach], text, c.clock);
    this.log(text, { who: [id], kind: 'record', minor: rep.kind !== 'practice' || rep.verdict === 'normal', report: rep });
  }
  forceRest(c, id, text) {
    const ag = this.agents[id]; this.finish(c, id, '疲労の上限');
    ag.rev++; const win = this.winOf(id); if (win) ag.plan[win] = ag.plan[win].filter(b => MENUS[b.menu].kind !== 'practice');
    this.constraintNote(id, text, 'warn');
    addEvent(this.records, { day: this.day, M: this.M, kind: 'rest', who: 'system', player: id, text, source: 'constraint' });
    changed(ag, { time: this.c.clock, text: '残りの練習を外して休憩', reason: text, source: 'constraint' });
    this.startBlock(c, id, { menu: 'rest', minutes: 20, intensity: 'normal', source: 'constraint' });
  }
  constraintNote(id, text, kind = 'record') { const ag = this.agents[id]; note(ag, text, this.c.clock); this.log(`${this.view(id).label}：${text}`, { who: [id], kind, minor: kind !== 'warn' }); }
  planChange(id, text, source, reason = '') {
    const ag = this.agents[id];
    changed(ag, { time: this.c.clock, text, reason, source });
    addEvent(this.records, { day: this.day, M: this.M, kind: 'plan', who: id, player: PLAYERS[id] ? id : null, text: text + (reason ? `（${reason}）` : ''), source });
  }
  coachPresent(c, menu) { const k = MENUS[menu].coach, C = COACHES[k]; if (!C) return false; const p = c.person(k); return !p.away && p.at === C.station && !p.moving && p.activity === C.act; }
  trainerPresent(c, spot) { const t = c.person('trainer'), near = { 'bed-1': 'treat-1', 'bed-2': 'treat-2' }[spot]; return !!near && !t.away && t.at === near && !t.moving && t.activity === 'treat'; }

  // ── 夕方（17:30）：監督が一日を振り返り、GMに報告する
  evening(c) {
    for (const id of ['manager', 'gm']) if (!c.person(id).away) { this.locked.add(id); c.replace(id, { do: 'goto', spot: id === 'gm' ? 'meet-1' : 'meet-2', then: 'meet' }); }
    if (!c.person('manager').away) {
      this.log('練習終了。監督が一日を振り返り、GMに報告する', { who: ['manager', 'gm'], kind: 'day', spot: 'meet-1' });
      this.enqueue('day_review', 'manager', { topic: `d${this.day}` });
    }
  }

  // ── スタッフ：出勤・退勤・持ち場・食事・定型の仕事。勤務外は家に帰っている
  planDuty(id, M) {
    const S = STAFF[id], base = this.base(M + 240), r = new Rng(seedFor(this.seed, `duty:${id}:${activityDayOf(M + 60)}`));
    const j = () => Math.floor(r.next() * 11) - 5;
    const prev = this.duty[id];
    this.duty[id] = { state: prev?.state === 'on' || prev?.state === 'leaving' ? prev.state : 'away', arriveAt: base + S.arrive + j(), leaveAt: base + S.leave + j(), day: activityDayOf(M + 60) };
  }
  staffMinute(c, M) {
    const mod = modOf(M);
    for (const id of Object.keys(STAFF)) {
      const D = this.duty[id], p = c.person(id);
      if (D.state === 'away' && M >= D.arriveAt && M < D.leaveAt) this.arrive(c, id);
      else if (D.state === 'on' && M >= D.leaveAt && this.canLeave(id, M)) { D.state = 'leaving'; this.locked.add(id); c.replace(id, { do: 'goto', spot: 'exit', then: 'idle' }); this.log(`${p.label}が退勤`, { who: [id], kind: 'info', minor: true }); }
      else if (D.state === 'leaving' && p.at === 'exit' && !p.moving) { D.state = 'away'; p.away = true; p.doingText = '勤務時間外（帰宅中）'; p.bubble = null; this.release(id); }
    }
    const practice = this.inPractice(mod), meal = mod >= DAY.lunch && mod < DAY.lunch + 50 ? 'lunch' : mod >= DAY.end && mod < DAY.end + 40 ? 'dinner' : null;
    for (const [id, C] of Object.entries(COACHES)) {
      const p = c.person(id); if (this.duty[id].state !== 'on') continue;
      if (meal) { if (p.at !== STAFF_SEATS[id] && !c.busy(id)) c.replace(id, { do: 'goto', spot: STAFF_SEATS[id], then: 'eat' }); continue; }
      if (practice || mod < DAY.start) { if (!c.busy(id) && !(p.at === C.station && p.activity === C.act)) c.replace(id, { do: 'goto', spot: C.station, then: practice ? C.act : 'idle' }); continue; }
      const eve = { hcoach: ['meet-3', 'read'], fcoach: ['meet-4', 'read'], pcoach: ['cabinet', 'look'] }[id];
      if (!c.busy(id) && !(p.at === eve[0] && p.activity === eve[1])) c.replace(id, { do: 'goto', spot: eve[0], then: eve[1] });
      if (p.at === eve[0]) p.doingText = '今日の練習記録を整理している';
    }
    const t = c.person('trainer');
    if (this.duty.trainer.state === 'on') {
      const bed = ['bed-1', 'bed-2'].find(s => { const who = this.reserved[s]; return who && this.agents[who]?.block?.phase === 'active'; });
      const want = bed ? [{ 'bed-1': 'treat-1', 'bed-2': 'treat-2' }[bed], 'treat'] : ['care-seat', 'record'];
      if (!c.busy('trainer') && !(t.at === want[0] && t.activity === want[1])) c.replace('trainer', { do: 'goto', spot: want[0], then: want[1] });
    }
    for (const id of BACKGROUND) {
      if (this.duty[id].state !== 'on' || this.locked.has(id) || c.busy(id)) continue;
      const opts = ROUTINES[id](c), i = Math.floor(c.rand() * opts.length);
      c.intend(id, opts[i]);
    }
    // スタッフの区切り（定型の行動の切れ目）で、保留中の報告をまとめて検討する
    for (const id of ['manager', 'gm', ...Object.keys(COACHES)]) if (this.duty[id].state === 'on' && !c.busy(id)) this.breakpoint(c, id);
  }
  inPractice(mod) { return (mod >= DAY.start && mod < DAY.lunch) || (mod >= DAY.afternoon && mod < DAY.end); }
  arrive(c, id) {
    const p = c.person(id), [spot, act] = STAFF_START[id];
    this.duty[id].state = 'on'; p.away = false; p.sleeping = false; p.doingText = null;
    c.place(id, 'exit', 'idle'); c.replace(id, { do: 'goto', spot, then: act });
    if (BACKGROUND.includes(id)) this.locked.delete(id);
    this.log(`${p.label}が出勤`, { who: [id], kind: 'info', minor: true, spot: 'exit' });
    if (COACHES[id] || id === 'manager' || id === 'gm') this.enqueue('staff_plan', id, { topic: `d${this.day}` });
    this.breakpoint(c, id);
  }
  canLeave(id, M) {
    if (id === 'analyst') return !this.analyst.busy() || modOf(M) >= STAFF.analyst.overtimeUntil || modOf(M) < LIFE.boundary;
    if ((id === 'manager' || id === 'gm') && this.locked.has(id) && modOf(M) < DAY.meetingEnd) return false;
    return true;
  }

  // ── 届いた報告・提案（受け手の「知っていること」に入り、判断が必要なものは区切りで検討する）
  deliver(to, item) {
    const ag = this.agents[to], it = { id: `I${++this.itemSeq}`, status: 'pending', at: this.M, clock: this.c.clock, holds: 0, ...item };
    ag.inbox.push(it); while (ag.inbox.length > 24) { const k = ag.inbox.findIndex(x => x.status !== 'pending' && x.status !== 'held'); if (k < 0) break; ag.inbox.splice(k, 1); }
    remember(ag, `${it.fromLabel}の${it.kindLabel}：${it.text}`, this.c.clock);
    if (it.needsDecision && it.urgent && this.awake(to)) this.enqueue('consider', to, { urgent: true });
    return it;
  }
  dueItems(id) { const M = this.M; return this.agents[id].inbox.filter(i => i.needsDecision && (i.status === 'pending' || (i.status === 'held' && M >= i.revisitAt))).slice(0, 6); }
  breakpoint(c, id) { if (this.agents[id] && this.awake(id) && this.dueItems(id).length) this.enqueue('consider', id); }

  // ── 判断要求のキュー（同時に1件。回数の上限はない）
  pending(id) { return this.queue.some(r => r.who === id && r.kind !== 'consider') || (this.inflight?.who === id && this.inflight.kind !== 'consider') || this.inbox.some(x => x.req.who === id && x.req.kind !== 'consider'); }
  enqueue(kind, who, { topic = '', depth = 1, extra = null, urgent = false } = {}) {
    const base = `${who}:${kind}:${topic}`;
    if (depth > THREAD.maxDepth) return null;
    // 同じ人物・同じ出来事の要求が待機中・推論中・反映待ちにあれば、追加せずにまとめる
    const same = [...this.queue, ...(this.inflight ? [this.inflight] : []), ...this.inbox.map(x => x.req)].find(r => r.base === base && !r.dropped);
    if (same) { this.stats.merged++; if (urgent && this.queue.includes(same)) { same.urgent = true; same.priority = Math.max(same.priority, PRIORITY[kind] + 14); same.notBefore = this.M; } if (extra && this.queue.includes(same)) same.extra = { ...same.extra, ...extra }; return null; }
    const n = (this.keyCount[base] = (this.keyCount[base] || 0) + 1);
    const congested = this.queue.length >= CONGESTED && !urgent && DEFERRABLE.includes(kind);
    const req = { id: ++this.reqSeq, key: `${base}#${this.day}.${n}`, base, kind, who, day: this.day, minute: this.M, depth, priority: PRIORITY[kind] + (urgent ? 14 : 0), extra, urgent, notBefore: this.M + (congested ? DEFER_MIN : 0) };
    if (congested) this.stats.deferred++;
    this.queue.push(req);
    this.agents[who].decision = { state: 'queued', kind, since: this.M, key: req.key };
    return req;
  }
  score(r) { return r.priority + AGING * (this.M - r.minute); }
  ordered() { return [...this.queue].sort((a, b) => this.score(b) - this.score(a) || a.id - b.id); }
  dispatchable(r) { return r.notBefore <= this.M && this.awake(r.who) && (!ANALYSIS_KINDS.includes(r.kind) || this.analyst.wants(r)) && (!MATCH_KINDS.includes(r.kind) || this.matches.wants(r)) && (!PLAYERS[r.who] || !this.matches.holds(r.who)); }
  llmUsable() { const pv = this.provider; return this.mode === 'llm' && !this.replay && pv && (pv.state?.checked ?? true) && pv.available !== false; }
  llmWaiting() { const pv = this.provider; return this.mode === 'llm' && !this.replay && pv && pv.state && !pv.state.checked; }
  // ルールで決めるもの（ルールのみの設定・LLM未接続）は、その分のうちに処理する。回数の上限による切り替えはない
  resolveRules(c, M) {
    if (this.replay) { this.replayDue(c, M, 'rules'); return; }
    if (this.llmWaiting()) return;
    if (this.llmUsable()) return;
    for (const req of this.ordered()) {
      if (!this.dispatchable(req)) continue;
      this.queue.splice(this.queue.indexOf(req), 1);
      const full = this.context(req); req.rev = this.agents[req.who].rev; req.ctx = full;
      const source = this.mode !== 'llm' ? 'rule' : 'fallback';
      this.applyResult(c, req, { stage: 'rules', source, error: source === 'fallback' ? 'connect' : null, decision: this.ruleFor(req.kind, full), issues: [] });
    }
  }
  ruleFor(kind, full) { return MATCH_KINDS.includes(kind) ? matchRule(kind, full) : ANALYSIS_KINDS.includes(kind) ? analysisRule(kind, full) : ruleDecision(kind, full); }
  // LLM へは同時に 1 件だけ送る。結果は inbox に入れ、次のゲーム内 1 分の処理で反映する
  pump() {
    const fl = this.inflight;
    if (fl && Date.now() - fl.started > this.hardTimeoutMs) this.settle(fl, { ok: false, error: 'timeout', detail: '応答が返らないため打ち切り', ms: Date.now() - fl.started });
    if (this.inflight || !this.queue.length || !this.llmUsable()) return;
    const req = this.ordered().find(r => this.dispatchable(r));
    if (!req) return;
    this.queue.splice(this.queue.indexOf(req), 1);
    const ag = this.agents[req.who];
    req.ctx = this.context(req); req.rev = ag.rev; req.prompt = MATCH_KINDS.includes(req.kind) ? matchPrompt(req.kind, req.ctx) : ANALYSIS_KINDS.includes(req.kind) ? analysisPrompt(req.kind, req.ctx) : buildPrompt(req.kind, req.ctx); req.started = Date.now(); req.startedM = this.M;
    ag.calls.today++; ag.calls.total++; ag.calls.byKind[req.kind] = (ag.calls.byKind[req.kind] || 0) + 1; this.stats.calls++;
    ag.decision = { state: 'thinking', kind: req.kind, since: req.minute, key: req.key, startedAt: req.started };
    const p = this.c.person(req.who); if (!p.away) p.icon = { kind: 'think', until: Infinity };
    this.inflight = req; this.active++; this.maxActive = Math.max(this.maxActive, this.active);
    Promise.resolve().then(() => this.provider.decide(req.prompt)).catch(e => ({ ok: false, error: 'connect', detail: String(e) })).then(res => this.settle(req, res));
  }
  settle(req, res) { if (req.settled) return; req.settled = true; this.active--; if (this.inflight === req) this.inflight = null; this.inbox.push({ req, res }); }
  drainInbox(c, M) {
    for (const { req, res } of this.inbox.splice(0)) {
      const p = c.person(req.who); if (p.icon?.kind === 'think' && p.icon.until === Infinity) p.icon = null;
      if (req.dropped) { this.agents[req.who].decision = { state: 'idle' }; this.record(req, { source: 'llm', decision: null, issues: [], ms: res.ms }, false, '読み込みで破棄'); continue; }
      const full = req.ctx || this.context(req), A = ANALYSIS_KINDS.includes(req.kind);
      if (!res.ok) { this.applyResult(c, req, { stage: 'inbox', source: 'fallback', error: res.error, detail: res.detail, ms: res.ms, decision: this.ruleFor(req.kind, full), issues: [] }); continue; }
      const v = MATCH_KINDS.includes(req.kind) ? matchValidate(req.kind, res.text, full) : A ? analysisValidate(req.kind, res.text, full) : validate(req.kind, res.text, full.ctx);
      if (!v.ok) { this.stats.invalid++; this.applyResult(c, req, { stage: 'inbox', source: 'fallback', error: 'invalid', ms: res.ms, decision: this.ruleFor(req.kind, full), issues: v.issues }); continue; }
      this.applyResult(c, req, { stage: 'inbox', source: 'llm', ms: res.ms, decision: v.decision, issues: v.issues });
    }
    if (this.replay) this.replayDue(c, M, 'inbox');
  }
  // 記録の再生：採用した判断を、記録された分にそのまま反映する（LLM の判断も含めて同じ経過を再現する）
  replayDue(c, M, stage) {
    for (const r of this.replay.filter(x => x.stage === stage && x.minute <= M)) {
      const req = this.queue.find(q => q.key === r.key); if (!req) continue;
      this.replay.splice(this.replay.indexOf(r), 1); this.queue.splice(this.queue.indexOf(req), 1);
      req.rev = r.rev; req.ctx = this.context(req);
      if (r.source === 'llm') { const ag = this.agents[req.who]; ag.calls.today++; ag.calls.total++; }
      this.applyResult(c, req, { stage, source: r.source, replayed: true, error: r.error, ms: r.ms, decision: r.decision, issues: r.issues || [] });
    }
  }

  // その人物に必要な情報だけを集める
  context(req) {
    const c = this.c, who = req.who, M = this.M;
    if (MATCH_KINDS.includes(req.kind)) return this.matches.context(req);
    if (ANALYSIS_KINDS.includes(req.kind)) return this.analyst.context(req);
    const base = { day: this.day, clock: c.clock, match: this.matches.fixture()?.day === this.day ? this.matches.fixture() : null, cap: PLAYERS[who] ? this.cap(who) : null };
    const out = { who, view: { label: c.person(who).label, roleLabel: c.person(who).roleLabel }, ag: this.agents[who], tr: this.trainees[who] || null, ctx: base };
    const sumOf = pid => playerSummary(pid, this.trainees[pid], this.agents[pid], { label: c.person(pid).label });
    const stateOf = pid => { const tr = this.trainees[pid], ag = this.agents[pid]; return { fatigue: tr.fatigue, block: ag.block && !ag.block.wait ? { menu: ag.block.menu, intensity: ag.block.intensity } : null, lastCond: tr.last?.cond ?? null, minutes: tr.today.minutes }; };
    if (PLAYERS[who]) {
      const ag = this.agents[who], win = this.winOf(who, M), sl = this.trainees[who].lastSleep;
      Object.assign(base, { menus: PLAYERS[who].menus, eveningMenus: eveningMenus(PLAYERS[who].menus), usualBed: PLAYERS[who].bed, avail: { morning: ag.life?.sched ? this.avail(who, 'morning', M) : 0, afternoon: ag.life?.sched ? this.avail(who, 'afternoon', M) : 0, now: win ? this.avail(who, win, M) : 0 }, lastSleep: sl ? `昨夜の睡眠 ${Math.floor(sl.minutes / 60)}時間${sl.minutes % 60}分${sl.wakeups.length ? `（夜中に${sl.wakeups.length}回目覚めた）` : ''}` : null, limits: ag.limits.noHardUntil >= this.day ? `「強め」は使わない（${ag.limits.noHardBy}）` : null });
    } else if (COACHES[who]) {
      const players = COACHES[who].players;
      Object.assign(base, { role: 'coach', players, menusOf: Object.fromEntries(players.map(p => [p, PLAYERS[p].menus])), allMenus: [...new Set(players.flatMap(p => PLAYERS[p].menus))], team: players.map(sumOf), states: Object.fromEntries(players.map(p => [p, stateOf(p)])), watch: this.agents[who].staffPlan?.day === this.day ? this.agents[who].staffPlan.watch : null });
      const skip = players.map(p => this.threadBlock(who, p)).filter(Boolean); base.skip = skip.map(s => s.text); base.skipIds = skip.map(s => s.player);
    } else {
      const players = PLAYER_IDS;
      const avg = players.reduce((s, p) => s + this.trainees[p].fatigue, 0) / players.length;
      Object.assign(base, { role: who, players, team: players.map(sumOf), states: Object.fromEntries(players.map(p => [p, stateOf(p)])), avgFatigue: avg });
    }
    if (req.kind === 'consider') base.items = this.dueItems(who).map(it => ({ ...it }));
    return out;
  }
  // 同じコーチから同じ選手への相談：検討中のもの、または状況が変わらないまま見送られたものがあれば、新しい提案を送らない
  threadBlock(coach, player) {
    const tr = this.trainees[player], sig = `${Math.floor(tr.fatigue / 10)}|${tr.last?.rid || ''}`;
    for (const t of Object.values(this.threads)) {
      if (t.from !== coach || t.to !== player) continue;
      if (t.status === 'open') return { player, text: `${this.view(player).name}への提案は本人が検討中` };
      if (t.status === 'closed' && t.end === 'declined' && t.sig === sig && this.M - t.closedAt < 240) return { player, text: `${this.view(player).name}は同じ状況で提案を見送った（状況の変化待ち）` };
    }
    return null;
  }

  // ── 判断の反映（LLM・ルール・再生で共通）。古くなった判断は捨て、実行できるかを今の状態で確かめ直す
  applyResult(c, req, res) {
    const ag = this.agents[req.who], name = c.person(req.who).label, src = res.source;
    ag.decision = { state: 'idle' };
    const tag = src === 'llm' ? `ローカルLLM・${((res.ms || 0) / 1000).toFixed(1)}秒` : src === 'fallback' ? `ルール代替：${res.error === 'invalid' ? '不正な応答' : ERROR_TEXT[res.error] || 'LLM未接続'}` : SOURCE_LABEL[src] + (res.replayed ? '・再生' : '');
    const A = ANALYSIS_KINDS.includes(req.kind);
    const stale = MATCH_KINDS.includes(req.kind) ? !this.matches.wants(req) : A ? !this.analyst.wants(req) : (req.rev != null && req.rev !== ag.rev) || (req.extra?.win && req.extra.win !== this.winOf(req.who));
    if (stale) { this.stats.stale++; this.record(req, res, false, '状況が変わったため破棄'); this.log(`${name}：${KIND_LABEL[req.kind]}の判断（${tag}）は、返るまでに状況が変わったため採用しなかった`, { who: [req.who], kind: 'system', minor: true }); if (PLAYERS[req.who] && !A) this.advance(c, req.who); return; }
    if (!res.decision) { this.record(req, res, false, '判断なし'); return; }
    this.stats[src] = (this.stats[src] || 0) + 1;
    const d = res.decision, issues = res.issues?.length ? `（検証で調整：${res.issues.slice(0, 3).join('、')}${res.issues.length > 3 ? ' ほか' : ''}）` : '';
    const reason = d.reason ? `「${d.reason}」` : '';
    const setReason = () => { ag.reason = { text: d.reason || '', time: c.clock, source: src, tag }; c.person(req.who).reason = { text: d.reason || '', time: c.clock }; c.emit('reason', { id: req.who }); };
    let applied = true, noteText = '';
    if (MATCH_KINDS.includes(req.kind)) { setReason(); const r = this.matches.onDecision(req, res); this.record(req, res, r.applied, r.note); this.log(`${name}：${r.note}（${tag}）${reason}`, { kind: 'game', who: ['manager'] }); return; }
    if (A) { setReason(); const r = this.analyst.onDecision(c, req, res, tag); applied = r.applied; noteText = r.note; this.record(req, res, applied, noteText); return; }
    switch (req.kind) {
      case 'day_plan': {
        const M = this.M, s = ag.life.sched, slotIdx = ['wash', 'morning_free', 'breakfast', 'prep', 'morning', 'lunch', 'afternoon', 'dinner', 'evening', 'bed'].indexOf(this.slotOf(req.who, M));
        ag.plan.focus = d.focus; ag.plan.bedtime = d.bedtime;
        if (s && ag.life.state === 'awake' && slotIdx < 9) s.bedAt = this.base(s.wake + 120) + BEDTIMES[d.bedtime];
        ag.plan.morning = slotIdx <= 4 ? fitTo(d.morning, this.avail(req.who, 'morning', M)) : [];
        ag.plan.afternoon = slotIdx <= 6 ? fitTo(d.afternoon, this.avail(req.who, 'afternoon', M)) : [];
        ag.plan.evening = slotIdx <= 8 ? fitTo(d.evening, this.avail(req.who, 'evening', M)) : [];
        for (const w of WINDOWS) for (const b of ag.plan[w]) b.source = src;
        ag.planSource = src; ag.rev++; setReason();
        const plan = WINDOWS.map(w => ag.plan[w].length ? `${WIN_LABEL[w]}：${ag.plan[w].map(blockText).join(' → ')}` : '').filter(Boolean).join('／');
        noteText = `方針「${FOCUS[d.focus]}」・${plan || '（時間内に入る予定なし）'}・就寝 ${d.bedtime}`;
        note(ag, `今日の方針と予定を決めた：${noteText}`, c.clock);
        this.planChange(req.who, `一日の予定を決定：${noteText}`, src, d.reason);
        this.log(`${name}が今日の方針と予定を決定（${tag}）：${noteText}${reason}${issues}`, { who: [req.who], kind: 'decision' });
        if (!ag.block || ag.block.wait) this.advance(c, req.who, M);
        break;
      }
      case 'next': case 'fatigue': {
        const win = this.winOf(req.who);
        if (!win) { applied = false; noteText = '練習時間外'; break; }
        ag.plan[win] = fitTo(d.blocks, this.avail(req.who, win)); const plan = ag.plan[win];
        for (const b of plan) b.source = src;
        ag.planSource = src; ag.rev++; setReason();
        noteText = plan.map(blockText).join(' → ') || '（時間内に入る予定なし）';
        note(ag, `${KIND_LABEL[req.kind]}を決めた：${noteText}`, c.clock);
        this.planChange(req.who, `${WIN_LABEL[win]}の残りを変更：${noteText}`, src, d.reason);
        this.log(`${name}が${KIND_LABEL[req.kind]}を決定（${tag}）：${noteText}${reason}${issues}`, { who: [req.who], kind: 'decision' });
        if (req.kind === 'fatigue' && ag.block && !ag.block.wait) this.finish(c, req.who, '予定の見直し');
        if (!ag.block || ag.block.wait) this.advance(c, req.who);
        break;
      }
      case 'consider': {
        setReason();
        const results = [];
        for (const dd of d.decisions) {
          const it = ag.inbox.find(i => i.id === dd.id);
          if (!it || (it.status !== 'pending' && it.status !== 'held')) continue;
          results.push(this.decideItem(c, req.who, it, dd.choice, dd.reason, src));
        }
        noteText = results.join('、') || '検討する項目はなかった';
        this.log(`${name}が届いた報告・提案を検討（${tag}）：${noteText}${issues}`, { who: [req.who], kind: 'decision' });
        // 反映中に新しく届いたものは、次の区切りでまた検討する
        break;
      }
      case 'review': {
        setReason();
        const sent = [], skipped = [];
        for (const pr of d.proposals) {
          const who2 = c.person(pr.player).label, block = this.threadBlock(req.who, pr.player), pa = this.agents[pr.player];
          if (block) { skipped.push(block.text); continue; }
          if (pa.life.state !== 'awake' || !this.winOf(pr.player)) { skipped.push(`${who2}への提案（練習時間外のため送らず）`); continue; }
          const urgent = this.trainees[pr.player].fatigue >= 65 && MENUS[pr.menu].kind === 'recover';
          const tid = `T${this.itemSeq + 1}`;
          this.threads[tid] = { id: tid, from: req.who, to: pr.player, topic: pr.menu, status: 'open', openedAt: this.M, turns: 1, sig: null };
          this.deliver(pr.player, { kind: 'proposal', kindLabel: '提案', from: req.who, fromLabel: name, text: `${blockText(pr)}「${pr.message}」`, change: { type: 'block', block: { menu: pr.menu, minutes: pr.minutes, intensity: pr.intensity } }, changeText: `${blockText(pr)}を次に行う`, urgent, needsDecision: true, thread: tid });
          addEvent(this.records, { day: this.day, M: this.M, kind: 'coaching', who: req.who, player: pr.player, text: `${name}が${blockText(pr)}を提案「${pr.message}」${urgent ? '（急ぎ）' : ''}`, source: src });
          c.say(req.who, `${c.person(pr.player).name}、${pr.message}`, 4);
          sent.push(`${c.person(pr.player).label}に${blockText(pr)}${urgent ? '（急ぎ）' : '（次の区切りで検討）'}`);
        }
        if (d.note && this.onSite('manager')) remember(this.agents.manager, `${name}の報告：${d.note}`, c.clock);
        noteText = (sent.length ? `提案：${sent.join('、')}` : d.proposals.length ? '提案は送らなかった' : '提案なし（予定どおり）') + (skipped.length ? `。${skipped.join('、')}` : '');
        note(ag, `練習結果を振り返った。${noteText}`, c.clock);
        this.log(`${name}が練習結果を振り返り（${tag}）：${noteText}${d.note ? `。報告「${d.note}」` : ''}${issues}`, { who: [req.who, ...d.proposals.map(p => p.player)], kind: 'decision' });
        break;
      }
      case 'day_review': {
        setReason();
        for (const t of d.tomorrow) { this.agents[t.player].focus = t.focus; const txt = `${name}の方針：明日は${FOCUS[t.focus]}`; remember(this.agents[t.player], txt, c.clock); const co = coachOf(t.player); if (co) remember(this.agents[co], `${c.person(t.player).label}は明日${FOCUS[t.focus]}（${name}）`, c.clock); }
        if (d.report) remember(this.agents.gm, `${name}の報告：${d.report}`, c.clock);
        if (d.ask) this.analyst.request({ trigger: 'manager', by: 'manager', players: [d.ask], theme: 'efficiency', question: `${c.person(d.ask).name}の最近の練習と成果を、過去と比べて確認したい` });
        noteText = (d.tomorrow.map(t => `${c.person(t.player).name}=${FOCUS[t.focus]}`).join('、') || '変更なし') + (d.ask ? `。小野に${c.person(d.ask).name}の分析を依頼` : '');
        this.log(`${name}が明日の方針を決定（${tag}）：${noteText}${d.report ? `。GMへ報告「${d.report}」` : ''}${issues}`, { who: [req.who, 'gm'], kind: 'decision', spot: 'meet-2' });
        if (d.report && !c.person(req.who).away) c.say(req.who, d.report, 4);
        this.enqueue('policy', 'gm', { depth: req.depth + 1, topic: `d${this.day}` });
        break;
      }
      case 'policy': {
        setReason();
        this.policy = d.policy; const P = POLICY[d.policy];
        const txt = `GMの方針：${P.label}（練習上限 ${P.cap}分${P.youngCap ? `・若手 ${P.youngCap}分` : ''}）${d.message ? `「${d.message}」` : ''}`;
        for (const id of ['manager', ...Object.keys(COACHES), ...PLAYER_IDS]) remember(this.agents[id], txt, c.clock);
        if (d.message && !c.person('gm').away) c.say('gm', d.message, 4);
        noteText = P.label;
        addEvent(this.records, { day: this.day, M: this.M, kind: 'policy', who: 'gm', text: txt, source: src });
        this.log(`${name}が球団方針を決定（${tag}）：${txt}${reason}${issues}`, { who: ['gm', 'manager'], kind: 'decision', spot: 'meet-1' });
        break;
      }
      case 'staff_plan': {
        setReason();
        const role = COACHES[req.who] ? 'coach' : req.who;
        ag.staffPlan = { day: this.day, focus: d.focus, watch: d.watch, note: d.note, label: STAFF_FOCUS[role][d.focus] };
        noteText = `${STAFF_FOCUS[role][d.focus]}${d.watch ? `・${c.person(d.watch).name}を特に見る` : ''}`;
        note(ag, `今日の方針：${noteText}`, c.clock);
        this.log(`${name}が今日の仕事の方針を決定（${tag}）：${noteText}${d.note ? `「${d.note}」` : ''}${issues}`, { who: [req.who], kind: 'decision', minor: true });
        break;
      }
    }
    this.record(req, res, applied, noteText);
  }
  // 報告・提案への判断（採用・見送り・保留）を記録し、採用なら実際の予定や方針に反映する
  decideItem(c, who, it, choice, why, src) {
    const ag = this.agents[who], name = c.person(who).name;
    it.considered = (it.considered || 0) + 1; it.decidedAt = this.M; it.reason = why || '';
    if (choice === 'hold') {
      it.holds++;
      if (it.holds > THREAD.maxHolds) { it.status = 'closed'; it.end = '同じ検討を繰り返して進展がないため終了'; }
      else { it.status = 'held'; it.revisitAt = this.M + THREAD.revisitAfter; }
    } else it.status = choice === 'adopt' ? 'adopted' : 'declined';
    let applied = '';
    if (it.status === 'adopted') applied = this.applyItem(c, who, it, src);
    const label = { adopted: '採用', declined: '見送り', held: '保留', closed: '終了' }[it.status];
    if (it.thread && this.threads[it.thread]) { const t = this.threads[it.thread]; if (it.status !== 'held') Object.assign(t, { status: 'closed', end: it.status, closedAt: this.M, closedDay: this.day, sig: `${Math.floor((this.trainees[who]?.fatigue ?? 0) / 10)}|${this.trainees[who]?.last?.rid || ''}` }); }
    if (it.from && this.agents[it.from]) remember(this.agents[it.from], `${c.person(who).label}の返答（${it.kindLabel}）：${label}${why ? `「${why}」` : ''}`, c.clock);
    if (it.kind === 'analysis') this.analyst.onItemDecision(it, who, it.status, why, applied);
    addEvent(this.records, { day: this.day, M: this.M, kind: it.kind === 'analysis' ? 'report_decision' : 'proposal_decision', who, player: PLAYERS[who] ? who : it.change?.player || null, text: `${it.fromLabel}の${it.kindLabel}を${label}：${it.text}${applied ? ` → ${applied}` : ''}${why ? `（${why}）` : ''}`, source: src, ref: it.reportId || it.id });
    note(ag, `${it.fromLabel}の${it.kindLabel}を${label}${applied ? `（${applied}）` : ''}`, c.clock);
    return `${it.fromLabel}の${it.kindLabel}を${label}${applied ? `→${applied}` : ''}${it.end ? `（${it.end}）` : ''}`;
  }
  applyItem(c, who, it, src) {
    const ch = it.change; if (!ch) return '';
    const target = ch.player || who, tag = PLAYERS[target] ? this.agents[target] : null;
    switch (ch.type) {
      case 'block': {
        const win = this.winOf(who); if (!win) { it.status = 'closed'; it.end = '練習時間外のため実行できず'; return ''; }
        const ag = this.agents[who];
        if (it.urgent && ag.block && !ag.block.wait && MENUS[ag.block.menu].kind === 'practice') this.finish(c, who, '提案を受けて変更');
        ag.plan[win] = fitTo([{ ...ch.block, source: src, origin: it.fromLabel }, ...ag.plan[win]], this.avail(who, win)); ag.rev++;
        this.planChange(who, `${WIN_LABEL[win]}に${blockText(ch.block)}を入れた`, src, `${it.fromLabel}の提案`);
        if (!ag.block || ag.block.wait) this.advance(c, who);
        return `${blockText(ch.block)}を${it.urgent ? 'すぐに' : '次に'}行う`;
      }
      case 'focus_next_day': if (!tag) return ''; tag.focus = ch.focus; remember(tag, `${c.person(who).label}の方針：明日は${FOCUS[ch.focus]}（分析を受けて）`, c.clock); this.planChange(target, `明日の方針を${FOCUS[ch.focus]}に`, src, `${c.person(who).name}が分析の提案を採用`); return `${c.person(target).name}の明日の方針を${FOCUS[ch.focus]}に`;
      case 'avoid_hard': if (!tag) return ''; tag.limits.noHardUntil = this.day + 1; tag.limits.noHardBy = `${c.person(who).name}が分析を受けて決定`; remember(tag, `${c.person(who).label}の方針：明日まで「強め」の練習は控える`, c.clock); this.planChange(target, '明日まで「強め」を控える', src, `${c.person(who).name}が分析の提案を採用`); return `${c.person(target).name}は明日まで強めを控える`;
      case 'add_care': {
        const ag = this.agents[target], win = this.winOf(target) || (ag.life.state === 'awake' && this.slotOf(target, this.M) !== 'bed' ? 'evening' : null);
        if (!win) return '';
        ag.plan[win] = fitTo([{ menu: 'care', minutes: 20, intensity: 'normal', source: src, origin: '分析' }, ...ag.plan[win]], this.avail(target, win)); ag.rev++;
        this.planChange(target, `${WIN_LABEL[win]}にケア20分を入れた`, src, '分析の提案を採用');
        return `${WIN_LABEL[win]}にケアを入れる`;
      }
      case 'earlier_bed': {
        const ag = this.agents[target], s = ag.life.sched; if (!s || ag.life.state !== 'awake') return '';
        s.bedAt -= 30; ag.plan.evening = fitTo(ag.plan.evening, this.avail(target, 'evening'));
        this.planChange(target, `今夜の就寝を ${clockOf(s.bedAt)} に早めた`, src, '分析の提案を採用');
        return `今夜は ${clockOf(s.bedAt)} に寝る`;
      }
    }
    return '';
  }
  record(req, res, applied, noteText) {
    this.decisions.push({ key: req.key, stage: res.stage || null, kind: req.kind, who: req.who, day: req.day, minute: this.M, clock: this.c.clock, rev: req.rev ?? null, source: res.source, error: res.error || null, ms: res.ms ?? null, decision: res.decision, issues: res.issues || [], applied, note: noteText });
    if (this.decisions.length > 1500) this.decisions.shift();
  }

  // ── 画面向けの問い合わせ
  personView(id) {
    const ag = this.agents[id], tr = this.trainees[id];
    if (!ag) return { managed: false, duty: this.duty[id] || null };
    const d = ag.decision, order = this.ordered(), p = this.c.person(id);
    let state = 'idle', text = '';
    if (d.state === 'queued') { state = 'queued'; const r = this.queue.find(q => q.key === d.key); text = `AI判断待ち（${KIND_LABEL[d.kind]}・${order.findIndex(q => q.who === id) + 1}番目／${this.M - d.since}分待ち${r && r.notBefore > this.M ? '・混雑のため後回し' : r && !this.awake(id) ? '・起きてから判断' : ''}）`; }
    else if (d.state === 'thinking') { state = 'thinking'; text = `AI判断中（${KIND_LABEL[d.kind]}・${Math.round((Date.now() - d.startedAt) / 1000)}秒）`; }
    else if (PLAYERS[id] && ag.life?.state === 'asleep') { state = 'asleep'; text = `睡眠中（起床予定 ${clockOf(ag.life.wakeAt)}）。眠っている間は判断を要求しない`; }
    else if (p.away) { state = 'away'; text = `勤務時間外（次の出勤 ${this.duty[id] ? clockOf(this.duty[id].arriveAt) : '—'}）`; }
    else if (ag.block && !ag.block.wait) { state = 'executing'; text = `行動実行中（${SOURCE_LABEL[ag.block.source] || 'ルール'}の予定）`; }
    else if (PLAYERS[id] && ag.block?.life) { state = 'executing'; text = '時間割の行動（予定・ルール）'; }
    else if (PLAYERS[id] && ag.block?.wait) { state = 'idle'; text = '待機中'; }
    else if (id === 'analyst') { const j = this.analyst.current(); state = 'executing'; text = j ? `分析作業（${j.stageLabel}）` : '定型の確認作業（ルール）'; }
    else { state = 'executing'; text = COACHES[id] ? '持ち場で指導中（ルールで配置）' : '定型の行動（ルール）'; }
    const remaining = [];
    if (PLAYERS[id] && ag.life?.state === 'awake') {
      const slot = this.slotOf(id, this.M), s = ag.life.sched, order2 = ['morning', 'afternoon', 'evening'], from = order2.indexOf(slot);
      for (const w of order2) if (order2.indexOf(w) >= Math.max(0, from === -1 ? order2.findIndex(x => this.winRange(id, x)[0] > this.M) : from)) for (const b of ag.plan[w]) remaining.push({ ...b, half: WIN_LABEL[w] });
      if (s) remaining.push({ menu: 'sleep', half: '就寝', text: clockOf(s.bedAt) });
    }
    const due = ag.inbox.filter(i => i.status === 'pending' || i.status === 'held');
    return { managed: true, state, text, reason: ag.reason, next: remaining, block: ag.block, tr, ag, calls: ag.calls, cap: PLAYERS[id] ? this.cap(id) : null, focus: ag.focus, dayFocus: ag.plan?.focus || null, staffPlan: ag.staffPlan?.day === this.day ? ag.staffPlan : null, inbox: due, recentItems: ag.inbox.filter(i => i.status !== 'pending' && i.status !== 'held').slice(-3).reverse(), changes: ag.changes.slice(-3).reverse(), life: ag.life, duty: this.duty[id] || null };
  }
  queueView() {
    return { inflight: this.inflight ? { who: this.inflight.who, kind: this.inflight.kind, secs: Math.round((Date.now() - this.inflight.started) / 1000) } : null, queued: this.ordered().map(r => ({ who: r.who, kind: r.kind, waited: this.M - r.minute, deferred: r.notBefore > this.M, sleeping: !this.awake(r.who) })), recent: this.decisions.slice(-6).reverse(), stats: this.stats, maxActive: this.maxActive };
  }
  // 早送りを止めるべきか（重要な判断・警告が出た）
  needsAttention() { return this.queue.some(r => this.dispatchable(r) && this.llmUsable()) || !!this.inflight; }

  // ── 保存と再開（ゲーム内の状態・記憶・予定・乱数・人物の位置・長期の記録・分析と、採用した判断の記録）
  serialize() {
    const c = this.c, pending = [...this.queue, ...(this.inflight ? [this.inflight] : []), ...this.inbox.map(x => x.req)].filter(r => !r.dropped).map(r => ({ key: r.key, base: r.base, kind: r.kind, who: r.who, day: r.day, minute: r.minute, depth: r.depth, priority: r.priority, extra: r.extra, urgent: !!r.urgent, notBefore: r.notBefore ?? r.minute, id: r.id }));
    const people = {};
    for (const p of c.people.values()) people[p.id] = clone({ x: p.x, y: p.y, tx: p.tx, ty: p.ty, dir: p.dir, path: p.path, moving: p.moving, gait: p.gait, stepDist: p.stepDist, at: p.at, activity: p.activity, act: p.act, phase: p.phase, queue: p.queue, cur: p.cur, goal: p.goal || null, reason: p.reason, form: p.form, hold: p.hold, ox: p.ox, oy: p.oy, doingText: p.doingText || null, away: !!p.away, sleeping: !!p.sleeping });
    return clone({ v: SAVE_VERSION, seed: this.seed, mode: this.mode, t: c.t, gm: c.gm, rate: c.rate, day: this.day, lastMinute: this.lastMinute, rolledAt: this.rolledAt ?? null, policy: this.policy, reqSeq: this.reqSeq, blockSeq: this.blockSeq, itemSeq: this.itemSeq, keyCount: this.keyCount, reserved: this.reserved, locked: [...this.locked], threads: this.threads, duty: this.duty, trainees: this.trainees, agents: this.agents, pending, decisions: this.decisions, stats: this.stats, records: this.records, analysis: this.analyst.serialize(), matches: this.matches.serialize(), people, events: c.events, eseq: c.seq, rand: c.rand.state.s, cyc: c.cyc || null, knockOff: c.knockOff || 0, savedAt: Date.now() });
  }
  static restore(c, data, opts = {}) {
    if (!data || data.v !== SAVE_VERSION) throw Error('保存データの形式が違います（先に移行してください）');
    const d = new AgentDirector({ seed: data.seed, mode: opts.mode || data.mode, provider: opts.provider || null, archive: opts.archive || null });
    Object.assign(d, { day: data.day, lastMinute: data.lastMinute, rolledAt: data.rolledAt ?? undefined, policy: data.policy, reqSeq: data.reqSeq, blockSeq: data.blockSeq, itemSeq: data.itemSeq || 0, keyCount: data.keyCount || {}, reserved: data.reserved, locked: new Set(data.locked), threads: data.threads || {}, duty: data.duty || {}, trainees: data.trainees, agents: data.agents, decisions: data.decisions, stats: { ...d.stats, ...data.stats }, records: data.records });
    d.analyst.restore(data.analysis);
    d.matches.restore(data.matches);
    d.attach(c);
    c.t = data.t; c.gm = data.gm; c.rate = data.rate ?? c.rate; c.events = data.events; c.seq = data.eseq; c.rand.state.s = data.rand; c.cyc = data.cyc || undefined; c.knockOff = data.knockOff;
    for (const [id, s] of Object.entries(data.people)) { const p = c.person(id); if (p) Object.assign(p, s, { bubble: null, icon: null }); }
    for (const r of data.pending) { d.queue.push({ ...r, base: r.base || r.key.split('#')[0] }); d.agents[r.who].decision = { state: 'queued', kind: r.kind, since: r.minute, key: r.key }; }
    // 初版の試合判断に含まれた未検証の自由文は、復元時にも表示を抑える。起用・スコア・記録はそのまま。
    for (const r of d.decisions) if (MATCH_KINDS.includes(r.kind) && r.source === 'llm' && r.decision?.reason) {
      const old = r.decision.reason, safe = safeMatchReason(r.kind, old); r.decision.reason = safe;
      if (d.agents.manager.reason?.text === old) d.agents.manager.reason.text = safe;
      if (c.person('manager').reason?.text === old) c.person('manager').reason.text = safe;
    }
    for (const e of c.events) if (e.kind === 'game' && e.text.includes('ローカルLLM')) e.text = e.text.replace(/「[^」]*」/g, text => `「${safeMatchReason(e.text.includes('打順') ? 'match_lineup' : 'match_pitching', text.slice(1,-1))}」`);
    for (const ag of Object.values(d.agents)) if (ag.decision.state === 'thinking') ag.decision = { state: 'idle' };
    return d;
  }
  archiveCoverage() { return coverage(this.records); }
}
