// Driveへ送信するのは保存ボタンを押した時だけ。認証情報はこのモジュールへ渡さない。
export function mountDrive({ snapshot, restore, restoreBackup, demo = false, onConnected = () => {} }) {
  const el = id => document.getElementById(id);
  let connected = false, busy = false, nextPage = null;
  const message = text => { el('drive-message').textContent = text; };
  function controls() {
    el('drive-connect').disabled = busy || demo;
    el('drive-status').disabled = busy || demo;
    el('drive-save').disabled = busy || demo || !connected;
    el('drive-list').disabled = busy || demo || !connected;
    el('drive-more').disabled = busy;
    el('drive-undo').disabled = busy || demo;
    el('drive-files').querySelectorAll('button').forEach(b => { b.disabled = busy; });
  }
  async function request(path, body) {
    const r = await fetch('/api/drive/' + path, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45000) });
    const j = await r.json().catch(() => ({ ok: false, message: 'サーバーから応答を取得できませんでした。' }));
    if (!r.ok || !j.ok) {
      if (j.error === 'disconnected' || j.error === 'auth') { connected = false; onConnected(false); }
      throw Error(j.message || 'Google Driveへの操作に失敗しました。');
    }
    return j;
  }
  async function run(fn) {
    if (busy || demo) return;
    busy = true; controls();
    try { await fn(); } catch (e) { message(e.name === 'TimeoutError' ? '通信が時間切れになりました。保存は完了している場合があります。一覧を確認してください。' : e.message === 'Failed to fetch' ? 'ローカルサーバーに接続できません。' : e.message); }
    finally { busy = false; controls(); }
  }
  async function status() {
    const j = await request('status'); connected = j.connected; onConnected(connected);
    el('drive-state').textContent = connected ? '接続設定済み' : '未接続';
    message(connected ? 'セーブの送信は「Driveへ保存」を押した時だけ行います。記録・レポートの送信は下の設定にしたがいます。' : j.configured ? '接続設定が見つかりました。「Googleに接続」からログインしてください。' : j.setupError === 'multiple' ? '設定ファイルの候補が複数あります。使用するファイルのパスを設定してください。' : j.setupError === 'downloads' ? 'ダウンロードフォルダを読み取れませんでした（macOSのアクセス許可を確認するか、設定ファイルのパスを指定してください）。' : 'ダウンロードした接続設定のJSONを確認してください。');
  }
  function showFiles(files, append) {
    if (!append) el('drive-files').replaceChildren();
    for (const f of files) {
      const li = document.createElement('li'), name = document.createElement('span'), button = document.createElement('button');
      name.textContent = f.name; button.textContent = '読み込む'; button.className = 'toggle';
      button.addEventListener('click', () => {
        if (!confirm('このセーブを読み込みますか？現在の進行はPC内に1件バックアップしてから切り替えます。')) return;
        run(async () => { message('セーブを取得しています…'); const j = await request('load', { id: f.id }); restore(j.snapshot); message('Driveのセーブを読み込みました。読み込み前の進行はPC内に退避しました。'); });
      });
      li.append(name, button); el('drive-files').append(li);
    }
    if (!el('drive-files').children.length) { const li = document.createElement('li'); li.textContent = 'Driveに保存したセーブはまだありません。'; el('drive-files').append(li); }
  }
  async function list(append = false) {
    message('保存一覧を取得しています…');
    const j = await request('saves' + (append && nextPage ? '?pageToken=' + encodeURIComponent(nextPage) : ''));
    showFiles(j.files, append); nextPage = j.nextPageToken;
    el('drive-more').hidden = !nextPage;
    message('この球団アプリの専用フォルダに保存したセーブを表示しています。');
  }
  el('drive-connect').addEventListener('click', () => {
    // 同じページからのPOSTで認証開始。別サイトからの認証開始要求はサーバーが拒否する。
    const form = document.createElement('form'); form.method = 'POST'; form.action = '/api/drive/connect'; form.target = '_blank'; form.rel = 'noopener';
    document.body.append(form); form.submit(); form.remove();
    message('別タブでGoogleにログインし、許可したら「接続を確認」を押してください。');
  });
  el('drive-status').addEventListener('click', () => run(status));
  el('drive-save').addEventListener('click', () => run(async () => {
    const data = snapshot(); message('現在の球団をDriveへ保存しています…');
    const j = await request('save', data);
    message('保存しました：' + j.file.name);
  }));
  el('drive-list').addEventListener('click', () => run(() => list()));
  el('drive-more').addEventListener('click', () => run(() => list(true)));
  el('drive-undo').addEventListener('click', () => {
    if (!confirm('直前のDrive読み込み前の進行に戻しますか？現在の進行と入れ替えます。')) return;
    run(async () => { restoreBackup(); message('読み込み前の進行へ戻しました。'); });
  });
  if (demo) { message('デモ台本モードではDrive保存を利用できません。'); controls(); }
  else run(status);
}
