// 人物のドット絵。姿勢（関節の位置）→ 2頭身の人物を原寸で描き、キャッシュする
import { canvas, painter, selOutline, outerOutline, flipped, shade, mix } from './pixel.js';

export const SW = 52, SH = 60, AX = 26, AY = 48; // スプライト枠と原点（立ち姿は足元、着席は腰）
export const TEAM = { g: '#2f6a4f', gD: '#21503a', gL: '#4d8c69', cr: '#f1ead6', crS: '#d3c9ae' };
export const SKINS = [['#f4d2b0', '#dcab86'], ['#e9bb93', '#cc9670'], ['#d29e70', '#b07c52'], ['#9c6a47', '#7a4e33']];
export const HAIRS = { black: '#2f2a31', dark: '#4a3429', brown: '#7a543a', chestnut: '#9a643b', gray: '#8e8a86', silver: '#c4bfb6', ash: '#5d5650' };

// ── 頭（10×12、上2行は髪のボリューム）。s肌 k肌影 e目 r頬 h髪 H髪ハイライト
const FACE = {
  down: ['..........', '..........', '..ssssss..', '.ssssssss.', 'ssssssssss', 'ssssssssss', 'ssssssssss', 'ssessssess', 'ssessssess', 'srssssssrs', '.kssssssk.', '..kkkkkk..'],
  up: ['..........', '..........', '..ssssss..', '.ssssssss.', 'ssssssssss', 'ssssssssss', 'ssssssssss', 'ssssssssss', 'ssssssssss', 'ssssssssss', '.ssssssss.', '..kkkkkk..'],
  right: ['..........', '..........', '..ssssss..', '.ssssssss.', 'ssssssssss', 'ssssssssss', 'ssssssssss', 'sssssssess', 'sssskssess', 'ssssssssrs', '.sssssssk.', '..kkkkk...']
};
const HAIR = {
  short: {
    down: ['..........', '...hhhh...', '..hhhhhh..', '.hhHHhhhh.', 'hhHhhhhhhh', 'hhhhhhhhhh', 'hhh.hhhh.h', 'h........h', 'h........h'],
    up: ['..........', '...hhhh...', '..hhhhhh..', '.hhHHhhhh.', 'hhHhhhhhhh', 'hhhhhhhhhh', 'hhhhhhhhhh', 'hhhhhhhhhh', 'shhhhhhhhs', '.hhhhhhhh.', '..hhhhhh..'],
    right: ['..........', '..hhhh....', '.hhhhhhh..', 'hhhHHhhhh.', 'hhhhhhhhhh', 'hhhhhhhhhh', 'hhhhhhhh.h', 'hhhh......', 'hhh.......', 'hhh.......', '.hh.......']
  },
  spiky: {
    down: ['..h.h..h..', '.hhhhhhhh.', '.hhhhhhhhh', 'hhhHHhhhhh', 'hhHhhhhhhh', 'hhhhhhhhhh', 'h.hhh.hh.h', 'h........h'],
    up: ['..h.h..h..', '.hhhhhhhh.', '.hhhhhhhhh', 'hhhHHhhhhh', 'hhHhhhhhhh', 'hhhhhhhhhh', 'hhhhhhhhhh', 'hhhhhhhhhh', 'shhhhhhhhs', '.hhhhhhhh.', '..hhhhhh..'],
    right: ['.h.h.h....', 'hhhhhhh...', '.hhhhhhhh.', 'hhhHHhhhhh', 'hhhhhhhhhh', 'hhhhhhhhhh', 'hhhhhhh.hh', 'hhhh......', 'hhh.......', 'hhh.......', '.hh.......']
  },
  sidepart: {
    down: ['..........', '...hhhh...', '..hhhhhh..', '.hhhhhHHh.', 'hhhhhhhhhh', 'hhhhhhhhhh', 'hhhhh....h', 'hh.......h', 'h.........'],
    up: ['..........', '...hhhh...', '..hhhhhh..', '.hhHHhhhh.', 'hhHhhhhhhh', 'hhhhhhhhhh', 'hhhhhhhhhh', 'hhhhhhhhhh', 'shhhhhhhhs', '.hhhhhhhh.', '..hhhhhh..'],
    right: ['..........', '..hhhh....', '.hhhhhhh..', 'hhhhHHhhh.', 'hhhhhhhhhh', 'hhhhhhhhhh', 'hhhhhhhhh.', 'hhhh......', 'hhh.......', 'hhh.......', '.hh.......']
  },
  bob: {
    down: ['..........', '..hhhhhh..', '.hhhhhhhh.', 'hhhHHhhhhh', 'hhHhhhhhhh', 'hhhhhhhhhh', 'hhhhhhhhhh', 'hh......hh', 'hh......hh', 'hh......hh', '.h......h.'],
    up: ['..........', '..hhhhhh..', '.hhhhhhhh.', 'hhhHHhhhhh', 'hhHhhhhhhh', 'hhhhhhhhhh', 'hhhhhhhhhh', 'hhhhhhhhhh', 'hhhhhhhhhh', 'hhhhhhhhhh', '.hhhhhhhh.', '..hhhhhh..'],
    right: ['..........', '..hhhhh...', '.hhhhhhhh.', 'hhhHHhhhhh', 'hhHhhhhhhh', 'hhhhhhhhhh', 'hhhhhhhhhh', 'hhhhhh....', 'hhhhh.....', 'hhhhh.....', '.hhhh.....', '..hh......']
  },
  buzz: {
    down: ['..........', '..........', '..hhhhhh..', '.hhhhhhhh.', 'hhhhhhhhhh', 'hhhhhhhhhh', 'h........h'],
    up: ['..........', '..........', '..hhhhhh..', '.hhHHhhhh.', 'hhhhhhhhhh', 'hhhhhhhhhh', 'hhhhhhhhhh', 'hhhhhhhhhh', 'shhhhhhhhs', '.hhhhhhhh.'],
    right: ['..........', '..........', '..hhhhh...', '.hhhhhhhh.', 'hhhhhhhhhh', 'hhhhhhhh..', 'hhhhh.....', 'hhhh......', 'hhh.......', '.hh.......']
  }
};
// 帽子類。c本体 L記章/光沢 b つば o バンダナ g マスク
const WEAR = {
  cap: {
    down: ['..........', '...cccc...', '..cccccc..', '.cccLLccc.', 'ccccLLcccc', 'cccccccccc', 'bbbbbbbbbb'],
    up: ['..........', '...cccc...', '..cccccc..', '.cccccccc.', 'cccccccccc', 'cccccccccc', 'cccc..cccc'],
    right: ['..........', '..ccccc...', '.ccccccc..', 'cccccLccc.', 'cccccccccc', 'cccccccccc', 'ccccccbbbbbb'],
    hides: 7
  },
  helmet: {
    down: ['..........', '...cccc...', '..ccLccc..', '.cLLcccccc', 'cccccccccc', 'cccccccccc', 'bbbbbbbbbb', 'cc......cc', 'cc......cc'],
    up: ['..........', '...cccc...', '..ccLccc..', '.cLLcccccc', 'cccccccccc', 'cccccccccc', 'cccccccccc', 'cccccccccc', 'cc......cc'],
    right: ['..........', '..ccccc...', '.ccLcccc..', 'cLLccccccc', 'cccccccccc', 'cccccccccc', 'cccccccbbb', 'cccc......', 'cccc......', '.cc.......'],
    hides: 10
  },
  mask: {
    down: ['..........', '...cccc...', '..ccLccc..', '.cLLcccccc', 'cccccccccc', 'cccccccccc', 'cgggggggc.', 'cg.g.g.gc.', 'cgggggggc.', '.g.g.g.g..', '..gggggg..'],
    up: ['..........', '...cccc...', '..ccLccc..', '.cLLcccccc', 'cccccccccc', 'cccccccccc', 'cccccccccc', 'cccccccccc', 'cc......cc'],
    right: ['..........', '..ccccc...', '.ccLcccc..', 'cLLccccccc', 'cccccccccc', 'ccccccccgg', 'cccccccg.g', 'cccccgggg.', 'cccc.g.g.g', '.ccc.gggg.', '.....g.g..'],
    hides: 10
  },
  bandana: {
    down: ['..........', '..........', '..oooooo..', '.oooooooo.', 'ooOooooooo', 'oooooooooo'],
    up: ['..........', '..........', '..oooooo..', '.oooooooo.', 'oooooooooo', 'oooooooooo', '....oo....', '...o..o...'],
    right: ['..........', '..........', '..ooooo...', '.oooooooo.', 'ooooOooooo', 'oooooooooo', 'o.........', 'oo........'],
    hides: 6
  }
};

