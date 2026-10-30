// 施設のドット絵：床・壁・グラウンド（静的な背景）と家具（前後関係つきの描画単位）
import { T, W, H, MAP, tileAt, floorAt, FURNITURE, FIELD } from './world.js';
import { hash, shade, mix } from './pixel.js';
import { TEAM } from './sprites.js';

export const PAL = {
  cap: '#3b4759', capL: '#56677d', capD: '#2b3443',
  wood: '#c48f5c', woodL: '#d29e69', woodD: '#a8784a', woodS: '#97693e',
  carpet: '#5f7187', carpetD: '#56667b', carpetL: '#6b7d92',
  cafeA: '#efe4cd', cafeB: '#dfcda8', grout: '#d2c09b',
  locker: '#8e9a94', lockerD: '#838f89',
  care: '#d2e6dc', careL: '#e0efe8', careD: '#c2d8cd',
  pave: '#d1c5ad', paveD: '#bcae93', paveL: '#ddd2bc',
  grass: '#7aad5a', grassA: '#73a554', grassB: '#81b462', grassD: '#679a4b',
  dirt: '#cf9f6b', dirtD: '#bf8f5e', dirtL: '#dcb07e',
  chalk: '#f7f2e4', shadow: 'rgba(36,28,56,0.20)', ink: '#2c2734',
  deskTop: '#cd9d66', deskTopL: '#dfb47d', deskFront: '#a9794a', deskFrontD: '#8d6239',
  metal: '#c9cfd3', metalD: '#9aa3aa', metalL: '#e3e7e9',
  screen: '#2a3646'
};
const FACE = { office: ['#e9dec6', '#dfd1b4'], analysis: ['#cdd6dd', '#c0cad2'], cafe: ['#f1e5c9', '#e6d7b6'], locker: ['#b9c6c0', '#adbab4'], care: ['#ddefe7', '#cfe4da'], dorm: ['#e8d9c4', '#dccab0'] };
const faceRoom = (x, y) => y <= 2 ? (x < 17 ? 'office' : x < 28 ? 'analysis' : x < 46 ? 'cafe' : 'dorm') : y <= 14 ? 'locker' : 'care';

function R(ctx, x, y, w, h, c) { if (w <= 0 || h <= 0) return; ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
const P = (ctx, x, y, c) => R(ctx, x, y, 1, 1, c);
const shadowRect = (ctx, x, y, w, h, a = 0.2) => R(ctx, x, y, w, h, `rgba(36,28,56,${a})`);

// ── 背景（床・壁・地面）。一度だけ描いてキャッシュする
export function drawBackground(ctx) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) drawTile(ctx, x, y);
  drawFieldGround(ctx);
  // 壁ぎわの床に落ちる影（奥行き）
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = tileAt(x, y);
    if ('wcklmr'.includes(floorAt(x, y)) && t !== '=' && t !== '#') {
      const up = tileAt(x, y - 1); if (up === '=' || up === '#') shadowRect(ctx, x * T, y * T, T, 3, 0.16);
      const lf = tileAt(x - 1, y); if (lf === '#') shadowRect(ctx, x * T, y * T, 2, T, 0.12);
    }
  }
}

function drawTile(ctx, x, y) {
  const t = tileAt(x, y), X = x * T, Y = y * T, h = (a = 0) => hash(x, y, a);
  if (t === '#') return drawCap(ctx, x, y);
  if (t === '=') {
    const [a, b] = FACE[faceRoom(x, y)], top = tileAt(x, y - 1) === '#';
    R(ctx, X, Y, T, T, a);
    for (let i = 0; i < T; i += 4) R(ctx, X + i, Y, 1, T, b); // 壁紙のストライプ
    if (top) { R(ctx, X, Y, T, 2, shade(a, 0.78)); }
    if (tileAt(x, y + 1) !== '=') { R(ctx, X, Y + T - 3, T, 3, '#9b7b5a'); R(ctx, X, Y + T - 3, T, 1, '#b5926c'); }
    return;
  }
  const f = floorAt(x, y);
  switch (f) {
    case 'w': { // 木の床（板目）
      for (let r = 0; r < 4; r++) {
        const yy = Y + r * 4, off = ((y * 4 + r) * 7) % 16, c = [PAL.wood, PAL.woodL, PAL.wood, '#c08a56'][Math.floor(hash(x, y, r) * 4)];
        R(ctx, X, yy, T, 4, c); R(ctx, X, yy + 3, T, 1, PAL.woodD);
        const jx = X + ((off + x * 5) % 16); R(ctx, jx, yy, 1, 3, PAL.woodS);
        if (hash(x, y, r + 9) > 0.8) P(ctx, X + Math.floor(hash(x, y, r + 3) * 14) + 1, yy + 1, PAL.woodS);
      }
      break;
    }
    case 'c': {
      R(ctx, X, Y, T, T, PAL.carpet);
      for (let i = 0; i < 10; i++) P(ctx, X + Math.floor(h(i) * 16), Y + Math.floor(h(i + 20) * 16), i % 2 ? PAL.carpetD : PAL.carpetL);
      if ((x + y) % 2) R(ctx, X, Y, T, T, 'rgba(255,255,255,0.025)');
      break;
    }
    case 'k': {
      const c = (x + y) % 2 ? PAL.cafeA : PAL.cafeB;
      R(ctx, X, Y, T, T, c); R(ctx, X, Y + T - 1, T, 1, PAL.grout); R(ctx, X + T - 1, Y, 1, T, PAL.grout);
      P(ctx, X + 3, Y + 3, shade(c, 1.06));
      break;
    }
    case 'l': {
      R(ctx, X, Y, T, T, PAL.locker); R(ctx, X, Y, T, 1, PAL.lockerD); R(ctx, X, Y, 1, T, PAL.lockerD);
      for (let i = 2; i < 16; i += 5) for (let j = 2; j < 16; j += 5) P(ctx, X + i, Y + j, PAL.lockerD);
      break;
    }
    case 'r': { // 寮の床（畳風の敷物）
      R(ctx, X, Y, T, T, (x + y) % 2 ? '#c9b98f' : '#c3b288'); R(ctx, X, Y + T - 1, T, 1, '#ad9c74'); R(ctx, X + T - 1, Y, 1, T, '#b5a47b');
      for (let i = 2; i < 16; i += 3) R(ctx, X + 1, Y + i, T - 2, 1, 'rgba(120,100,60,0.10)');
      break;
    }
    case 'm': {
      R(ctx, X, Y, T, T, PAL.care); R(ctx, X, Y + T - 1, T, 1, PAL.careD); R(ctx, X + T - 1, Y, 1, T, PAL.careD);
      if ((x * 3 + y) % 5 === 0) R(ctx, X + 2, Y + 4, 6, 1, PAL.careL);
      break;
    }
    case 'p': { // 舗装（互い違いの石）
      R(ctx, X, Y, T, T, PAL.pave);
      for (let r = 0; r < 2; r++) {
        const yy = Y + r * 8, off = (y * 2 + r) % 2 ? 8 : 0;
        R(ctx, X, yy + 7, T, 1, PAL.paveD); R(ctx, X + off, yy, 1, 7, PAL.paveD);
        R(ctx, X + (off + 1) % 16, yy, 6, 1, PAL.paveL);
        if (h(r) > 0.7) P(ctx, X + Math.floor(h(r + 5) * 14) + 1, yy + 3, PAL.paveD);
      }
      break;
    }
    case 'g': drawGrass(ctx, x, y); break;
    case 'f': drawGrass(ctx, x, y); break;
    default: R(ctx, X, Y, T, T, '#555');
  }
  if (t === 'D') drawDoor(ctx, x, y, f);
}

function drawCap(ctx, x, y) {
  const X = x * T, Y = y * T;
  R(ctx, X, Y, T, T, PAL.cap);
  const below = tileAt(x, y + 1), above = tileAt(x, y - 1);
  // 建物の外壁（下が屋外のとき、天端の下に外壁面を見せる）
  if ((below === 'p' || below === 'g') && y > 0) {
    R(ctx, X, Y, T, 5, PAL.cap); R(ctx, X, Y + 4, T, 1, PAL.capL);
    R(ctx, X, Y + 5, T, 11, '#ddd0b6'); R(ctx, X, Y + 5, T, 1, '#c7b89b');
    for (let i = 0; i < T; i += 8) R(ctx, X + i + (y % 2 ? 4 : 0), Y + 6, 1, 9, '#cdbfa3');
    R(ctx, X, Y + 10, T, 1, '#d2c4a8'); R(ctx, X, Y + 15, T, 1, '#a99877');
    return;
  }
  if ('wcklmrD='.includes(below)) R(ctx, X, Y + T - 2, T, 2, PAL.capL);
  if (above === '#' || y === 0) R(ctx, X, Y, T, 1, PAL.capD);
  const l = tileAt(x - 1, y), r = tileAt(x + 1, y);
  if ('wcklmrD'.includes(l)) R(ctx, X, Y, 1, T, PAL.capL);
  if ('wcklmrD'.includes(r)) R(ctx, X + T - 1, Y, 1, T, PAL.capL);
}

