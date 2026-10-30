// 施設の地図・家具・人物が使う地点。描画にもシミュレーションにも依存しない純粋なデータ
export const T = 16, W = 64, H = 30;

// # 壁の天端  = 壁面  | なし  w 木の床  c カーペット  k 食堂タイル  l ロッカー床  m ケア床  r 寮の床  p 舗装  g 芝  f フェンス  D 出入口
const ROWS = [];
{
  const fill = (n, ch) => ch.repeat(n);
  ROWS[0] = fill(46, '#');
  for (const r of [1, 2]) ROWS[r] = '#' + fill(16, '=') + '#' + fill(10, '=') + '#' + fill(16, '=') + '#';
  for (let r = 3; r <= 8; r++) ROWS[r] = '#' + fill(16, 'w') + (r === 6 || r === 7 ? 'D' : '#') + fill(10, 'c') + '#' + fill(16, 'k') + '#';
  ROWS[9] = fill(46, '#').split('').map((c, i) => [8, 9, 22, 23, 36, 37].includes(i) ? 'D' : c).join('');
  ROWS[10] = ROWS[11] = fill(46, 'p');
  const field = (r, gates = []) => 'f' + fill(30, 'g') + (gates.includes(r) ? 'g' : 'f') + 'p';
  ROWS[12] = fill(32, 'f').split('').map((c, i) => [9, 10].includes(i) ? 'g' : c).join('') + 'p' + '######DD#####';
  for (const r of [13, 14]) ROWS[r] = field(r) + '#' + '=====DD====' + '#';
  for (let r = 15; r <= 19; r++) ROWS[r] = field(r, [15, 16]) + (r === 17 || r === 18 ? 'D' : '#') + fill(11, 'l') + '#';
  ROWS[20] = field(20) + '######DD#####';
  for (const r of [21, 22]) ROWS[r] = field(r) + '#' + '=====DD====' + '#';
  for (let r = 23; r <= 28; r++) ROWS[r] = field(r, [24, 25]) + (r === 25 || r === 26 ? 'D' : '#') + fill(11, 'm') + '#';
  ROWS[29] = fill(32, 'f') + 'p' + fill(13, '#');
  // 東側に選手寮（12人分の寝室）と中庭を追加。通路は東端の通用口（スタッフの出退勤）まで続く
  const DORM = { 0: fill(18, '#'), 1: '#' + fill(16, '=') + '#', 2: '#' + fill(16, '=') + '#', 9: '#####DD###########', 10: fill(18, 'p'), 11: fill(18, 'p') };
  for (let r = 0; r < H; r++) ROWS[r] += DORM[r] ?? (r <= 8 ? '#' + fill(16, 'r') + '#' : fill(18, 'g'));
}
export const MAP = ROWS;
export const tileAt = (x, y) => (MAP[y] || '')[x] || '#';
const FLOOR_OF_DOOR = (x, y) => { for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) { const t = tileAt(x + dx, y + dy); if ('wcklmrpg'.includes(t)) return t; } return 'p'; };
export const floorAt = (x, y) => { const t = tileAt(x, y); return t === 'D' ? FLOOR_OF_DOOR(x, y) : t; };
export const isOutdoor = (x, y) => 'pgf'.includes(floorAt(x, y)) || (tileAt(x, y) === 'D' && y >= 9 && y <= 12 && 'pg'.includes(floorAt(x, y)));

export const ROOMS = [
  { id: 'office', name: '監督・編成室', x: 1, y: 3, w: 16, h: 6, indoor: true },
  { id: 'analysis', name: '分析室', x: 18, y: 3, w: 10, h: 6, indoor: true },
  { id: 'cafe', name: '食堂', x: 29, y: 3, w: 16, h: 6, indoor: true },
  { id: 'locker', name: 'ロッカー', x: 34, y: 15, w: 11, h: 5, indoor: true },
  { id: 'care', name: 'ケアルーム', x: 34, y: 23, w: 11, h: 6, indoor: true },
  { id: 'field', name: '練習グラウンド', x: 1, y: 13, w: 30, h: 16 },
  { id: 'dorm', name: '選手寮', x: 47, y: 3, w: 16, h: 6, indoor: true },
  { id: 'walk', name: '通路', x: 0, y: 10, w: 64, h: 2 },
  { id: 'path', name: '通路', x: 32, y: 12, w: 1, h: 18 },
  { id: 'yard', name: '中庭', x: 46, y: 12, w: 18, h: 18 }
];
export const roomAt = (x, y) => ROOMS.find(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) || null;

