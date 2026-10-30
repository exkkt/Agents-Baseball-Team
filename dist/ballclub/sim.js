// 球団の状態と行動。描画（DOM・canvas）に依存しない。AIは intend() と event() を通して人物を動かす
import { T, SPOTS, findPath, spotAnchor, tileCenter, roomAt, isOutdoor } from './world.js';
import { CAST } from './cast.js';

export const START_MIN = 6 * 60; // 新しい進行は 1日目 06:00（全員が寝ている時刻）から始める
// 時間の軸は2つ：t＝動作の秒（歩行・投球・ボール・吹き出しは常に自然な速さ）、gm＝ゲーム内の時計（分）。
// 標準は「現実の1秒＝ゲーム内の10秒」。時計・予定・練習・成長は gm で進み、動作は t で進む
export const CLOCK_RATE = 10 / 60;
export const clockText = m => { m = Math.floor(m + 1e-6); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
export const STATUS = { talk: '会話中', think: '考え中', work: '作業中', rest: '休憩中', move: '移動中', idle: '待機中' };

// 行動の種類。kind は姿勢、status は表示の区分、label は「現在の行動」の文
export const ACTS = {
  match: { kind: 'stand', status: 'work', label: '練習試合に参加している' },
  idle: { kind: 'stand', status: 'idle', label: '待機している' },
  look: { kind: 'stand', status: 'work', label: '掲示物を確認している' },
  pc: { kind: 'sit', sit: 'type', status: 'work', label: 'PCで作業している' },
  read: { kind: 'sit', sit: 'read', status: 'work', label: '書類を確認している' },
  meet: { kind: 'sit', sit: 'meet', status: 'talk', label: '会議に参加している' },
  observe: { kind: 'sit', sit: 'observe', status: 'work', label: 'ベンチから練習を見ている' },
  card: { kind: 'sit', sit: 'read', status: 'work', label: '起用表（メンバー表）を確認している' },
  eat: { kind: 'sit', sit: 'eat', status: 'rest', label: '食事をしている' },
  sitrest: { kind: 'sit', sit: 'drink', status: 'rest', label: '水分補給して休憩している' },
  sitidle: { kind: 'sit', sit: 'idle', status: 'rest', label: '座って休んでいる' },
  tie: { kind: 'sit', sit: 'tie', status: 'work', label: 'スパイクのひもを結んでいる' },
  record: { kind: 'sit', sit: 'type', status: 'work', label: '選手の状態を記録している' },
  clip: { kind: 'clip', status: 'work', label: '打撃フォームを確認している' },
  penwatch: { kind: 'clip', status: 'work', label: '投球フォームを確認している' },
  bat: { kind: 'bat', drill: 'cage', status: 'work', label: '打撃ケージでフリー打撃をしている' },
  swing: { kind: 'bat', drill: 'dry', status: 'work', label: '素振りをしている' },
  demo: { kind: 'bat', drill: 'dry', status: 'work', label: 'スイングの手本を見せている', slow: true },
  pitch: { kind: 'pitch', drill: 'pen', status: 'work', label: 'ブルペンで投球練習をしている' },
  catch: { kind: 'catcher', drill: 'pen', status: 'work', label: 'ブルペンで投球を受けている' },
  knock: { kind: 'knock', drill: 'knock', status: 'work', label: '内野ノックを打っている' },
  field: { kind: 'field', drill: 'knock', status: 'work', label: 'ノックを受けている' },
  firstbase: { kind: 'firstbase', drill: 'knock', status: 'work', label: '一塁で送球を受けている' },
  catchball: { kind: 'throw', drill: 'catchball', status: 'work', label: 'キャッチボールをしている' },
  run: { kind: 'run', drill: 'run', status: 'work', label: 'ダッシュ走をしている' },
  jog: { kind: 'run', drill: 'run', status: 'work', label: '軽めのジョグで調整している', slow: true },
  stretch: { kind: 'stretch', status: 'work', label: 'ストレッチをしている' },
  treat: { kind: 'treat', status: 'work', label: '選手のケアをしている' },
  lie: { kind: 'lie', status: 'rest', label: 'ベッドで横になっている' },
  cook: { kind: 'cook', status: 'work', label: '昼食を調理している' },
  talk: { kind: 'talk', status: 'talk', label: '話している' },
  point: { kind: 'point', status: 'work', label: 'モニターを見ながら分析している' },
  print: { kind: 'stand', status: 'work', label: '資料を印刷している' }
};

// 決定的な乱数（同じ種なら同じ一日になる）
function rng(seed) { const st = { s: seed >>> 0 }; const f = () => { st.s = (st.s + 0x6D2B79F5) >>> 0; let t = st.s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; f.state = st; return f; }

const WALK = 38, RUN = 82;

export class Club {
  constructor({ seed = 21, rate = CLOCK_RATE, startMinute = START_MIN } = {}) {
    this.rand = rng(seed);
    this.t = 0; // 動作の経過秒（描画のアニメーション・移動の速さに使う）
    this.gm = startMinute; // ゲーム内の時計（1日目 00:00 からの分）
    this.rate = rate; // 動作1秒あたりに進むゲーム内の分
    this.people = new Map();
    this.balls = []; this.effects = []; this.events = []; this.listeners = new Set();
    this.drills = {}; this.flags = {}; this.lineup = null; this.story = { steps: [], done: new Set() };
    this.seq = 0;
    for (const c of CAST) {
      this.people.set(c.id, {
        ...c, x: 0, y: 0, tx: 0, ty: 0, dir: 'down', path: [], moving: false, gait: 'walk', stepDist: 0,
        at: null, activity: 'idle', act: { kind: 'stand', ph: '', f: 0 }, phase: this.rand() * 10,
        queue: [], cur: null, bubble: null, icon: null, hop: 0, reason: null, form: 0.5, hold: null, ox: 0, oy: 0, controlled: false, away: false, sleeping: false
      });
    }
  }
  get minutes() { return this.gm; }
  get clock() { return clockText(this.minutes); }
  get day() { return 1 + Math.floor((this.minutes + 1e-6) / 1440); }
  person(id) { return this.people.get(id); }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, data) { for (const fn of this.listeners) fn(type, data); }
  r(a, b) { return a + (b - a) * this.rand(); }

  // ── 外部（デモ台本／将来のAI）からの入口
  intend(id, ...intents) { const p = this.person(id); p.queue.push(...intents.flat()); return this; }
  replace(id, ...intents) { const p = this.person(id); p.queue = intents.flat(); p.cur = null; return this; }
  place(id, spotId, activity = 'idle') { // 初期配置（瞬間移動）
    const p = this.person(id), s = SPOTS[spotId], a = spotAnchor(s);
    Object.assign(p, { x: a.x, y: a.y, tx: s.x, ty: s.y, at: spotId, dir: s.dir, path: [], moving: false });
    this.setActivity(p, activity);
  }
  event(text, { who = [], spot = null, kind = 'info', step = null, ...extra } = {}) {
    const e = { id: ++this.seq, minutes: this.minutes, day: this.day, time: this.clock, text, who, spot, kind, step, ...extra };
    this.events.push(e); if (this.events.length > (this.maxEvents || 60)) this.events.shift();
    if (step) this.story.done.add(step);
    this.emit('event', e); return e;
  }
  setReason(id, text) { const p = this.person(id); p.reason = { text, time: this.clock }; this.emit('reason', { id }); }
  say(id, text, secs = 3) { const p = this.person(id); p.bubble = { text, until: this.t + secs, t0: this.t }; }

  // 経過中かどうかの問い合わせ（台本の待ち条件用）
  busy(id) { const p = this.person(id); return p.moving || !!p.cur || p.queue.length > 0; }
  isAt(id, spotId) { const p = this.person(id); return p.at === spotId && !p.moving; }

  setActivity(p, name) {
    p.activity = name; const A = ACTS[name] || ACTS.idle;
    p.act = { kind: A.kind, sit: A.sit, ph: '', f: 0, t0: this.t };
    p.ox = 0; p.oy = 0;
  }

  // ── 1ステップ進める（dt秒）
  step(dt) {
    if (dt <= 0) return;
    this.t += dt; this.gm += dt * this.rate;
    for (const p of this.people.values()) this.updatePerson(p, dt);
    this.updateDrills(dt);
    this.updateBalls(dt);
    this.effects = this.effects.filter(e => this.t - e.t0 < e.dur);
    if (this.director) this.director.update(this, dt);
  }

  updatePerson(p, dt) {
    if (p.bubble && this.t > p.bubble.until) p.bubble = null;
    if (p.icon && this.t > p.icon.until) p.icon = null;
    if (p.hop > 0) p.hop = Math.max(0, p.hop - dt);
    // 意図を順に実行
    let guard = 0;
    while (guard++ < 20) {
      if (!p.cur) { if (!p.queue.length) break; p.cur = p.queue.shift(); p.cur.t0 = this.t; if (!this.startIntent(p, p.cur)) { p.cur = null; continue; } }
      if (this.runIntent(p, p.cur, dt)) { p.cur = null; continue; }
      break;
    }
    if (p.moving) this.move(p, dt);
    this.animate(p, dt);
  }

  startIntent(p, it) {
    if (it.reason) this.setReason(p.id, it.reason);
    switch (it.do) {
      case 'goto': {
        const s = SPOTS[it.spot];
        if (!s) return false;
        if (p.at === it.spot && !p.moving) { this.arrive(p, it); return false; }
        const path = findPath(p.tx, p.ty, s.x, s.y);
        if (!path) return false;
        p.path = path.map(([x, y]) => ({ x, y })); p.moving = true; p.gait = it.gait || 'walk'; p.hold = it.hold || null; p.at = null; p.goal = it; p.doingText = null;
        p.act = { kind: 'walk', ph: '', f: 0, t0: this.t };
        return true;
      }
      case 'act': this.setActivity(p, it.activity); p.doingText = it.label || null; if (it.dir) p.dir = it.dir; return true;
      case 'say': this.say(p.id, it.text, it.for || 3); if (it.face) this.face(p, it.face); return true;
      case 'think': p.icon = { kind: 'think', until: this.t + (it.for || 3) }; return true;
      case 'emote': p.icon = { kind: it.icon, until: this.t + (it.for || 1.6) }; if (it.icon === 'joy') p.hop = 0.7; return true;
      case 'face': this.face(p, it.to); return false;
      case 'wait': return true;
      case 'call': it.fn(this, p); return false;
      case 'reason': return false;
      default: return false;
    }
  }
  runIntent(p, it, dt) {
    void dt;
    switch (it.do) {
      case 'goto': return !p.moving;
      case 'act': return it.for == null || this.t - it.t0 >= it.for;
      case 'say': return this.t - it.t0 >= (it.for || 3) + (it.gap ?? 0.35);
      case 'think': return this.t - it.t0 >= (it.for || 3);
      case 'emote': return this.t - it.t0 >= (it.for || 1.6);
      case 'wait': return it.until ? it.until(this) : this.t - it.t0 >= (it.for || 1);
      default: return true;
    }
  }
  face(p, to) {
    if (['up', 'down', 'left', 'right'].includes(to)) { p.dir = to; return; }
    const q = this.person(to); if (!q) return;
    const dx = q.x - p.x, dy = q.y - p.y;
    p.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  }

  move(p, dt) {
    const speed = (p.gait === 'run' ? RUN : WALK) * dt;
    let left = speed;
    while (left > 0 && p.moving) {
      const last = p.path.length === 1, n = p.path[0];
      const tgt = last && p.goal ? spotAnchor(SPOTS[p.goal.spot]) : tileCenter(n.x, n.y);
      const dx = tgt.x - p.x, dy = tgt.y - p.y, d = Math.hypot(dx, dy);
      if (d > 0.01) p.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      if (d <= left) {
        p.x = tgt.x; p.y = tgt.y; left -= d; p.stepDist += d; p.tx = n.x; p.ty = n.y; p.path.shift();
        if (!p.path.length) { p.moving = false; this.arrive(p, p.goal); }
      } else { p.x += dx / d * left; p.y += dy / d * left; p.stepDist += left; left = 0; }
    }
  }
  arrive(p, it) {
    const s = SPOTS[it.spot];
    p.at = it.spot; p.dir = it.dir || s.dir; p.hold = it.keepHold ? p.hold : null; p.doingText = null;
    this.setActivity(p, it.then || (s.pose === 'sit' ? 'sitidle' : s.pose === 'lie' ? 'lie' : 'idle'));
    this.emit('arrive', { id: p.id, spot: it.spot });
  }

  // 姿勢の細かい動き（フレーム）
  animate(p, dt) {
    const a = p.act, A = ACTS[p.activity] || ACTS.idle, t = this.t + p.phase;
    if (p.moving) { a.kind = p.gait === 'run' ? 'run' : 'walk'; a.f = Math.floor(p.stepDist / (p.gait === 'run' ? 7 : 5)) % 4; return; }
    if (A.drill && this.drills[A.drill]?.has(p.id)) return; // 練習の段取りが姿勢を決める
    switch (p.activity) {
      case 'pc': case 'record': { const burst = (t % 7) < 5; a.f = burst ? Math.floor(t / 0.16) % 2 : 0; a.ph = burst ? 'type' : 'look'; break; }
      case 'read': case 'card': a.f = Math.floor(t / 3.2) % 2; break;
      case 'meet': a.f = Math.floor(t / 0.45) % 2; break;
      case 'eat': a.f = (t % 2.4) < 0.7 ? 1 : 0; break;
      case 'sitrest': a.f = (t % 6) < 1.4 ? 1 : 0; break;
      case 'observe': a.f = Math.floor(t / 0.5) % 8; break;
      case 'tie': a.f = Math.floor(t / 0.35) % 2; break;
      case 'clip': case 'penwatch': a.ph = (t % 9) < 2.5 ? 'write' : ''; a.f = Math.floor(t / 0.3) % 2; break;
      case 'stretch': a.f = Math.floor(t / 1.2) % 4; break;
      case 'treat': a.f = Math.floor(t / 0.5) % 2; break;
      case 'cook': a.f = Math.floor(t / 0.25) % 4; break;
      case 'talk': a.f = Math.floor(t / 0.5) % 2; break;
      case 'point': a.f = Math.floor(t / 1.4) % 2; break;
      case 'swing': case 'demo': this.dryswing(p, t, A.slow ? 1.6 : 1); break;
      case 'bat': case 'pitch': case 'catch': case 'knock': case 'field': case 'firstbase': case 'catchball': if (!this.drills[A.drill]?.has(p.id)) { a.kind = A.kind; a.ph = ''; } break;
      case 'run': case 'jog': this.runLap(p, dt, !!A.slow); break;
      default: a.f = Math.floor(t / 1.6) % 2;
    }
    void dt;
  }
  dryswing(p, t, slow) {
    const c = (t / slow) % 2.4, a = p.act; a.kind = 'bat';
    a.ph = c < 1.0 ? 'stance' : c < 1.3 ? 'load' : c < 1.42 ? 'swing' : c < 1.9 ? 'follow' : 'stance'; a.f = Math.floor(t / 0.5) % 2;
  }
  // 走路をダッシュで往復。端で息を整える
  runLap(p, dt, slow) {
    const a = p.act, w = spotAnchor(SPOTS['track-w']), e = spotAnchor(SPOTS['track-e']);
    a.lap ??= { to: 'e', rest: 0 };
    if (a.lap.rest > 0) { a.lap.rest -= dt; a.kind = 'breathe'; a.f = Math.floor((this.t + p.phase) / 0.4) % 2; p.dir = a.lap.to === 'e' ? 'right' : 'left'; return; }
    const tgt = a.lap.to === 'e' ? e : w, dx = tgt.x - p.x, sp = (slow ? 44 : RUN) * dt;
    p.y += Math.sign(tgt.y - p.y) * Math.min(Math.abs(tgt.y - p.y), sp);
    if (Math.abs(dx) <= sp) { p.x = tgt.x; a.lap.to = a.lap.to === 'e' ? 'w' : 'e'; a.lap.rest = slow ? 0.8 : this.r(1.4, 2.6); }
    else { p.x += Math.sign(dx) * sp; p.stepDist += sp; }
    p.dir = dx > 0 ? 'right' : 'left'; a.kind = slow ? 'walk' : 'run'; a.f = Math.floor(p.stepDist / (slow ? 5 : 7)) % 4;
    p.tx = Math.floor(p.x / T); p.ty = Math.floor(p.y / T);
  }

  // ── 練習の段取り（ボールの受け渡し）
  ready(id, activity, spot) { const p = this.person(id); return p && p.activity === activity && !p.moving && (!spot || p.at === spot); }
  updateDrills(dt) {
    const d = this.drills;
    d.cage = new Set(); d.pen = new Set(); d.knock = new Set(); d.catchball = new Set();
    const batter = [...this.people.values()].find(p => p.activity === 'bat' && p.at === 'cage-bat' && !p.moving);
    if (batter) { d.cage.add(batter.id); this.cageDrill(batter, dt); }
    const pitcher = [...this.people.values()].find(p => p.activity === 'pitch' && p.at === 'mound' && !p.moving);
    const catcher = [...this.people.values()].find(p => p.activity === 'catch' && p.at === 'plate' && !p.moving);
    if (pitcher && catcher) { d.pen.add(pitcher.id); d.pen.add(catcher.id); this.penDrill(pitcher, catcher, dt); }
    const coach = [...this.people.values()].find(p => p.activity === 'knock' && p.at === 'knock' && !p.moving);
    const fielders = [...this.people.values()].filter(p => p.activity === 'field' && (p.at === 'short' || p.at === 'second') && !p.moving);
    const first = [...this.people.values()].find(p => p.activity === 'firstbase' && p.at === 'first' && !p.moving);
    if (coach && fielders.length) { [coach, first, ...fielders].forEach(p => p && d.knock.add(p.id)); this.knockDrill(coach, fielders, first, dt); }
    const a = [...this.people.values()].find(p => p.activity === 'catchball' && p.at === 'catch-a' && !p.moving);
    const b = [...this.people.values()].find(p => p.activity === 'catchball' && p.at === 'catch-b' && !p.moving);
    if (a && b) { d.catchball.add(a.id); d.catchball.add(b.id); this.catchDrill(a, b, dt); }
  }
  cycle(key, len, dt) { const s = (this.cyc ??= {}); s[key] ??= { c: 0, n: 0 }; const o = s[key]; const prev = o.c; o.c += dt; let wrapped = false; if (o.c >= len) { o.c -= len; o.n++; wrapped = true; } return { c: o.c, prev: wrapped ? -1 : prev, n: o.n }; }
  crossed(cy, at) { return cy.prev < at && cy.c >= at; }
  throwBall(o) { const b = { t0: this.t, arc: 0, h0: 8, h1: 8, ...o }; this.balls.push(b); return b; }
  fx(kind, x, y, dur = 0.4) { this.effects.push({ kind, x, y, t0: this.t, dur }); }

  cageDrill(p, dt) {
    const cy = this.cycle('cage', 3.0, dt), c = cy.c, a = p.act;
    a.kind = 'bat'; a.f = Math.floor((this.t + p.phase) / 0.5) % 2;
    a.ph = c < 1.1 ? 'stance' : c < 1.45 ? 'load' : c < 1.58 ? 'swing' : c < 2.15 ? 'follow' : 'stance';
    const plate = spotAnchor(SPOTS['cage-bat']), mx = 27 * T + 4, my = 15 * T + 6;
    if (this.crossed(cy, 0.95)) this.throwBall({ x0: mx, y0: my, x1: plate.x + 10, y1: plate.y - 2, h0: 9, h1: 9, dur: 0.55, kind: 'pitch' });
    if (this.crossed(cy, 1.5)) {
      const good = this.rand() < p.form, sharp = good && this.rand() < p.form * 0.8;
      const tx = good ? this.r(25.5, 28.5) * T : this.r(18.6, 19.0) * T, ty = good ? this.r(13.8, 16.4) * T : this.r(14.2, 16.6) * T;
      if (good) this.fx(sharp ? 'spark' : 'hit', plate.x + 12, plate.y - 12, 0.35);
      this.throwBall({ x0: plate.x + 10, y0: plate.y - 2, x1: tx, y1: ty, h0: 9, h1: good ? 14 : 6, arc: good ? (sharp ? 4 : 16) : 2, dur: good ? (sharp ? 0.35 : 0.6) : 0.25, kind: 'hit' });
      this.lastHit = { id: p.id, good, sharp, t: this.t };
      this.hits = (this.hits || []).concat({ id: p.id, sharp, good }).slice(-30);
      this.emit('hit', this.lastHit);
    }
  }
  penDrill(pi, ca, dt) {
    const cy = this.cycle('pen', 4.4, dt), c = cy.c;
    pi.act.kind = 'pitch'; ca.act.kind = 'catcher';
    pi.act.ph = c < 1.0 ? 'set' : c < 1.45 ? 'lift' : c < 1.65 ? 'stride' : c < 1.8 ? 'release' : c < 2.3 ? 'follow' : c > 3.25 && c < 3.75 ? 'catchback' : 'set';
    ca.act.ph = c > 2.05 && c < 2.4 ? 'catch' : c > 2.75 && c < 3.05 ? 'throw' : 'ready';
    const m = spotAnchor(SPOTS.mound), pl = spotAnchor(SPOTS.plate);
    if (this.crossed(cy, 1.7)) { this.throwBall({ x0: m.x + 8, y0: m.y - 1, x1: pl.x - 6, y1: pl.y - 1, h0: 15, h1: 9, dur: 0.35, kind: 'pitch' }); }
    if (this.crossed(cy, 2.05)) { this.fx('pop', pl.x - 6, pl.y - 10, 0.3); this.pitches = (this.pitches || 0) + 1; }
    if (this.crossed(cy, 2.85)) this.throwBall({ x0: pl.x - 4, y0: pl.y - 1, x1: m.x + 5, y1: m.y - 1, h0: 12, h1: 13, arc: 12, dur: 0.6, kind: 'lob' });
  }
  knockDrill(co, fielders, fb, dt) {
    const cy = this.cycle('knock', 5.2, dt), c = cy.c, f = fielders[cy.n % fielders.length];
    co.act.kind = 'knock'; if (fb) fb.act.kind = 'firstbase';
    co.act.ph = c < 0.6 ? 'ready' : c < 1.0 ? 'toss' : c < 1.15 ? 'swing' : c < 1.6 ? 'follow' : 'ready';
    const home = spotAnchor(SPOTS.knock), fs = spotAnchor(SPOTS[f.at]), first = spotAnchor(SPOTS.first);
    this.knockOff ??= 0;
    for (const o of fielders) { o.act.kind = 'field'; if (o !== f) { o.act.ph = 'ready'; o.ox = 0; } }
    const off = this.knockOff;
    if (c < 1.1) { f.act.ph = 'ready'; }
    else if (c < 1.9) { f.act.ph = 'shuffle'; f.ox = off * Math.min(1, (c - 1.1) / 0.6); f.act.f = Math.floor(c / 0.15) % 2; }
    else if (c < 2.25) { f.act.ph = 'scoop'; f.ox = off; }
    else if (c < 2.45) { f.act.ph = 'wind'; }
    else if (c < 2.6) { f.act.ph = 'throw'; }
    else if (c < 2.9) { f.act.ph = 'follow'; }
    else { f.act.ph = 'ready'; f.ox = off * Math.max(0, 1 - (c - 2.9) / 0.7); }
    if (fb) fb.act.ph = c > 2.85 && c < 3.35 ? 'stretch' : c > 3.6 && c < 3.85 ? 'flip' : 'ready';
    if (this.crossed(cy, 1.08)) {
      this.knockOff = Math.round(this.r(-10, 10));
      this.fx('hit', home.x + 12, home.y - 8, 0.25);
      this.throwBall({ x0: home.x + 12, y0: home.y - 4, x1: fs.x - 8 + this.knockOff, y1: fs.y - 1, h0: 6, h1: 3, dur: 0.85, kind: 'grounder' });
    }
    if (this.crossed(cy, 2.5)) this.throwBall({ x0: fs.x - 6 + off, y0: fs.y - 1, x1: first.x + 6, y1: first.y - 1, h0: 12, h1: 11, arc: 6, dur: 0.45, kind: 'throw' });
    if (fb && this.crossed(cy, 3.0)) this.fx('pop', first.x + 6, first.y - 12, 0.25);
    if (fb && this.crossed(cy, 3.7)) this.throwBall({ x0: first.x, y0: first.y - 1, x1: home.x - 6, y1: home.y + 14, h0: 8, h1: 2, arc: 10, dur: 0.7, kind: 'lob' });
  }
  catchDrill(a, b, dt) {
    const cy = this.cycle('catchball', 3.2, dt), c = cy.c;
    a.act.kind = b.act.kind = 'throw';
    const A = spotAnchor(SPOTS['catch-a']), B = spotAnchor(SPOTS['catch-b']);
    a.act.ph = c < 0.25 ? 'wind' : c < 0.4 ? 'throw' : c < 0.7 ? 'follow' : c > 2.45 && c < 2.85 ? 'catch' : 'ready';
    b.act.ph = c > 0.95 && c < 1.35 ? 'catch' : c > 1.55 && c < 1.8 ? 'wind' : c > 1.8 && c < 1.95 ? 'throw' : c > 1.95 && c < 2.25 ? 'follow' : 'ready';
    if (this.crossed(cy, 0.32)) this.throwBall({ x0: A.x + 6, y0: A.y - 1, x1: B.x - 5, y1: B.y - 1, h0: 15, h1: 16, arc: 14, dur: 0.75, kind: 'throw' });
    if (this.crossed(cy, 1.88)) this.throwBall({ x0: B.x - 6, y0: B.y - 1, x1: A.x + 5, y1: A.y - 1, h0: 15, h1: 16, arc: 14, dur: 0.75, kind: 'throw' });
  }
  updateBalls() {
    for (const b of this.balls) {
      const p = Math.min(1, (this.t - b.t0) / b.dur);
      b.x = b.x0 + (b.x1 - b.x0) * p; b.y = b.y0 + (b.y1 - b.y0) * p;
      b.h = b.h0 + (b.h1 - b.h0) * p + b.arc * 4 * p * (1 - p);
      if (b.kind === 'grounder') b.h = Math.abs(Math.sin(p * Math.PI * 3)) * 4 * (1 - p) + 1;
      b.done = p >= 1;
    }
    this.balls = this.balls.filter(b => !b.done || this.t - b.t0 < b.dur + 0.05);
  }

  // ── 表示用の問い合わせ
  status(p) {
    if (p.bubble) return 'talk';
    if (p.icon?.kind === 'think') return 'think';
    if (p.moving) return 'move';
    return (ACTS[p.activity] || ACTS.idle).status;
  }
  doing(p) {
    if (p.moving) return `${SPOTS[p.goal?.spot]?.label || '目的地'}へ向かっている`;
    return p.doingText || (ACTS[p.activity] || ACTS.idle).label;
  }
  place_(p) { const r = roomAt(p.tx, p.ty); return r ? r.name : '屋外'; }
  outdoors(p) { return isOutdoor(p.tx, p.ty); }

  // AIへ渡す想定の要約（人物の状態と直近の出来事）
  snapshot() {
    return {
      clock: this.clock,
      people: [...this.people.values()].map(p => ({ id: p.id, name: p.name, role: p.roleLabel, place: this.place_(p), activity: p.activity, status: STATUS[this.status(p)], doing: this.doing(p), reason: p.reason?.text || null })),
      events: this.events.slice(-10).map(e => ({ time: e.time, text: e.text }))
    };
  }
}