function drawDoor(ctx, x, y, f) {
  const X = x * T, Y = y * T, vertical = tileAt(x - 1, y) === '#' || tileAt(x + 1, y) === '#' ? false : true;
  // 敷居とマット
  if (tileAt(x, y - 1) === '#' && tileAt(x, y + 1) !== '#' || tileAt(x, y + 1) === '#' || tileAt(x, y - 1) === '#') {
    shadowRect(ctx, X, Y, T, 2, 0.18);
  }
  if (!vertical) { R(ctx, X, Y + 6, T, 4, 'rgba(60,50,70,0.10)'); }
  if (y === 9 || y === 12 || y === 20) R(ctx, X + 1, Y + 4, T - 2, 8, y === 9 ? '#8b6d58' : '#6f7d76');
}

function drawGrass(ctx, x, y) {
  const X = x * T, Y = y * T, stripe = Math.floor(x / 2) % 2 ? PAL.grassA : PAL.grassB;
  R(ctx, X, Y, T, T, stripe);
  for (let i = 0; i < 6; i++) {
    const px = X + Math.floor(hash(x, y, i) * 16), py = Y + Math.floor(hash(x, y, i + 30) * 15);
    P(ctx, px, py, PAL.grassD); P(ctx, px, py - 1, shade(stripe, 1.08));
  }
  if (hash(x, y, 77) > 0.93) { const px = X + 4 + Math.floor(hash(x, y, 78) * 8), py = Y + 4 + Math.floor(hash(x, y, 79) * 8); P(ctx, px, py, hash(x, y, 80) > 0.5 ? '#f4f0dc' : '#f2d36b'); }
}

// グラウンドの地面（内野の土・ライン・ブルペン・走路・ケージ内）
function drawFieldGround(ctx) {
  const F = FIELD, px = v => v * T;
  const img = ctx.getImageData(0, 0, W * T, H * T), d = img.data;
  const put = (x, y, c) => { const i = (y * W * T + x) * 4, n = parseInt(c.slice(1), 16); d[i] = n >> 16; d[i + 1] = n >> 8 & 255; d[i + 2] = n & 255; };
  const dirt = (x, y) => { const v = hash(x, y, 5); return v > 0.93 ? PAL.dirtL : v < 0.08 ? PAL.dirtD : PAL.dirt; };
  for (let y = 13 * T; y < 29 * T; y++) for (let x = 1 * T; x < 31 * T; x++) {
    const tx = x / T, ty = y / T;
    const dx = tx - F.mound.x, dy = ty - F.mound.y, man = Math.abs(dx) + Math.abs(dy);
    let soil = false;
    if (man <= 5.2 && man >= 3.1) soil = true; // 内野の土
    if (Math.hypot(tx - F.home.x, ty - F.home.y) < 1.45) soil = true;
    if (Math.hypot(dx, dy) < 0.85) soil = true;
    for (const b of [F.first, F.second, F.third]) if (Math.hypot(tx - b.x, ty - b.y) < 0.9) soil = true;
    if (man < 3.1 && (Math.abs(Math.abs(dx) - Math.abs(dy)) < 0.0 || false)) soil = true;
    // 塁間の走路
    const onPath = Math.abs(man - 4) < 0.25 && tx < F.second.x + 0.3;
    if (onPath) soil = true;
    if (ty >= 28 && ty < 29) soil = true; // 走路
    if (tx >= 20 && tx < 21.4 && ty >= 23.6 && ty < 25.6 && Math.hypot(tx - F.penMound.x, ty - F.penMound.y) < 1.1) soil = true;
    if (Math.hypot(tx - F.penPlate.x, ty - F.penPlate.y) < 1.1) soil = true;
    if (tx >= 20.4 && tx < 27.6 && Math.abs(ty - 24.5) < 0.18) soil = true;
    if (tx >= 1 && tx < 9 && ty >= 13 && ty < 14.3) { put(x, y, hash(x, y, 2) > 0.85 ? '#aaa496' : '#b8b2a5'); continue; } // ベンチ前のコンクリート
    if (tx >= 19 && tx < 29 && ty >= 14 && ty < 17) { put(x, y, (Math.floor(tx * 2) % 2 ? '#5d8e4a' : '#638f4c')); continue; } // ケージ内の人工芝
    if (soil) put(x, y, dirt(x, y));
  }
  ctx.putImageData(img, 0, 0);
  // 土と芝の境目
  // ライン（ファウルライン・打席）
  const chalkLine = (x0, y0, x1, y1) => { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); for (let i = 0; i <= n; i++) P(ctx, Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), PAL.chalk); };
  const hx = px(F.home.x), hy = px(F.home.y);
  chalkLine(hx + 3, hy - 3, px(13.4), px(12.6) + 13);
  chalkLine(hx + 3, hy + 3, px(11.0), px(28.0));
  R(ctx, hx - 9, hy - 5, 5, 1, PAL.chalk); R(ctx, hx - 9, hy + 4, 5, 1, PAL.chalk); R(ctx, hx - 9, hy - 5, 1, 10, PAL.chalk);
  R(ctx, hx + 5, hy - 5, 5, 1, PAL.chalk); R(ctx, hx + 5, hy + 4, 5, 1, PAL.chalk); R(ctx, hx + 9, hy - 5, 1, 10, PAL.chalk);
  // ホームベース・塁
  R(ctx, hx - 2, hy - 2, 5, 4, '#fbf8ee'); P(ctx, hx - 2, hy + 1, PAL.dirt); P(ctx, hx + 2, hy + 1, PAL.dirt); R(ctx, hx - 1, hy + 2, 3, 1, '#fbf8ee'); R(ctx, hx - 2, hy + 3, 5, 1, 'rgba(0,0,0,0.12)');
  for (const b of [F.first, F.second, F.third]) { const bx = px(b.x), by = px(b.y); R(ctx, bx - 2, by - 2, 5, 5, '#fbf8ee'); R(ctx, bx - 2, by + 3, 5, 1, 'rgba(0,0,0,0.15)'); }
  // マウンド
  const mx = px(F.mound.x), my = px(F.mound.y); R(ctx, mx - 5, my - 3, 10, 6, PAL.dirtL); R(ctx, mx - 2, my - 1, 4, 1, '#fbf8ee');
  const bx = px(F.penMound.x), by = px(F.penMound.y); R(ctx, bx - 5, by - 3, 10, 6, PAL.dirtL); R(ctx, bx - 1, by - 2, 1, 4, '#fbf8ee');
  const pxp = px(F.penPlate.x), pyp = px(F.penPlate.y); R(ctx, pxp - 2, pyp - 2, 4, 5, '#fbf8ee');
  // ケージ内のホーム
  R(ctx, px(20.5) - 2, px(15.5) - 2, 4, 5, '#fbf8ee'); R(ctx, px(19.2), px(14.6), 1, 15, 'rgba(255,255,255,0.35)');
  // 走路のライン
  for (let x = T + 4; x < 31 * T - 4; x += 12) R(ctx, x, 28 * T + 8, 6, 1, 'rgba(255,248,230,0.55)');
}

// ── 家具
// 各家具は [{ zY, draw(ctx, view) }] を返す。view は時刻や動的な状態（起用表・食事中の席など）
export function furnitureDrawables(view) {
  const out = [];
  for (const f of FURNITURE) {
    const fn = KIND[f.kind]; if (!fn) continue;
    const X = f.x * T, Y = f.y * T, Wp = f.w * T, Hp = f.h * T;
    const r = fn(f, X, Y, Wp, Hp, view);
    (Array.isArray(r) ? r : [r]).forEach(d => d && out.push(d));
  }
  // フェンス（上下は金網、左右は支柱）
  out.push({ zY: 12 * T + 15, draw: ctx => fenceH(ctx, 0, 12, 32, [9, 10]) });
  out.push({ zY: 29 * T + 15, draw: ctx => fenceH(ctx, 0, 29, 32, []) });
  out.push({ zY: 13 * T, draw: ctx => { fenceV(ctx, 0, 12, 29, []); fenceV(ctx, 31, 12, 29, [15, 16, 24, 25]); } });
  return out;
}