// 3×4 の数字（背番号）
const DIGITS = { 0: ['111', '101', '101', '111'], 1: ['010', '110', '010', '111'], 2: ['111', '011', '100', '111'], 3: ['111', '011', '001', '111'], 4: ['101', '101', '111', '001'], 5: ['111', '110', '001', '110'], 6: ['100', '111', '101', '111'], 7: ['111', '001', '010', '010'], 8: ['111', '111', '101', '111'], 9: ['111', '101', '111', '001'] };

export function outfitColors(look) {
  const base = { shoe: '#2d2a30', belt: '#2d2a30', socks: null, sleeve2: null, acc: null, shirt: null };
  const u = { pants: '#ebe3cd', pantsS: '#cdc3a8', socks: TEAM.g, belt: TEAM.gD };
  switch (look.outfit) {
    case 'uniform': return { ...base, ...u, top: TEAM.cr, topS: TEAM.crS, topH: '#fbf7ea', acc: TEAM.g, sleeve2: TEAM.g, num: TEAM.g };
    case 'coach': return { ...base, ...u, top: TEAM.g, topS: TEAM.gD, topH: TEAM.gL, acc: TEAM.cr, sleeve2: TEAM.g, num: TEAM.cr };
    case 'suit': return { ...base, top: '#3b4868', topS: '#2c3652', topH: '#4f5d80', acc: '#b9473b', shirt: '#eef0ec', pants: '#323b56', pantsS: '#262d44', shoe: '#2a2326' };
    case 'blazer': return { ...base, top: '#7b5b42', topS: '#634631', topH: '#8f6d51', shirt: '#bfd5e8', pants: '#4b4e57', pantsS: '#3b3d45', shoe: '#3b2a22' };
    case 'cardigan': return { ...base, top: '#3f7f84', topS: '#30676c', topH: '#53949a', shirt: '#f3efe4', pants: '#cdb894', pantsS: '#b29d7a', shoe: '#6b4f3a' };
    case 'polo': return { ...base, top: '#3f86a3', topS: '#306c86', topH: '#58a0bb', shirt: '#f6f5ef', pants: '#2f3b55', pantsS: '#242e44', shoe: '#e9e8e2', belt: '#242e44' };
    case 'cook': return { ...base, top: '#f3f2ec', topS: '#d4d2c8', topH: '#ffffff', apron: '#3f6d58', pants: '#4a4a52', pantsS: '#3a3a40', shoe: '#2b2b2b' };
    default: return { ...base, top: '#9aa3a8', topS: '#7d868b', topH: '#b0b8bc', pants: '#4a4a52', pantsS: '#3a3a40' };
  }
}

function headColors(look, wear) {
  const [s, k] = SKINS[look.skin || 0], h = HAIRS[look.hair] || look.hair;
  return {
    s, k, r: mix(s, '#e47a6c', 0.3), e: '#2a2230', h, H: shade(h, 1.22), x: shade(h, 0.72), g: '#33303a', w: '#d9eef7', m: '#9b4a46',
    c: wear === 'helmet' || wear === 'mask' ? (look.role === 'catcher' && wear === 'mask' ? '#2e3a52' : TEAM.g) : TEAM.g,
    L: wear === 'cap' ? TEAM.cr : '#6fa88a', b: TEAM.gD, o: '#d9783a', O: '#ef9a55'
  };
}

