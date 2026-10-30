// デモ台本。人物への指示は Club の公開メソッド（intend/replace/say/event/setReason）だけを使う。
// AIに接続するときは、同じ update(club, dt) を持つ別の Director に差し替える
const wait = s => ({ wait: s });
const until = fn => ({ until: fn });
const go = (spot, then, extra = {}) => ({ do: 'goto', spot, then, ...extra });
const act = (activity, secs, label, reason) => ({ do: 'act', activity, for: secs, label, reason });

export const STORY_STEPS = [
  { id: 'notice', label: '気づく', who: 'hcoach' },
  { id: 'consult', label: '相談する', who: 'manager' },
  { id: 'decide', label: '起用を決める', who: 'gm' },
  { id: 'tell', label: '若手へ伝える', who: 'aoki' }
];

// 起用表の磁石（打順 slot 0-8 / 控え bench）
const LINEUP = [
  { num: 8, slot: 0 }, { num: 5, slot: 1 }, { num: 9, slot: 2 }, { num: 44, slot: 3 }, { num: 27, slot: 4 }, { num: 1, slot: 5 }, { num: 3, slot: 6, color: '#4f7fb3' }, { num: 6, slot: 7 }, { num: 2, slot: 8 },
  { num: 21, bench: 0, color: '#e0a43a' }, { num: 12, bench: 1 }, { num: 33, bench: 2 }
];