// 寮のベッド（左上の床タイル）。上段は枕が北の壁側、下段は南の壁側に足を向ける
export const DORM_BEDS = [[48, 3], [50, 3], [53, 3], [55, 3], [48, 7], [50, 7], [53, 7], [55, 7], [58, 3], [60, 3], [58, 7], [60, 7]];

// 家具。x,y,w,h は床の占有タイル（block=false なら通行可）。描画の見た目は furniture.js
export const FURNITURE = [
  // 監督・編成室
  { id: 'office-window', kind: 'window', x: 2, y: 1, w: 3, h: 2, wall: true },
  { id: 'office-shelf', kind: 'shelf', x: 1, y: 3, w: 1, h: 1 },
  { id: 'gm-desk', kind: 'desk', x: 2, y: 4, w: 3, h: 1, front: true, items: ['monitorBack', 'keyboard', 'mug', 'papers'] },
  { id: 'gm-chair', kind: 'chair', x: 3, y: 3, w: 1, h: 1, face: 'down', exec: true },
  { id: 'office-clock', kind: 'clock', x: 5.5, y: 1, w: 1, h: 1, wall: true },
  { id: 'dir-desk', kind: 'desk', x: 6, y: 3, w: 3, h: 1, items: ['monitor', 'files', 'phone'] },
  { id: 'dir-chair', kind: 'chair', x: 7, y: 4, w: 1, h: 1, face: 'up' },
  { id: 'lineup-board', kind: 'lineup', x: 10, y: 1, w: 5, h: 2, wall: true },
  { id: 'meet-table', kind: 'table', x: 10, y: 5, w: 5, h: 2, items: ['papers', 'mug', 'tablet'] },
  ...[[11, 4, 'down'], [13, 4, 'down'], [11, 7, 'up'], [13, 7, 'up']].map(([x, y, face], i) => ({ id: 'meet-chair-' + i, kind: 'chair', x, y, w: 1, h: 1, face })),
  { id: 'office-cabinet', kind: 'cabinet', x: 15, y: 3, w: 2, h: 1 },
  { id: 'office-pennant', kind: 'pennant', x: 15, y: 1, w: 2, h: 1, wall: true },
  { id: 'office-plant', kind: 'plant', x: 16, y: 8, w: 1, h: 1 },
  { id: 'office-plant2', kind: 'plant', x: 1, y: 8, w: 1, h: 1 },
  { id: 'office-water', kind: 'water', x: 1, y: 6, w: 1, h: 1 },
  // 分析室
  { id: 'big-screen', kind: 'screen', x: 20, y: 1, w: 5, h: 2, wall: true },
  { id: 'ana-desk', kind: 'desk', x: 19, y: 3, w: 3, h: 1, items: ['monitor2', 'keyboard', 'mug'] },
  { id: 'ana-chair', kind: 'chair', x: 20, y: 4, w: 1, h: 1, face: 'up' },
  { id: 'ana-desk2', kind: 'desk', x: 23, y: 3, w: 3, h: 1, items: ['monitor', 'papers'] },
  { id: 'ana-chair2', kind: 'chair', x: 24, y: 4, w: 1, h: 1, face: 'up' },
  { id: 'server', kind: 'server', x: 27, y: 3, w: 1, h: 1 },
  { id: 'ana-board', kind: 'easel', x: 25, y: 6, w: 2, h: 1 },
  { id: 'printer', kind: 'printer', x: 18, y: 8, w: 1, h: 1 },
  { id: 'ana-plant', kind: 'plant', x: 27, y: 8, w: 1, h: 1 },
  // 食堂
  { id: 'kitchen-wall', kind: 'kitchenWall', x: 29, y: 1, w: 7, h: 2, wall: true },
  { id: 'counter', kind: 'counter', x: 29, y: 4, w: 7, h: 1 },
  { id: 'menu', kind: 'menu', x: 37, y: 1, w: 3, h: 2, wall: true },
  { id: 'cafe-clock', kind: 'clock', x: 41, y: 1, w: 1, h: 1, wall: true },
  { id: 'water-server', kind: 'water', x: 42, y: 3, w: 1, h: 1 },
  { id: 'vending', kind: 'vending', x: 43, y: 3, w: 2, h: 1 },
  ...[31, 35, 39, 42].map((x, i) => ({ id: 'cafe-table-' + i, kind: 'table', x, y: 7, w: 2, h: 1, small: true })),
  ...[31, 35, 39, 42].flatMap((x, i) => [[x, 6, 'down'], [x + 1, 6, 'down'], [x, 8, 'up'], [x + 1, 8, 'up']].map(([cx, cy, face], j) => ({ id: `cafe-stool-${i}-${j}`, kind: 'stool', x: cx, y: cy, w: 1, h: 1, face, block: i === 3 ? false : true }))),
  { id: 'cafe-bin', kind: 'bin', x: 44, y: 8, w: 1, h: 1 },
  { id: 'cafe-plant', kind: 'plant', x: 29, y: 8, w: 1, h: 1 },
  // ロッカー
  { id: 'lockers-a', kind: 'lockers', x: 34, y: 15, w: 5, h: 1, nums: [3, 5, 8, 9, 18] },
  { id: 'lockers-b', kind: 'lockers', x: 41, y: 15, w: 4, h: 1, nums: [21, 27, 44, 77] },
  { id: 'locker-bench', kind: 'bench', x: 35, y: 17, w: 4, h: 1, indoor: true },
  { id: 'helmet-rack', kind: 'helmetRack', x: 42, y: 18, w: 3, h: 1 },
  { id: 'laundry', kind: 'laundry', x: 34, y: 19, w: 1, h: 1 },
  // ケアルーム
  { id: 'care-shelf', kind: 'careShelf', x: 34, y: 21, w: 4, h: 2, wall: true },
  { id: 'care-poster', kind: 'poster', x: 41, y: 21, w: 2, h: 2, wall: true },
  { id: 'bed-1', kind: 'bed', x: 35, y: 24, w: 1, h: 3 },
  { id: 'bed-2', kind: 'bed', x: 38, y: 24, w: 1, h: 3 },
  { id: 'care-desk', kind: 'desk', x: 41, y: 24, w: 3, h: 1, front: true, items: ['monitorBack', 'keyboard', 'files'] },
  { id: 'care-chair', kind: 'chair', x: 42, y: 23, w: 1, h: 1, face: 'down' },
  { id: 'icebath', kind: 'icebath', x: 42, y: 27, w: 3, h: 2 },
  { id: 'towels', kind: 'towels', x: 44, y: 23, w: 1, h: 1 },
  { id: 'care-plant', kind: 'plant', x: 34, y: 28, w: 1, h: 1 },
  // グラウンド
  { id: 'dugout', kind: 'bench', x: 2, y: 13, w: 6, h: 1, roof: true },
  { id: 'cooler', kind: 'cooler', x: 1, y: 13, w: 1, h: 1 },
  { id: 'bat-rack', kind: 'batRack', x: 8, y: 13, w: 1, h: 1 },
  { id: 'ball-basket', kind: 'basket', x: 4, y: 22, w: 1, h: 1 },
  { id: 'cage', kind: 'cage', x: 18, y: 13, w: 12, h: 5, block: false },
  { id: 'machine', kind: 'machine', x: 27, y: 15, w: 1, h: 1 },
  { id: 'lscreen', kind: 'lscreen', x: 26, y: 15, w: 1, h: 1, block: false },
  { id: 'cage-basket', kind: 'basket', x: 28, y: 14, w: 1, h: 1 },
  { id: 'pen-net', kind: 'backnet', x: 29, y: 22, w: 1, h: 5 },
  { id: 'pen-basket', kind: 'basket', x: 28, y: 22, w: 1, h: 1 },
  { id: 'cones', kind: 'cones', x: 2, y: 27, w: 1, h: 1, block: false },
  { id: 'cones2', kind: 'cones', x: 29, y: 27, w: 1, h: 1, block: false },
  { id: 'hurdles', kind: 'hurdles', x: 24, y: 19, w: 2, h: 1, block: false },
  { id: 'scoreboard', kind: 'scoreboard', x: 12, y: 12, w: 4, h: 1, wall: true },
  // 通路
  ...[3, 14, 26, 44].map((x, i) => ({ id: 'planter-' + i, kind: 'planter', x, y: 11, w: 1, h: 1 })),
  { id: 'notice', kind: 'notice', x: 16, y: 9, w: 2, h: 1, wall: true },
  { id: 'walk-vending', kind: 'vendingOut', x: 30, y: 9, w: 1, h: 1, wall: true },
  // 選手寮（ベッドは1人1台。ケアルームの治療ベッドは寝床に使わない）
  { id: 'dorm-window-0', kind: 'window', x: 48, y: 1, w: 3, h: 2, wall: true },
  { id: 'dorm-window-1', kind: 'window', x: 53, y: 1, w: 3, h: 2, wall: true },
  { id: 'dorm-clock', kind: 'clock', x: 51.5, y: 1, w: 1, h: 1, wall: true },
  ...DORM_BEDS.map(([x, y], i) => ({ id: 'dorm-bed-' + i, kind: 'dormbed', x, y, w: 1, h: 2, slot: i })),
  { id: 'dorm-shelf', kind: 'shelf', x: 47, y: 3, w: 1, h: 1 },
  { id: 'dorm-plant', kind: 'plant', x: 52, y: 3, w: 1, h: 1 },
  // 中庭
  ...[[47, 13], [56, 13], [47, 21], [56, 21], [51, 27]].map(([x, y], i) => ({ id: 'yard-planter-' + i, kind: 'planter', x, y, w: 1, h: 1 })),
  { id: 'gate-sign', kind: 'notice', x: 55, y: 9, w: 2, h: 1, wall: true }
];