// ── 1体を描く。pose の座標は原点からの相対（y はマイナスが上）
function drawFigure(look, pose) {
  const body = canvas(SW, SH), g = painter(body.getContext('2d'), AX, AY);
  const back = canvas(SW, SH), gb = painter(back.getContext('2d'), AX, AY);
  const oc = outfitColors(look), dir = pose.dir, side = dir === 'right';
  const tw = look.build === 'big' ? 5 : 4, hip = pose.hip, top = hip - 6, lean = pose.lean || 0;
  const wear = pose.wear;
  const gear = pose.gear;
  const sleeveCol = (frac) => frac < 0.4 || !oc.sleeve2 ? oc.top : oc.sleeve2;

  const drawArm = (pts, dark) => {
    if (!pts) return;
    const c1 = dark ? shade(oc.top, 0.8) : oc.top, c2 = dark ? shade(oc.sleeve2 || oc.top, 0.8) : (oc.sleeve2 || oc.top);
    let total = 0; for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    let run = 0;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
      for (let j = 0; j <= n; j++) {
        const fr = (run + Math.hypot(x1 - x0, y1 - y0) * j / n) / (total || 1);
        g.r(Math.round(x0 + (x1 - x0) * j / n), Math.round(y0 + (y1 - y0) * j / n), 2, 2, fr < 0.4 ? c1 : c2);
      }
      run += Math.hypot(x1 - x0, y1 - y0);
    }
    const [hx, hy] = pts[pts.length - 1];
    const [sk] = SKINS[look.skin || 0];
    g.r(hx, hy, 2, 2, dark ? shade(sk, 0.85) : sk);
  };
  const legCol = (lower) => lower && oc.socks ? oc.socks : oc.pants;
  const sideLeg = (L, dark) => {
    if (!L) return;
    const hx = lean + (L.hx || 0), hy = Math.min(hip + 1, -3), [kx, ky] = L.k, [fx, fy] = L.f;
    const c = x => dark ? shade(x, 0.78) : x;
    g.line(hx - 1, hy, kx - 1, ky - 1, 3, c(legCol(false)));
    g.line(kx - 1, ky - 1, fx - 1, fy - 3, 3, c(legCol(true)));
    if (gear === 'catcher') g.line(kx - 1, ky - 1, fx - 1, fy - 3, 3, c('#2e3a52'));
    g.r(fx - 1, fy - 1, 4, 2, c(oc.shoe)); g.p(fx + 2, fy - 1, c(shade(oc.shoe, 1.3)));
  };
  const frontLegs = (L) => {
    const k = L.k;
    if (k === 'none') return;
    if (k === 'sitBack') { g.r(-tw, hip + 1, 2 * tw, 1, oc.pants); return; }
    if (k === 'sit') { // 太ももが手前に伸び、すねと靴が下に見える
      g.r(-tw, hip + 1, 2 * tw, 2, oc.pants); g.r(-tw + 1, hip + 1, 2 * tw - 2, 1, shade(oc.pants, 1.12));
      g.r(-tw, hip + 3, tw - 1, 3, legCol(true)); g.r(1, hip + 3, tw - 1, 3, legCol(true));
      g.r(-tw, hip + 6, tw - 1, 2, oc.shoe); g.r(1, hip + 6, tw - 1, 2, oc.shoe);
      return;
    }
    const lift = k === 'walk' ? (L.f === 0 ? [1, 0] : L.f === 2 ? [0, 1] : [0, 0]) : [0, 0];
    const len = -2 - (hip + 1); // 腰下〜靴上の行数
    g.r(-tw, hip + 1, 2 * tw, 2, oc.pants);
    [[-tw, lift[0]], [1, lift[1]]].forEach(([x, up]) => {
      const w = tw - 1, y0 = hip + 3, y1 = -3 - up;
      g.r(x, y0, w, y1 - y0 + 1, oc.pants);
      if (oc.socks) g.r(x, y1 - 1, w, 2, oc.socks);
      if (gear === 'catcher') g.r(x, y1 - 3, w, 4, '#2e3a52');
      g.r(x, -2 - up, w, 2, oc.shoe);
      if (dir === 'down') g.r(x, -2 - up, w, 1, shade(oc.shoe, 1.3));
    });
    g.r(-1, hip + 1, 2, 1, oc.pantsS);
    void len;
  };
  const torso = () => {
    if (side) {
      g.r(lean - 3, top, 6, 6, oc.top); g.r(lean - 3, top, 1, 6, oc.topS); g.r(lean - 2, top, 4, 1, oc.topH);
      if (oc.shirt && look.outfit !== 'cardigan') g.p(lean + 2, top, oc.shirt);
      if (look.outfit === 'suit') { g.p(lean + 2, top + 1, oc.acc); }
      if (look.outfit === 'coach') g.r(lean - 2, top + 2, 1, 4, TEAM.cr);
      if (oc.apron) g.r(lean + 1, top + 2, 2, 8, oc.apron);
      if (gear === 'catcher') g.r(lean, top, 3, 6, '#2e3a52');
      g.r(lean - 3, hip, 6, 1, oc.belt);
      return;
    }
    g.r(-tw, top, 2 * tw, 6, oc.top); g.r(-tw, top, 1, 6, oc.topS); g.r(tw - 1, top, 1, 6, oc.topS); g.r(-tw + 1, top, 2 * tw - 2, 1, oc.topH);
    const o = look.outfit;
    if (dir === 'down') {
      if (o === 'uniform') { g.r(-1, top, 2, 1, oc.acc); g.r(0, top + 1, 1, 5, oc.topS); g.r(-tw + 1, top + 2, 2, 2, oc.acc); }
      if (o === 'coach') { g.r(-2, top, 4, 1, TEAM.cr); g.r(0, top + 1, 1, 5, TEAM.cr); g.r(-tw + 1, top + 2, 2, 1, TEAM.cr); }
      if (o === 'suit') { g.r(-2, top, 4, 1, oc.shirt); g.r(-1, top + 1, 2, 1, oc.shirt); g.r(-1, top, 1, 4, oc.acc); g.p(0, top, oc.acc); g.p(-1, top + 4, oc.topS); }
      if (o === 'blazer' || o === 'cardigan') { g.r(-2, top, 4, 1, oc.shirt); g.r(-1, top + 1, 2, 2, oc.shirt); g.p(0, top + 4, oc.topS); }
      if (o === 'polo') { g.r(-2, top, 4, 1, oc.shirt); g.p(0, top + 1, oc.shirt); g.p(-tw + 1, top + 2, oc.shirt); }
      if (o === 'cook') { g.p(-2, top + 1, oc.topS); g.p(-2, top + 3, oc.topS); g.p(1, top + 1, oc.topS); g.p(1, top + 3, oc.topS); }
    } else {
      if (o === 'uniform' || o === 'coach') {
        const num = String(look.number ?? ''), w = num.length * 4 - 1;
        [...num].forEach((d, i) => DIGITS[d].forEach((row, y) => [...row].forEach((v, x) => v === '1' && g.p(-Math.ceil(w / 2) + i * 4 + x, top + 1 + y, oc.num))));
      }
      if (o === 'suit' || o === 'blazer') g.r(0, top + 2, 1, 4, oc.topS);
      if (o === 'cook') { g.r(-tw + 1, top + 2, 2 * tw - 2, 1, oc.apron); }
    }
    if (gear === 'catcher') { g.r(-tw + 1, top, 2 * tw - 2, 6, '#2e3a52'); g.r(-tw + 2, top + 2, 2 * tw - 4, 1, '#44527a'); g.r(-tw + 2, top + 4, 2 * tw - 4, 1, '#44527a'); }
    g.r(-tw, hip, 2 * tw, 1, oc.belt);
    if (oc.apron && dir === 'down') { g.r(-tw + 1, top + 2, 2 * tw - 2, 8, oc.apron); g.r(-tw + 1, top + 2, 2 * tw - 2, 1, shade(oc.apron, 1.2)); }
  };
  const head = () => {
    const x0 = (side ? lean - 4 : -5) + (pose.hx || 0), y0 = top - 12 + (pose.hy || 0);
    const col = headColors(look, wear), face = FACE[dir].slice();
    if (pose.eyes === 'closed' || pose.eyes === 'blink') face[7] = face[7].replace(/e/g, 's'), face[8] = face[8].replace(/e/g, 'k');
    if (pose.eyes === 'down' && dir === 'down') face[7] = face[7].replace(/e/g, 's');
    g.tpl(face, x0, y0, col);
    const hair = (HAIR[look.hairStyle] || HAIR.short)[dir], hides = wear ? WEAR[wear].hides : 0;
    g.tpl(hair.map((r, i) => i < hides ? '..........' : r), x0, y0, col);
    if (look.glasses && dir !== 'up' && wear !== 'mask') {
      if (dir === 'down') { g.tpl(['.gwggggwg.'], x0, y0 + 7, col); } else g.tpl(['.....gwgg.'], x0, y0 + 7, col);
    }
    if (look.mustache && dir !== 'up' && wear !== 'mask') g.tpl([dir === 'down' ? '...xxxx...' : '.......xx.'], x0, y0 + 9, col);
    if (pose.mouth && dir !== 'up' && wear !== 'mask') g.tpl([dir === 'down' ? '....mm....' : '........m.'], x0, y0 + 9 + (look.mustache ? 1 : 0), col);
    if (wear) g.tpl(WEAR[wear][dir], x0, y0, col);
  };

  const A = pose.arms || {};
  // 奥側（背中側）の道具
  (pose.props || []).filter(p => p.z === 'back').forEach(p => drawProp(gb, p));
  if (side) {
    drawArm(A.a, true); sideLeg(pose.legs.f, true); sideLeg(pose.legs.n, false);
    torso(); head(); drawArm(A.b, false);
  } else if (dir === 'down') {
    frontLegs(pose.legs); torso(); drawArm(A.a); drawArm(A.b); head();
  } else {
    frontLegs(pose.legs); drawArm(A.a); drawArm(A.b); torso(); head();
  }
  (pose.props || []).filter(p => p.z === 'body').forEach(p => drawProp(g, p));
  selOutline(body);
  const out = canvas(SW, SH), go = painter(out.getContext('2d'), AX, AY);
  out.getContext('2d').drawImage(back, 0, 0); out.getContext('2d').drawImage(body, 0, 0);
  (pose.props || []).filter(p => !p.z || p.z === 'front').forEach(p => drawProp(go, p));
  if (pose.trail) drawTrail(go, pose.trail);
  let over = null;
  if (pose.over && pose.over.length) {
    over = canvas(SW, SH); const gv = painter(over.getContext('2d'), AX, AY);
    pose.over.forEach(p => p.k === 'hand' ? drawHand(gv, p, look, oc) : drawProp(gv, p));
  }
  return { body: out, over };
}