// ── 普段の行動（台本で動かしていない人物が、空いたら次のまとまりを選ぶ）
export const ROUTINES = {
  gm: c => [
    [go('gm-seat', 'pc'), act('pc', c.r(30, 50), '来季の人件費をPCで試算している', '来季の総年俸を枠内に収めつつ、若手の昇給余地を残したい')],
    [go('gm-seat', 'read'), act('read', c.r(16, 24), 'スカウトの報告書を読んでいる', '夏の補強候補を3人まで絞り込みたい')],
    [go('lineup-view', 'look'), act('look', c.r(5, 8), '起用表を見ている', '今週の起用に偏りがないか確かめたい')]
  ],
  director: c => [
    [go('dir-seat', 'pc'), act('pc', c.r(30, 45), 'ドラフト候補の映像メモを整理している', '秋のドラフトに向けて、守備力の高い内野手を優先したい')],
    [go('dir-seat', 'read'), act('read', c.r(18, 26), '他球団の編成動向を読んでいる', 'トレード市場の相場を把握しておきたい')],
    [go('cabinet', 'look'), act('look', c.r(5, 8), '書類棚で契約資料を探している', '過去の契約条件を参照したい')]
  ],
  analyst: c => [
    [go('ana-seat', 'pc'), act('pc', c.r(28, 44), '昨日の試合の打球データを集計している', '打球速度と角度の分布から、各打者の調子を数値で追う')],
    [go('screen-view', 'point'), act('point', c.r(7, 10), '大型モニターで打球方向を分析している', '相手投手ごとの打球方向の偏りを確認したい')],
    [go('easel', 'point'), act('point', c.r(5, 8), '分析ボードのグラフを更新している', '週ごとの傾向をチームに共有できる形にしたい')]
  ],
  manager: c => [
    [go('bench-1', 'observe'), act('observe', c.r(22, 34), 'ベンチから練習全体を見ている', '誰が調子を上げているか、動きの切れで確かめたい')],
    [go('bench-1', 'card'), act('card', c.r(12, 18), '明日のメンバー表を見直している', '相手先発は左腕。打順の組み合わせを考えたい')]
  ],
  hcoach: c => [
    [go('cage-coach', 'clip'), act('clip', c.r(26, 40), '打撃ケージの後ろでスイングを確認している', 'バットの軌道と、下半身の使い方を見ている')],
    [go('cage-coach', 'demo'), act('demo', c.r(6, 9), 'スイングの手本を見せている', '言葉より動きで伝えたほうが早い')]
  ],
  fcoach: () => [[go('knock', 'knock'), act('knock', 9999, '内野ノックを打っている', '試合前に、併殺の形を体に入れておきたい')]],
  pcoach: c => [
    [go('pen-coach', 'penwatch'), act('penwatch', c.r(30, 45), 'ブルペンで投球フォームを確認している', '踏み出し足の向きと、リリースの高さを見ている')],
    [go('pen-coach2', 'penwatch'), act('penwatch', c.r(10, 16), '投球数と球質をメモしている', '球数が40球を超えたら終える予定')]
  ],
  aoki: () => [[go('cage-bat', 'bat'), act('bat', 9999, '打撃ケージでフリー打撃をしている', '出場機会をつかむため、逆方向への強い打球を磨いている')]],
  yamada: () => [[go('short', 'field'), act('field', 9999, '遊撃でノックを受けている', '主将として、守備のリズムを作りたい')]],
  mori: () => [[go('second', 'field'), act('field', 9999, '二塁でノックを受けている', '併殺の送球をもっと速くしたい')]],
  kobayashi: () => [[go('first', 'firstbase'), act('firstbase', 9999, '一塁で送球を受けている', 'ショートバウンドの送球も確実に捕りたい')]],
  endo: () => [[go('mound', 'pitch'), act('pitch', 9999, 'ブルペンで投球練習をしている', '次回登板に向けて、40球で変化球の精度を確かめる')]],
  endoAfter: c => [[go('stretch-2', 'stretch'), act('stretch', c.r(18, 26), '肩まわりのストレッチをしている', '投げた日は、肩を冷やさず柔らかく保ちたい')], [go('bench-4', 'sitrest'), act('sitrest', c.r(12, 18), 'ベンチで水分補給している', '次の登板まで、疲れを残さないようにする')]],
  pcoachAfter: c => [[go('bench-2', 'card'), act('card', c.r(18, 26), '投球数と球質をノートに整理している', '遠藤の次の登板間隔を、球数と張りから決めたい')], [go('cage-watch', 'clip'), act('clip', c.r(12, 18), '打撃ケージの様子を見ている', '投手目線で、打者の狙い球を探りたい')]],
  kawaguchi: c => [[go('swing-spot', 'swing'), act('swing', c.r(20, 30), '素振りをしている', '午後の打撃練習に向けて体を温めたい')], [go('bench-3', 'sitrest'), act('sitrest', c.r(10, 14), 'ベンチで水分補給している', '捕手は消耗が大きい。こまめに休む')]],
  sato: c => [[go('stretch', 'stretch'), act('stretch', c.r(18, 26), 'ストレッチで脚の状態を確かめている', '今日は別メニュー。張りを残さないよう軽めに調整する')], [go('track-w', 'jog'), act('jog', c.r(16, 22), '軽めのジョグで調整している', '全力は控え、走れる状態かを確かめる')]],
  kubo: () => [[go('track-w', 'run'), act('run', 9999, '走路でダッシュを繰り返している', '一歩目の速さを上げて、次の塁を狙いたい')]],
  trainer: c => [[go('care-seat', 'record'), act('record', c.r(18, 26), '選手の状態を記録している', '練習量と張りの記録から、無理をさせない判断をしたい')], [go('towels', null), act('look', 5, 'タオルと氷の補充を確認している', 'ケアの道具を切らさない')]],
  cook: c => [c.minutes % 1440 < 12 * 60 + 30 ? [go('cook', 'cook'), act('cook', 60, '昼食を調理している', '練習後に必要な量のたんぱく質と炭水化物をそろえたい')] : [go('cook-2', 'cook'), act('cook', 60, '片付けと夕食の仕込みをしている', '夕方の練習後にすぐ食べられるよう準備しておく')]]
};

export class DemoDirector {
  constructor() { this.label = 'デモ台本'; this.connected = false; this.tasks = []; this.last = {}; }