// ケージのネット（外周）は通れない。入口は (19,17)
const CAGE_BLOCK = [];
for (let x = 18; x <= 29; x++) { CAGE_BLOCK.push([x, 13]); if (x !== 19) CAGE_BLOCK.push([x, 17]); }
for (let y = 14; y <= 16; y++) CAGE_BLOCK.push([18, y], [29, y]);

// 人物が使う地点。pose: sit/stand/lie。desk=前面の机（手を机の上に重ねて描く）
export const SPOTS = {
  'gm-seat': { x: 3, y: 3, dir: 'down', pose: 'sit', desk: 'gm-desk', room: 'office', label: 'GM席' },
  'dir-seat': { x: 7, y: 4, dir: 'up', pose: 'sit', room: 'office', label: '編成部長席' },
  'meet-1': { x: 11, y: 4, dir: 'down', pose: 'sit', desk: 'meet-table', room: 'office', label: '会議テーブル' },
  'meet-2': { x: 13, y: 4, dir: 'down', pose: 'sit', desk: 'meet-table', room: 'office', label: '会議テーブル' },
  'meet-3': { x: 11, y: 7, dir: 'up', pose: 'sit', room: 'office', label: '会議テーブル' },
  'meet-4': { x: 13, y: 7, dir: 'up', pose: 'sit', room: 'office', label: '会議テーブル' },
  'lineup-view': { x: 12, y: 3, dir: 'up', pose: 'stand', room: 'office', label: '起用表の前' },
  'cabinet': { x: 15, y: 4, dir: 'up', pose: 'stand', room: 'office', label: '書類棚' },
  'ana-seat': { x: 20, y: 4, dir: 'up', pose: 'sit', room: 'analysis', label: '分析デスク' },
  'ana-seat2': { x: 24, y: 4, dir: 'up', pose: 'sit', room: 'analysis', label: '分析デスク' },
  'screen-view': { x: 22, y: 4, dir: 'up', pose: 'stand', room: 'analysis', label: '大型モニター前' },
  'printer': { x: 19, y: 8, dir: 'left', pose: 'stand', room: 'analysis', label: 'プリンター' },
  'easel': { x: 24, y: 6, dir: 'right', pose: 'stand', room: 'analysis', label: '分析ボード' },
  'cook': { x: 32, y: 3, dir: 'down', pose: 'stand', desk: 'counter', room: 'cafe', label: '厨房' },
  'cook-2': { x: 34, y: 3, dir: 'down', pose: 'stand', desk: 'counter', room: 'cafe', label: '厨房' },
  'serve': { x: 33, y: 5, dir: 'up', pose: 'stand', room: 'cafe', label: '配膳口' },
  'vending': { x: 43, y: 4, dir: 'up', pose: 'stand', room: 'cafe', label: '自販機' },
  ...Object.fromEntries([31, 35, 39, 42].flatMap((x, i) => [[x, 6, 'down'], [x + 1, 6, 'down'], [x, 8, 'up'], [x + 1, 8, 'up']].map(([cx, cy, dir], j) => [`cafe-${i}-${j}`, { x: cx, y: cy, dir, pose: 'sit', desk: dir === 'down' ? 'cafe-table-' + i : null, room: 'cafe', label: '食堂の席' }]))),
  'locker-1': { x: 35, y: 17, dir: 'down', pose: 'sit', room: 'locker', label: 'ロッカーのベンチ' },
  'locker-2': { x: 37, y: 17, dir: 'down', pose: 'sit', room: 'locker', label: 'ロッカーのベンチ' },
  'locker-front': { x: 36, y: 16, dir: 'up', pose: 'stand', room: 'locker', label: 'ロッカー前' },
  'bed-1': { x: 35, y: 25, dir: 'down', pose: 'lie', room: 'care', label: '治療ベッド' },
  'bed-2': { x: 38, y: 25, dir: 'down', pose: 'lie', room: 'care', label: '治療ベッド' },
  'treat-1': { x: 36, y: 25, dir: 'left', pose: 'stand', room: 'care', label: 'ベッド脇' },
  'treat-2': { x: 39, y: 25, dir: 'left', pose: 'stand', room: 'care', label: 'ベッド脇' },
  'towels': { x: 44, y: 24, dir: 'up', pose: 'stand', room: 'care', label: 'タオル棚' },
  'care-seat': { x: 42, y: 23, dir: 'down', pose: 'sit', desk: 'care-desk', room: 'care', label: 'トレーナー机' },
  'bench-1': { x: 3, y: 13, dir: 'down', pose: 'sit', room: 'field', label: 'ベンチ' },
  'bench-2': { x: 5, y: 13, dir: 'down', pose: 'sit', room: 'field', label: 'ベンチ' },
  'bench-3': { x: 6, y: 13, dir: 'down', pose: 'sit', room: 'field', label: 'ベンチ' },
  'bench-4': { x: 7, y: 13, dir: 'down', pose: 'sit', room: 'field', label: 'ベンチ' },
  'bench-front': { x: 4, y: 14, dir: 'down', pose: 'stand', room: 'field', label: 'ベンチ前' },
  'bench-side': { x: 2, y: 14, dir: 'right', pose: 'stand', room: 'field', label: 'ベンチ前' },
  'talk-l': { x: 3, y: 14, dir: 'right', pose: 'stand', room: 'field', label: 'ベンチ前' },
  'talk-r': { x: 5, y: 14, dir: 'left', pose: 'stand', room: 'field', label: 'ベンチ前' },
  'cage-bat': { x: 20, y: 15, dir: 'right', pose: 'stand', room: 'field', label: '打撃ケージ' },
  'cage-coach': { x: 17, y: 15, dir: 'right', pose: 'stand', room: 'field', label: '打撃ケージの後ろ' },
  'cage-out': { x: 19, y: 18, dir: 'right', pose: 'stand', room: 'field', label: '打撃ケージ前' },
  'cage-side': { x: 21, y: 18, dir: 'left', pose: 'stand', room: 'field', label: '打撃ケージ前' },
  'cage-watch': { x: 25, y: 18, dir: 'up', pose: 'stand', room: 'field', label: '打撃ケージ前' },
  'swing-spot': { x: 15, y: 15, dir: 'right', pose: 'stand', room: 'field', label: '素振り' },
  'knock': { x: 5, y: 21, dir: 'right', pose: 'stand', room: 'field', label: 'ノック' },
  'short': { x: 11, y: 18, dir: 'left', pose: 'stand', room: 'field', label: '遊撃の守備位置' },
  'first': { x: 9, y: 24, dir: 'right', pose: 'stand', room: 'field', label: '一塁' },
  'second': { x: 12, y: 23, dir: 'left', pose: 'stand', room: 'field', label: '二塁の守備位置' },
  'mound': { x: 20, y: 24, dir: 'right', pose: 'stand', room: 'field', label: 'ブルペン' },
  'plate': { x: 27, y: 24, dir: 'left', pose: 'stand', room: 'field', label: 'ブルペン' },
  'pen-coach': { x: 19, y: 25, dir: 'right', pose: 'stand', room: 'field', label: 'ブルペン' },
  'pen-coach2': { x: 22, y: 26, dir: 'up', pose: 'stand', room: 'field', label: 'ブルペン' },
  'catch-a': { x: 16, y: 20, dir: 'right', pose: 'stand', room: 'field', label: 'キャッチボール' },
  'catch-b': { x: 22, y: 20, dir: 'left', pose: 'stand', room: 'field', label: 'キャッチボール' },
  'track-w': { x: 2, y: 28, dir: 'right', pose: 'stand', room: 'field', label: '走路' },
  'track-e': { x: 28, y: 28, dir: 'left', pose: 'stand', room: 'field', label: '走路' },
  'stretch': { x: 14, y: 27, dir: 'down', pose: 'stand', room: 'field', label: 'ストレッチ' },
  'stretch-2': { x: 17, y: 27, dir: 'down', pose: 'stand', room: 'field', label: 'ストレッチ' },
  'gate': { x: 9, y: 12, dir: 'down', pose: 'stand', room: 'field', label: 'グラウンド入口' },
  'exit': { x: 57, y: 10, dir: 'right', pose: 'stand', room: 'walk', label: '通用口' },
  // 寮：自分のベッド（寝る・横になって過ごす）と、ベッド脇（身支度）
  ...Object.fromEntries(DORM_BEDS.map(([x, y], i) => [`dorm-${i}`, { x, y: y + 1, dir: 'down', pose: 'lie', room: 'dorm', label: '寮の自室' }])),
  ...Object.fromEntries(DORM_BEDS.map(([x, y], i) => [`dorm-side-${i}`, { x: x + ([48, 53, 58].includes(x) ? -1 : 1), y: y + 1, dir: [48, 53, 58].includes(x) ? 'right' : 'left', pose: 'stand', room: 'dorm', label: '寮の自室' }])),
  ...Object.fromEntries([['P',8,21],['C',3,21],['3B',8,17],['LF',9,15],['CF',14,15],['RF',16,22]].map(([id,x,y]) => ['match-'+id, { x,y, dir:'down', pose:'stand', room:'field', label:'試合の守備位置' }])),
  ...Object.fromEntries(Array.from({length:12}, (_,i) => ['match-bench-'+i, { x:2+i,y:28,dir:'up',pose:'stand',room:'field',label:'試合ベンチ' }])),
  'yard-bench': { x: 51, y: 14, dir: 'down', pose: 'stand', room: 'yard', label: '中庭' }
};