function drawHand(g, p, look, oc) {
  const [sk, sks] = SKINS[look.skin || 0];
  if (p.arm) g.r(p.x, p.y - 1, 2, 1, shade(oc.sleeve2 || oc.top, 0.9));
  g.r(p.x, p.y, 2, 2, sk); g.p(p.x + 1, p.y + 1, sks);
}

const WOOD = '#d8ae72', WOODD = '#8c5f35', WOODL = '#f0d29c';
export function drawProp(g, p) {
  const { x, y } = p;
  switch (p.k) {
    case 'bat': case 'fungo': {
      const n = Math.max(Math.abs(p.x2 - x), Math.abs(p.y2 - y), 1), thin = p.k === 'fungo';
      for (let i = 0; i <= n; i++) {
        const t = i / n, px = Math.round(x + (p.x2 - x) * t), py = Math.round(y + (p.y2 - y) * t);
        if (t < 0.12) { g.p(px, py, '#3a2c26'); continue; }
        g.p(px, py, WOOD);
        if (!thin && t > 0.45) { g.p(px + (Math.abs(p.y2 - y) > Math.abs(p.x2 - x) ? 1 : 0), py + (Math.abs(p.y2 - y) > Math.abs(p.x2 - x) ? 0 : 1), WOODD); }
      }
      g.p(p.x2, p.y2, WOODL);
      break;
    }
    case 'ball': g.r(x, y, 2, 2, '#fbfaf4'); g.p(x + 1, y + 1, '#c9c2b4'); g.p(x, y, '#ffffff'); break;
    case 'glove': g.r(x, y, 3, 3, '#a6612e'); g.r(x, y, 3, 1, '#c57e43'); g.p(x + 2, y + 2, '#6e3d1c'); g.p(x + 1, y + 1, '#83491f'); break;
    case 'mitt': g.r(x, y, 4, 4, '#8a4d24'); g.r(x + 1, y + 1, 2, 2, '#5f3416'); g.r(x, y, 4, 1, '#a9663a'); break;
    case 'clip': g.r(x, y, 4, 5, '#8a5a34'); g.r(x, y + 1, 4, 4, '#f6f2e6'); g.r(x + 1, y, 2, 1, '#b8b4a8'); g.p(x + 1, y + 2, '#9aa2aa'); g.p(x + 1, y + 3, '#9aa2aa'); g.p(x + 2, y + 3, '#9aa2aa'); break;
    case 'paper': { const w = p.w || 6; g.r(x, y, w, 4, '#fbf8ef'); g.r(x, y + 3, w, 1, '#ddd6c4'); g.r(x + 1, y + 1, w - 2, 1, '#a7aeb6'); if (p.flip) g.p(x + w - 1, y, '#ddd6c4'); else g.r(x + 1, y + 2, w - 3, 1, '#c3c8cc'); break; }
    case 'card': g.r(x, y, 4, 5, '#fbf8ef'); g.r(x, y, 4, 1, TEAM.g); g.p(x + 1, y + 2, '#8d939a'); g.p(x + 2, y + 3, '#8d939a'); break;
    case 'tablet': g.r(x, y, 5, 4, '#2f3440'); g.r(x + 1, y + 1, 3, 2, '#7ac5dc'); break;
    case 'pen': g.r(x, y, 1, 2, '#2f3440'); break;
    case 'cup': g.r(x, y, 2, 3, '#f4f2ea'); g.p(x, y, '#7a4a2a'); break;
    case 'bottle': g.r(x, y, 2, 4, '#7cc4cf'); g.p(x, y, '#e8f4f4'); g.r(x, y + 3, 2, 1, '#4f9aa6'); break;
    case 'chop': g.line(x, y, x + 1, y - 3, 1, '#c9a26a'); break;
    case 'ladle': g.line(x, y, x - 1, y + 4, 1, '#9aa0a6'); g.r(x - 2, y + 4, 2, 1, '#9aa0a6'); break;
    case 'towel': g.r(x, y, 4, 2, '#f7f6f0'); g.r(x, y + 1, 4, 1, '#d9e3e6'); break;
    case 'tape': g.r(x, y, 2, 2, '#e8e3d2'); g.p(x, y, '#ffffff'); break;
  }
}

function drawTrail(g, t) {
  const ctx = g.ctx; ctx.save(); ctx.globalAlpha = 0.55;
  for (let i = 0; i <= 14; i++) {
    const s = i / 14, x = (1 - s) * (1 - s) * t[0][0] + 2 * (1 - s) * s * t[1][0] + s * s * t[2][0], y = (1 - s) * (1 - s) * t[0][1] + 2 * (1 - s) * s * t[1][1] + s * s * t[2][1];
    g.p(Math.round(x), Math.round(y), '#fffaf0');
  }
  ctx.restore();
}

// ── 姿勢の定義。st = { kind, ph, f, dir, hold, eyes, mouth, wear }
const geo = (look, dir, hip, lean = 0) => {
  const tw = look.build === 'big' ? 5 : 4, top = hip - 6;
  if (dir === 'right') return { tw, hip, top, a: [lean - 2, top + 1], b: [lean - 1, top] };
  return { tw, hip, top, a: [-tw - 2, top], b: [tw, top] };
};
const baseHip = look => -7 - (look.tall ? 1 : 0);
const armsDown = (G, dir, da = 0, db = 0) => dir === 'right'
  ? { a: [G.a, [G.a[0], G.top + 5 + da]], b: [G.b, [G.b[0], G.top + 5 + db]] }
  : { a: [G.a, [G.a[0], G.top + 5 + da]], b: [G.b, [G.b[0], G.top + 5 + db]] };
const sideStand = (spread = 1) => ({ k: 'side', n: { k: [0, -4], f: [-spread, -1] }, f: { k: [1, -4], f: [spread, -1] } });

// 持ち物を前に構える（歩きながら運ぶ・立って読む）
function holdArms(G, dir, item) {
  if (dir === 'right') return { arms: { a: [G.a, [G.a[0] + 2, G.top + 3]], b: [G.b, [G.b[0] + 1, G.top + 3], [G.b[0] + 3, G.top + 2]] }, props: [{ k: item, x: G.b[0] + 3, y: G.top + 1, z: 'front' }] };
  if (dir === 'up') return { arms: { a: [G.a, [G.a[0] + 1, G.top + 3]], b: [G.b, [G.b[0] - 1, G.top + 3]] }, props: [] };
  return { arms: { a: [G.a, [G.a[0], G.top + 3], [-3, G.top + 3]], b: [G.b, [G.b[0], G.top + 3], [1, G.top + 3]] }, props: [{ k: item, x: -3, y: G.top + 1, w: 6, z: 'front' }] };
}

