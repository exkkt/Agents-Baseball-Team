// 小野アナリスト：依頼受付 → 記録の収集 → 集計 → 考察 → レポート完成 → 関係者への報告。DOM に依存しない。
// 数値の集計は metrics.js（画面と共通）が行い、LLM は「どの選手・期間・指標を調べるか」「追加で調べるか」「考察と提案の言葉」だけを選ぶ。
// 使えるのは検証済みの構造化ツール（指標の集計・Driveの球団専用記録の検索と取得）だけで、自由なコードやSQLは実行しない
import { METRICS, METRIC_IDS, query, fmt, withUnit, unitText, FEW_DAYS } from './metrics.js';
import { coverage, queueReport, rowsFromChunk } from './records.js';
import { PLAYERS, FOCUS, coachOf, cleanText, parseJSON, remember, note } from './agents.js';
import { SPOTS, roomAt } from './world.js';

export const ANALYSIS_KINDS = ['analysis_plan', 'analysis_more', 'analysis_write'];
export const STAGE_ORDER = ['intake', 'collect', 'aggregate', 'analyze', 'complete', 'report'];
export const STAGE_LABEL = { queued: '着手待ち', intake: '依頼受付', collect: '記録の収集', aggregate: '集計', analyze: '考察', complete: 'レポート完成', report: '関係者への報告', done: '完了' };
// ゲーム内の作業時間（分）。分析デスクでPC作業をしている間だけ進む。実処理（LLM・Drive）が終わるまで次へ進まない
export const WORK = { intake: 10, collect: 25, aggregate: 20, analyze: 30, complete: 10 };
// 一つの分析の上限（その分析を区切るためのもの。別の依頼は止めない）
export const LIMITS = { maxPlayers: 4, maxMetrics: 6, maxSpanDays: 60, maxSearch: 2, maxFetch: 4, maxFollowups: 2, maxFollowQueries: 3, maxQueued: 8, deliverTries: 6 };
export const THEMES = { pitch_detail:'球種・コース・カウントの傾向', game: '試合の成績と次の起用', growth: '成長の伸び', efficiency: '練習の効率', fatigue_sleep: '疲労と睡眠', menu: 'メニュー別の時間と成果' };
const THEME_METRICS = { pitch_detail:['gamePA','batterPitchAVG','batterWhiffRate','pitcherVelocity','avgFastball','pitcherWhiffRate'], game: ['gamePA','gameAVG','batterWhiffRate','gamePitches','gameERA','avgFastball'], growth: ['abilityGain', 'expGained', 'expPerHour', 'practiceMinutes'], efficiency: ['expPerHour', 'expVsExpected', 'practiceMinutes', 'wakeFatigue'], fatigue_sleep: ['wakeFatigue', 'bedFatigue', 'sleepQuality', 'sleepMinutes', 'expPerHour'], menu: ['practiceMinutes', 'expPerHour', 'expVsExpected'] };
export const REC_TYPES = { focus_next_day: { label: '翌日の方針を変える', decider: 'manager' }, avoid_hard: { label: '強めの練習を控える（明日まで）', decider: 'manager' }, add_care: { label: 'ケアを予定に入れる', decider: 'player' }, earlier_bed: { label: '今夜は早めに寝る', decider: 'player' }, keep: { label: '今の方針を続ける（共有のみ）', decider: null } };
const TRIGGER_LABEL = { postgame: '試合後の分析', daily: '定例分析', weekly: '週の振り返り', owner: 'オーナーの依頼', manager: '監督の依頼' };
const MEET_SPOT = { office: 'meet-4', analysis: 'screen-view', cafe: 'serve', locker: 'locker-front', care: 'towels', walk: 'gate', path: 'gate', yard: 'yard-bench' };
const FIELD_SPOTS = ['bench-front', 'cage-out', 'talk-l', 'pen-coach2', 'catch-a', 'cage-watch'];
// 原因を断定する言い回し（観察から因果を断定しない）
const CAUSAL = /(原因|せいで|のせい|ためだ|ためである|によって(低下|悪化|増加|改善|上昇|減少)|が影響して|につながった|が招いた)/;
const modOf = M => ((M % 1440) + 1440) % 1440;
const clone = o => JSON.parse(JSON.stringify(o));

export class Analyst {
  constructor(director) { this.d = director; this.st = { seq: 0, jobs: [], reports: [], lastDaily: 0 }; this.runtime = {}; }
  serialize() { return clone(this.st); }
  restore(data) {
    this.st = data ? clone(data) : { seq: 0, jobs: [], reports: [], lastDaily: 0 };
    // 保存した時点で通信中だった実処理（Drive）は、やり直す（取得済みの行はジョブに残っている）
    for (const j of this.st.jobs) if (j.pending === 'drive') { j.pending = null; j.collected = false; }
  }
  get c() { return this.d.c; }
  current() { const j = this.st.jobs.find(x => STAGE_ORDER.includes(x.stage)); return j ? { ...j, stageLabel: STAGE_LABEL[j.stage] } : null; }
  job(id) { return this.st.jobs.find(j => j.id === id) || null; }
  report(id) { return this.st.reports.find(r => r.id === id) || null; }
  onDuty() { return this.d.duty.analyst?.state === 'on'; }
  // 残業してでも続ける作業があるか（報告の相手が寝ている・帰っているだけなら翌日に回す）
  busy() { const j = this.st.jobs.find(x => STAGE_ORDER.includes(x.stage)); if (!j) return false; if (j.stage !== 'report') return true; return j.recipients?.some(r => r.status !== 'delivered' && this.d.onSite(r.who) && !this.d.matches.holds(r.who)); }
  wants(req) { const j = this.job(req.extra?.job); return !!j && j.pendingKind === req.kind && this.onDuty(); }