function fenceH(ctx, x0, y, w, gaps) {
  const Y = y * T + 15;
  for (let x = x0; x < x0 + w; x++) {
    if (gaps.includes(x)) continue;
    const X = x * T;
    R(ctx, X, Y - 12, T, 12, 'rgba(84,96,92,0.28)');
    for (let i = 0; i < T; i += 3) { P(ctx, X + i, Y - 12 + (i % 6 ? 2 : 5), 'rgba(220,226,222,0.65)'); P(ctx, X + i + 1, Y - 12 + (i % 6 ? 6 : 9), 'rgba(220,226,222,0.65)'); }
    R(ctx, X, Y - 13, T, 1, '#8a948f'); R(ctx, X, Y - 1, T, 1, '#6f7a76');
    if (x % 2 === 0) { R(ctx, X, Y - 14, 2, 15, '#7b8582'); P(ctx, X, Y - 14, '#a9b2ae'); }
  }
}
function fenceV(ctx, x, y0, y1, gaps) {
  for (let y = y0; y <= y1; y++) {
    if (gaps.includes(y)) continue;
    const X = x * T + 7, Y = y * T;
    R(ctx, X, Y - 4, 2, T, 'rgba(84,96,92,0.35)'); R(ctx, X, Y - 4, 1, T, '#8a948f');
    if (y % 2 === 0) { R(ctx, X - 1, Y - 12, 3, 12, '#7b8582'); P(ctx, X - 1, Y - 12, '#a9b2ae'); }
  }
}

// 机の上の小物
function deskItems(ctx, f, X, topY, view) {
  const t = view.t;
  for (const it of f.items || []) {
    switch (it) {
      case 'monitorBack': R(ctx, X + 4, topY - 9, 13, 9, '#4a5160'); R(ctx, X + 4, topY - 9, 13, 1, '#636b7b'); R(ctx, X + 9, topY, 3, 2, '#3a404c'); R(ctx, X + 6, topY + 2, 9, 1, '#3a404c'); break;
      case 'monitor': monitor(ctx, X + Math.round(f.w * T / 2) - 7, topY - 11, 14, 10, view, f.id); break;
      case 'monitor2': monitor(ctx, X + 6, topY - 11, 14, 10, view, f.id + 'a'); monitor(ctx, X + 22, topY - 11, 14, 10, view, f.id + 'b'); break;
      case 'keyboard': R(ctx, X + (f.front ? 18 : 17), topY + (f.front ? 3 : 4), 12, 3, '#dde1e3'); R(ctx, X + (f.front ? 18 : 17), topY + (f.front ? 5 : 6), 12, 1, '#a9afb3'); break;
      case 'mug': R(ctx, X + f.w * T - 9, topY + 2, 3, 3, '#f2efe6'); P(ctx, X + f.w * T - 9, topY + 2, '#6b3f25'); P(ctx, X + f.w * T - 6, topY + 3, '#f2efe6'); break;
      case 'papers': R(ctx, X + f.w * T - 18, topY + 3, 7, 5, '#fbf8ef'); R(ctx, X + f.w * T - 17, topY + 2, 7, 5, '#f4f0e4'); R(ctx, X + f.w * T - 16, topY + 4, 4, 1, '#a7aeb6'); break;
      case 'files': R(ctx, X + 2, topY - 6, 3, 8, '#d06b4f'); R(ctx, X + 5, topY - 6, 3, 8, '#4f7fb3'); R(ctx, X + 8, topY - 5, 3, 7, '#e0b44d'); break;
      case 'phone': R(ctx, X + f.w * T - 9, topY + 2, 6, 4, '#3a3f4a'); R(ctx, X + f.w * T - 9, topY + 2, 6, 1, '#555c6a'); break;
      case 'tablet': R(ctx, X + 34, topY + 8, 7, 5, '#2f3440'); R(ctx, X + 35, topY + 9, 5, 3, '#7ac5dc'); break;
      case 'tray': break;
    }
  }
  void t;
}
function monitor(ctx, x, y, w, h, view, seed) {
  R(ctx, x, y, w, h, '#2d3340'); R(ctx, x + 1, y + 1, w - 2, h - 3, '#1d2a38');
  const on = view.screens?.[seed] !== false, t = view.t;
  if (on) {
    // 画面の中身：行が流れる／グラフ
    const s = Math.floor(t * 2 + hash(seed.length, 3) * 10);
    for (let r = 0; r < 3; r++) { const len = 3 + Math.floor(hash(s + r, seed.length) * (w - 6)); R(ctx, x + 2, y + 2 + r * 2, len, 1, r === 0 ? '#79c6a0' : '#8fb7d9'); }
    if (seed.endsWith('b')) { for (let i = 0; i < 5; i++) R(ctx, x + 2 + i * 2, y + h - 3 - Math.floor(hash(i, s >> 2) * 4), 1, Math.floor(hash(i, s >> 2) * 4) + 1, '#e6b45a'); }
  }
  R(ctx, x + Math.floor(w / 2) - 1, y + h, 2, 2, '#3a404c'); R(ctx, x + Math.floor(w / 2) - 3, y + h + 2, 6, 1, '#3a404c');
}

