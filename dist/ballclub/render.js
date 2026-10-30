// 描画。Club の状態を読むだけで、状態は変えない
import { T, W, H, SPOTS, FURNITURE, ROOMS, roomAt } from './world.js';
import { drawBackground, furnitureDrawables, lineupGeometry } from './furniture.js';
import { figure, outlineOf, AX, AY } from './sprites.js';
import { canvas } from './pixel.js';
import { STATUS } from './sim.js';

const WW = W * T, WH = H * T;
const FONT = "'Noto Sans JP', 'Hiragino Sans', system-ui, sans-serif";
const deskZ = id => { const f = FURNITURE.find(o => o.id === id); return f ? (f.y + f.h) * T + 0.3 : 0; };
const ROOM_LABELS = [
  { name: '監督・編成室', x: 1.2, y: 3.15 }, { name: '分析室', x: 18.2, y: 3.15 }, { name: '食堂', x: 36.2, y: 3.15 },
  { name: 'ロッカー', x: 34.2, y: 15.15 }, { name: 'ケアルーム', x: 34.2, y: 23.15 }, { name: '練習グラウンド', x: 9.2, y: 13.1 },
  { name: '選手寮', x: 47.2, y: 3.15 }, { name: '通用口', x: 54.6, y: 11.3 }
];
const ZONE_LABELS = [
  { name: '打撃ケージ', x: 23, y: 12.2 }, { name: 'ブルペン', x: 23, y: 22.1 }, { name: '内野ノック', x: 8.5, y: 26.7 }, { name: '走路', x: 16, y: 29.4 }, { name: 'キャッチボール', x: 19.5, y: 19.0 }
];
// 時間帯の暗さ（0＝昼〜0.46＝夜）。夜でも人物と操作対象が見える上限にしている
export function darkness(mod) {
  const k = mod < 300 ? 1 : mod < 420 ? 1 - (mod - 300) / 120 : mod < 1020 ? 0 : mod < 1170 ? (mod - 1020) / 150 : 1;
  return 0.46 * k * k * (3 - 2 * k);
}
export const STATUS_COLOR = { talk: '#e9b35a', think: '#b9a4e6', work: '#79c49a', rest: '#7fb6e0', move: '#a9b1ad', idle: '#a9b1ad' };

export class Renderer {
  constructor(cv, club) {
    this.cv = cv; this.ctx = cv.getContext('2d'); this.club = club;
    this.world = canvas(WW, WH); this.w = this.world.getContext('2d');
    this.bg = canvas(WW, WH); drawBackground(this.bg.getContext('2d'));
    this.cam = { z: 2, x: WW / 2, y: WH / 2, base: 2, follow: null };
    this.selected = null; this.hovered = null; this.showNames = false; this.dpr = 1;
    this.resize();
  }
  setClub(club) { this.club = club; }
  resize() {
    const r = this.cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    this.dpr = dpr; this.cv.width = Math.max(1, Math.round(r.width * dpr)); this.cv.height = Math.max(1, Math.round(r.height * dpr));
    const fit = Math.min(this.cv.width / WW, this.cv.height / WH);
    const base = fit >= 2 ? Math.floor(fit) : fit;
    const wasBase = this.cam.z === this.cam.base;
    this.cam.base = base; if (wasBase || this.cam.z < base) this.cam.z = base;
    this.clamp();
  }
  levels() { const out = [this.cam.base]; for (let z = Math.floor(this.cam.base) + 1; z <= Math.max(8, this.cam.base * 4); z++) out.push(z); return out; }
  zoomBy(step, sx, sy) {
    const L = this.levels(), i = L.findIndex(z => Math.abs(z - this.cam.z) < 1e-6), j = Math.max(0, Math.min(L.length - 1, (i < 0 ? 0 : i) + step));
    const z = L[j];
    if (sx != null) { const before = this.toWorld(sx, sy); this.cam.z = z; const after = this.toWorld(sx, sy); this.cam.x += before.x - after.x; this.cam.y += before.y - after.y; }
    else this.cam.z = z;
    this.clamp();
  }
  fit() { this.cam.z = this.cam.base; this.cam.follow = null; this.clamp(); }
  get atFit() { return Math.abs(this.cam.z - this.cam.base) < 1e-6; }
  focus(x, y, zoomIn = true) { if (zoomIn && this.atFit) this.cam.z = this.levels()[Math.min(2, this.levels().length - 1)]; this.cam.x = x; this.cam.y = y; this.clamp(); }
  pan(dx, dy) { this.cam.x -= dx * this.dpr / this.cam.z; this.cam.y -= dy * this.dpr / this.cam.z; this.cam.follow = null; this.clamp(); }
  clamp() {
    const z = this.cam.z, vw = this.cv.width / z, vh = this.cv.height / z;
    this.cam.x = vw >= WW ? WW / 2 : Math.max(vw / 2, Math.min(WW - vw / 2, this.cam.x));
    this.cam.y = vh >= WH ? WH / 2 : Math.max(vh / 2, Math.min(WH - vh / 2, this.cam.y));
  }
  origin() { const z = this.cam.z; return { ox: Math.round(this.cv.width / 2 - this.cam.x * z), oy: Math.round(this.cv.height / 2 - this.cam.y * z), z }; }
  toWorld(cssX, cssY) { const { ox, oy, z } = this.origin(); return { x: (cssX * this.dpr - ox) / z, y: (cssY * this.dpr - oy) / z }; }
  toScreen(wx, wy) { const { ox, oy, z } = this.origin(); return { x: (ox + wx * z) / this.dpr, y: (oy + wy * z) / this.dpr }; }