  // ── 依頼（オーナー・監督・定例）。順番に1件ずつ処理する
  request({ trigger, by, players = null, from = null, to = null, theme = 'efficiency', question = '' }) {
    if (this.st.jobs.filter(j => j.stage === 'queued').length >= LIMITS.maxQueued) return { ok: false, message: '依頼が多いため受け付けられません（着手待ちが上限）' };
    const id = `A${++this.st.seq}`, d = this.d;
    const j = { id, trigger, by, request: { players: players ? players.filter(p => PLAYERS[p]).slice(0, LIMITS.maxPlayers) : null, from, to, theme: THEMES[theme] ? theme : 'efficiency', question: cleanText(question, 100) }, createdAt: d.M, createdClock: `${d.day}日目 ${d.c.clock}`, stage: 'queued', work: 0, pending: null, pendingKind: null, counts: { search: 0, fetch: 0, followups: 0, queries: 0 }, toolLog: [], notes: [], archiveRows: [], extraFacts: [] };
    const k = trigger === 'owner' || trigger === 'manager' || trigger === 'postgame' ? this.st.jobs.findIndex(x => x.stage === 'queued' && (x.trigger === 'daily' || x.trigger === 'weekly')) : -1;
    if (k >= 0) this.st.jobs.splice(k, 0, j); else this.st.jobs.push(j);
    while (this.st.jobs.length > 40) { const i = this.st.jobs.findIndex(x => x.stage === 'done'); if (i < 0) break; this.st.jobs.splice(i, 1); }
    d.log(`小野アナリストが分析の依頼を受け付けた（${TRIGGER_LABEL[trigger]}${j.request.players ? `：${j.request.players.map(p => d.c.person(p).name).join('・')}` : ''}）${this.onDuty() ? '' : '。出勤後に着手する'}`, { who: ['analyst'], kind: 'info' });
    return { ok: true, id };
  }

  // ── 毎分の処理
  minute(c, M) {
    const d = this.d, st = this.st, mod = modOf(M), p = c.person('analyst');
    if (this.onDuty() && mod >= 570 && mod < 1080 && st.lastDaily < d.day) {
      st.lastDaily = d.day;
      if (d.day >= 2) this.request({ trigger: d.day >= 8 && d.day % 7 === 1 ? 'weekly' : 'daily', by: 'routine', theme: d.day % 7 === 1 ? 'growth' : 'efficiency' });
    }
    let j = st.jobs.find(x => STAGE_ORDER.includes(x.stage));
    if (!j && this.onDuty()) { j = st.jobs.find(x => x.stage === 'queued'); if (j) this.begin(j, M); }
    if (this.onDuty()) this.position(c, j, mod);
    if (!j) return;
    if (this.onDuty() && j.stage !== 'report' && this.atDesk(p)) j.work++;
    this.progress(c, j, M);
  }
  atDesk(p) { return !p.away && !p.moving && (p.at === 'ana-seat' || p.at === 'ana-seat2') && (p.activity === 'pc' || p.activity === 'read'); }
  position(c, j, mod) {
    const p = c.person('analyst'), meal = (mod >= 720 && mod < 770) || (mod >= 1050 && mod < 1090);
    if (!this.onDuty()) return;
    if (meal && !(j && j.stage === 'report' && this.deliverable(j))) { if (p.at !== 'cafe-2-3' && !c.busy('analyst')) c.replace('analyst', { do: 'goto', spot: 'cafe-2-3', then: 'eat' }); return; }
    if (j && j.stage === 'report') return; // 報告の移動は deliveries が行う
    if (j) {
      if (!(p.at === 'ana-seat' && p.activity === 'pc') && !c.busy('analyst')) c.replace('analyst', { do: 'goto', spot: 'ana-seat', then: 'pc' });
      if (p.at === 'ana-seat') p.doingText = this.doingText(j);
      return;
    }
    // 依頼がないとき：記録の欠けを点検する（実際に記録の範囲と件数を数えて表示する）
    if (!(p.at === 'ana-seat2' && p.activity === 'read') && !c.busy('analyst')) c.replace('analyst', { do: 'goto', spot: 'ana-seat2', then: 'read' });
    if (p.at === 'ana-seat2') { const cv = coverage(this.d.records); p.doingText = `記録の欠けを点検している（練習 ${this.d.records.practice.length}件・睡眠 ${this.d.records.sleeps.length}件、詳細は${cv.detailFrom ?? '—'}日目から）`; }
  }
  doingText(j) {
    const wait = j.pending === 'llm' ? '（LLMの順番待ち・推論中）' : j.pending === 'drive' ? '（保存庫から記録を取得中）' : '';
    const who = j.plan?.players?.map(p => this.c.person(p).name).join('・') || (j.request.players || []).map(p => this.c.person(p).name).join('・') || 'チーム';
    return `${STAGE_LABEL[j.stage]}：${who}の${THEMES[j.request.theme]}${wait}`;
  }
  begin(j, M) {
    const d = this.d;
    j.stage = 'intake'; j.work = 0; j.startedAt = M; j.startedClock = `${d.day}日目 ${d.c.clock}`;
    // 分析の開始時点で、対象データの時点を固定する（以後に増えた記録はこの分析に入らない）
    j.asOf = { seq: d.records.seq, M, clock: d.c.clock, day: d.day };
    d.log(`小野アナリストが分析 ${j.id} に着手（${TRIGGER_LABEL[j.trigger]}）。対象データは ${d.day}日目 ${d.c.clock} 時点で固定`, { who: ['analyst'], kind: 'info', spot: 'ana-seat' });
  }
  next(j, stage) { j.stage = stage; j.work = 0; j.stageAt = this.d.M; }
  progress(c, j, M) {
    const d = this.d;
    switch (j.stage) {
      case 'intake':
        if (!j.plan && !j.pending && this.onDuty()) { j.pending = 'llm'; j.pendingKind = 'analysis_plan'; d.enqueue('analysis_plan', 'analyst', { topic: j.id, extra: { job: j.id } }); }
        if (j.plan && !j.pending && j.work >= WORK.intake) this.next(j, 'collect');
        break;
      case 'collect':
        if (!j.collected && !j.pending) this.collect(j);
        if (j.collected && !j.pending && j.work >= WORK.collect + 5 * j.counts.fetch) this.next(j, 'aggregate');
        break;
      case 'aggregate':
        if (!j.facts) this.aggregate(j);
        if (!j.pending && !j.moreDone && this.onDuty()) {
          if (j.counts.followups >= LIMITS.maxFollowups) { j.moreDone = true; j.endNote = '追加調査は上限まで行った'; }
          else { j.pending = 'llm'; j.pendingKind = 'analysis_more'; d.enqueue('analysis_more', 'analyst', { topic: `${j.id}-${j.counts.followups}`, extra: { job: j.id } }); }
        }
        if (j.moreDone && !j.pending && j.work >= WORK.aggregate) this.next(j, 'analyze');
        break;
      case 'analyze':
        if (!j.write && !j.pending && this.onDuty()) { j.pending = 'llm'; j.pendingKind = 'analysis_write'; d.enqueue('analysis_write', 'analyst', { topic: j.id, extra: { job: j.id } }); }
        if (j.write && !j.pending && j.work >= WORK.analyze) this.next(j, 'complete');
        break;
      case 'complete':
        if (!j.reportId) this.publish(c, j);
        if (j.work >= WORK.complete) { this.next(j, 'report'); d.log(`小野アナリストがレポート ${j.reportId} を関係者へ報告しに行く`, { who: ['analyst'], kind: 'info' }); }
        break;
      case 'report': this.deliveries(c, j, M); break;
    }
  }

