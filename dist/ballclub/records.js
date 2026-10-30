import { allPitches } from './baseball.js';
// 長期分析用の記録。人物の短期記憶（agents の knows/recent）や画面の出来事ログとは別に、追記だけで残す。DOM に依存しない。
// 記録は seq（通し番号）を持つので、分析の開始時点の seq で「その時点までのデータ」に固定できる
export const RECORD_VERSION = 1;
// ブラウザキャッシュの日数（活動日）。原本をDBまたはDriveへ確定保存した日だけ整理する。DB原本は期限で削除しない。
export const RETAIN = { practiceDays: 30, eventDays: 30, sleepDays: 180, dayDays: 365 };
const r1 = n => Math.round(n * 10) / 10, r2 = n => Math.round(n * 100) / 100;
const clone = o => JSON.parse(JSON.stringify(o));

export function makeStore({ M, day, lineage = 'L' + Date.now().toString(36) }) {
  return { v: RECORD_VERSION, lineage, seq: 0, since: { M, day, partialDay: null }, practice: [], sleeps: [], days: [], events: [], matches: [], games: [], localGames: {}, localDays: {}, legacy: { days: [], sleeps: [], practice: [], from: null }, open: {}, trimmed: { practiceBefore: null, eventsBefore: null, sleepsBefore: null, daysBefore: null }, outbox: [], synced: {}, pins: {} };
}
const stamp = (store, t, rec) => ({ t, v: RECORD_VERSION, seq: ++store.seq, rid: `${t[0].toUpperCase()}${store.seq}`, ...rec });

// ── 書き込み
// 練習1回分。blockReport の数値（積算した実績そのもの）に、時刻・睡眠・出どころを足す
export function addPractice(store, { player, day, start, end, rep, sleepId, source, self = false, cut = null, coachMinutes = 0 }) {
  const rec = stamp(store, 'practice', { player, day, start, end, menu: rep.menu, intensity: rep.intensity, minutes: rep.minutes, planned: rep.planned, fatigue0: rep.fatigue0, fatigue1: rep.fatigue1, exp: rep.exp || {}, expect: rep.expectBy || {}, gained: rep.gained ?? 0, expected: rep.expected ?? 0, cond: rep.cond ?? null, luck: rep.luck ?? null, sleepId: sleepId || null, source: source || null, self, cut, coachMinutes });
  store.practice.push(rec); return rec;
}
// 睡眠1回分（就寝〜起床）。forDay＝この睡眠のあとに始まる活動日（その日の練習に効く）
export function addSleep(store, { player, rec, startDay, forDay }) {
  const r = stamp(store, 'sleep', { player, id: rec.id, kind: rec.kind, start: rec.start, end: rec.end, minutes: rec.minutes, wakeups: rec.wakeups, endedBy: rec.endedBy, quality: rec.quality, fatigueBed: rec.fatigue[0], fatigueWake: rec.fatigue[1], gains: rec.gains, consolidated: rec.consolidated, startDay, forDay });
  store.sleeps.push(r); return r;
}
// 指導・予定の変更・休養・報告への判断など（介入の記録）
export function addEvent(store, { day, M, kind, who, player = null, text, source = null, ref = null }) {
  const r = stamp(store, 'event', { day, M, kind, who, player, text, source, ref });
  store.events.push(r); return r;
}
// 活動日の開始・終了（能力の開始値・終了値）。成長量は「その活動日に終わった睡眠の定着分」と一致する
export function openDay(store, player, day, tr, M) { store.open[player] = { day, M, abilityStart: { ...tr.ability }, fatigueStart: r1(tr.fatigue) }; }
export function closeDay(store, player, tr, M) {
  const o = store.open[player]; if (!o) return null;
  delete store.open[player];
  const prac = store.practice.filter(p => p.player === player && p.day === o.day);
  const sleeps = store.sleeps.filter(s => s.player === player && s.forDay === o.day && s.kind === 'main');
  const bed = store.sleeps.filter(s => s.player === player && s.startDay === o.day && s.kind === 'main').at(-1) || null;
  const r = stamp(store, 'day', { player, day: o.day, start: o.M, end: M, abilityStart: o.abilityStart, abilityEnd: { ...tr.ability }, practiceMinutes: prac.reduce((n, p) => n + p.minutes, 0), practiceCount: prac.length, sleepUsed: sleeps.at(-1)?.id || null, bedSleep: bed?.id || null, partial: store.since.partialDay === o.day });
  store.days.push(r); return r;
}
export const closeDays = (store, ids, trainees, M) => ids.map(id => closeDay(store, id, trainees[id], M)).filter(Boolean);