const POSES = {
  stand(look, st) {
    const hip = baseHip(look) + (st.f === 1 ? 0 : 0), G = geo(look, st.dir, hip);
    const breath = st.f === 1 ? -1 : 0;
    const pose = { hip, legs: st.dir === 'right' ? sideStand(1) : { k: 'stand' }, arms: armsDown(G, st.dir), hy: breath };
    if (st.hold) Object.assign(pose, holdArms(G, st.dir, st.hold));
    return pose;
  },
  walk(look, st) {
    const f = st.f % 4, bob = f % 2 ? -1 : 0, hip = baseHip(look) + bob, G = geo(look, st.dir, hip);
    if (st.dir === 'right') {
      const s = [3, 0, -3, 0][f], lift = [0, 1, 0, 2][f];
      const legs = { k: 'side', n: { k: [s / 2 + 1, -4 - (lift === 2 ? 1 : 0)], f: [s, lift === 2 ? -2 : -1] }, f: { k: [-s / 2 + 1, -4 - (lift === 1 ? 1 : 0)], f: [-s, lift === 1 ? -2 : -1] } };
      const sw = [-2, 0, 2, 0][f];
      const pose = { hip, legs, arms: { a: [G.a, [G.a[0] - sw, G.top + 5]], b: [G.b, [G.b[0] + sw, G.top + 5]] } };
      if (st.hold) Object.assign(pose, holdArms(G, 'right', st.hold));
      return pose;
    }
    const pose = { hip, legs: { k: 'walk', f }, arms: armsDown(G, st.dir, f === 0 ? 1 : f === 2 ? -1 : 0, f === 0 ? -1 : f === 2 ? 1 : 0) };
    if (st.hold) Object.assign(pose, holdArms(G, st.dir, st.hold));
    return pose;
  },
  run(look, st) {
    const f = st.f % 4, bob = f % 2 ? -1 : 0, hip = baseHip(look) + bob, lean = st.dir === 'right' ? 1 : 0, G = geo(look, st.dir, hip, lean);
    if (st.dir === 'right') {
      // 接地 → すれ違い（膝を上げる）→ 反対の脚で接地 → すれ違い
      const L = [{ k: [3, -4], f: [5, -1] }, { k: [1, -4], f: [0, -1] }, { k: [-1, -4], f: [-3, -4] }, { k: [3, -6], f: [2, -4] }];
      const T0 = G.top, arm = [[[lean - 2, T0 + 3], [lean - 4, T0 + 1]], [[lean, T0 + 4], [lean + 1, T0 + 3]], [[lean + 2, T0 + 3], [lean + 4, T0 + 1]], [[lean, T0 + 4], [lean + 1, T0 + 3]]];
      return { hip, lean, legs: { k: 'side', n: L[f], f: L[(f + 2) % 4] }, arms: { a: [G.a, ...arm[(f + 2) % 4].map(([x, y]) => [x - 1, y + 1])], b: [G.b, ...arm[f]] } };
    }
    return { ...POSES.walk(look, st), hip: baseHip(look) + bob };
  },
  breathe(look, st) { // 膝に手をついて息を整える
    const hip = baseHip(look) + 2, lean = 3, G = geo(look, 'right', hip, lean);
    return { hip, lean, hy: 1, legs: { k: 'side', n: { k: [2, -4], f: [-1, -1] }, f: { k: [3, -4], f: [2, -1] } }, arms: { a: [G.a, [lean, -5]], b: [G.b, [lean + 2, -5]] }, eyes: st.f % 2 ? 'closed' : null, mouth: true };
  },
  talk(look, st) {
    const hip = baseHip(look), G = geo(look, st.dir, hip), f = st.f % 2;
    if (st.dir === 'right') return { hip, legs: sideStand(1), arms: { a: armsDown(G, 'right').a, b: [G.b, [G.b[0] + 2, G.top + 3], [G.b[0] + 4, G.top + (f ? 1 : 2)]] }, mouth: st.mouth };
    if (st.dir === 'up') return { hip, legs: { k: 'stand' }, arms: { a: armsDown(G, 'up').a, b: [G.b, [G.b[0] + 1, G.top + 2], [G.b[0] + 1, G.top - (f ? 1 : 0)]] } };
    return { hip, legs: { k: 'stand' }, arms: { a: armsDown(G, 'down').a, b: [G.b, [G.b[0] + 1, G.top + 3], [G.b[0] + 1, G.top + (f ? 0 : 1)]] }, mouth: st.mouth };
  },
  think(look, st) {
    const hip = baseHip(look), G = geo(look, st.dir === 'up' ? 'down' : st.dir, hip);
    if (st.dir === 'right') return { hip, legs: sideStand(1), arms: { a: [G.a, [G.a[0] + 2, G.top + 4]], b: [G.b, [G.b[0] + 2, G.top + 3], [G.b[0] + 3, G.top - 1]] }, eyes: 'down' };
    return { hip, legs: { k: 'stand' }, arms: { a: [G.a, [G.a[0], G.top + 4], [G.tw - 2, G.top + 4]], b: [G.b, [G.b[0], G.top + 3], [1, G.top - 1]] }, eyes: st.f % 2 ? 'down' : null };
  },
  point(look, st) {
    const hip = baseHip(look), G = geo(look, st.dir, hip);
    if (st.dir === 'up') return { hip, legs: { k: 'stand' }, arms: { a: armsDown(G, 'up').a, b: [G.b, [G.b[0] + 2, G.top - 3], [G.b[0] + 3, G.top - 8 - (st.f % 2)]] } };
    return { hip, legs: st.dir === 'right' ? sideStand(1) : { k: 'stand' }, arms: { a: armsDown(G, st.dir).a, b: [G.b, [G.b[0] + 2, G.top - 2], [G.b[0] + 4, G.top - 5 - (st.f % 2)]] }, mouth: st.mouth };
  },
  joy(look, st) {
    const hip = baseHip(look), G = geo(look, st.dir === 'right' ? 'right' : 'down', hip);
    if (st.dir === 'right') return { hip, legs: sideStand(1), arms: { a: [G.a, [G.a[0] + 1, G.top - 5]], b: [G.b, [G.b[0] + 2, G.top - 3], [G.b[0] + 2, G.top - 7]] }, mouth: true };
    return { dir: 'down', hip, legs: { k: 'stand' }, arms: { a: [G.a, [G.a[0] - 1, G.top - 3], [G.a[0], G.top - 7]], b: [G.b, [G.b[0] + 1, G.top - 3], [G.b[0], G.top - 7]] }, mouth: true };
  },
  stretch(look, st) {
    const hip = baseHip(look), G = geo(look, 'down', hip), f = st.f % 4;
    if (f < 2) return { dir: 'down', hip, legs: { k: 'stand' }, arms: { a: [G.a, [G.a[0], G.top - 4], [-3, G.top - 9]], b: [G.b, [G.b[0], G.top - 4], [1, G.top - 9]] }, hy: -f, eyes: 'closed' };
    const d = f === 2 ? -1 : 1;
    return { dir: 'down', hip, hx: d, legs: { k: 'stand' }, arms: { a: d < 0 ? armsDown(G, 'down').a : [G.a, [G.a[0], G.top - 4], [-2, G.top - 9]], b: d > 0 ? armsDown(G, 'down').b : [G.b, [G.b[0], G.top - 4], [0, G.top - 9]] } };
  },
  clip(look, st) { // クリップボードを持って観察・記録
    const hip = baseHip(look), G = geo(look, st.dir, hip), w = st.ph === 'write' ? st.f % 2 : 0;
    if (st.dir === 'right') return { hip, legs: sideStand(1), arms: { a: [G.a, [G.a[0] + 2, G.top + 3], [G.a[0] + 4, G.top + 2]], b: [G.b, [G.b[0] + 2, G.top + 4], [G.b[0] + 3 + w, G.top + 3]] }, props: [{ k: 'clip', x: G.b[0] + 3, y: G.top + 1, z: 'body' }, ...(st.ph === 'write' ? [{ k: 'pen', x: G.b[0] + 4 + w, y: G.top + 2 }] : [])], eyes: st.ph === 'write' ? 'down' : null };
    if (st.dir === 'up') return { hip, legs: { k: 'stand' }, arms: { a: [G.a, [G.a[0] + 1, G.top + 3]], b: [G.b, [G.b[0] - 1, G.top + 3]] } };
    return { hip, legs: { k: 'stand' }, arms: { a: [G.a, [G.a[0], G.top + 3], [-3, G.top + 3]], b: [G.b, [G.b[0], G.top + 3], [0 + w, G.top + 2]] }, props: [{ k: 'clip', x: -2, y: G.top + 1, z: 'body' }, ...(st.ph === 'write' ? [{ k: 'pen', x: 1 + w, y: G.top + 1 }] : [])], eyes: st.ph === 'write' ? 'down' : null };
  },
  // ── 着席系（原点＝座面）
  sit(look, st) {
    const hip = -2, G = geo(look, st.dir, hip), a = st.act || 'idle', f = st.f % 2;
    const pose = { hip, legs: st.dir === 'down' ? { k: 'sit' } : st.dir === 'up' ? { k: 'sitBack' } : { k: 'side', n: { k: [5, hip + 2], f: [5, 6], hx: 0 }, f: { k: [4, hip + 2], f: [4, 6] } }, arms: armsDown(G, st.dir, -1, -1), over: [] };
    if (st.dir === 'right') {
      if (a === 'treatSit' || a === 'type') pose.arms = { a: [G.a, [G.a[0] + 3, G.top + 4]], b: [G.b, [G.b[0] + 2, G.top + 4], [G.b[0] + 4, G.top + 3 + f]] };
      return pose;
    }
    if (st.dir === 'up') { // 背中側：肘の動きだけが見える
      if (a === 'type') pose.arms = { a: [G.a, [G.a[0] + f, G.top + 3]], b: [G.b, [G.b[0] - (1 - f), G.top + 3]] };
      else if (a === 'talk' || a === 'meet') pose.arms = { a: [G.a, [G.a[0] + 1, G.top + 3]], b: f && st.mouth ? [G.b, [G.b[0] + 1, G.top + 1], [G.b[0] + 1, G.top - 2]] : [G.b, [G.b[0] - 1, G.top + 3]] };
      else if (a === 'eat') pose.arms = { a: [G.a, [G.a[0] + 1, G.top + 3]], b: [G.b, [G.b[0] - 1, G.top + (f ? 0 : 3)]] };
      else if (a === 'read') pose.arms = { a: [G.a, [G.a[0] + 1, G.top + 2]], b: [G.b, [G.b[0] - 1, G.top + 2]] };
      return pose;
    }
    // 正面（机の奥）：机より手前に出る手は over に描く
    const desk = st.desk;
    switch (a) {
      case 'type':
        pose.arms = { a: [G.a, [G.a[0], G.top + 4], [-4, G.top + 6]], b: [G.b, [G.b[0], G.top + 4], [2, G.top + 6]] };
        if (desk) pose.over = [{ k: 'hand', x: -4, y: 1 - f, arm: true }, { k: 'hand', x: 2, y: f, arm: true }];
        pose.eyes = 'down'; break;
      case 'read':
        pose.arms = { a: [G.a, [G.a[0], G.top + 4], [-5, G.top + 6]], b: [G.b, [G.b[0], G.top + 4], [3, G.top + 6]] };
        if (desk) pose.over = [{ k: 'paper', x: -3, y: 0, w: 6, flip: f }, { k: 'hand', x: -5, y: 1 }, { k: 'hand', x: 3, y: 1 }];
        else pose.props = [{ k: 'card', x: -2, y: G.top + 2, z: 'front' }], pose.arms = { a: [G.a, [G.a[0], G.top + 4], [-3, G.top + 4]], b: [G.b, [G.b[0], G.top + 4], [1, G.top + 4]] };
        pose.eyes = 'down'; break;
      case 'talk': case 'meet': {
        const gest = st.mouth && f;
        pose.arms = { a: [G.a, [G.a[0], G.top + 4], [-4, G.top + 6]], b: gest ? [G.b, [G.b[0] + 1, G.top + 3], [G.b[0] + 1, G.top]] : [G.b, [G.b[0], G.top + 4], [2, G.top + 6]] };
        if (desk) pose.over = [{ k: 'hand', x: -4, y: 1, arm: true }, ...(gest ? [] : [{ k: 'hand', x: 2, y: 1, arm: true }])];
        pose.mouth = st.mouth; pose.hy = st.nod ? 1 : 0; break;
      }
      case 'eat':
        pose.arms = { a: [G.a, [G.a[0], G.top + 4], [-4, G.top + 6]], b: f ? [G.b, [G.b[0] + 1, G.top + 3], [1, G.top - 2]] : [G.b, [G.b[0], G.top + 4], [2, G.top + 6]] };
        pose.props = f ? [{ k: 'chop', x: 1, y: G.top - 2 }] : [];
        if (desk) pose.over = [{ k: 'hand', x: -4, y: 1, arm: true }, ...(f ? [] : [{ k: 'hand', x: 2, y: 1, arm: true }, { k: 'chop', x: 3, y: 2 }])];
        pose.mouth = f; break;
      case 'observe': // 腕組み
        pose.arms = { a: [G.a, [G.a[0], G.top + 3], [G.tw - 2, G.top + 3]], b: [G.b, [G.b[0], G.top + 4], [-G.tw, G.top + 4]] };
        pose.eyes = st.f % 8 === 7 ? 'blink' : null; break;
      case 'drink':
        pose.arms = { a: armsDown(G, 'down', -1).a, b: f ? [G.b, [G.b[0] + 1, G.top + 2], [1, G.top - 2]] : [G.b, [G.b[0] + 1, G.top + 4], [G.b[0], G.top + 5]] };
        pose.props = [{ k: 'bottle', x: f ? 2 : G.b[0] + 1, y: f ? G.top - 5 : G.top + 3, z: 'front' }]; pose.eyes = f ? 'closed' : null; break;
      case 'tie': // 靴ひもを結ぶ
        pose.arms = { a: [G.a, [G.a[0], G.top + 4], [-3, 3]], b: [G.b, [G.b[0], G.top + 4], [1, 3 + f]] }; pose.hy = 2; pose.eyes = 'down'; break;
      case 'think':
        pose.arms = { a: [G.a, [G.a[0], G.top + 4], [G.tw - 2, G.top + 4]], b: [G.b, [G.b[0], G.top + 3], [1, G.top - 1]] }; pose.eyes = 'down'; break;
    }
    return pose;
  },
  lie(look, st) { // あお向け（ベッドの上）。体は正面図をそのまま使い、靴は描かない
    const hip = -7, G = geo(look, 'down', hip);
    return { dir: 'down', hip, legs: { k: 'stand' }, arms: armsDown(G, 'down'), eyes: 'closed', noShoes: true };
  },
  // ── 野球（横向き＝右向きで定義し、左向きは反転）
  bat(look, st) {
    const hip = baseHip(look) + 1, ph = st.ph || 'stance', w = st.f % 2;
    const P = {
      stance: { lean: 0, n: [[-2, -4], [-4, -1]], fl: [[3, -4], [4, -1]], b: [[-4, 3], [-3, -1 - w]], a: [[-2, 0]], bat: [[-3, -1 - w], [-9 + w, -13]], z: 'back' },
      load: { lean: -1, n: [[-3, -4], [-5, -1]], fl: [[2, -6], [2, -3]], b: [[-5, 2], [-5, 0]], a: [[-4, 1]], bat: [[-4, 0], [-12, -6]], z: 'back' },
      swing: { lean: 1, n: [[-1, -4], [-3, -2]], fl: [[3, -4], [5, -1]], b: [[1, 3], [3, 4]], a: [[2, 4]], bat: [[3, 4], [15, 3]], z: 'front', trail: [[-9, -3], [-2, 9], [16, 4]] },
      follow: { lean: 1, n: [[0, -4], [-2, -2]], fl: [[3, -4], [5, -1]], b: [[2, 1], [1, -2]], a: [[1, -1]], bat: [[1, -2], [-9, -5]], z: 'back' }
    }[ph === 'reset' ? 'stance' : ph];
    const lean = P.lean, G = geo(look, 'right', hip, lean), T = G.top;
    const at = ([x, y]) => [x + lean, y + T];
    return {
      hip, lean, legs: { k: 'side', n: { k: P.n[0], f: P.n[1] }, f: { k: P.fl[0], f: P.fl[1] } },
      arms: { a: [G.a, ...P.a.map(at)], b: [G.b, ...P.b.map(at)] },
      props: [{ k: 'bat', x: at(P.bat[0])[0], y: at(P.bat[0])[1], x2: at(P.bat[1])[0], y2: at(P.bat[1])[1], z: P.z }],
      trail: P.trail && P.trail.map(at), wear: st.wear
    };
  },
  pitch(look, st) {
    const hip0 = baseHip(look), ph = st.ph || 'set';
    const P = {
      set: { h: 0, lean: 0, n: [[0, -4], [-1, -1]], fl: [[1, -4], [1, -1]], b: [[1, 3], [1, 2]], a: [[1, 2]], glove: [1, 1] },
      lift: { h: 0, lean: -1, n: [[0, -4], [0, -1]], fl: [[3, -8], [2, -5]], b: [[1, 3], [1, 1]], a: [[1, 1]], glove: [1, 0] },
      stride: { h: 1, lean: 0, n: [[-3, -4], [-5, -1]], fl: [[4, -4], [6, -1]], b: [[-4, 1], [-7, -2]], a: [[3, 1], [4, 1]], glove: [4, 0], ball: [-7, -3] },
      release: { h: 1, lean: 2, n: [[-2, -4], [-4, -2]], fl: [[5, -4], [6, -1]], b: [[1, -3], [5, -1]], a: [[1, 3]], glove: [0, 2], trail: [[-6, -5], [0, -9], [7, 0]] },
      follow: { h: 2, lean: 3, n: [[-1, -5], [-4, -6]], fl: [[5, -4], [6, -1]], b: [[2, 3], [3, 7]], a: [[1, 4]], glove: [0, 3] },
      catchback: { h: 0, lean: 0, n: [[0, -4], [-1, -1]], fl: [[1, -4], [1, -1]], b: [[2, 2], [3, 1]], a: [[3, 0]], glove: [3, -1] }
    }[ph === 'recover' ? 'set' : ph];
    const hip = hip0 + P.h, lean = P.lean, G = geo(look, 'right', hip, lean), T = G.top, at = ([x, y]) => [x + lean, y + T];
    const props = [{ k: 'glove', x: at(P.glove)[0], y: at(P.glove)[1], z: 'front' }];
    if (P.ball) props.push({ k: 'ball', x: at(P.ball)[0], y: at(P.ball)[1], z: 'back' });
    return { hip, lean, legs: { k: 'side', n: { k: P.n[0], f: P.n[1] }, f: { k: P.fl[0], f: P.fl[1] } }, arms: { a: [G.a, ...P.a.map(at)], b: [G.b, ...P.b.map(at)] }, props, trail: P.trail && P.trail.map(at) };
  },
  catcher(look, st) {
    const ph = st.ph || 'ready';
    if (ph === 'throw') {
      const hip = baseHip(look) + 2, lean = 1, G = geo(look, 'right', hip, lean), T = G.top;
      return { hip, lean, gear: 'catcher', wear: 'mask', legs: { k: 'side', n: { k: [-1, -3], f: [-3, -1] }, f: { k: [3, -3], f: [4, -1] } }, arms: { a: [G.a, [lean + 2, T + 3]], b: [G.b, [lean + 2, T - 1], [lean + 5, T - 1]] }, props: [{ k: 'mitt', x: lean + 1, y: T + 2, z: 'front' }] };
    }
    const hip = -2, lean = 1, G = geo(look, 'right', hip, lean), T = G.top, j = ph === 'catch' ? -1 : 0;
    return {
      hip, lean, gear: 'catcher', wear: 'mask', legs: { k: 'side', n: { k: [5, -4], f: [2, -1] }, f: { k: [4, -5], f: [3, -1] } },
      arms: { a: [G.a, [lean + 3 + j, T + 2]], b: [G.b, [lean + 1, T + 5]] }, props: [{ k: 'mitt', x: lean + 4 + j, y: T, z: 'front' }]
    };
  },
  throw(look, st) { // キャッチボール
    const ph = st.ph || 'ready', hip0 = baseHip(look);
    const P = {
      ready: { h: 0, lean: 0, n: [[-1, -4], [-2, -1]], fl: [[2, -4], [2, -1]], b: [[2, 3], [2, 2]], a: [[2, 2]], glove: [2, 1] },
      wind: { h: 1, lean: -1, n: [[-2, -4], [-3, -1]], fl: [[3, -4], [4, -1]], b: [[-4, 1], [-6, -2]], a: [[3, 1], [4, 1]], glove: [4, 0], ball: [-6, -3] },
      throw: { h: 1, lean: 1, n: [[-2, -4], [-3, -2]], fl: [[3, -4], [4, -1]], b: [[1, -2], [5, -1]], a: [[1, 3]], glove: [0, 2], trail: [[-5, -4], [0, -7], [6, 0]] },
      follow: { h: 1, lean: 2, n: [[-1, -5], [-3, -4]], fl: [[3, -4], [4, -1]], b: [[2, 3], [3, 6]], a: [[1, 4]], glove: [0, 3] },
      catch: { h: 0, lean: 0, n: [[-1, -4], [-2, -1]], fl: [[2, -4], [2, -1]], b: [[2, 2], [3, 1]], a: [[3, -1], [4, -1]], glove: [4, -2] }
    }[ph];
    const hip = hip0 + P.h, lean = P.lean, G = geo(look, 'right', hip, lean), T = G.top, at = ([x, y]) => [x + lean, y + T];
    const props = [{ k: 'glove', x: at(P.glove)[0], y: at(P.glove)[1], z: 'front' }];
    if (P.ball) props.push({ k: 'ball', x: at(P.ball)[0], y: at(P.ball)[1], z: 'back' });
    return { hip, lean, legs: { k: 'side', n: { k: P.n[0], f: P.n[1] }, f: { k: P.fl[0], f: P.fl[1] } }, arms: { a: [G.a, ...P.a.map(at)], b: [G.b, ...P.b.map(at)] }, props, trail: P.trail && P.trail.map(at) };
  },
  knock(look, st) { // ノック
    const ph = st.ph || 'ready', hip = baseHip(look) + 1;
    const P = {
      ready: { lean: 0, b: [[-1, 3], [-1, 1]], a: [[2, 3], [2, 2]], bat: [[-1, 1], [-8, -9]], ball: [2, 1] },
      toss: { lean: 0, b: [[-2, 2], [-2, 0]], a: [[2, 0], [3, -5]], bat: [[-2, 0], [-9, -8]], ball: [3, -8] },
      swing: { lean: 1, b: [[1, 3], [3, 4]], a: [[2, 4]], bat: [[3, 4], [16, 6]], trail: [[-8, -6], [-1, 9], [16, 6]] },
      follow: { lean: 1, b: [[2, 1], [1, -2]], a: [[1, -1]], bat: [[1, -2], [-10, -4]] }
    }[ph];
    const lean = P.lean, G = geo(look, 'right', hip, lean), T = G.top, at = ([x, y]) => [x + lean, y + T];
    const props = [{ k: 'fungo', x: at(P.bat[0])[0], y: at(P.bat[0])[1], x2: at(P.bat[1])[0], y2: at(P.bat[1])[1], z: ph === 'swing' ? 'front' : 'back' }];
    if (P.ball) props.push({ k: 'ball', x: at(P.ball)[0], y: at(P.ball)[1], z: 'front' });
    return { hip, lean, legs: { k: 'side', n: { k: [-1, -4], f: [-3, -1] }, f: { k: [3, -4], f: [4, -1] } }, arms: { a: [G.a, ...P.a.map(at)], b: [G.b, ...P.b.map(at)] }, props, trail: P.trail && P.trail.map(at) };
  },
  field(look, st) { // 内野の守備
    const ph = st.ph || 'ready';
    if (ph === 'throw' || ph === 'follow' || ph === 'wind') return POSES.throw(look, { ...st, ph });
    if (ph === 'catch') return POSES.throw(look, { ...st, ph: 'catch' });
    const deep = ph === 'scoop', hip = baseHip(look) + (deep ? 4 : 2) + (ph === 'shuffle' && st.f % 2 ? -1 : 0), lean = deep ? 3 : 1, G = geo(look, 'right', hip, lean), T = G.top;
    const wide = ph === 'shuffle' && st.f % 2 ? 2 : 3;
    const glove = deep ? [lean + 4, -3] : [lean + 2, T + 6];
    return { hip, lean, legs: { k: 'side', n: { k: [-1, -3], f: [-wide, -1] }, f: { k: [3, -3], f: [wide, -1] } }, arms: { a: [G.a, [glove[0], glove[1] + 1]], b: [G.b, [glove[0] - 1, glove[1] + 1]] }, props: [{ k: 'glove', x: glove[0], y: glove[1], z: 'front' }] };
  },
  firstbase(look, st) {
    const ph = st.ph || 'ready';
    if (ph === 'stretch') {
      const hip = baseHip(look) + 2, lean = 2, G = geo(look, 'right', hip, lean), T = G.top;
      return { hip, lean, legs: { k: 'side', n: { k: [-2, -4], f: [-3, -1] }, f: { k: [5, -3], f: [7, -1] } }, arms: { a: [G.a, [lean + 5, T + 1]], b: [G.b, [lean + 3, T + 2]] }, props: [{ k: 'glove', x: lean + 6, y: T, z: 'front' }] };
    }
    if (ph === 'flip') {
      const hip = baseHip(look) + 1, lean = 1, G = geo(look, 'right', hip, lean), T = G.top;
      return { hip, lean, legs: sideStand(2), arms: { a: [G.a, [lean + 1, T + 3]], b: [G.b, [lean + 2, T + 4], [lean + 4, T + 3]] }, props: [{ k: 'glove', x: lean, y: T + 2, z: 'front' }] };
    }
    return POSES.throw(look, { ...st, ph: 'ready' });
  },
  treat(look, st) { // ベッドの選手をケア（横向き）
    const f = st.f % 2, hip = baseHip(look) + 1, lean = 2 + f, G = geo(look, 'right', hip, lean), T = G.top;
    if (st.ph === 'record') return POSES.clip(look, { ...st, dir: 'right', ph: 'write' });
    return { hip, lean, legs: sideStand(1), arms: { a: [G.a, [lean + 2, T + 4], [lean + 4, T + 6 + f]], b: [G.b, [lean + 2, T + 4], [lean + 5, T + 5 + f]] }, eyes: 'down' };
  },
  cook(look, st) { // 鍋をかき混ぜる（正面）
    const hip = baseHip(look), G = geo(look, 'down', hip), c = [[3, 5], [2, 6], [1, 5], [2, 4]][st.f % 4];
    return { dir: 'down', hip, legs: { k: 'stand' }, arms: { a: [G.a, [G.a[0], G.top + 4], [-4, G.top + 5]], b: [G.b, [G.b[0], G.top + 3], [c[0], G.top + c[1]]] }, props: [{ k: 'ladle', x: c[0] + 1, y: G.top + c[1] + 1 }], eyes: 'down' };
  }
};