  // ── 記録の収集：ローカルの記録は固定時点まで。必要ならDriveの球団専用記録を、上限内で検索・取得する
  collect(j) {
    const d = this.d, pl = j.plan, cv = coverage(d.records), periods = [pl.current, pl.baseline].filter(Boolean);
    const minDay = Math.min(...periods.map(p => p.from)), maxDay = Math.max(...periods.map(p => p.to));
    d.records.pins[j.id] = minDay;
    const localFrom = Math.min(...[cv.detailFrom, cv.legacyFrom].filter(x => x != null), Infinity);
    const trimmedBefore = Math.max(d.records.trimmed.practiceBefore ?? -Infinity, d.records.trimmed.sleepsBefore ?? -Infinity);
    const needPitch = pl.metrics.some(m=>METRICS[m].source==='pitch') && minDay < (cv.pitchFrom??Infinity);
    const needOld = minDay < localFrom || minDay < trimmedBefore || needPitch;
    j.toolLog.push({ tool: 'local_records', args: { from: minDay, to: maxDay, players: pl.players }, result: `ローカルの記録（${cv.detailFrom ?? '—'}日目〜、既存セーブ分 ${cv.legacyFrom ?? '—'}〜${cv.legacyTo ?? '—'}日目）`, at: d.c.clock });
    const ar = d.archive;
    if (!pl.archive && !ar?.localAvailable?.()) { j.collected = true; if (needOld) j.notes.push('ローカルにない古い期間を含むが、保存庫の記録は取得しなかった'); return; }
    if (!ar || !ar.available()) { j.collected = true; j.notes.push('保存庫に接続していないため、ローカルの記録だけで分析した'); j.toolLog.push({ tool: 'drive_search', args: {}, result: '未接続のため実行せず', at: d.c.clock }); return; }
    if (!needOld) { j.collected = true; j.toolLog.push({ tool: 'drive_search', args: {}, result: '対象期間はローカルにそろっているため検索しなかった', at: d.c.clock }); return; }
    j.pending = 'drive';
    const run = async () => {
      j.counts.search++;
      const missingTo=Math.max(Number.isFinite(localFrom)?localFrom-1:-Infinity,Number.isFinite(trimmedBefore)?trimmedBefore-1:-Infinity,needPitch?(cv.pitchFrom??maxDay+1)-1:-Infinity);
      const list = await ar.search({ fromDay: minDay, toDay: Math.min(maxDay,missingTo), lineage: d.records.lineage, localOnly: !pl.archive });
      j.toolLog.push({ tool: 'drive_search', args: { fromDay: minDay, toDay: maxDay }, result: `${list.length}件の記録ファイルが見つかった`, at: d.c.clock });
      const want = list.filter(f => periods.some(p => f.day >= p.from && f.day <= p.to)).sort((a, b) => b.day - a.day).slice(0, LIMITS.maxFetch);
      if (list.length > want.length) j.notes.push(`保存庫の記録は上限（${LIMITS.maxFetch}件）まで取得した`);
      for (const f of want) {
        j.counts.fetch++;
        const chunk = await ar.fetch(f.id);
        const rows = rowsFromChunk(chunk).filter(r => !r.player || pl.players.includes(r.player));
        j.archiveRows.push(...rows);
        j.toolLog.push({ tool: 'drive_fetch', args: { id: f.id, day: f.day }, result: `${rows.length}件の記録を取得（${f.cached ? '取得済みを再利用' : '保存庫から取得'}）`, at: d.c.clock });
      }
    };
    run().catch(e => { j.notes.push(`保存庫の記録を取得できなかった（${cleanText(String(e.message || e), 40)}）。ローカルの記録で続けた`); j.toolLog.push({ tool: 'drive', args: {}, result: '失敗', at: d.c.clock }); })
      .finally(() => { j.pending = null; j.collected = true; });
  }

  // ── 集計：共通の指標定義（metrics.js）で、選手×指標×期間の事実表を作る。値はこの時点で固定する
  src(j) { return { store: this.d.records, extra: j.archiveRows || [] }; }
  aggregate(j) {
    const pl = j.plan, facts = [], src = this.src(j), asOf = j.asOf.seq;
    for (const player of pl.players) for (const metric of pl.metrics) for (const [period, range] of [['current', pl.current], ['baseline', pl.baseline]]) {
      if (!range) continue;
      facts.push(this.fact(facts.length + 1, src, { metric, player, period, range, asOf }));
    }
    j.facts = facts; j.counts.queries = facts.length;
    j.toolLog.push({ tool: 'metrics.query', args: { players: pl.players, metrics: pl.metrics }, result: `${facts.length}個の集計値（記録 ${facts.reduce((n, f) => n + f.count, 0)}件を参照）`, at: this.d.c.clock });
  }
  fact(n, src, { metric, player, period, range, asOf, groupBy = null }) {
    const q = query(src, { metric, from: range.from, to: range.to, players: player ? [player] : null, asOf, groupBy: groupBy || undefined });
    return { id: `f${n}`, metric, name: METRICS[metric].name, playerName: player ? this.c.person(player).name : null, unit: METRICS[metric].unit, player: player || null, period, from: range.from, to: range.to, value: q.value, display: fmt(metric, q.value), status: q.status, count: q.count, legacy: q.legacyCount, days: q.daysWithData, sparse: q.sparse, notes: q.notes, groupBy, groups: q.groups ? q.groups.map(g => ({ key: g.key, value: g.value, display: fmt(metric, g.value), count: g.count, status: g.status })) : null };
  }