  start(c) {
    this.c = c; c.director = this;
    c.rate = 1; c.gm = 9 * 60; // 旧デモ台本は従来どおり「1秒＝ゲーム内1分」・09:00 開始
    c.story.steps = STORY_STEPS;
    c.lineup = LINEUP.map(m => ({ ...m, color: m.color || '#2f6a4f', t0: -9 }));
    // 9:00 の初期配置
    const P = (id, spot, a, reason) => { c.place(id, spot, a); if (reason) c.setReason(id, reason); };
    P('gm', 'gm-seat', 'pc', '来季の総年俸を枠内に収めつつ、若手の昇給余地を残したい');
    P('director', 'dir-seat', 'read', '秋のドラフトに向けて、守備力の高い内野手を優先したい');
    P('analyst', 'ana-seat', 'pc', '打球速度と角度の分布から、各打者の調子を数値で追う');
    P('manager', 'bench-1', 'observe', '誰が調子を上げているか、動きの切れで確かめたい');
    P('hcoach', 'cage-coach', 'clip', 'バットの軌道と、下半身の使い方を見ている');
    P('fcoach', 'knock', 'knock', '試合前に、併殺の形を体に入れておきたい');
    P('pcoach', 'pen-coach', 'penwatch', '踏み出し足の向きと、リリースの高さを見ている');
    P('aoki', 'cage-bat', 'bat', '出場機会をつかむため、逆方向への強い打球を磨いている');
    P('yamada', 'short', 'field', '主将として、守備のリズムを作りたい');
    P('kobayashi', 'first', 'firstbase', 'ショートバウンドの送球も確実に捕りたい');
    P('endo', 'mound', 'pitch', '次回登板に向けて、40球で変化球の精度を確かめる');
    P('kawaguchi', 'plate', 'catch', '遠藤の球筋とキレを確かめている');
    P('sato', 'bed-1', 'lie', '右太ももの張りが抜けない。無理はしたくない');
    P('kubo', 'track-w', 'run', '一歩目の速さを上げて、次の塁を狙いたい');
    P('mori', 'locker-1', 'tie', '遅れた分、すぐにノックへ合流したい');
    P('trainer', 'treat-1', 'treat', '張りの場所と強さを確かめ、今日の練習量を決めたい');
    P('cook', 'cook', 'cook', '練習後に必要な量のたんぱく質と炭水化物をそろえたい');
    ['gm', 'director', 'analyst', 'manager', 'hcoach', 'fcoach', 'pcoach', 'aoki', 'yamada', 'kobayashi', 'endo', 'kawaguchi', 'kubo', 'cook'].forEach(id => c.intend(id, { do: 'act', activity: c.person(id).activity, for: id === 'gm' ? 22 : id === 'analyst' ? 26 : id === 'director' ? 18 : id === 'manager' ? 30 : id === 'hcoach' ? 9999 : 9999 }));
    c.person('aoki').form = 0.42;
    this.hold('sato', 'trainer', 'mori', 'hcoach', 'aoki', 'endo', 'kawaguchi');
    c.event('朝の全体練習が始まった', { who: ['manager'], spot: 'bench-1', kind: 'day' });
    this.spawn(this.story(c)); this.spawn(this.care(c)); this.spawn(this.bullpen(c)); this.spawn(this.mori(c)); this.spawn(this.lunch(c));
  }
  hold(...ids) { ids.forEach(id => this.c.person(id).controlled = true); }
  free(...ids) { ids.forEach(id => this.c.person(id).controlled = false); }
  spawn(gen) { this.tasks.push({ gen, w: null }); }

  update(c, dt) {
    void dt;
    for (const task of this.tasks) {
      let guard = 0;
      while (!task.done && guard++ < 50) {
        const w = task.w;
        if (w) {
          if (w.wait != null && c.t < w.at) break;
          if (w.until && !w.until(c)) break;
        }
        const r = task.gen.next();
        if (r.done) { task.done = true; break; }
        task.w = r.value ? { ...r.value, at: c.t + (r.value.wait || 0) } : null;
      }
    }
    this.tasks = this.tasks.filter(t => !t.done);
    // 空いている人物には普段の行動を
    for (const p of c.people.values()) {
      if (p.controlled || c.busy(p.id)) continue;
      const key = c.flags.penDone && (p.id === 'endo' || p.id === 'pcoach') ? p.id + 'After' : p.id;
      const make = ROUTINES[key]; if (!make) continue;
      const opts = make(c);
      let i = Math.floor(c.rand() * opts.length);
      if (opts.length > 1 && i === this.last[p.id]) i = (i + 1) % opts.length;
      this.last[p.id] = i;
      c.intend(p.id, opts[i]);
    }
  }

  *talk(lines) {
    for (const [id, text, secs = 3] of lines) {
      if (text === null) { this.c.intend(id, { do: 'think', for: secs }); yield wait(secs + 0.3); continue; }
      this.c.say(id, text, secs); yield wait(secs + 0.45);
    }
  }

