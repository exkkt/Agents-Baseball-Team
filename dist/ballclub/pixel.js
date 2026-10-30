// ドット絵の共通道具：色計算・キャンバス・輪郭。ブラウザ専用（sim/world からは読み込まない）
export const T = 16;
const rgbCache = new Map();
export const rgb = c => {
  if (rgbCache.has(c)) return rgbCache.get(c);
  const n = parseInt(c.slice(1), 16), v = [n >> 16 & 255, n >> 8 & 255, n & 255];
  rgbCache.set(c, v); return v;
};
const toHex = v => '#' + v.map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
export const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return toHex(A.map((x, i) => x + (B[i] - x) * t)); };
// f<1で暗く（影は少し青紫へ寄せる）、f>1で明るく
export const shade = (c, f) => f < 1 ? toHex(rgb(mix(c, '#2a2440', 0.18 * (1 - f) / 0.5)).map(x => x * f)) : mix(c, '#fffaf0', Math.min(1, f - 1));
// 画面外の下絵・スプライトは CPU 側に置く（GPU のリセットで中身が消え、背景が黒くなるのを防ぐ）
export const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d', { willReadFrequently: true }); return c; };

// ピクセル単位で塗る小さな筆。座標は原点（足元など）からの相対
export function painter(ctx, ox, oy, flip = false, w = 0) {
  const X = x => flip ? w - 1 - (ox + x) : ox + x;
  const g = {
    ctx,
    r(x, y, ww, hh, c) { if (!c || ww <= 0 || hh <= 0) return; ctx.fillStyle = c; flip ? ctx.fillRect(X(x) - ww + 1, oy + y, ww, hh) : ctx.fillRect(ox + x, oy + y, ww, hh); },
    p(x, y, c) { g.r(x, y, 1, 1, c); },
    // 太さ s の線（正方形の筆を並べる）
    line(x0, y0, x1, y1, s, c) {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
      for (let i = 0; i <= n; i++) g.r(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), s, s, c);
    },
    tpl(rows, x, y, colors) {
      rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) { const k = row[i]; if (k !== '.' && colors[k]) g.p(x + i, y + j, colors[k]); } });
    }
  };
  return g;
}

// シルエットの縁を暗くする（内側の輪郭線）
export function innerOutline(cv, f = 0.62) {
  const ctx = cv.getContext('2d'), { width: w, height: h } = cv, img = ctx.getImageData(0, 0, w, h), d = img.data, src = new Uint8ClampedArray(d);
  const a = (x, y) => x < 0 || y < 0 || x >= w || y >= h ? 0 : src[(y * w + x) * 4 + 3];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; if (!src[i + 3]) continue;
    if (!a(x - 1, y) || !a(x + 1, y) || !a(x, y - 1) || !a(x, y + 1)) {
      d[i] = src[i] * f + 42 * (1 - f) * 0.3; d[i + 1] = src[i + 1] * f + 36 * (1 - f) * 0.3; d[i + 2] = src[i + 2] * f + 64 * (1 - f) * 0.3;
    }
  }
  ctx.putImageData(img, 0, 0); return cv;
}

// 外側に 1px の輪郭。色は隣の色を暗くしたもの（髪の縁は焦げ茶、肌の縁は赤茶…）
export function selOutline(cv, f = 0.42) {
  const ctx = cv.getContext('2d'), { width: w, height: h } = cv, img = ctx.getImageData(0, 0, w, h), d = img.data, src = new Uint8ClampedArray(d);
  const at = (x, y) => x < 0 || y < 0 || x >= w || y >= h ? -1 : (src[(y * w + x) * 4 + 3] > 128 ? (y * w + x) * 4 : -1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; if (src[i + 3]) continue;
    // 下と横を優先（上の縁は少し明るめにして立体感を残す）
    const n = [at(x, y - 1), at(x - 1, y), at(x + 1, y), at(x, y + 1)].find(v => v >= 0);
    if (n === undefined) continue;
    const k = at(x, y + 1) >= 0 ? f + 0.08 : f;
    d[i] = src[n] * k + 30 * (1 - k) * 0.4; d[i + 1] = src[n + 1] * k + 24 * (1 - k) * 0.4; d[i + 2] = src[n + 2] * k + 48 * (1 - k) * 0.4; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); return cv;
}

// 選択用の外側輪郭（1px）
export function outerOutline(cv, color = '#fffaf0') {
  const { width: w, height: h } = cv, out = canvas(w, h), src = cv.getContext('2d').getImageData(0, 0, w, h).data, ctx = out.getContext('2d');
  const [r, g, b] = rgb(color), img = ctx.createImageData(w, h), d = img.data;
  const a = (x, y) => x < 0 || y < 0 || x >= w || y >= h ? 0 : src[(y * w + x) * 4 + 3];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (a(x, y)) continue;
    if (a(x - 1, y) || a(x + 1, y) || a(x, y - 1) || a(x, y + 1)) { const i = (y * w + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; }
  }
  ctx.putImageData(img, 0, 0); return out;
}

export const flipped = cv => { const o = canvas(cv.width, cv.height), c = o.getContext('2d'); c.translate(cv.width, 0); c.scale(-1, 1); c.drawImage(cv, 0, 0); return o; };

// 決定的な疑似乱数（描画の揺らぎ用）
export const hash = (...n) => { let h = 2166136261; for (const v of n) { h ^= v & 0xffff; h = Math.imul(h, 16777619); h ^= v >>> 16; h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; };