  // ── LLM（またはルール代替）の判断の反映
  onDecision(c, req, res, tag) {
    const j = this.job(req.extra?.job), d = this.d, dec = res.decision;
    if (!j) return { applied: false, note: '対象の分析がない' };
    j.pending = null; j.pendingKind = null;
    if (req.kind === 'analysis_plan') {
      j.plan = dec; j.planBy = res.source;
      const who = dec.players.map(p => c.person(p).name).join('・');
      const txt = `対象 ${who}・指標 ${dec.metrics.map(m => METRICS[m].name).join('、')}・期間 ${dec.current.from}〜${dec.current.to}日目${dec.baseline ? `（比較 ${dec.baseline.from}〜${dec.baseline.to}日目）` : ''}・Drive取得 ${dec.archive ? 'する' : 'しない'}`;
      d.log(`小野アナリストが調査計画を決定（${tag}）：${txt}${dec.focus ? `。注目点「${dec.focus}」` : ''}`, { who: ['analyst', ...dec.players], kind: 'decision' });
      note(d.agents.analyst, `分析 ${j.id} の計画：${txt}`, c.clock);
      return { applied: true, note: txt };
    }
    if (req.kind === 'analysis_more') {
      j.counts.followups++;
      const src = this.src(j), added = [];
      for (const m of (dec.more || []).slice(0, LIMITS.maxFollowQueries)) {
        const range = m.period === 'baseline' ? j.plan.baseline : j.plan.current; if (!range) continue;
        const f = this.fact(j.facts.length + 1, src, { metric: m.metric, player: m.player === 'all' ? null : m.player, period: m.period, range, asOf: j.asOf.seq, groupBy: m.groupBy === 'none' ? null : m.groupBy });
        j.facts.push(f); added.push(`${f.name}${f.groupBy ? `（${f.groupBy}別）` : ''}`);
      }
      j.counts.queries += added.length;
      if (added.length) j.toolLog.push({ tool: 'metrics.query', args: { more: dec.more }, result: `追加の集計 ${added.length}件：${added.join('、')}`, at: c.clock });
      if (dec.done || !added.length || j.counts.followups >= LIMITS.maxFollowups) { j.moreDone = true; j.endNote = dec.done ? 'これ以上の調査は不要と判断' : !added.length ? '追加で調べる項目がなかった' : '追加調査は上限まで行った'; }
      return { applied: true, note: added.length ? `追加の集計：${added.join('、')}` : '追加の調査なし' };
    }
    // LLM が選手IDのまま書いた箇所は名前に直す（数値や意味は変えない）
    const names = Object.keys(PLAYERS).sort((a, b) => b.length - a.length), re = new RegExp(names.join('|'), 'g'), nm = t => typeof t === 'string' ? t.replace(re, id => c.person(id).name) : t;
    dec.insight = nm(dec.insight); dec.findings = dec.findings.map(f => ({ ...f, note: nm(f.note) })); dec.recommendations = dec.recommendations.map(r => ({ ...r, note: nm(r.note) })); dec.caveats = (dec.caveats || []).map(nm);
    j.write = dec; j.writeBy = res.source; j.writeIssues = res.issues || [];
    return { applied: true, note: `考察 ${dec.findings.length}件・提案 ${dec.recommendations.length}件` };
  }

  // ── レポートの完成と公開（オーナーの分析画面へ）
  publish(c, j) {
    const d = this.d, w = j.write, pl = j.plan, id = 'R' + j.id.slice(1);
    const factOf = fid => j.facts.find(f => f.id === fid);
    const strong = fids => fids.every(fid => { const f = factOf(fid); return f && !f.sparse && f.status === 'ok'; });
    const recs = w.recommendations.map((r, k) => {
      const t = REC_TYPES[r.type], decider = t.decider === 'player' ? r.player : t.decider;
      const rel = j.facts.filter(f => f.player === r.player).map(f => f.id);
      return { id: `${id}-${k + 1}`, type: r.type, label: t.label, player: r.player || null, focus: r.focus || null, note: r.note, decider, evidence: rel.length && strong(rel) ? 'clear' : 'weak', status: decider ? 'pending' : 'shared' };
    });
    const caveats = [...new Set([
      '事実は観察された記録と集計値です。同じ時期に起きた変化でも、原因は確認していません。',
      'ゲーム内の仮定にもとづく計算で、現実の人体を再現するものではありません。',
      ...j.facts.filter(f => f.sparse).slice(0, 1).map(() => `記録が少ない値があります（${FEW_DAYS}日未満の期間・選手）。`),
      ...j.facts.filter(f => f.status === 'zero_denominator').slice(0, 1).map(() => '分母がゼロの指標は「—」（確認できたゼロではありません）。'),
      ...j.facts.flatMap(f => f.notes || []).slice(0, 2),
      ...j.notes, ...(w.caveats || [])
    ])];
    const recipients = [];
    const addTo = (who, recId, needs) => { if (!who) return; let r = recipients.find(x => x.who === who); if (!r) recipients.push(r = { who, recs: [], decide: [], status: 'waiting', deliveredAt: null, held: null, tries: 0 }); if (recId) { r.recs.push(recId); if (needs) r.decide.push(recId); } };
    addTo('manager', null, false);
    if (j.request.theme === 'game') for (const player of pl.players) addTo(player, null, false);
    for (const r of recs) { if (r.decider) addTo(r.decider, r.id, true); const co = r.player && coachOf(r.player); if (co) addTo(co, r.id, false); }
    const report = { id, jobId: j.id, trigger: j.trigger, triggerLabel: TRIGGER_LABEL[j.trigger], requestedBy: j.by, question: j.request.question || '', theme: j.request.theme, title: `${pl.players.map(p => c.person(p).name).join('・')}：${THEMES[j.request.theme]}`, createdDay: d.day, createdAt: d.M, createdClock: `${d.day}日目 ${c.clock}`, asOf: j.asOf, period: { current: pl.current, baseline: pl.baseline || null }, players: pl.players, metrics: pl.metrics, data: { records: j.facts.reduce((n, f) => n + f.count, 0), legacy: j.facts.reduce((n, f) => n + f.legacy, 0), archiveRows: j.archiveRows.length, archiveFiles: j.counts.fetch, searches: j.counts.search, queries: j.counts.queries, followups: j.counts.followups }, facts: j.facts, findings: w.findings.map(f => ({ ...f, factText: this.factText(factOf(f.fact)) })), insight: w.insight, recommendations: recs, caveats, recipients, generatedBy: j.planBy === 'llm' && j.writeBy === 'llm' ? 'llm' : j.planBy === 'llm' || j.writeBy === 'llm' ? 'mixed' : j.writeBy, planBy: j.planBy, writeBy: j.writeBy, issues: j.writeIssues || [], toolLog: j.toolLog, endNote: j.endNote || null };
    this.st.reports.push(report); while (this.st.reports.length > 60) this.st.reports.shift();
    j.reportId = id; j.recipients = recipients;
    queueReport(d.records, report);
    j.archiveRows=[]; // 集計と考察の完了後、原本の複製はセーブに抱え込まない（原本は保存庫にある）
    delete d.records.pins[j.id];
    d.log(`小野アナリストがレポート ${id}「${report.title}」を完成させ、分析室に公開した（事実 ${report.findings.length}件・提案 ${recs.length}件）`, { who: ['analyst'], kind: 'decision', spot: 'ana-seat', reportId: id });
    c.emit('report', { id });
  }
  factText(f) { if (!f) return ''; const who = f.player ? this.c.person(f.player).name : 'チーム'; return `${who}の${f.name}（${f.from}〜${f.to}日目）：${withUnit(f.metric, f.value)}・記録${f.count}件${f.sparse ? '・記録が少ない' : ''}`; }