  // ── メインの流れ：気づく → 相談 → 決定 → 伝える
  *story(c) {
    yield wait(8);
    c.person('aoki').form = 0.93; // 打球が変わってくる
    yield until(() => c.t > 10 && c.lastHit?.id === 'aoki' && c.lastHit.sharp && c.t - c.lastHit.t < 0.3);
    c.replace('hcoach', { do: 'emote', icon: 'notice', for: 1.4 });
    c.event('高橋コーチが青木 #21 の打球の変化に気づく', { who: ['hcoach', 'aoki'], spot: 'cage-coach', kind: 'story', step: 'notice' });
    yield wait(1.5);
    c.intend('hcoach', { do: 'think', for: 3.2, reason: '芯でとらえた打球が、この30球で18本。先週の倍近く、逆方向にも強い' });
    yield wait(3.3);
    c.intend('hcoach', act('clip', 3.5, '打球の質をメモしている'));
    yield wait(3.6);
    yield* this.talk([['hcoach', '青木、今の感覚だ。下半身から打てている', 3], ['aoki', 'はい！', 1.6]]);
    // 監督のもとへ
    c.replace('hcoach', go('talk-r', 'talk'), { do: 'face', to: 'manager' });
    c.setReason('hcoach', '若手の変化は、今のうちに監督の耳に入れておきたい');
    yield until(() => c.isAt('hcoach', 'talk-r') || c.person('hcoach').y < 15.5 * 16 && c.person('hcoach').x < 8 * 16);
    this.hold('manager');
    c.replace('manager', go('talk-l', 'talk'), { do: 'face', to: 'hcoach' });
    yield until(() => c.isAt('hcoach', 'talk-r') && c.isAt('manager', 'talk-l'));
    c.intend('hcoach', { do: 'face', to: 'manager' });
    c.event('高橋コーチが佐伯監督に青木の起用を相談', { who: ['hcoach', 'manager'], spot: 'talk-l', kind: 'story', step: 'consult' });
    yield* this.talk([
      ['hcoach', '監督、青木の打球が変わってきました', 3.2],
      ['manager', 'ほう。どう変わった？', 2.4],
      ['hcoach', '芯でとらえる打球が先週の倍です。逆方向にも強い', 3.6]
    ]);
    c.setReason('manager', 'コーチの見立ては信頼できる。ただ先発を動かすなら、数字と編成の判断もそろえたい');
    yield* this.talk([['manager', null, 3.4], ['manager', 'GMを交えて決めよう。小野にもデータを頼む', 3.4], ['hcoach', 'わかりました', 1.8]]);
    c.event('佐伯監督：GM・アナリストを交えて判断することに', { who: ['manager'], spot: 'talk-l', kind: 'story' });
    // 会議へ
    this.hold('gm', 'analyst');
    c.replace('manager', go('meet-2', 'meet', { reason: '編成室で、GMと起用を詰めたい' }));
    c.replace('hcoach', go('meet-3', 'meet'));
    yield wait(2.5);
    c.replace('analyst', { do: 'emote', icon: 'notice', for: 1.2 }, { do: 'say', text: '了解です。打球データを出します', for: 2.4 }, go('printer', 'print'), act('print', 3.5, '会議用の資料を印刷している', '会議では、数字を紙で一枚にまとめて見せたい'), go('meet-4', 'meet', { hold: 'paper' }));
    yield wait(5);
    c.replace('gm', { do: 'emote', icon: 'notice', for: 1.2 }, go('meet-1', 'meet', { reason: '起用の話なら、現場の判断と数字の両方を聞いておきたい' }));
    yield until(() => ['meet-1', 'meet-2', 'meet-3', 'meet-4'].every((s, i) => c.isAt(['gm', 'manager', 'hcoach', 'analyst'][i], s)));
    c.flags.meeting = true;
    c.event('編成室で起用会議（GM・監督・打撃コーチ・アナリスト）', { who: ['gm', 'manager', 'hcoach', 'analyst'], spot: 'meet-1', kind: 'story' });
    yield wait(1);
    yield* this.talk([
      ['manager', '青木を明日、スタメンで使いたい', 3.0],
      ['gm', '根拠を聞かせてください', 2.4],
      ['hcoach', 'この3日、芯でとらえた打球が倍に増えています', 3.4],
      ['analyst', '打球速度は平均+6km/h。左投手の球にも差し込まれていません', 4.0]
    ]);
    c.setReason('gm', '若手を使う根拠はそろってきた。外れる選手の状態も確かめたい');
    yield* this.talk([['gm', null, 3.2], ['gm', '佐藤の脚の状態は？', 2.4], ['hcoach', '中村トレーナーの記録では、張りが3日続いています', 3.6], ['gm', null, 2.4]]);
    c.say('gm', 'では佐藤は明日休養。青木を7番・レフトで', 3.6);
    yield wait(1.0);
    for (const m of c.lineup) {
      if (m.num === 21) Object.assign(m, { from: { bench: 0 }, slot: 6, bench: undefined, t0: c.t, hi: true });
      if (m.num === 3) Object.assign(m, { from: { slot: 6 }, slot: undefined, bench: 0, t0: c.t, hi: false });
    }
    yield wait(3.1);
    c.setReason('gm', 'コーチの所見・打球データ・トレーナーの記録の3点がそろった。若手の成長を試合で確かめる好機');
    c.event('起用決定：明日、青木 #21 を7番・左翼で先発／佐藤 #3 は休養', { who: ['gm', 'manager'], spot: 'meet-1', kind: 'decision', step: 'decide' });
    yield* this.talk([['manager', '決まりだ。本人には私から伝える', 3.0]]);
    c.flags.meeting = false;
    // 解散して、監督は若手のもとへ
    c.replace('gm', go('gm-seat', 'pc'), act('pc', 24, '決定した起用を登録し、関係部署へ共有している', '決まったことはすぐに記録し、広報とトレーナーにも伝えたい'));
    c.replace('analyst', go('ana-seat', 'pc'), act('pc', 20, '会議の内容をデータ記録に残している', '判断の根拠を、あとで検証できる形で残したい'));
    this.free('gm', 'analyst');
    c.replace('hcoach', go('cage-coach', 'clip'), act('clip', 9999, '打撃ケージの後ろで青木のスイングを見ている', '先発が決まっても、良い状態のまま試合に入らせたい'));
    c.replace('manager', go('cage-side', 'talk', { reason: '起用は本人に直接伝えたい。期待していることも添えて' }));
    yield until(() => c.person('manager').x > 15 * 16 && c.person('manager').y > 12 * 16);
    this.hold('aoki');
    c.replace('aoki', go('cage-out', 'talk'), { do: 'face', to: 'manager' });
    yield until(() => c.isAt('manager', 'cage-side') && c.isAt('aoki', 'cage-out'));
    c.intend('manager', { do: 'face', to: 'aoki' }); c.intend('aoki', { do: 'face', to: 'manager' });
    yield* this.talk([['manager', '青木、明日は7番・レフトで先発だ', 3.2]]);
    c.intend('aoki', { do: 'emote', icon: 'notice', for: 1.0 });
    yield wait(1.1);
    c.intend('aoki', { do: 'emote', icon: 'joy', for: 1.6 });
    c.event('佐伯監督が青木 #21 に先発起用を伝える', { who: ['manager', 'aoki'], spot: 'cage-side', kind: 'story', step: 'tell' });
    yield* this.talk([['aoki', 'はい！ やってみせます！', 2.6], ['manager', '佐藤の分まで頼むぞ。守備も確かめておけ', 3.2], ['aoki', '外野の送球、確認してきます！', 2.4]]);
    c.setReason('aoki', '先発に備えて、外野からの送球と左投手への対応を確かめたい');
    c.replace('aoki', go('catch-a', 'catchball', { gait: 'run' }), act('catchball', 9999, '外野手の久保とキャッチボールをしている', '先発に備えて、外野からの送球を確かめたい'));
    this.hold('kubo');
    c.replace('kubo', { do: 'say', text: '付き合うよ！', for: 1.6 }, go('catch-b', 'catchball'), act('catchball', 9999, '青木のキャッチボールに付き合っている', '同じ外野手として、青木の準備を手伝いたい'));
    c.replace('manager', go('bench-1', 'observe'), act('observe', 30, 'ベンチから青木の準備を見守っている', '期待をかけた分、硬くなっていないかを見たい'));
    this.free('manager');
    yield wait(14);
    c.event('デモの流れはここまで。このあとも球団の一日は続きます', { kind: 'system' });
  }