// 通行判定
const blocked = new Set();
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ('#=f'.includes(tileAt(x, y))) blocked.add(x + ',' + y);
for (const f of FURNITURE) {
  if (f.wall || f.block === false) continue;
  for (let y = Math.floor(f.y); y < Math.ceil(f.y + f.h); y++) for (let x = Math.floor(f.x); x < Math.ceil(f.x + f.w); x++) blocked.add(x + ',' + y);
}
CAGE_BLOCK.forEach(([x, y]) => blocked.add(x + ',' + y));
export const isBlocked = (x, y) => x < 0 || y < 0 || x >= W || y >= H || blocked.has(x + ',' + y);
const spotTiles = new Set(Object.values(SPOTS).map(s => s.x + ',' + s.y));

// 4方向の幅優先探索。目的地が座席（家具の上）でも到達できる
export function findPath(sx, sy, tx, ty) {
  if (sx === tx && sy === ty) return [];
  const key = (x, y) => x + ',' + y, prev = new Map([[key(sx, sy), null]]), q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny);
      if (prev.has(k)) continue;
      const goal = nx === tx && ny === ty;
      if (!goal && isBlocked(nx, ny)) continue;
      if (goal && isBlocked(nx, ny) && !spotTiles.has(k)) continue;
      prev.set(k, [x, y]);
      if (goal) {
        const path = []; let cur = [nx, ny];
        while (cur && !(cur[0] === sx && cur[1] === sy)) { path.unshift(cur); cur = prev.get(key(cur[0], cur[1])); }
        return path;
      }
      q.push([nx, ny]);
    }
  }
  return null;
}

// 地点の足元（着席は座面）の座標（px）
export const spotAnchor = s => {
  const o = { sit: [0, 9], stand: [0, 12], lie: [0, 6] }[s.pose] || [0, 12];
  return { x: s.x * T + 8 + (s.dx || 0) + o[0], y: s.y * T + o[1] + (s.dy || 0) };
};
export const tileCenter = (x, y) => ({ x: x * T + 8, y: y * T + 12 });

// 野球の地面（描画とボールの着地点で共用）
export const FIELD = {
  home: { x: 4.5, y: 21.5 }, first: { x: 8.5, y: 25.5 }, second: { x: 12.5, y: 21.5 }, third: { x: 8.5, y: 17.5 }, mound: { x: 8.5, y: 21.5 },
  cage: { x: 18, y: 13, w: 12, h: 5 }, pen: { x: 18, y: 22, w: 12, h: 5 }, penMound: { x: 20.5, y: 24.5 }, penPlate: { x: 27.5, y: 24.5 }, track: { y: 28 }
};