// 既存セーブ（v1）から取れる範囲だけを取り込む。保存していなかった詳細（就寝時刻・練習ごとの時刻など）は作らない
export function importLegacy(store, trainees, { day, M }) {
  store.legacy.from = 'v1';
  for (const [player, tr] of Object.entries(trainees)) {
    for (const h of tr.history || []) {
      store.legacy.days.push({ t: 'day', legacy: true, seq: ++store.seq, rid: `L${store.seq}`, source: '既存セーブの日別履歴', player, day: h.day, practiceMinutes: h.minutes, exp: h.exp || {}, partial: false });
      // 旧版の「夜の一括計算」＝その日の夜の睡眠。翌日の練習に効く
      store.legacy.sleeps.push({ t: 'sleep', legacy: true, seq: ++store.seq, rid: `L${store.seq}`, source: '既存セーブの夜の計算', player, id: `legacy-${player}-${h.day}`, kind: 'main', start: null, end: null, minutes: null, wakeups: null, quality: h.sleep, fatigueBed: null, fatigueNight: h.fatigue?.[0] ?? null, fatigueWake: h.fatigue?.[1] ?? null, gains: h.gains || {}, startDay: h.day, forDay: h.day + 1 });
    }
    for (const rep of tr.reports || []) if (rep.kind === 'practice') store.legacy.practice.push({ t: 'practice', legacy: true, seq: ++store.seq, rid: `L${store.seq}`, source: '既存セーブの直近の練習（一部のみ）', player, day: rep.day, clock: rep.time || null, menu: rep.menu, intensity: rep.intensity, minutes: rep.minutes, exp: rep.exp || {}, gained: rep.gained, expected: rep.expected, fatigue0: rep.fatigue0, fatigue1: rep.fatigue1 });
    // 移行した日の、移行時点までの練習（合計のみ。メニューの内訳は残っていない）
    if (tr.today?.minutes > 0) store.legacy.days.push({ t: 'day', legacy: true, seq: ++store.seq, rid: `L${store.seq}`, source: '移行時点までの合計（メニュー内訳なし）', player, day, practiceMinutes: tr.today.minutes, exp: Object.fromEntries(Object.entries(tr.today.exp || {}).map(([k, v]) => [k, r2(v)])), partial: true });
  }
  store.since.partialDay = day;
  void M;
}

// ── 読み出し（分析の固定時点 asOf＝seq まで）
export function rowsOf(store, kind, { from = -Infinity, to = Infinity, players = null, asOf = Infinity, extra = [] } = {}) {
  const keep = r => (r.archived || r.seq <= asOf) && (!players || players.includes(r.player));
  const dayOf = r => kind === 'sleep' ? r.forDay : r.day;
  const local = { practice: store.practice, sleep: store.sleeps, day: store.days, event: store.events, match: store.matches || [] }[kind] || [];
  const legacy = { practice: [], sleep: store.legacy.sleeps, day: store.legacy.days, event: [], match: [] }[kind] || [];
  const seen = new Set(), out = [];
  for (const r of [...local, ...legacy, ...extra.filter(x => x.t === kind)]) {
    if (!keep(r) || dayOf(r) < from || dayOf(r) > to || seen.has(r.rid)) continue;
    seen.add(r.rid); out.push(r);
  }
  return out;
}
// どの範囲の記録があるか（分析の対象期間の選択肢・データ不足の表示に使う）
export function coverage(store) {
  const days = [...store.days.map(d => d.day), ...store.practice.map(p => p.day), ...(store.matches || []).map(p => p.day)], legacy = store.legacy.days.map(d => d.day);
  const min = a => a.length ? Math.min(...a) : null, max = a => a.length ? Math.max(...a) : null;
  return { pitchFrom: min((store.games||[]).filter(r=>r.game.v===2).map(r=>r.day)), detailFrom: min(days) ?? store.since.day, detailTo: max(days), legacyFrom: min(legacy), legacyTo: max(legacy), since: store.since, trimmed: store.trimmed, seq: store.seq };
}