  // 人物の当たり判定（上に描かれている人を優先）
  pick(cssX, cssY) {
    const p = this.toWorld(cssX, cssY); let best = null, bz = -1;
    for (const q of this.club.people.values()) {
      if (q.away) continue;
      const sit = q.act.kind === 'sit', lie = q.act.kind === 'lie';
      const x0 = q.x + q.ox - 7, x1 = q.x + q.ox + 7, y0 = q.y - (lie ? 26 : sit ? 20 : 28), y1 = q.y + (sit ? 4 : 2);
      if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && q.y > bz) { best = q.id; bz = q.y; }
    }
    return best;
  }

  // ── 人物 1人分の見た目の状態
  spriteState(p) {
    const c = this.club, a = p.act, sp = p.at ? SPOTS[p.at] : null, t = c.t + p.phase;
    let kind = a.kind, dir = p.dir, act = a.sit;
    const outdoors = c.outdoors(p);
    let wear = p.look.headwear || (p.look.cap && outdoors ? 'cap' : null);
    if (kind === 'bat' && p.activity === 'bat') wear = 'helmet';
    if (kind === 'catcher') wear = 'mask';
    if (kind === 'walk' && p.gait === 'run') kind = 'run';
    if (kind === 'sit' && sp) dir = sp.dir;
    const speaking = !!p.bubble, mouth = speaking && Math.floor(c.t / 0.13) % 2 === 0;
    const thinking = p.icon?.kind === 'think';
    if (thinking && !p.moving) { if (kind === 'sit') act = 'think'; else if (['stand', 'talk', 'clip'].includes(kind)) kind = 'think'; }
    if (speaking && kind === 'stand') kind = 'talk';
    if (p.activity === 'meet' && kind === 'sit') act = 'meet';
    let eyes = null; if ((t * 1.3) % 4.6 < 0.14) eyes = 'blink';
    let nod = false;
    if (kind === 'sit' && act === 'meet' && !speaking) { const s = (t / 1.9) % 3; nod = s < 0.35 && this.someoneSpeaking(p); }
    const f = kind === 'stand' ? (Math.floor(t / 1.4) % 2) : a.f;
    return { kind, dir, f, ph: a.ph, act, hold: p.hold, wear, mouth: mouth || (speaking && kind !== 'sit' && kind !== 'talk' ? false : mouth), eyes, nod, desk: kind === 'sit' && !!sp?.desk };
  }
  someoneSpeaking(p) { for (const q of this.club.people.values()) if (q !== p && q.bubble && q.activity === 'meet') return true; return false; }

  furnitureView() {
    const c = this.club, view = { t: c.t, minutes: c.minutes, clock: c.clock, meeting: !!c.flags.meeting, trays: {}, beds: {} };
    for (const p of c.people.values()) if (!p.away && !p.moving && p.activity === 'lie' && /^dorm-\d+$/.test(p.at || '')) view.beds[Number(p.at.slice(5))] = true;
    for (const p of c.people.values()) if (p.activity === 'eat' && p.at && SPOTS[p.at]) {
      const s = SPOTS[p.at], tid = s.desk || ('cafe-table-' + p.at.split('-')[1]);
      (view.trays[tid] ??= []).push(s);
    }
    // 起用表の磁石（決定の瞬間はスライドさせる）
    const lb = FURNITURE.find(f => f.id === 'lineup-board'), G = lineupGeometry(lb.x * T, lb.y * T);
    const posOf = m => m.slot != null ? G.slot(m.slot) : G.bench(m.bench ?? 0);
    view.lineup = (c.lineup || []).map(m => {
      const to = posOf(m), k = Math.min(1, Math.max(0, (c.t - m.t0) / 1.4)), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      if (m.from && k < 1) { const fr = posOf(m.from); return { color: m.color, hi: m.hi, x: fr.x + (to.x - fr.x) * e, y: fr.y + (to.y - fr.y) * e - Math.sin(k * Math.PI) * 4 }; }
      return { color: m.color, hi: m.hi && c.t - m.t0 < 40, x: to.x, y: to.y };
    });
    return view;
  }

  // ── 1フレーム描画
  draw() {
    const c = this.club, w = this.w;
    if (this.cam.follow) { const p = c.person(this.cam.follow); if (p) { this.cam.x += (p.x - this.cam.x) * 0.12; this.cam.y += (p.y - 12 - this.cam.y) * 0.12; this.clamp(); } }
    w.drawImage(this.bg, 0, 0);
    const list = furnitureDrawables(this.furnitureView());
    for (const p of c.people.values()) if (!p.away) this.personDrawables(p, list);
    for (const b of c.balls) list.push({ zY: b.y + 0.4, draw: g => this.ball(g, b) });
    for (const e of c.effects) list.push({ zY: e.y + 30, draw: g => this.effect(g, e) });
    list.sort((a, b) => a.zY - b.zY);
    for (const d of list) d.draw(w);
    this.clouds(w);
    const dark = darkness(((c.minutes % 1440) + 1440) % 1440);
    if (dark > 0.004) this.lighting(w, dark);
    for (const p of c.people.values()) if (!p.away) this.icons(w, p);
    // 画面へ
    const ctx = this.ctx, { ox, oy, z } = this.origin();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#1b2124'; ctx.fillRect(0, 0, this.cv.width, this.cv.height);
    ctx.drawImage(this.world, ox, oy, WW * z, WH * z);
    this.overlays(ctx);
  }

  personDrawables(p, list) {
    const st = this.spriteState(p), spr = figure(p.look, st);
    const hop = p.hop > 0 ? Math.round(Math.sin((0.7 - p.hop) / 0.7 * Math.PI * 2) ** 2 * 3) : 0;
    const x = Math.round(p.x + p.ox), y = Math.round(p.y + p.oy) - hop, sit = st.kind === 'sit', lie = st.kind === 'lie';
    const sel = this.selected === p.id, hov = this.hovered === p.id && !sel;
    list.push({ zY: p.y + 0.5, draw: g => {
      if (!sit && !lie) { g.fillStyle = 'rgba(36,28,56,0.24)'; g.fillRect(x - 5, y - 1 + hop, 11, 2); g.fillRect(x - 4, y - 2 + hop, 9, 1); }
      if (sel || hov) { g.save(); g.globalAlpha = sel ? 1 : 0.55; g.drawImage(outlineOf(spr), x - AX, y - AY); g.restore(); }
      g.drawImage(spr.body, x - AX, y - AY);
      if (lie && !/^dorm-\d+$/.test(p.at || '')) { g.fillStyle = '#cfe3ea'; g.fillRect(x - 6, y - 9, 13, 8); g.fillStyle = '#e4f0f3'; g.fillRect(x - 6, y - 9, 13, 1); if (p.id === 'endo') { g.fillStyle = '#9fd3ea'; g.fillRect(x - 6, y - 15, 4, 3); } }
    } });
    if (spr.over && p.at && SPOTS[p.at]?.desk) list.push({ zY: deskZ(SPOTS[p.at].desk), draw: g => g.drawImage(spr.over, x - AX, y - AY) });
  }

  ball(g, b) {
    const x = Math.round(b.x), y = Math.round(b.y), h = Math.round(b.h);
    g.fillStyle = 'rgba(36,28,56,0.28)'; g.fillRect(x - 1, y, 3, 1);
    if (b.kind === 'pitch' || (b.kind === 'hit' && b.arc < 6)) { g.fillStyle = 'rgba(255,255,255,0.35)'; const dx = Math.sign(b.x1 - b.x0); g.fillRect(x - 3 * dx - 1, y - h - 1, 2, 1); }
    g.fillStyle = '#5a5464'; g.fillRect(x - 1, y - h - 2, 3, 3);
    g.fillStyle = '#fbfaf4'; g.fillRect(x - 1, y - h - 2, 2, 2);
  }
  effect(g, e) {
    const k = (this.club.t - e.t0) / e.dur, x = Math.round(e.x), y = Math.round(e.y);
    if (e.kind === 'hit' || e.kind === 'spark') {
      const r = 2 + Math.round(k * (e.kind === 'spark' ? 5 : 3)), c = e.kind === 'spark' ? '#ffd65a' : '#fffaf0';
      g.fillStyle = c; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) g.fillRect(x + Math.round(dx * r), y + Math.round(dy * r), 1, 1);
      if (k < 0.4) g.fillRect(x - 1, y - 1, 3, 3);
      if (e.kind === 'spark') { g.fillStyle = '#ffffff'; g.fillRect(x, y - 2, 1, 5); g.fillRect(x - 2, y, 5, 1); }
    } else if (e.kind === 'pop') {
      g.fillStyle = `rgba(255,250,240,${(1 - k).toFixed(2)})`; const r = 2 + Math.round(k * 3);
      g.fillRect(x - r, y, 1, 1); g.fillRect(x + r, y, 1, 1); g.fillRect(x, y - r, 1, 1); g.fillRect(x - r + 1, y - r + 1, 1, 1); g.fillRect(x + r - 1, y - r + 1, 1, 1);
    }
  }
  // 夜の暗さと室内の照明。人のいる（起きている）部屋は明かりがつき、寝静まった寮は常夜灯ていど。
  // 夕方以降に屋外で練習している人がいればグラウンドの照明をつける
  lighting(g, dark) {
    const lit = new Set(), occupied = new Set();
    for (const p of this.club.people.values()) {
      if (p.away) continue;
      const r = roomAt(Math.floor(p.x / T), Math.floor((p.y - 4) / T)); if (!r) continue;
      occupied.add(r.id); if (!p.sleeping) lit.add(r.id);
    }
    const alphaOf = r => r.indoor ? (lit.has(r.id) ? dark * 0.16 : occupied.has(r.id) ? dark * 0.72 : null) : r.id === 'field' && lit.has('field') ? dark * 0.5 : null;
    g.save(); g.beginPath(); g.rect(0, 0, WW, WH);
    const special = ROOMS.filter(r => alphaOf(r) != null);
    for (const r of special) g.rect(r.x * T, r.y * T, r.w * T, r.h * T);
    g.fillStyle = `rgba(14,20,52,${dark.toFixed(3)})`; g.fill('evenodd');
    for (const r of special) {
      g.fillStyle = `rgba(14,20,52,${alphaOf(r).toFixed(3)})`; g.fillRect(r.x * T, r.y * T, r.w * T, r.h * T);
      if (r.indoor && lit.has(r.id)) { g.fillStyle = `rgba(255,196,120,${(0.03 + dark * 0.12).toFixed(3)})`; g.fillRect(r.x * T, r.y * T, r.w * T, r.h * T); }
    }
    g.restore();
  }
  clouds(g) {
    const t = this.club.t;
    g.save(); g.beginPath(); g.rect(T, 13 * T, 30 * T, 16 * T); g.clip();
    g.fillStyle = 'rgba(30,40,60,0.07)';
    for (let i = 0; i < 2; i++) {
      const x = ((t * 3 + i * 380) % (WW + 300)) - 200, y = 14 * T + i * 120 + Math.sin(t * 0.05 + i) * 20;
      g.beginPath(); g.ellipse(x, y, 90, 34, 0, 0, Math.PI * 2); g.ellipse(x + 60, y + 14, 60, 26, 0, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }

  // 頭上の小さな表示（考え中・気づき・喜び・休憩・選択中）
  icons(g, p) {
    const sit = p.act.kind === 'sit', lie = p.act.kind === 'lie', x = Math.round(p.x + p.ox), top = Math.round(p.y) - (lie ? 22 : sit ? 20 : 28), t = this.club.t;
    const px = (dx, dy, w, h, c) => { g.fillStyle = c; g.fillRect(x + dx, top + dy, w, h); };
    if (p.icon?.kind === 'think') {
      px(2, -9, 11, 7, '#3a3442'); px(3, -10, 9, 9, '#3a3442'); px(3, -9, 9, 7, '#fbf8f0'); px(4, -10, 7, 1, '#fbf8f0');
      const n = Math.floor(t / 0.35) % 4; for (let i = 0; i < 3; i++) if (i < n) px(4 + i * 3, -6, 2, 2, '#6b5f80');
      px(1, -2, 2, 2, '#fbf8f0'); px(0, 0, 1, 1, '#fbf8f0');
    } else if (p.icon?.kind === 'notice') {
      const b = Math.floor(t * 8) % 2;
      px(-2, -11 - b, 5, 9, '#3a3442'); px(-1, -10 - b, 3, 7, '#ffd04a'); px(0, -9 - b, 1, 3, '#3a3442'); px(0, -5 - b, 1, 1, '#3a3442');
    } else if (p.icon?.kind === 'joy') {
      const s = Math.floor(t * 6) % 2;
      for (const [dx, dy] of [[-8, -4], [7, -6], [-5, -10], [5, -12]]) { const yy = dy - s; px(dx, yy, 1, 3, '#ffd04a'); px(dx - 1, yy + 1, 3, 1, '#ffd04a'); }
    } else if (p.sleeping) {
      const k = (t * 0.6 + p.phase) % 1; g.globalAlpha = 1 - k; px(6, -2 - Math.round(k * 6), 3, 1, '#ffffff'); px(7, -1 - Math.round(k * 6), 1, 1, '#ffffff'); px(6, 0 - Math.round(k * 6), 3, 1, '#ffffff'); g.globalAlpha = 1;
    }
    if (this.selected === p.id) {
      const b = Math.floor(t * 2.5) % 2, y0 = (p.icon && !lie ? -16 : -6) - b;
      px(-2, y0, 5, 1, '#3a3442'); px(-2, y0 - 1, 5, 1, '#ffd04a'); px(-1, y0 + 1, 3, 1, '#ffd04a'); px(0, y0 + 2, 1, 1, '#ffd04a'); px(-1, y0 + 2, 1, 1, '#3a3442'); px(1, y0 + 2, 1, 1, '#3a3442');
    }
  }

  // ── 画面解像度の文字（部屋名・名札・吹き出し）
  overlays(ctx) {
    const d = this.dpr, c = this.club, zc = this.cam.z / d;
    ctx.setTransform(d, 0, 0, d, 0, 0); ctx.textBaseline = 'middle';
    // 部屋名
    const small = zc < 1;
    ctx.font = `600 ${small ? 9 : zc < 1.6 ? 10 : 11}px ${FONT}`;
    for (const r of ROOM_LABELS) {
      const s = this.toScreen(r.x * T, r.y * T), tw = ctx.measureText(r.name).width, h = small ? 13 : 17;
      ctx.fillStyle = 'rgba(27,33,36,0.62)'; roundRect(ctx, s.x, s.y, tw + (small ? 6 : 10), h, 3); ctx.fill();
      ctx.fillStyle = '#f4efe2'; ctx.fillText(r.name, s.x + (small ? 3 : 5), s.y + h / 2 + 0.5);
    }
    if (zc >= 2.2) {
      ctx.font = `500 10px ${FONT}`;
      for (const r of ZONE_LABELS) { const s = this.toScreen(r.x * T, r.y * T), tw = ctx.measureText(r.name).width; ctx.fillStyle = 'rgba(255,250,240,0.78)'; roundRect(ctx, s.x - tw / 2 - 4, s.y - 7, tw + 8, 14, 3); ctx.fill(); ctx.fillStyle = '#3a3442'; ctx.fillText(r.name, s.x - tw / 2, s.y); }
    }
    // 名札
    const tags = [];
    for (const p of c.people.values()) {
      const show = this.showNames || p.id === this.selected || p.id === this.hovered;
      if (!show || p.away) continue;
      const s = this.toScreen(p.x + p.ox, p.y + (p.act.kind === 'sit' ? 6 : 3));
      tags.push({ p, s, strong: p.id === this.selected || p.id === this.hovered });
    }
    for (const { p, s, strong } of tags) {
      ctx.font = `${strong ? 700 : 600} ${strong ? 11 : 10}px ${FONT}`;
      const text = p.label, tw = ctx.measureText(text).width, h = strong ? 17 : 15, x0 = s.x - (tw + 18) / 2;
      ctx.fillStyle = strong ? 'rgba(255,250,240,0.96)' : 'rgba(255,250,240,0.82)'; roundRect(ctx, x0, s.y + 2, tw + 18, h, 4); ctx.fill();
      if (strong) { ctx.strokeStyle = '#3a3442'; ctx.lineWidth = 1; ctx.stroke(); }
      ctx.fillStyle = STATUS_COLOR[c.status(p)]; ctx.beginPath(); ctx.arc(x0 + 7, s.y + 2 + h / 2, 3, 0, 7); ctx.fill();
      ctx.fillStyle = '#2c2734'; ctx.fillText(text, x0 + 13, s.y + 2 + h / 2 + 0.5);
    }
    // 吹き出し（重ならないよう上へずらす）
    const bubbles = [];
    for (const p of c.people.values()) {
      if (!p.bubble || p.away) continue;
      const top = p.y - (p.act.kind === 'sit' ? 22 : 30) - (p.icon ? 10 : 0), s = this.toScreen(p.x + p.ox, top);
      ctx.font = `500 12px ${FONT}`;
      const lines = wrap(ctx, p.bubble.text, 168), name = p.label;
      const w = Math.max(...lines.map(l => ctx.measureText(l).width), (ctx.font = `700 10px ${FONT}`, ctx.measureText(name).width)) + 16, h = 18 + lines.length * 16;
      bubbles.push({ p, s, lines, name, w, h, x: s.x - w / 2, y: s.y - h - 8 });
    }
    bubbles.sort((a, b) => b.s.y - a.s.y);
    const placed = [];
    for (const b of bubbles) {
      b.x = Math.max(4, Math.min(this.cv.width / d - b.w - 4, b.x));
      for (let i = 0; i < 12; i++) { const hit = placed.find(o => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y); if (!hit) break; b.y = hit.y - b.h - 4; }
      b.y = Math.max(4, b.y); placed.push(b);
    }
    for (const b of placed) {
      const age = c.t - b.p.bubble.t0, a = Math.min(1, age / 0.15);
      ctx.globalAlpha = a;
      ctx.fillStyle = '#fffaf0'; ctx.strokeStyle = '#3a3442'; ctx.lineWidth = 1.5;
      roundRect(ctx, b.x, b.y, b.w, b.h, 6); ctx.fill(); ctx.stroke();
      const tx = Math.max(b.x + 10, Math.min(b.x + b.w - 10, b.s.x));
      ctx.beginPath(); ctx.moveTo(tx - 5, b.y + b.h - 0.5); ctx.lineTo(b.s.x, b.s.y - 2); ctx.lineTo(tx + 5, b.y + b.h - 0.5); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(tx - 5, b.y + b.h); ctx.lineTo(b.s.x, b.s.y - 2); ctx.lineTo(tx + 5, b.y + b.h); ctx.stroke();
      ctx.font = `700 10px ${FONT}`; ctx.fillStyle = '#4b7a62'; ctx.fillText(b.name, b.x + 8, b.y + 10);
      ctx.font = `500 12px ${FONT}`; ctx.fillStyle = '#2c2734';
      b.lines.forEach((l, i) => ctx.fillText(l, b.x + 8, b.y + 25 + i * 16));
      ctx.globalAlpha = 1;
    }
  }
}

function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function wrap(ctx, text, max) {
  const out = []; let line = '';
  for (const ch of text) { if (ctx.measureText(line + ch).width > max && line) { out.push(line); line = ch; } else line += ch; }
  if (line) out.push(line); return out;
}
export { STATUS };