  // ── 関係者への報告。相手のところへ行って伝え、受け手の「知っていること」と検討項目に加える。眠っている・帰っている相手には後で伝える
  deliverable(j) { return j.recipients?.find(r => r.status !== 'delivered' && this.d.onSite(r.who) && !this.d.matches.holds(r.who) && this.meetSpot(r.who)); }
  meetSpot(who) {
    const q = this.c.person(who); if (q.away || q.sleeping) return null;
    const rid = roomOf(q), tx = q.x / 16, ty = q.y / 16;
    if (rid === 'dorm') return null; // 寮の自室には入らない（次に会えたときに伝える）
    if (rid === 'field') return FIELD_SPOTS.map(s => [s, Math.hypot(SPOTS[s].x - tx, SPOTS[s].y - ty)]).sort((a, b) => a[1] - b[1])[0][0];
    return MEET_SPOT[rid] || null;
  }
  deliveries(c, j, M) {
    const d = this.d, p = c.person('analyst'), rep = this.report(j.reportId);
    for (const r of j.recipients) if (r.status !== 'delivered') { const q = c.person(r.who); r.held = q.away ? '勤務時間外のため、出勤後に伝える' : q.sleeping || !d.awake(r.who) ? '眠っているため、起きてから伝える' : !this.meetSpot(r.who) ? '寮の自室にいるため、次に会えたときに伝える' : null; r.status = r.held ? 'held' : 'waiting'; }
    if (rep) rep.recipients = clone(j.recipients);
    if (j.recipients.every(r => r.status === 'delivered')) { this.next(j, 'done'); j.doneAt = M; d.log(`小野アナリストがレポート ${j.reportId} の報告を終えた`, { who: ['analyst'], kind: 'info', minor: true }); return; }
    if (!this.onDuty()) return;
    const t = this.deliverable(j);
    if (!t) { if (!(p.at === 'ana-seat' && p.activity === 'pc') && !c.busy('analyst')) c.replace('analyst', { do: 'goto', spot: 'ana-seat', then: 'pc' }); if (p.at === 'ana-seat') p.doingText = `報告の相手を待っている（${j.recipients.filter(r => r.status !== 'delivered').map(r => `${c.person(r.who).name}：${r.held || '移動中'}`).join('、')}）`; return; }
    const spot = this.meetSpot(t.who);
    if (j.target !== t.who || j.targetSpot !== spot) { j.target = t.who; j.targetSpot = spot; t.tries++; c.replace('analyst', { do: 'goto', spot, then: 'talk' }); p.doingText = null; return; }
    if (p.at !== spot || p.moving) return;
    // 着いた：相手の検討項目に加え、要点を伝える
    const recs = rep.recommendations.filter(x => t.recs.includes(x.id));
    for (const rc of recs) {
      const needs = t.decide.includes(rc.id);
      d.deliver(t.who, { kind: 'analysis', kindLabel: '分析レポート', from: 'analyst', fromLabel: '小野アナリスト', reportId: rep.id, recId: rc.id, text: `${rep.id}：${rc.player ? c.person(rc.player).name + 'について' : ''}${rc.label}${rc.note ? `「${rc.note}」` : ''}`, change: needs && rc.type !== 'keep' ? { type: rc.type, player: rc.player, focus: rc.focus } : null, changeText: needs ? rc.label : '', urgent: false, needsDecision: needs && rc.type !== 'keep', evidence: rc.evidence });
    }
    const personal = PLAYERS[t.who] ? rep.facts.filter(f => f.player === t.who && f.period === 'current').slice(0, 2).map(f => this.factText(f)).join('／') : null;
    if (!recs.length) remember(d.agents[t.who], `小野アナリストの${rep.id}：${personal || rep.findings.slice(0, 2).map(f => f.factText).join('／')}`, c.clock);
    const head = personal || rep.findings[0]?.factText || rep.title;
    c.say('analyst', `${c.person(t.who).name}さん、${rep.id}の報告です。${head}`, 5);
    t.status = 'delivered'; t.deliveredAt = `${d.day}日目 ${c.clock}`; j.target = null; j.targetSpot = null;
    if (rep) rep.recipients = clone(j.recipients);
    d.log(`小野アナリストが${c.person(t.who).label}にレポート ${rep.id} を報告${recs.length ? `（検討を求める提案 ${t.decide.length}件・共有 ${recs.length - t.decide.length}件）` : '（要点の共有）'}`, { who: ['analyst', t.who], kind: 'decision', reportId: rep.id });
  }
  // 受け手が判断した（採用・見送り・保留）。報告状況と提案の扱いをレポートに残す
  onItemDecision(it, who, status, why, applied) {
    const rep = this.report(it.reportId); if (!rep) return;
    const rec = rep.recommendations.find(r => r.id === it.recId); if (rec) Object.assign(rec, { status, decidedBy: who, decidedAt: `${this.d.day}日目 ${this.c.clock}`, reason: why || '', applied: applied || '' });
    const r = rep.recipients.find(x => x.who === who); if (r) { r.decisions = { ...(r.decisions || {}), [it.recId]: status }; }
    const j = this.job(rep.jobId); if (j?.recipients) { const jr = j.recipients.find(x => x.who === who); if (jr) jr.decisions = { ...(jr.decisions || {}), [it.recId]: status }; }
  }

  // ── LLM に渡す材料（ジョブとアナリスト本人の情報だけ）
  context(req) {
    const d = this.d, c = this.c, j = this.job(req.extra?.job), cv = coverage(d.records);
    const ag = d.agents.analyst;
    const minDay = Math.max(1, Math.min(...[cv.detailFrom, cv.legacyFrom].filter(x => x != null), d.day));
    const ctx = { day: d.day, clock: c.clock, minDay, maxDay: d.day, archive: !!d.archive?.available(), players: Object.keys(PLAYERS).map(p => ({ id: p, label: c.person(p).label, name: c.person(p).name, pos: PLAYERS[p].pos })), coverage: cv, request: j?.request, trigger: j?.trigger, triggerLabel: j ? TRIGGER_LABEL[j.trigger] : '', plan: j?.plan || null, facts: j?.facts || [], followupsLeft: j ? LIMITS.maxFollowups - j.counts.followups : 0, fatigue: Object.fromEntries(Object.keys(PLAYERS).map(p => [p, d.trainees[p].fatigue])) };
    return { who: 'analyst', view: { label: c.person('analyst').label, roleLabel: c.person('analyst').roleLabel }, ag, tr: null, job: j, ctx };
  }
}