// ── 古い詳細の整理（活動日の区切りで一度だけ）。分析中の期間（pins）と未送信の日は残す
export function trim(store, today) {
  const pinned = Object.values(store.pins).reduce((m, d) => Math.min(m, d), Infinity);
  const limit = (days, key, field = 'day') => {
    const soft = today - days;
    const before = store[key].length;
    store[key] = store[key].filter(r => { const d = r[field]; if (d >= soft) return true; if (d >= pinned) return true; if (!store.localDays?.[chunkId(store,d)] && !store.synced[chunkId(store,d)]) return true; return false; });
    return before !== store[key].length ? soft : null;
  };
  store.matches ??= []; store.games ??= [];
  limit(365, 'matches'); limit(30, 'games');
  const p = limit(RETAIN.practiceDays, 'practice'), e = limit(RETAIN.eventDays, 'events'), s = limit(RETAIN.sleepDays, 'sleeps', 'forDay'), d = limit(RETAIN.dayDays, 'days');
  if (p != null) store.trimmed.practiceBefore = Math.max(store.trimmed.practiceBefore ?? -Infinity, p);
  if (e != null) store.trimmed.eventsBefore = Math.max(store.trimmed.eventsBefore ?? -Infinity, e);
  if (s != null) store.trimmed.sleepsBefore = Math.max(store.trimmed.sleepsBefore ?? -Infinity, s);
  if (d != null) store.trimmed.daysBefore = Math.max(store.trimmed.daysBefore ?? -Infinity, d);
  // 原本未保存の記録は日数を理由に削らない
  // 未送信の索引は期限で捨てない。原本がDBにある日は、必要なときに取り出してDriveへ送れる。
}

// ── Driveへ送る単位（活動日ごとの記録）。同じ chunk ID は二度作らない
export const chunkId = (store, day) => `${store.lineage}-day-${day}-v${RECORD_VERSION}`;
export function chunkFor(store, day) {
  const pick = (arr, f = 'day') => arr.filter(r => r[f] === day).map(clone);
  const records = { practice: pick(store.practice), sleeps: pick(store.sleeps, 'forDay'), days: pick(store.days), events: pick(store.events), matches: pick(store.matches || []), games: pick(store.games || []) };
  const players = [...new Set([...records.practice, ...records.days, ...records.matches].map(r => r.player))].sort();
  return { kind: 'ballclub-records', v: RECORD_VERSION, lineage: store.lineage, chunk: chunkId(store, day), day, players, records, counts: Object.fromEntries(Object.entries(records).map(([k, v]) => [k, v.length])) };
}
export function queueChunk(store, day) { const id = chunkId(store, day); if (!store.synced[id] && !store.outbox.some(o => o.id === id)) store.outbox.push({ kind: 'records', id, day, tries: 0, lastError: null }); }
export function queueReport(store, report) { const id = 'report-' + report.id; if (!store.synced[id] && !store.outbox.some(o => o.id === id)) store.outbox.push({ kind: 'report', id, reportId: report.id, tries: 0, lastError: null }); }
// 取り出した記録（Driveのチャンク）を、分析で使える行に戻す
export function rowsFromChunk(chunk) {
  const r = chunk?.records || {};
  return [...(r.practice || []), ...(r.sleeps || []).map(s => ({ ...s, t: 'sleep' })), ...(r.days || []), ...(r.events || []), ...(r.matches || []), ...(r.games || []).flatMap(g=>pitchRows(g,chunk.lineage))].map(x => ({ ...x, archived: true }));
}

// 終了した試合だけを集計対象にする。打席詳細と両チームの成績も同じチャンクへ保存する。
export function addGame(store, game) {
  store.matches ??= []; store.games ??= [];
  if (!game.complete || store.games.some(r => r.game.id === game.id)) return false;
  store.games.push(stamp(store, 'game', { day: game.day, game: clone(game) }));
  const t = game.teams[game.own];
  for (const player of Object.keys(t.roster)) {
    const b = t.batting[player], p = t.pitching[player];
    if (!b.PA && !t.original.some(x => x.player === player) && !p) continue;
    store.matches.push(stamp(store, 'match', { player, day: game.day, game: game.id, opponent: game.teams[1 - game.own].name, start: game.start, end: game.end, ...b, model: game.model || 'appearance-v1', pitching: p ? clone(p) : null }));
  }
  return true;
}

export function pitchRows(record,lineage) { return allPitches(record.game).map(p=>({...p,pitchSeq:p.seq,seq:record.seq,t:'pitch',rid:`pitch:${lineage}:${record.game.id}:${p.seq}`,day:record.day,own:record.game.own})); }