const KIND = {
  desk(f, X, Y, Wp, Hp, view) {
    if (f.front) {
      // 手前側から見た机。奥に座る人の腰から下を隠す
      return { zY: Y + T, draw: ctx => {
        shadowRect(ctx, X + 2, Y + 12, Wp, 4);
        R(ctx, X, Y - 6, Wp, 11, PAL.deskTop); R(ctx, X, Y - 6, Wp, 1, PAL.deskTopL); R(ctx, X, Y + 4, Wp, 1, shade(PAL.deskTop, 0.9));
        R(ctx, X, Y + 5, Wp, 8, PAL.deskFront); R(ctx, X, Y + 12, Wp, 1, PAL.deskFrontD);
        R(ctx, X + Wp - 16, Y + 7, 12, 1, PAL.deskFrontD); R(ctx, X + Wp - 11, Y + 9, 2, 1, '#e3c79a');
        R(ctx, X + 1, Y + 13, 2, 2, PAL.deskFrontD); R(ctx, X + Wp - 3, Y + 13, 2, 2, PAL.deskFrontD);
        deskItems(ctx, f, X, Y - 6, view);
      } };
    }
    // 壁ぎわの机。手前に座る人は机より前に描く
    return { zY: Y + 10, draw: ctx => {
      shadowRect(ctx, X + 2, Y + 13, Wp, 3);
      R(ctx, X, Y + 1, Wp, 9, PAL.deskTop); R(ctx, X, Y + 1, Wp, 1, PAL.deskTopL);
      R(ctx, X, Y + 10, Wp, 4, PAL.deskFront); R(ctx, X, Y + 13, Wp, 1, PAL.deskFrontD);
      R(ctx, X + 1, Y + 14, 2, 2, PAL.deskFrontD); R(ctx, X + Wp - 3, Y + 14, 2, 2, PAL.deskFrontD);
      deskItems(ctx, f, X, Y + 1, view);
    } };
  },
  chair(f, X, Y) {
    const cx = X + 8, cy = Y + 9, body = f.exec ? '#6b4535' : '#4f5a6e', bodyL = f.exec ? '#82573f' : '#66728a';
    if (f.face === 'down') return { zY: Y + 2, draw: ctx => {
      // 背もたれは頭の左右と上から少しのぞく（座っている感じを出す）
      const top = cy - (f.exec ? 22 : 17), w = f.exec ? 14 : 12;
      R(ctx, cx - w / 2, top, w, cy - 4 - top, body); R(ctx, cx - w / 2 + 1, top, w - 2, 1, bodyL); R(ctx, cx - w / 2, top + 1, 1, cy - 6 - top, bodyL);
      R(ctx, cx - 5, cy - 3, 10, 4, bodyL); R(ctx, cx - 1, cy + 1, 2, 3, '#3a3f4a'); R(ctx, cx - 5, cy + 4, 10, 1, '#3a3f4a');
    } };
    if (f.face === 'up') return { zY: Y + 10.5, draw: ctx => {
      shadowRect(ctx, cx - 5, cy + 6, 11, 2);
      R(ctx, cx - 5, cy - 6, 10, 9, body); R(ctx, cx - 5, cy - 6, 10, 1, bodyL); R(ctx, cx - 4, cy - 4, 8, 4, shade(body, 0.9));
      R(ctx, cx - 1, cy + 3, 2, 3, '#3a3f4a'); R(ctx, cx - 5, cy + 5, 10, 1, '#3a3f4a'); P(ctx, cx - 5, cy + 6, '#2a2e36'); P(ctx, cx + 4, cy + 6, '#2a2e36');
    } };
    return null;
  },
  stool(f, X, Y) {
    const cx = X + 8, cy = Y + 9;
    return { zY: Y + (f.face === 'up' ? 10.5 : 2), draw: ctx => {
      if (f.face === 'up') { R(ctx, cx - 4, cy - 1, 8, 4, '#b8573f'); R(ctx, cx - 4, cy - 1, 8, 1, '#cf6d52'); R(ctx, cx - 3, cy + 3, 1, 3, '#6b6f75'); R(ctx, cx + 2, cy + 3, 1, 3, '#6b6f75'); }
      else { R(ctx, cx - 4, cy - 3, 8, 4, '#b8573f'); R(ctx, cx - 4, cy - 3, 8, 1, '#cf6d52'); }
    } };
  },
  table(f, X, Y, Wp, Hp, view) {
    const top = f.small ? '#eadfca' : PAL.deskTop, topL = f.small ? '#f6efe0' : PAL.deskTopL, edge = f.small ? '#c9b994' : PAL.deskFront;
    return { zY: Y + Hp, draw: ctx => {
      shadowRect(ctx, X + 2, Y + Hp - 1, Wp, 4);
      R(ctx, X, Y - 5, Wp, Hp + 1, top); R(ctx, X, Y - 5, Wp, 1, topL); R(ctx, X, Y + Hp - 4, Wp, 4, edge); R(ctx, X, Y + Hp - 1, Wp, 1, shade(edge, 0.8));
      R(ctx, X + 1, Y + Hp, 2, 2, shade(edge, 0.7)); R(ctx, X + Wp - 3, Y + Hp, 2, 2, shade(edge, 0.7));
      if (!f.small) {
        R(ctx, X + 8, Y + 1, 8, 6, '#fbf8ef'); R(ctx, X + 9, Y + 2, 5, 1, '#a7aeb6'); R(ctx, X + 9, Y + 4, 4, 1, '#c3c8cc');
        R(ctx, X + 44, Y + 2, 8, 6, '#fbf8ef'); R(ctx, X + 45, Y + 3, 5, 1, '#a7aeb6');
        R(ctx, X + 30, Y + 4, 3, 3, '#f2efe6'); P(ctx, X + 30, Y + 4, '#6b3f25');
        if (view.meeting) { R(ctx, X + 22, Y + 6, 10, 7, '#fbf8ef'); R(ctx, X + 23, Y + 7, 8, 1, TEAM.g); for (let i = 0; i < 4; i++) R(ctx, X + 24, Y + 9 + i, 4 + (i % 2) * 2, 1, '#a7aeb6'); }
      }
      // 食事中の席にはトレー
      for (const seat of view.trays?.[f.id] || []) {
        const tx = seat.x * T + 2, ty = seat.dir === 'down' ? Y - 4 : Y + 2;
        R(ctx, tx, ty, 12, 7, '#d9a35b'); R(ctx, tx + 1, ty + 1, 4, 3, '#fbfbf6'); R(ctx, tx + 6, ty + 1, 4, 3, '#a2603a'); R(ctx, tx + 2, ty + 4, 8, 2, '#7fae5f');
      }
    } };
  },
  counter(f, X, Y, Wp, Hp, view) {
    return { zY: Y + T, draw: ctx => {
      shadowRect(ctx, X + 2, Y + 14, Wp, 2);
      R(ctx, X, Y - 4, Wp, 8, PAL.metal); R(ctx, X, Y - 4, Wp, 1, PAL.metalL); R(ctx, X, Y + 3, Wp, 1, PAL.metalD);
      R(ctx, X, Y + 4, Wp, 11, '#b98a5b'); for (let i = 6; i < Wp; i += 16) R(ctx, X + i, Y + 5, 1, 9, '#a07448'); R(ctx, X, Y + 14, Wp, 1, '#8d6239');
      // 炊飯器・鍋・トレー
      R(ctx, X + 6, Y - 9, 9, 7, '#f1f0ea'); R(ctx, X + 6, Y - 9, 9, 2, '#d8d6cf'); P(ctx, X + 13, Y - 5, '#e86a4a');
      R(ctx, X + 22, Y - 8, 11, 6, '#7d858c'); R(ctx, X + 22, Y - 8, 11, 1, '#a6aeb4'); R(ctx, X + 23, Y - 7, 9, 1, '#c98a4a');
      steam(ctx, X + 27, Y - 10, view.t);
      for (let i = 0; i < 4; i++) R(ctx, X + 44, Y - 3 - i * 2, 14, 2, i % 2 ? '#d9a35b' : '#c99350');
      R(ctx, X + 66, Y - 6, 10, 5, '#fbfbf6'); R(ctx, X + 68, Y - 5, 6, 3, '#e8c37a'); R(ctx, X + 82, Y - 6, 10, 5, '#fbfbf6'); R(ctx, X + 84, Y - 5, 6, 3, '#9fc477');
      R(ctx, X + 98, Y - 7, 8, 6, '#f6f2e8'); R(ctx, X + 99, Y - 6, 6, 3, '#c25b3d');
    } };
  },
  kitchenWall(f, X, Y, Wp, Hp) {
    return { zY: -1, draw: ctx => {
      R(ctx, X, Y + 6, Wp, Hp - 9, '#f4f1ea'); for (let x = 0; x < Wp; x += 6) R(ctx, X + x, Y + 6, 1, Hp - 9, '#ddd8cc'); for (let y = 6; y < Hp - 3; y += 6) R(ctx, X, Y + y, Wp, 1, '#ddd8cc');
      R(ctx, X + 30, Y - 2, 26, 10, PAL.metal); R(ctx, X + 30, Y + 7, 26, 2, PAL.metalD); R(ctx, X + 32, Y + 9, 22, 1, 'rgba(0,0,0,0.15)');
      R(ctx, X + 4, Y + 10, 22, 2, '#a07448'); R(ctx, X + 6, Y + 6, 5, 4, '#c9564a'); R(ctx, X + 13, Y + 7, 4, 3, '#e3b04a'); R(ctx, X + 19, Y + 6, 5, 4, '#6f8fae');
      R(ctx, X + 64, Y + 10, 40, 2, '#a07448'); for (let i = 0; i < 6; i++) R(ctx, X + 66 + i * 6, Y + 6, 4, 4, ['#f2f0ea', '#e8e4d8'][i % 2]);
    } };
  },
  menu(f, X, Y, Wp) {
    return { zY: -1, draw: ctx => {
      R(ctx, X + 2, Y + 3, Wp - 4, 22, '#3a5a4a'); R(ctx, X + 2, Y + 3, Wp - 4, 1, '#55786a'); R(ctx, X + 2, Y + 24, Wp - 4, 2, '#8b6a4a');
      for (let i = 0; i < 5; i++) { R(ctx, X + 6, Y + 7 + i * 3, 18 + (i % 3) * 4, 1, '#e9efe4'); R(ctx, X + Wp - 12, Y + 7 + i * 3, 5, 1, '#f2cf7a'); }
    } };
  },
  vending(f, X, Y, Wp, Hp, view) {
    return { zY: Y + T, draw: ctx => {
      shadowRect(ctx, X + 3, Y + 12, Wp - 2, 4);
      R(ctx, X + 2, Y - 22, Wp - 4, 36, '#c84b46'); R(ctx, X + 2, Y - 22, Wp - 4, 2, '#e06a62'); R(ctx, X + 4, Y - 18, 18, 18, '#e9f2f3');
      for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) R(ctx, X + 5 + c * 3 + (c > 2 ? 1 : 0), Y - 17 + r * 6, 2, 4, ['#4f8fd1', '#e8b03c', '#5aa86a', '#e36c5c', '#8b6bc2'][(r + c) % 5]);
      R(ctx, X + 24, Y - 16, 4, 6, '#2a2f38'); R(ctx, X + 6, Y + 4, 16, 4, '#2a2f38');
      R(ctx, X + 4, Y - 18, 18, 18, `rgba(255,255,240,${0.08 + 0.05 * Math.sin(view.t * 2)})`);
    } };
  },
  vendingOut(f, X, Y) {
    return { zY: Y + T + 2, draw: ctx => {
      R(ctx, X + 2, Y - 6, 13, 22, '#3f7fb5'); R(ctx, X + 2, Y - 6, 13, 1, '#5b9bd0'); R(ctx, X + 4, Y - 3, 9, 9, '#e9f2f3');
      for (let c = 0; c < 3; c++) R(ctx, X + 5 + c * 3, Y - 2, 2, 3, ['#e8b03c', '#5aa86a', '#e36c5c'][c]); R(ctx, X + 4, Y + 10, 9, 3, '#2a2f38');
    } };
  },
  water(f, X, Y) {
    return { zY: Y + T, draw: ctx => {
      shadowRect(ctx, X + 4, Y + 13, 10, 3);
      R(ctx, X + 4, Y - 6, 9, 20, '#f1f0ea'); R(ctx, X + 4, Y - 6, 9, 1, '#ffffff'); R(ctx, X + 5, Y - 15, 7, 9, '#8fc6e4'); R(ctx, X + 6, Y - 14, 2, 6, '#c9e6f4');
      P(ctx, X + 6, Y + 1, '#e05a4a'); P(ctx, X + 10, Y + 1, '#4a8ae0');
    } };
  },
  clock(f, X, Y, Wp, Hp, view) {
    return { zY: -1, draw: ctx => {
      const cx = X + 8, cy = Y + 10;
      R(ctx, cx - 5, cy - 4, 10, 8, '#f8f5ec'); R(ctx, cx - 4, cy - 5, 8, 10, '#f8f5ec'); R(ctx, cx - 4, cy - 5, 8, 1, '#3d3a44'); R(ctx, cx - 4, cy + 4, 8, 1, '#3d3a44'); R(ctx, cx - 5, cy - 4, 1, 8, '#3d3a44'); R(ctx, cx + 4, cy - 4, 1, 8, '#3d3a44');
      const m = view.minutes || 0, ha = (m / 60 % 12) / 12 * Math.PI * 2, ma = (m % 60) / 60 * Math.PI * 2;
      for (let i = 0; i <= 3; i++) P(ctx, cx + Math.round(Math.sin(ma) * i), cy - Math.round(Math.cos(ma) * i), '#2c2734');
      for (let i = 0; i <= 2; i++) P(ctx, cx + Math.round(Math.sin(ha) * i), cy - Math.round(Math.cos(ha) * i), '#c0463c');
    } };
  },
  window(f, X, Y, Wp, Hp, view) {
    return { zY: -1, draw: ctx => {
      R(ctx, X + 2, Y + 2, Wp - 4, Hp - 6, '#f4efe2');
      R(ctx, X + 4, Y + 4, Wp - 8, Hp - 10, '#a9d3ea'); R(ctx, X + 4, Y + 4 + (Hp - 10) * 0.6, Wp - 8, (Hp - 10) * 0.4, '#c3e2ef');
      R(ctx, X + 8, Y + 14, 9, 6, '#8fbf7a'); R(ctx, X + 10, Y + 11, 5, 4, '#9fcd88'); R(ctx, X + 30, Y + 15, 12, 5, '#8fbf7a');
      const cx = (view.t * 1.5) % (Wp - 8); R(ctx, X + 4 + cx, Y + 7, 6, 2, '#ffffff');
      R(ctx, X + Wp / 2 - 1, Y + 4, 2, Hp - 10, '#f4efe2'); R(ctx, X + 2, Y + Hp - 5, Wp - 4, 2, '#cdbf9f');
    } };
  },
  lineup(f, X, Y, Wp, Hp, view) {
    return { zY: -1, draw: ctx => drawLineup(ctx, X, Y, Wp, Hp, view) };
  },
  screen(f, X, Y, Wp, Hp, view) {
    return { zY: -1, draw: ctx => {
      R(ctx, X + 2, Y + 1, Wp - 4, Hp - 5, '#262c36'); R(ctx, X + 4, Y + 3, Wp - 8, Hp - 9, '#17222f');
      // 打球方向の扇形と点
      const ox = X + 22, oy = Y + 24;
      for (let a = -45; a <= 45; a += 3) { const r = 17, rad = (a - 90) * Math.PI / 180; P(ctx, ox + Math.round(Math.cos(rad) * r), oy + Math.round(Math.sin(rad) * r), '#3f6f58'); }
      for (let i = 0; i < 14; i++) { const a = (hash(i, 7) - 0.5) * 1.5 - Math.PI / 2, r = 5 + hash(i, 8) * 12, on = (view.t * 0.8 + i) % 14 > 2; if (on) P(ctx, ox + Math.round(Math.cos(a) * r), oy + Math.round(Math.sin(a) * r), i % 3 ? '#f0c95a' : '#e5674f'); }
      for (let i = 0; i < 6; i++) { const h = 3 + Math.floor(hash(i, Math.floor(view.t / 3)) * 10); R(ctx, X + 48 + i * 4, Y + 23 - h, 3, h, i === 3 ? '#e5674f' : '#5fb0d8'); }
      R(ctx, X + 46, Y + 6, 26, 1, '#7d8a99'); R(ctx, X + 46, Y + 9, 18, 1, '#7d8a99');
      R(ctx, X + Wp / 2 - 2, Y + Hp - 4, 4, 2, '#3a404c');
    } };
  },
  server(f, X, Y, Wp, Hp, view) {
    return { zY: Y + T, draw: ctx => {
      shadowRect(ctx, X + 3, Y + 13, 12, 3);
      R(ctx, X + 2, Y - 18, 13, 32, '#2f3540'); R(ctx, X + 2, Y - 18, 13, 1, '#4a5260');
      for (let i = 0; i < 6; i++) { R(ctx, X + 4, Y - 15 + i * 5, 9, 3, '#3b4350'); P(ctx, X + 5, Y - 14 + i * 5, (Math.floor(view.t * 3 + i * 1.7) % 3) ? '#5fd38a' : '#2a6b44'); P(ctx, X + 7, Y - 14 + i * 5, (Math.floor(view.t * 2 + i) % 4) ? '#2a4a6b' : '#5fb0e8'); }
    } };
  },
  easel(f, X, Y, Wp) {
    return { zY: Y + T, draw: ctx => {
      R(ctx, X + 6, Y - 4, 2, 18, '#8a6a4a'); R(ctx, X + Wp - 8, Y - 4, 2, 18, '#8a6a4a');
      R(ctx, X + 3, Y - 18, Wp - 6, 16, '#fbf8ef'); R(ctx, X + 3, Y - 18, Wp - 6, 1, '#d9d4c6');
      for (let i = 0; i < 5; i++) R(ctx, X + 6 + i * 4, Y - 6 - i * 2, 3, 3 + i * 2, i === 4 ? '#e5674f' : '#5f9fd0');
      R(ctx, X + 5, Y - 15, 14, 1, '#7d8a99');
    } };
  },
  printer(f, X, Y) {
    return { zY: Y + T, draw: ctx => { shadowRect(ctx, X + 2, Y + 13, 13, 3); R(ctx, X + 1, Y - 2, 14, 14, '#dfe2e3'); R(ctx, X + 1, Y - 2, 14, 2, '#f1f3f4'); R(ctx, X + 3, Y - 5, 10, 4, '#fbf8ef'); R(ctx, X + 3, Y + 6, 10, 2, '#4a5160'); } };
  },
  shelf(f, X, Y) {
    return { zY: Y + T, draw: ctx => {
      shadowRect(ctx, X + 2, Y + 13, 14, 3);
      R(ctx, X, Y - 22, 16, 36, '#8c6440'); R(ctx, X + 1, Y - 21, 14, 34, '#6f4d30');
      for (let s = 0; s < 4; s++) { R(ctx, X + 1, Y - 13 + s * 9, 14, 1, '#a57b52'); for (let b = 0; b < 5; b++) R(ctx, X + 2 + b * 3, Y - 20 + s * 9, 2, 7 - (b % 2), ['#c9564a', '#4f7fb3', '#e0b44d', '#5aa86a', '#ede6d6'][(b + s) % 5]); }
    } };
  },
  cabinet(f, X, Y, Wp) {
    return { zY: Y + T, draw: ctx => {
      shadowRect(ctx, X + 2, Y + 13, Wp, 3);
      R(ctx, X + 1, Y - 12, Wp - 2, 26, '#9aa3ab'); R(ctx, X + 1, Y - 12, Wp - 2, 1, '#b8c0c6');
      for (let i = 0; i < 3; i++) { R(ctx, X + 3, Y - 9 + i * 8, Wp - 6, 6, '#8a939b'); R(ctx, X + Wp / 2 - 3, Y - 7 + i * 8, 6, 1, '#d8dde0'); }
      R(ctx, X + 4, Y - 18, 4, 6, '#d06b4f'); R(ctx, X + 8, Y - 18, 4, 6, TEAM.g); R(ctx, X + 12, Y - 17, 4, 5, '#e0b44d'); R(ctx, X + 20, Y - 16, 6, 4, '#c9a26a');
    } };
  },
  pennant(f, X, Y) {
    return { zY: -1, draw: ctx => {
      R(ctx, X + 4, Y + 6, 22, 1, '#8a6a4a');
      for (let i = 0; i < 9; i++) R(ctx, X + 5 + i * 2, Y + 7 + Math.floor(i / 3), 22 - i * 2 > 4 ? 2 : 1, 12 - i, TEAM.g);
      R(ctx, X + 7, Y + 10, 6, 1, TEAM.cr); R(ctx, X + 7, Y + 12, 4, 1, TEAM.cr);
    } };
  },
  plant(f, X, Y, Wp, Hp, view) {
    return { zY: Y + T, draw: ctx => {
      shadowRect(ctx, X + 4, Y + 13, 10, 3);
      R(ctx, X + 4, Y + 5, 9, 9, '#b8714a'); R(ctx, X + 4, Y + 5, 9, 2, '#cf8a5f');
      const sway = Math.round(Math.sin(view.t * 0.7 + X) * 0.6);
      R(ctx, X + 3 + sway, Y - 6, 11, 11, '#4f8a4a'); R(ctx, X + 5 + sway, Y - 9, 7, 5, '#62a058'); R(ctx, X + 1 + sway, Y - 2, 4, 5, '#447a40'); R(ctx, X + 12 + sway, Y - 3, 4, 5, '#447a40'); P(ctx, X + 7 + sway, Y - 7, '#86c070');
    } };
  },
  lockers(f, X, Y, Wp) {
    return { zY: Y + T, draw: ctx => {
      shadowRect(ctx, X + 2, Y + 13, Wp, 3);
      for (let i = 0; i < f.w; i++) {
        const x = X + i * T, open = f.id === 'lockers-a' && i === 2;
        R(ctx, x, Y - 22, T, 36, '#5f8a9a'); R(ctx, x, Y - 22, T, 1, '#7fa6b4'); R(ctx, x + T - 1, Y - 22, 1, 36, '#4a6f7d');
        if (open) { R(ctx, x + 2, Y - 20, 12, 32, '#2f3d45'); R(ctx, x + 4, Y - 17, 8, 10, TEAM.cr); R(ctx, x + 6, Y - 15, 4, 3, TEAM.g); R(ctx, x + 3, Y + 2, 10, 3, '#3a3a40'); R(ctx, x - 1, Y - 20, 3, 32, '#7fa6b4'); continue; }
        for (let v = 0; v < 3; v++) R(ctx, x + 4, Y - 18 + v * 2, 8, 1, '#4a6f7d');
        R(ctx, x + 11, Y - 6, 1, 4, '#d9dfe1'); R(ctx, x + 5, Y - 10, 6, 3, '#e9efe9'); P(ctx, x + 7, Y - 9, '#3a4a50'); P(ctx, x + 8, Y - 9, '#3a4a50');
      }
    } };
  },
  bench(f, X, Y, Wp, Hp) {
    const wood = f.roof ? '#3f7a5a' : '#c49766', woodL = f.roof ? '#4f9070' : '#d6ab7a', woodD = f.roof ? '#2f5f45' : '#9e7449';
    const back = f.roof ? { zY: Y - 2, draw: ctx => {
      R(ctx, X - 18, Y - 16, Wp + 34, 14, '#46535a'); R(ctx, X - 18, Y - 16, Wp + 34, 2, '#5b6a72'); R(ctx, X - 18, Y - 4, Wp + 34, 2, '#3a454b');
      R(ctx, X, Y - 2, Wp, 4, wood); R(ctx, X, Y - 2, Wp, 1, woodL);
    } } : null;
    const seat = { zY: Y + 3, draw: ctx => {
      shadowRect(ctx, X + 1, Y + 12, Wp, 3);
      R(ctx, X, Y + 4, Wp, 6, wood); R(ctx, X, Y + 4, Wp, 1, woodL); R(ctx, X, Y + 9, Wp, 1, woodD);
      for (let i = 2; i < Wp; i += 22) R(ctx, X + i, Y + 10, 2, 4, woodD);
      R(ctx, X + Wp - 4, Y + 10, 2, 4, woodD);
    } };
    return back ? [back, seat] : seat;
  },
  helmetRack(f, X, Y, Wp) {
    return { zY: Y + T, draw: ctx => {
      shadowRect(ctx, X + 2, Y + 13, Wp, 3);
      R(ctx, X + 1, Y - 6, Wp - 2, 18, '#7a5a3e'); R(ctx, X + 1, Y + 2, Wp - 2, 1, '#9a7552');
      for (let i = 0; i < 5; i++) { R(ctx, X + 3 + i * 9, Y - 4, 7, 5, TEAM.g); R(ctx, X + 4 + i * 9, Y - 4, 3, 1, TEAM.gL); R(ctx, X + 3 + i * 9, Y, 8, 1, TEAM.gD); }
      for (let i = 0; i < 6; i++) R(ctx, X + 4 + i * 7, Y + 4, 2, 8, '#d8ae72');
    } };
  },
  laundry(f, X, Y) {
    return { zY: Y + T, draw: ctx => { shadowRect(ctx, X + 2, Y + 13, 13, 3); R(ctx, X + 2, Y + 1, 12, 12, '#8aa0a8'); R(ctx, X + 2, Y + 1, 12, 1, '#a9bec4'); R(ctx, X + 3, Y - 2, 10, 4, TEAM.cr); R(ctx, X + 6, Y - 3, 4, 2, '#f7f6f0'); } };
  },
  careShelf(f, X, Y, Wp) {
    return { zY: -1, draw: ctx => {
      for (let s = 0; s < 2; s++) {
        const yy = Y + 10 + s * 10; R(ctx, X + 3, yy, Wp - 6, 2, '#b8946a');
        for (let i = 0; i < 9; i++) { const k = (i + s) % 4; if (k === 0) { R(ctx, X + 5 + i * 6, yy - 4, 4, 4, '#f0ead6'); P(ctx, X + 6 + i * 6, yy - 3, '#c9c2ad'); } else if (k === 1) R(ctx, X + 5 + i * 6, yy - 6, 3, 6, '#4f9fc0'); else if (k === 2) R(ctx, X + 5 + i * 6, yy - 5, 4, 5, '#f4f2ec'); else R(ctx, X + 5 + i * 6, yy - 4, 4, 4, '#e09a4a'); }
      }
      R(ctx, X + Wp - 14, Y + 1, 9, 7, '#ffffff'); R(ctx, X + Wp - 11, Y + 2, 3, 5, '#d9534a'); R(ctx, X + Wp - 13, Y + 3, 7, 1, '#d9534a'); R(ctx, X + Wp - 13, Y + 4, 7, 1, '#d9534a');
    } };
  },
  poster(f, X, Y) {
    return { zY: -1, draw: ctx => {
      R(ctx, X + 6, Y + 2, 20, 24, '#fbf8ef'); R(ctx, X + 6, Y + 2, 20, 2, '#4f9fc0');
      R(ctx, X + 14, Y + 6, 4, 4, '#e0b49a'); R(ctx, X + 13, Y + 10, 6, 8, '#e0b49a'); R(ctx, X + 11, Y + 10, 2, 7, '#e0b49a'); R(ctx, X + 19, Y + 10, 2, 7, '#e0b49a'); R(ctx, X + 13, Y + 18, 2, 6, '#e0b49a'); R(ctx, X + 17, Y + 18, 2, 6, '#e0b49a');
      P(ctx, X + 18, Y + 11, '#d9534a'); P(ctx, X + 14, Y + 20, '#d9534a');
    } };
  },
  bed(f, X, Y, Wp, Hp) {
    return { zY: Y + 3, draw: ctx => {
      shadowRect(ctx, X + 2, Y + Hp - 3, 15, 4);
      R(ctx, X + 1, Y - 3, 14, Hp + 1, '#7f8a92'); R(ctx, X + 2, Y - 2, 12, Hp - 2, '#f3f6f4'); R(ctx, X + 2, Y - 2, 12, 1, '#ffffff');
      R(ctx, X + 3, Y - 1, 10, 5, '#ffffff'); R(ctx, X + 3, Y + 3, 10, 1, '#dfe6e4');
      R(ctx, X + 2, Y + Hp - 9, 12, 4, '#cfe3ea'); R(ctx, X + 1, Y + Hp - 2, 2, 3, '#5f6a72'); R(ctx, X + 13, Y + Hp - 2, 2, 3, '#5f6a72');
    } };
  },
  dormbed(f, X, Y, Wp, Hp, view) { // 寮のベッド（木枠・枕・掛け布団）。寝ている人の上に掛け布団を重ねる
    const used = view.beds?.[f.slot];
    return [{ zY: Y + 3, draw: ctx => {
      shadowRect(ctx, X + 2, Y + Hp - 2, 15, 3);
      R(ctx, X, Y - 4, 16, Hp + 3, '#8a6142'); R(ctx, X, Y - 4, 16, 1, '#a57652'); R(ctx, X + 1, Y - 3, 14, Hp + 1, '#efe8da');
      R(ctx, X + 3, Y - 2, 10, 5, '#ffffff'); R(ctx, X + 3, Y + 2, 10, 1, '#d9d2c4');
      if (!used) { R(ctx, X + 1, Y + 6, 14, Hp - 8, '#5f8f78'); R(ctx, X + 1, Y + 6, 14, 2, '#79a891'); R(ctx, X + 1, Y + Hp - 3, 14, 1, '#4c7764'); }
      R(ctx, X, Y + Hp - 1, 2, 2, '#6d4a31'); R(ctx, X + 14, Y + Hp - 1, 2, 2, '#6d4a31');
    } }, used ? { zY: Y + Hp - 0.5, draw: ctx => { R(ctx, X + 1, Y + 9, 14, Hp - 11, '#5f8f78'); R(ctx, X + 1, Y + 9, 14, 2, '#79a891'); R(ctx, X + 1, Y + Hp - 3, 14, 1, '#4c7764'); } } : null];
  },
  icebath(f, X, Y, Wp, Hp, view) {
    return { zY: Y + Hp, draw: ctx => {
      shadowRect(ctx, X + 3, Y + Hp - 3, Wp - 2, 4);
      R(ctx, X + 1, Y - 2, Wp - 2, Hp, '#b9c2c8'); R(ctx, X + 1, Y - 2, Wp - 2, 1, '#e3e7e9'); R(ctx, X + 3, Y, Wp - 6, Hp - 6, '#8fd0e6');
      for (let i = 0; i < 6; i++) R(ctx, X + 6 + i * 6, Y + 3 + (i % 2) * 6, 3, 3, '#e8f7fb');
      const w = Math.floor(view.t * 2) % 3; R(ctx, X + 8 + w * 8, Y + 9, 6, 1, '#c3e9f4');
      R(ctx, X + 1, Y + Hp - 6, Wp - 2, 4, '#9aa3aa');
    } };
  },
  towels(f, X, Y) {
    return { zY: Y + T, draw: ctx => { shadowRect(ctx, X + 2, Y + 13, 13, 3); R(ctx, X + 1, Y - 10, 14, 24, '#a57b52'); for (let i = 0; i < 3; i++) { R(ctx, X + 3, Y - 8 + i * 7, 10, 3, ['#f7f6f0', '#cfe3ea', '#f7f6f0'][i]); R(ctx, X + 2, Y - 5 + i * 7, 12, 1, '#8a6440'); } } };
  },
  cooler(f, X, Y) {
    return { zY: Y + T, draw: ctx => {
      shadowRect(ctx, X + 3, Y + 13, 11, 3);
      R(ctx, X + 4, Y + 4, 2, 9, '#7b8582'); R(ctx, X + 11, Y + 4, 2, 9, '#7b8582'); R(ctx, X + 3, Y + 3, 11, 2, '#8a948f');
      R(ctx, X + 3, Y - 8, 11, 11, '#e8823c'); R(ctx, X + 3, Y - 8, 11, 2, '#f7f2e4'); R(ctx, X + 4, Y - 6, 2, 8, '#f59a55'); R(ctx, X + 7, Y + 1, 3, 2, '#f7f2e4');
      R(ctx, X + 1, Y + 8, 4, 5, '#f7f2e4'); R(ctx, X + 12, Y + 9, 3, 4, '#f7f2e4');
    } };
  },
  batRack(f, X, Y) {
    return { zY: Y + T, draw: ctx => {
      shadowRect(ctx, X + 2, Y + 13, 13, 3);
      R(ctx, X + 1, Y + 6, 14, 7, '#6f5039'); R(ctx, X + 1, Y + 6, 14, 1, '#8a6a4f');
      for (let i = 0; i < 5; i++) { R(ctx, X + 2 + i * 3, Y - 8 + (i % 2), 2, 15, i === 2 ? '#3a2c26' : '#d8ae72'); P(ctx, X + 2 + i * 3, Y - 8 + (i % 2), '#f0d29c'); }
    } };
  },
  basket(f, X, Y) {
    return { zY: Y + T, draw: ctx => {
      shadowRect(ctx, X + 2, Y + 13, 13, 3);
      R(ctx, X + 2, Y + 2, 12, 11, '#9aa3aa'); for (let i = 2; i < 14; i += 3) R(ctx, X + i, Y + 2, 1, 11, '#7b858c'); R(ctx, X + 2, Y + 2, 12, 1, '#c9cfd3');
      for (let i = 0; i < 6; i++) R(ctx, X + 3 + (i % 3) * 3 + (i > 2 ? 1 : 0), Y - 1 + (i > 2 ? 2 : 0), 2, 2, '#fbfaf4');
    } };
  },
  cage(f, X, Y, Wp, Hp) {
    const net = 'rgba(232,236,232,0.42)', post = '#59646a', postL = '#8a959b';
    const top = Y + 14, bot = Y + Hp - 2, hgt = 26;
    const back = { zY: Y + 8, draw: ctx => {
      R(ctx, X, top - hgt, Wp, hgt, 'rgba(60,72,70,0.18)');
      for (let x = 0; x < Wp; x += 4) R(ctx, X + x, top - hgt, 1, hgt, net);
      for (let y = 0; y < hgt; y += 4) R(ctx, X, top - hgt + y, Wp, 1, net);
      R(ctx, X, top - hgt, Wp, 1, post);
      for (const x of [0, Wp / 2, Wp - 2]) { R(ctx, X + x, top - hgt, 2, hgt, post); P(ctx, X + x, top - hgt, postL); }
    } };
    const sides = { zY: Y + Hp - 3, draw: ctx => {
      for (const x of [X, X + Wp - 2]) { R(ctx, x, top - hgt, 2, bot - top + hgt, post); for (let y = top - hgt; y < bot; y += 4) R(ctx, x - 1, y, 4, 1, net); }
      R(ctx, X, top - hgt, 2, 1, postL); R(ctx, X + Wp - 2, top - hgt, 2, 1, postL);
    } };
    const front = { zY: Y + Hp + 0.5, draw: ctx => {
      const gx0 = X + 1 * T, gx1 = X + 2 * T;
      for (let x = 0; x < Wp; x += 4) { if (X + x >= gx0 && X + x < gx1) continue; R(ctx, X + x, bot - hgt, 1, hgt, net); }
      for (let y = 0; y < hgt; y += 4) { R(ctx, X, bot - hgt + y, gx0 - X, 1, net); R(ctx, gx1, bot - hgt + y, X + Wp - gx1, 1, net); }
      R(ctx, X, bot - hgt, Wp, 1, post); R(ctx, X, bot - 1, gx0 - X, 1, post); R(ctx, gx1, bot - 1, X + Wp - gx1, 1, post);
      for (const x of [0, T, 2 * T, Wp / 2, Wp - 2]) { R(ctx, X + x, bot - hgt, 2, hgt, post); P(ctx, X + x, bot - hgt, postL); }
    } };
    return [back, sides, front];
  },
  machine(f, X, Y, Wp, Hp, view) {
    return { zY: Y + T, draw: ctx => {
      shadowRect(ctx, X + 1, Y + 13, 15, 3);
      R(ctx, X + 4, Y + 4, 2, 10, '#4f585e'); R(ctx, X + 11, Y + 4, 2, 10, '#4f585e'); R(ctx, X + 7, Y + 2, 2, 12, '#4f585e');
      R(ctx, X + 2, Y - 6, 13, 9, '#d4583f'); R(ctx, X + 2, Y - 6, 13, 1, '#ec7a5f');
      const s = Math.floor(view.t * 12) % 2; R(ctx, X + 1, Y - 4, 4, 6, s ? '#2f3540' : '#454d5a'); R(ctx, X + 1, Y - 3, 4, 1, '#7d8792');
      R(ctx, X + 9, Y - 12, 6, 6, '#9aa3aa'); R(ctx, X + 10, Y - 11, 4, 2, '#fbfaf4');
    } };
  },
  lscreen(f, X, Y) {
    return { zY: Y + T - 1, draw: ctx => {
      R(ctx, X + 2, Y - 10, 2, 22, '#59646a'); R(ctx, X + 12, Y - 2, 2, 14, '#59646a'); R(ctx, X + 2, Y - 10, 12, 1, '#59646a'); R(ctx, X + 4, Y - 2, 10, 1, '#59646a');
      for (let y = -9; y < 11; y += 3) R(ctx, X + 4, Y + y, y < -2 ? 8 : 8, 1, 'rgba(232,236,232,0.5)');
    } };
  },
  backnet(f, X, Y, Wp, Hp) {
    return { zY: Y + Hp - 2, draw: ctx => {
      const x = X + 6;
      R(ctx, x - 2, Y - 18, 6, Hp + 16, 'rgba(60,72,70,0.15)');
      for (let y = Y - 18; y < Y + Hp - 2; y += 4) R(ctx, x - 2, y, 6, 1, 'rgba(232,236,232,0.5)');
      for (const y of [Y - 18, Y + Hp / 2 - 10, Y + Hp - 22]) { R(ctx, x, y, 2, 22, '#59646a'); P(ctx, x, y, '#8a959b'); }
    } };
  },
  cones(f, X, Y) {
    return { zY: Y + 12, draw: ctx => { for (const [dx, dy] of [[2, 6], [9, 9]]) { R(ctx, X + dx + 1, Y + dy - 4, 3, 4, '#f08a3c'); P(ctx, X + dx + 2, Y + dy - 5, '#f08a3c'); R(ctx, X + dx, Y + dy, 5, 1, '#d06a2a'); R(ctx, X + dx + 1, Y + dy - 2, 3, 1, '#fff4e0'); } } };
  },
  hurdles(f, X, Y, Wp) {
    return { zY: Y + 12, draw: ctx => { for (let i = 0; i < 3; i++) { const x = X + 2 + i * 10; R(ctx, x, Y + 4, 1, 6, '#e8e4d8'); R(ctx, x + 7, Y + 4, 1, 6, '#e8e4d8'); R(ctx, x, Y + 4, 8, 2, i % 2 ? '#f2cf3c' : '#e5674f'); } void Wp; } };
  },
  scoreboard(f, X, Y, Wp, Hp, view) {
    return { zY: Y + T + 1, draw: ctx => {
      R(ctx, X + 6, Y - 4, 2, 18, '#4a5458'); R(ctx, X + Wp - 8, Y - 4, 2, 18, '#4a5458');
      R(ctx, X + 2, Y - 14, Wp - 4, 13, '#22303a'); R(ctx, X + 2, Y - 14, Wp - 4, 1, '#3d4e5a');
      R(ctx, X + 4, Y - 12, 8, 2, TEAM.g); R(ctx, X + 13, Y - 12, 22, 1, '#7d8a99');
      drawDigits(ctx, X + 20, Y - 9, view.clock || '09:00', '#f2b84a');
    } };
  },
  planter(f, X, Y, Wp, Hp, view) {
    return { zY: Y + T - 2, draw: ctx => {
      shadowRect(ctx, X + 2, Y + 11, 14, 3);
      R(ctx, X + 1, Y + 3, 14, 9, '#9b7f63'); R(ctx, X + 1, Y + 3, 14, 1, '#b39778');
      R(ctx, X + 2, Y - 3, 12, 7, '#5b9a50'); for (let i = 0; i < 4; i++) P(ctx, X + 3 + i * 3, Y - 3 + (i % 2) * 2, ['#f2d36b', '#f4f0dc', '#e8857a', '#f2d36b'][i]);
      void view;
    } };
  },
  notice(f, X, Y, Wp) {
    return { zY: Y + T + 1, draw: ctx => {
      R(ctx, X + 4, Y + 3, Wp - 8, 10, '#b78a5a'); R(ctx, X + 4, Y + 3, Wp - 8, 1, '#cfa274');
      R(ctx, X + 6, Y + 5, 6, 6, '#fbf8ef'); R(ctx, X + 13, Y + 5, 5, 4, '#f2cf7a'); R(ctx, X + 19, Y + 6, 6, 5, '#cfe3ea'); P(ctx, X + 8, Y + 5, '#d9534a');
    } };
  }
};

