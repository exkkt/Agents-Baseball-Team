// 登場人物（架空）。見た目 look は描画用、それ以外は状態・行動データ用
export const CAST = [
  { id: 'gm', name: '三浦', title: 'GM', role: 'exec', roleLabel: 'GM（幹部）', look: { outfit: 'suit', skin: 0, hair: 'ash', hairStyle: 'sidepart', glasses: true } },
  { id: 'director', name: '石田', title: '編成部長', role: 'exec', roleLabel: '編成部長（幹部）', look: { outfit: 'blazer', skin: 1, hair: 'black', hairStyle: 'buzz', build: 'big' } },
  { id: 'analyst', name: '小野', title: 'アナリスト', role: 'staff', roleLabel: 'データアナリスト', look: { outfit: 'cardigan', skin: 0, hair: 'brown', hairStyle: 'bob', glasses: true } },
  { id: 'manager', name: '佐伯', title: '監督', role: 'manager', roleLabel: '監督', look: { outfit: 'uniform', number: 77, skin: 1, hair: 'silver', hairStyle: 'buzz', mustache: true, build: 'big', cap: true } },
  { id: 'hcoach', name: '高橋', title: '打撃コーチ', role: 'coach', roleLabel: '打撃コーチ', look: { outfit: 'coach', number: 82, skin: 2, hair: 'black', hairStyle: 'short', cap: true } },
  { id: 'fcoach', name: '岡', title: '守備コーチ', role: 'coach', roleLabel: '内野守備コーチ', look: { outfit: 'coach', number: 85, skin: 1, hair: 'gray', hairStyle: 'buzz', build: 'big', cap: true } },
  { id: 'pcoach', name: '西', title: '投手コーチ', role: 'coach', roleLabel: '投手コーチ', look: { outfit: 'coach', number: 81, skin: 0, hair: 'dark', hairStyle: 'sidepart', glasses: true, tall: true, cap: true } },
  { id: 'aoki', name: '青木', title: '#21', role: 'player', roleLabel: '外野手・2年目', look: { outfit: 'uniform', number: 21, skin: 0, hair: 'chestnut', hairStyle: 'spiky', cap: true } },
  { id: 'yamada', name: '山田', title: '#8', role: 'player', roleLabel: '遊撃手・主将', look: { outfit: 'uniform', number: 8, skin: 2, hair: 'black', hairStyle: 'short', build: 'big', cap: true } },
  { id: 'endo', name: '遠藤', title: '#18', role: 'player', roleLabel: '投手', look: { outfit: 'uniform', number: 18, skin: 1, hair: 'dark', hairStyle: 'sidepart', tall: true, cap: true } },
  { id: 'kawaguchi', name: '川口', title: '#27', role: 'catcher', roleLabel: '捕手', look: { outfit: 'uniform', number: 27, skin: 1, hair: 'dark', hairStyle: 'buzz', build: 'big', cap: true } },
  { id: 'sato', name: '佐藤', title: '#3', role: 'player', roleLabel: '外野手・主力', look: { outfit: 'uniform', number: 3, skin: 3, hair: 'black', hairStyle: 'short', cap: true } },
  { id: 'kobayashi', name: '小林', title: '#44', role: 'player', roleLabel: '一塁手', look: { outfit: 'uniform', number: 44, skin: 2, hair: 'black', hairStyle: 'buzz', build: 'big', tall: true, cap: true } },
  { id: 'mori', name: '森', title: '#5', role: 'player', roleLabel: '二塁手', look: { outfit: 'uniform', number: 5, skin: 1, hair: 'brown', hairStyle: 'short', cap: true } },
  { id: 'kubo', name: '久保', title: '#9', role: 'player', roleLabel: '外野手', look: { outfit: 'uniform', number: 9, skin: 0, hair: 'dark', hairStyle: 'spiky', cap: true } },
  { id: 'trainer', name: '中村', title: 'トレーナー', role: 'trainer', roleLabel: 'トレーナー', look: { outfit: 'polo', skin: 1, hair: 'black', hairStyle: 'short' } },
  { id: 'cook', name: '竹内', title: '調理師', role: 'staff', roleLabel: '食堂スタッフ', look: { outfit: 'cook', skin: 2, hair: 'dark', hairStyle: 'short', build: 'big', headwear: 'bandana' } }
];
for (const [id, name, number, roleLabel] of [['tanaka','田中',35,'三塁手'],['ishikawa','石川',7,'内外野手'],['hayashi','林',46,'救援投手'],['takeda','武田',16,'投手']]) CAST.push({ id, name, title: '#' + number, role: 'player', roleLabel, look: { outfit: 'uniform', number, skin: 1, hair: 'black', hairStyle: 'short', cap: true } });
CAST.forEach(p => { p.look.id = p.id; p.look.role = p.role; p.label = p.role === 'player' || p.role === 'catcher' ? `${p.name} ${p.title}` : `${p.name}${p.title}`; });