// ── 公開：人物の見た目と状態 → スプライト（キャッシュ付き）
const cache = new Map();
export function figure(look, st) {
  if (!st.f) st = { ...st, f: 0 };
  const key = `${look.id}|${st.kind}|${st.ph || ''}|${st.f || 0}|${st.dir}|${st.act || ''}|${st.hold || ''}|${st.wear || ''}|${st.eyes || ''}|${st.mouth ? 1 : 0}|${st.nod ? 1 : 0}|${st.desk ? 1 : 0}`;
  let hit = cache.get(key);
  if (hit) return hit;
  const flip = st.dir === 'left', dir = flip ? 'right' : st.dir;
  const builder = POSES[st.kind] || POSES.stand;
  const pose = { dir, ...builder(look, { ...st, dir }) };
  if (!pose.dir) pose.dir = dir;
  if (st.wear && !pose.wear) pose.wear = st.wear;
  if (st.eyes && !pose.eyes) pose.eyes = st.eyes;
  if (st.mouth && pose.mouth === undefined) pose.mouth = st.mouth;
  const r = drawFigure(look, pose);
  hit = { body: flip ? flipped(r.body) : r.body, over: r.over && (flip ? flipped(r.over) : r.over), outline: null };
  if (cache.size > 4000) cache.clear();
  cache.set(key, hit);
  return hit;
}
export const outlineOf = spr => spr.outline || (spr.outline = outerOutline(spr.body));

// 詳細欄の顔写真（正面・上半身）
export function mugshot(look, wear) {
  const s = figure(look, { kind: 'stand', dir: 'down', wear });
  const c = canvas(24, 22), ctx = c.getContext('2d');
  ctx.drawImage(s.body, AX - 12, AY - 28, 24, 22, 0, 0, 24, 22);
  return c;
}