const roomOf = q => roomAt(Math.floor(q.x / 16), Math.floor((q.y - 4) / 16))?.id || null;

// ── プロンプト・出力形式・検証・ルール代替（分析の3種類）
const facts = list => list.map(f => `- ${f.id}：${f.player ? `${f.playerName || f.player}（${f.player}）` : 'チーム'}／${f.name}${f.groupBy ? `（${f.groupBy}別：${(f.groups || []).map(g => `${g.key}=${g.display}`).join('、')}）` : ''}／${f.period === 'current' ? '対象期間' : '比較期間'} ${f.from}〜${f.to}日目／値 ${f.display}${unitText(f.metric)}／記録${f.count}件・${f.days}日分${f.sparse ? '・記録が少ない' : ''}${f.status !== 'ok' ? `・${f.status === 'no_data' ? '記録なし' : '分母ゼロ'}` : ''}`).join('\n');
const SYS = 'あなたは架空の野球球団の育成シミュレーションに登場するデータアナリスト「小野」です。数値の計算はゲームのプログラムが行います。あなたは示された選択肢から調べ方を選び、計算済みの値だけを根拠に考察します。数値を作ったり、計算したりしないでください。観察された関係から原因を断定しないでください（「原因」「〜のせいで」「〜によって低下した」などは使わない）。出力は指定された JSON だけです。';
export function analysisPrompt(kind, full) {
  const x = full.ctx, u = [`いま：${x.day}日目 ${x.clock}。依頼：${x.triggerLabel}／テーマ「${THEMES[x.request.theme]}」${x.request.players ? `／対象の希望 ${x.request.players.join(', ')}` : ''}${x.request.from ? `／期間の希望 ${x.request.from}〜${x.request.to}日目` : ''}${x.request.question ? `／質問「${x.request.question}」` : ''}`];
  if (kind === 'analysis_plan') {
    u.push(`使える記録：詳細な記録 ${x.coverage.detailFrom ?? '—'}〜${x.coverage.detailTo ?? '—'}日目、既存セーブから取り込んだ日別の記録 ${x.coverage.legacyFrom ?? '—'}〜${x.coverage.legacyTo ?? '—'}日目。今日（${x.day}日目）の記録は途中まで。保存庫の過去記録：${x.archive ? 'このPCのDBまたは球団専用Driveフォルダから検索・取得できる（最大2回の検索・4ファイル）' : '使えない（未接続）'}`);
    u.push('選手（players、1〜4人）：\n' + x.players.map(p => `- ${p.id}：${p.label}（${p.pos}・疲労 ${x.fatigue[p.id].toFixed(0)}）`).join('\n'));
    u.push('指標（metrics、1〜6個）：\n' + METRIC_IDS.map(m => `- ${m}：${METRICS[m].name}（${METRICS[m].description}）／使える分析軸：${METRICS[m].dims.join(',')}`).join('\n'));
    u.push(`期間は日目の整数。current＝調べる期間、baseline＝比べる過去の期間（current より前・重ならない。比べないなら baseline_from=0）。どちらも ${x.minDay}〜${x.maxDay}日目、長さは最大${LIMITS.maxSpanDays}日。記録が少ない期間は避けるか、少ないことを前提にする。archive は、ローカルにない古い期間を Drive から取得するときだけ true。focus は何に注目するか（40字以内）。`);
    u.push('出力：{"players":["…"],"metrics":["…"],"current_from":数値,"current_to":数値,"baseline_from":数値,"baseline_to":数値,"archive":真偽値,"focus":"…","reason":"…"}');
  } else if (kind === 'analysis_more') {
    u.push(`調査計画：${x.plan.players.join(', ')}／${x.plan.metrics.join(', ')}／対象 ${x.plan.current.from}〜${x.plan.current.to}日目${x.plan.baseline ? `・比較 ${x.plan.baseline.from}〜${x.plan.baseline.to}日目` : ''}`);
    u.push('ここまでの集計値（ゲームが計算）：\n' + facts(x.facts));
    u.push(`追加で集計できるのは最大${LIMITS.maxFollowQueries}件、追加調査はあと${x.followupsLeft}回。分析軸 groupBy：none・menu（メニュー別）・day（日別）・session（全体練習／自主練）・ability（能力別）。指標が対応しない軸は使えない。十分なら done=true、more は空配列。`);
    u.push('出力：{"more":[{"metric":"…","player":"選手IDまたはall","groupBy":"none","period":"current|baseline"}],"done":真偽値,"reason":"…"}');
  } else {
    u.push(`注目点：${x.plan.focus || '（指定なし）'}`);
    u.push('集計値（ゲームが計算。これ以外の数値は使わない）：\n' + facts(x.facts));
    u.push('文章の中で選手は名前（例：青木）で書き、ID（aoki など）は書かない。');
    u.push(`findings：確認できた事実を最大6件。fact に集計値の id、note に読み取り（40字以内・数値は書かない）。insight：全体の考察（120字以内）。数値を書くなら上の値をそのまま使う。原因の断定はしない（「〜と同じ時期に」「〜の可能性」は可）。recommendations：最大3件。type は ${Object.entries(REC_TYPES).map(([k, v]) => `${k}=${v.label}`).join('、')}。player は対象の選手ID、focus は focus_next_day のときだけ（${Object.keys(FOCUS).join('・')}、それ以外は "none"）。note は提案の一言（40字以内）。caveats：データ不足や不確実な点（各40字以内、最大3件）。`);
    u.push('出力：{"findings":[{"fact":"f1","note":"…"}],"insight":"…","recommendations":[{"type":"…","player":"…","focus":"none","note":"…"}],"caveats":["…"],"reason":"…"}');
  }
  return { system: SYS, user: u.join('\n\n'), schema: analysisSchema(kind, full) };
}
function analysisSchema(kind, full) {
  const x = full.ctx, players = x.players.map(p => p.id), reason = { type: 'string', maxLength: 60 };
  if (kind === 'analysis_plan') return { type: 'object', properties: { players: { type: 'array', minItems: 1, maxItems: LIMITS.maxPlayers, items: { type: 'string', enum: players } }, metrics: { type: 'array', minItems: 1, maxItems: LIMITS.maxMetrics, items: { type: 'string', enum: METRIC_IDS } }, current_from: { type: 'integer' }, current_to: { type: 'integer' }, baseline_from: { type: 'integer' }, baseline_to: { type: 'integer' }, archive: { type: 'boolean' }, focus: { type: 'string', maxLength: 40 }, reason }, required: ['players', 'metrics', 'current_from', 'current_to', 'baseline_from', 'baseline_to', 'archive', 'focus', 'reason'] };
  if (kind === 'analysis_more') return { type: 'object', properties: { more: { type: 'array', maxItems: LIMITS.maxFollowQueries, items: { type: 'object', properties: { metric: { type: 'string', enum: METRIC_IDS }, player: { type: 'string', enum: ['all', ...players] }, groupBy: { type: 'string', enum: ['none', 'menu', 'day', 'session', 'ability', 'zone', 'count', 'pitchType', 'inning'] }, period: { type: 'string', enum: ['current', 'baseline'] } }, required: ['metric', 'player', 'groupBy', 'period'] } }, done: { type: 'boolean' }, reason }, required: ['more', 'done', 'reason'] };
  return { type: 'object', properties: { findings: { type: 'array', maxItems: 6, items: { type: 'object', properties: { fact: { type: 'string', enum: x.facts.map(f => f.id) }, note: { type: 'string', maxLength: 40 } }, required: ['fact', 'note'] } }, insight: { type: 'string', maxLength: 160 }, recommendations: { type: 'array', maxItems: 3, items: { type: 'object', properties: { type: { type: 'string', enum: Object.keys(REC_TYPES) }, player: { type: 'string', enum: [...x.plan.players, 'none'] }, focus: { type: 'string', enum: ['none', ...Object.keys(FOCUS)] }, note: { type: 'string', maxLength: 40 } }, required: ['type', 'player', 'focus', 'note'] } }, caveats: { type: 'array', maxItems: 3, items: { type: 'string', maxLength: 40 } }, reason }, required: ['findings', 'insight', 'recommendations', 'caveats', 'reason'] };
}
const clampDay = (v, x) => Math.max(x.minDay, Math.min(x.maxDay, Math.round(Number(v))));
// 文中の数値が集計値と一致するか・因果の断定がないかを確かめ、合わない文は除く
export function checkText(text, factList, issues, label) {
  const allowed = new Set(factList.flatMap(f => [f.display, ...(f.groups || []).map(g => g.display), String(f.from), String(f.to), String(f.count), String(f.days)]));
  const out = [];
  for (const s of cleanText(text, 400).split(/(?<=。)/)) {
    if (!s.trim()) continue;
    const nums = s.match(/\d+(?:\.\d+)?/g) || [];
    const bad = nums.filter(n => !allowed.has(n) && !(n.length === 1 && !s.includes(n + '.')));
    if (bad.length) { issues.push(`${label}：集計にない数値（${bad.slice(0, 2).join('・')}）を含む文を除外`); continue; }
    if (CAUSAL.test(s)) { issues.push(`${label}：原因を断定する表現を含む文を除外`); continue; }
    out.push(s);
  }
  return out.join('');
}
// 文中に残った選手ID・指標IDを、画面と同じ名前に置き換える（意味や数値は変えない）
function nameify(t, x) {
  if (typeof t !== 'string') return t;
  const map = { ...Object.fromEntries(METRIC_IDS.map(m => [m, METRICS[m].name])), ...Object.fromEntries((x.players || []).map(p => [p.id, p.name || p.id])) };
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  return t.replace(new RegExp(`\\(?(${keys.join('|')})\\)?`, 'g'), (_, k) => map[k]);
}
export function analysisValidate(kind, text, full) {
  const issues = [], raw = typeof text === 'object' && text ? text : parseJSON(text), x = full.ctx;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, issues: ['JSONとして読めない応答'] };
  const j = { ...raw }; for (const k of ['reason', 'focus', 'insight']) j[k] = nameify(raw[k], x);
  if (Array.isArray(raw.findings)) j.findings = raw.findings.map(f => f && typeof f === 'object' ? { ...f, note: nameify(f.note, x) } : f);
  if (Array.isArray(raw.recommendations)) j.recommendations = raw.recommendations.map(r => r && typeof r === 'object' ? { ...r, note: nameify(r.note, x) } : r);
  if (Array.isArray(raw.caveats)) j.caveats = raw.caveats.map(t => nameify(t, x));
  const reason = cleanText(j.reason, 60), ids = x.players.map(p => p.id);
  if (kind === 'analysis_plan') {
    const players = [...new Set((Array.isArray(j.players) ? j.players : []).filter(p => { const ok = ids.includes(p); if (!ok) issues.push(`選手「${cleanText(String(p), 12)}」を除外`); return ok; }))].slice(0, LIMITS.maxPlayers);
    const metrics = [...new Set((Array.isArray(j.metrics) ? j.metrics : []).filter(m => { const ok = METRICS[m]; if (!ok) issues.push(`指標「${cleanText(String(m), 16)}」を除外`); return ok; }))].slice(0, LIMITS.maxMetrics);
    if (!players.length || !metrics.length) return { ok: false, issues: [...issues, '対象の選手か指標がない'] };
    if (![j.current_from, j.current_to].every(Number.isFinite)) return { ok: false, issues: [...issues, '期間が数値でない'] };
    let cur = { from: clampDay(j.current_from, x), to: clampDay(j.current_to, x) };
    if (cur.from > cur.to) { [cur.from, cur.to] = [cur.to, cur.from]; issues.push('期間の前後を入れ替えた'); }
    if (cur.to - cur.from + 1 > LIMITS.maxSpanDays) { cur.from = cur.to - LIMITS.maxSpanDays + 1; issues.push(`期間を${LIMITS.maxSpanDays}日に縮めた`); }
    let base = null;
    if (Number(j.baseline_from) > 0 && Number.isFinite(j.baseline_to)) {
      base = { from: clampDay(j.baseline_from, x), to: Math.min(clampDay(j.baseline_to, x), cur.from - 1) };
      if (base.from > base.to) { issues.push('比較期間が対象期間と重なる・前にないため外した'); base = null; }
      else if (base.to - base.from + 1 > LIMITS.maxSpanDays) { base.from = base.to - LIMITS.maxSpanDays + 1; issues.push('比較期間を縮めた'); }
    }
    let archive = j.archive === true; if (archive && !x.archive) { archive = false; issues.push('保存庫に接続していないため取得しない'); }
    return { ok: true, decision: { players, metrics, current: cur, baseline: base, archive, focus: cleanText(j.focus, 40), reason }, issues };
  }
  if (kind === 'analysis_more') {
    const more = [];
    for (const m of Array.isArray(j.more) ? j.more.slice(0, LIMITS.maxFollowQueries) : []) {
      if (!m || !METRICS[m.metric]) { issues.push('未登録の指標を除外'); continue; }
      const player = m.player === 'all' || ids.includes(m.player) ? m.player : null; if (!player) { issues.push('対象外の選手を除外'); continue; }
      const groupBy = m.groupBy === 'none' || METRICS[m.metric].dims.includes(m.groupBy) ? m.groupBy : null; if (!groupBy) { issues.push(`この指標では使えない分析軸「${cleanText(String(m.groupBy), 10)}」を除外`); continue; }
      more.push({ metric: m.metric, player, groupBy, period: m.period === 'baseline' ? 'baseline' : 'current' });
    }
    return { ok: true, decision: { more, done: j.done === true, reason }, issues };
  }
  const fl = x.facts, fids = new Set(fl.map(f => f.id)), findings = [], seen = new Set();
  for (const f of Array.isArray(j.findings) ? j.findings.slice(0, 6) : []) {
    if (!f || !fids.has(f.fact) || seen.has(f.fact)) { issues.push('存在しない・重複した集計値の参照を除外'); continue; }
    seen.add(f.fact); findings.push({ fact: f.fact, note: checkText(f.note, fl, issues, '事実の読み取り') });
  }
  if (!findings.length) return { ok: false, issues: [...issues, '確認できた事実が1件もない'] };
  const recommendations = [];
  for (const r of Array.isArray(j.recommendations) ? j.recommendations.slice(0, 3) : []) {
    if (!r || !REC_TYPES[r.type]) { issues.push('提案の種類が選択肢にないため除外'); continue; }
    const player = x.plan.players.includes(r.player) ? r.player : null;
    if (r.type !== 'keep' && !player) { issues.push('提案の対象選手がないため除外'); continue; }
    const focus = r.type === 'focus_next_day' ? (FOCUS[r.focus] ? r.focus : null) : null;
    if (r.type === 'focus_next_day' && !focus) { issues.push('方針の変更先がないため除外'); continue; }
    recommendations.push({ type: r.type, player, focus, note: checkText(r.note, fl, issues, '提案') });
  }
  const insight = checkText(j.insight, fl, issues, '考察');
  const caveats = (Array.isArray(j.caveats) ? j.caveats.slice(0, 3) : []).map(s => checkText(s, fl, issues, '注意点')).filter(Boolean);
  return { ok: true, decision: { findings, insight, recommendations, caveats, reason }, issues };
}