function steam(ctx, x, y, t) {
  for (let i = 0; i < 3; i++) {
    const p = (t * 0.8 + i / 3) % 1, a = 0.5 * (1 - p);
    R(ctx, x + Math.round(Math.sin((t + i) * 3) * 1.5), y - Math.round(p * 10), 2, 1, `rgba(255,255,255,${a.toFixed(2)})`);
  }
}

// 3×5 の小さな数字（電光掲示板・起用表）
const D5 = { 0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001', 5: '111100111001111', 6: '111100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001111', ':': '000010000010000' };
function drawDigits(ctx, x, y, s, c) {
  let cx = x;
  for (const ch of s) { const g = D5[ch]; if (!g) { cx += 2; continue; } for (let i = 0; i < 15; i++) if (g[i] === '1') P(ctx, cx + i % 3, y + Math.floor(i / 3), c); cx += ch === ':' ? 3 : 4; }
}
export { drawDigits };

// 起用表（ホワイトボード）。view.lineup = [{ num, color, slot }]。slot>=0 は打順、-1 は控え欄
function drawLineup(ctx, X, Y, Wp, Hp, view) {
  R(ctx, X + 1, Y + 1, Wp - 2, Hp - 3, '#aab2b8'); R(ctx, X + 2, Y + 2, Wp - 4, Hp - 5, '#fbfcfa');
  R(ctx, X + 4, Y + 4, 20, 2, TEAM.g); R(ctx, X + 56, Y + 4, 16, 2, '#9aa3aa');
  for (let i = 0; i < 9; i++) { R(ctx, X + 5, Y + 8 + i * 2, 1, 1, '#9aa3aa'); R(ctx, X + 14, Y + 8 + i * 2, 30, 1, '#d5dadd'); }
  R(ctx, X + 52, Y + 7, 1, 19, '#c5cbcf');
  for (const m of view.lineup || []) {
    const mx = m.x != null ? m.x : (m.slot >= 0 ? X + 8 : X + 56 + (m.bench % 3) * 7), my = m.y != null ? m.y : (m.slot >= 0 ? Y + 7 + m.slot * 2 : Y + 9 + Math.floor(m.bench / 3) * 6);
    R(ctx, Math.round(mx), Math.round(my), 5, 2, m.color); if (m.hi) R(ctx, Math.round(mx) - 1, Math.round(my) - 1, 7, 4, 'rgba(242,184,74,0.6)'), R(ctx, Math.round(mx), Math.round(my), 5, 2, m.color);
  }
  R(ctx, X + Wp - 14, Y + Hp - 4, 8, 1, '#3a404c'); P(ctx, X + Wp - 18, Y + Hp - 4, '#d9534a');
}
export const lineupGeometry = (X, Y) => ({ slot: i => ({ x: X + 8, y: Y + 7 + i * 2 }), bench: i => ({ x: X + 56 + (i % 3) * 7, y: Y + 9 + Math.floor(i / 3) * 6 }) });