  // 朝：トレーナーが佐藤の状態を記録
  *care(c) {
    yield wait(2);
    yield* this.talk([['trainer', '右の太もも、まだ張っていますね', 3.0], ['sato', '走ると重い感じが残ってて…', 3.0]]);
    c.intend('trainer', { do: 'think', for: 2.6, reason: '張りが3日続いている。今日は別メニューにして、記録を首脳陣と共有する' });
    yield wait(2.8);
    yield* this.talk([['trainer', '今日は別メニューでいきましょう', 2.6]]);
    c.replace('trainer', go('care-seat', 'record'), act('record', 14, '佐藤の状態を記録している', '張りの経過を数字で残し、起用の判断材料にしてもらう'));
    yield wait(3);
    c.event('中村トレーナー：佐藤 #3 の右太ももの張りを記録（3日連続）', { who: ['trainer', 'sato'], spot: 'care-seat', kind: 'record' });
    c.replace('sato', { do: 'wait', for: 1.5 }, go('locker-2', 'sitidle'), act('sitidle', 8, 'ロッカーで着替えている', '今日は別メニュー。軽く体を動かす準備をする'));
    this.free('sato');
    yield wait(16);
    this.free('trainer');
  }
  // ブルペン：遠藤が投げ終えてケアへ
  *bullpen(c) {
    yield until(() => (c.pitches || 0) >= 12 && c.t > 46);
    yield* this.talk([['endo', '今日はここまでにします', 2.4], ['pcoach', 'よし。肩のケアに行ってこい', 2.6]]);
    c.event('遠藤 #18：ブルペンでの投球を終え、ケアルームへ', { who: ['endo', 'pcoach'], spot: 'mound', kind: 'info' });
    c.flags.penDone = true;
    c.replace('pcoach', act('penwatch', 3, '遠藤を見送っている'));
    c.replace('endo', go('bed-2', 'lie', { reason: '投げた後の肩の張りを、早めに抜いておきたい' }));
    c.replace('kawaguchi', go('bench-3', 'sitrest'), act('sitrest', 12, 'ベンチで水分補給している', '捕手は消耗が大きい。こまめに休む'));
    this.free('kawaguchi');
    yield until(() => c.isAt('endo', 'bed-2'));
    this.hold('trainer');
    c.replace('trainer', go('treat-2', 'treat'), act('treat', 16, '遠藤の肩をケアしている', '投球後の肩の張りを確かめ、アイシングするか判断したい'));
    yield until(() => c.isAt('trainer', 'treat-2'));
    yield* this.talk([['trainer', '肩の後ろ、少し張ってますね', 2.8], ['endo', '最後の10球で重くなりました', 2.8]]);
    yield wait(10);
    c.replace('trainer', go('care-seat', 'record'), act('record', 12, '遠藤の投球後の状態を記録している', '投球数と張りの関係を、次の登板間隔の判断に使う'));
    c.event('中村トレーナー：遠藤 #18 の投球後の肩の状態を記録', { who: ['trainer', 'endo'], spot: 'care-seat', kind: 'record' });
    c.replace('endo', { do: 'wait', for: 2 }, go('locker-1', 'sitidle'), act('sitidle', 14, 'ロッカーで休んでいる', '午後に向けて体を冷やさないようにする'));
    this.free('endo', 'trainer');
  }
  // 少し遅れてきた森がノックに合流
  *mori(c) {
    yield wait(8);
    c.replace('mori', go('second', 'field', { gait: 'run' }), act('field', 9999, '二塁でノックを受けている', '併殺の送球をもっと速くしたい'));
    c.event('森 #5 が身支度を終えてノックに合流', { who: ['mori'], spot: 'second', kind: 'info' });
    yield wait(1); this.free('mori');
  }
  // 昼休み
  *lunch(c) {
    yield until(() => c.minutes >= 11 * 60 + 40);
    yield* this.talk([['cook', 'お昼、できてますよー！', 2.6]]);
    c.event('食堂：昼食の準備ができた', { who: ['cook'], spot: 'cook', kind: 'info' });
    yield until(() => c.minutes >= 12 * 60);
    c.event('昼休み。選手とスタッフが食堂へ', { kind: 'day', spot: 'cafe-0-0' });
    const diners = [['yamada', 'cafe-0-0'], ['mori', 'cafe-0-1'], ['kobayashi', 'cafe-0-2'], ['kubo', 'cafe-0-3'], ['aoki', 'cafe-1-0'], ['kawaguchi', 'cafe-1-1'], ['endo', 'cafe-1-2'], ['sato', 'cafe-1-3'], ['fcoach', 'cafe-2-0'], ['hcoach', 'cafe-2-1'], ['analyst', 'cafe-2-2'], ['pcoach', 'cafe-2-3']];
    for (const [id, seat] of diners) {
      this.hold(id);
      c.replace(id, { do: 'wait', for: c.r(0, 5) }, go(seat, 'eat'), act('eat', c.r(24, 36), '昼食をとっている', '午後の練習に向けて、しっかり食べておきたい'));
    }
    c.flags.lunch = true;
    yield wait(50);
    diners.forEach(([id]) => this.free(id));
    c.flags.lunch = false;
    c.event('午後の練習が始まった', { kind: 'day', spot: 'knock' });
  }
}