// ルール代替：テーマの標準の指標で、直近と比較期間を比べる。提案は閾値で決め、根拠の集計値を参照する
export function analysisRule(kind, full) {
  const x = full.ctx;
  if (kind === 'analysis_plan') {
    const req = x.request, theme = req.theme;
    const to = req.to ? Math.min(req.to, x.maxDay) : Math.max(x.minDay, x.maxDay - 1), len = req.from && req.to ? req.to - req.from + 1 : x.trigger === 'weekly' ? 7 : 3;
    const from = req.from ? Math.max(x.minDay, req.from) : Math.max(x.minDay, to - len + 1);
    const bTo = from - 1, bFrom = Math.max(x.minDay, bTo - (x.trigger === 'weekly' ? 6 : 6));
    const players = req.players?.length ? req.players : Object.entries(x.fatigue).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p]) => p);
    return { players, metrics: THEME_METRICS[theme] || THEME_METRICS.efficiency, current: { from, to: Math.max(from, to) }, baseline: bTo >= bFrom && bTo >= x.minDay ? { from: bFrom, to: bTo } : null, archive: false, focus: `${THEMES[theme]}の直近と比較期間の差`, reason: '依頼のテーマの標準の指標で、直近と過去を比べる' };
  }
  if (kind === 'analysis_more') return { more: [], done: true, reason: '標準の集計で十分と判断した' };
  const fl = x.facts, get = (p, m, per) => fl.find(f => f.player === p && f.metric === m && f.period === per && !f.groupBy);
  const findings = [], recommendations = [];
  for (const p of x.plan.players) {
    for (const m of x.plan.metrics) {
      const cur = get(p, m, 'current'), base = get(p, m, 'baseline');
      if (!cur || findings.length >= 6) continue;
      const dir = base && cur.value != null && base.value != null ? (cur.value > base.value ? '比較期間より高い' : cur.value < base.value ? '比較期間より低い' : '比較期間と同じ') : cur.value == null ? '記録がない' : '比較する過去の記録がない';
      if (m === x.plan.metrics[0] || m === 'wakeFatigue' || m === 'expPerHour') findings.push({ fact: cur.id, note: dir });
    }
    const wf = get(p, 'wakeFatigue', 'current'), wb = get(p, 'wakeFatigue', 'baseline'), sq = get(p, 'sleepQuality', 'current'), eh = get(p, 'expPerHour', 'current'), ehb = get(p, 'expPerHour', 'baseline');
    if (recommendations.length < 3 && wf?.value != null && wf.value >= 50 && (!wb || wb.value == null || wf.value > wb.value)) recommendations.push({ type: 'avoid_hard', player: p, focus: null, note: '起床時の疲労が高い。強めは控えて様子を見る' });
    else if (recommendations.length < 3 && sq?.value != null && sq.value < 0.6) recommendations.push({ type: 'earlier_bed', player: p, focus: null, note: '睡眠の質が低めの日が続いている' });
    else if (recommendations.length < 3 && eh?.value != null && ehb?.value != null && eh.value < ehb.value * 0.85 && wf?.value != null && wf.value >= 40) recommendations.push({ type: 'focus_next_day', player: p, focus: 'recovery', note: '効率が下がった時期と疲労が重なっている' });
  }
  if (!recommendations.length) recommendations.push({ type: 'keep', player: x.plan.players[0], focus: null, note: x.request?.theme === 'game' ? '出場数を蓄積して判断する。今回の成績だけで能力を断定しない' : '大きな変化は見られない' });
  const sparse = fl.some(f => f.sparse);
  return { findings: findings.length ? findings : [{ fact: fl[0].id, note: '記録の状況' }], insight: `直近と比較期間の値を並べた。差は観察された記録で、原因は確認していない。${sparse ? '記録が少ない値がある。' : ''}`, recommendations, caveats: sparse ? ['記録が少ない期間を含む'] : [], reason: 'ルール（閾値）による代替の考察' };
}
