/**
 * 習慣グリッド ビューア + 手動記録ボタン。
 *
 * 表示データは同じリポジトリの data/habits.json。tmhys/github_obsidian
 * （非公開、日記本体を含む）から、実施した日付だけを自動転載したもの。
 * このアプリ・このリポジトリのどこにも日記の文章は入らない。
 *
 * 記録は4つの手動habit（技術士勉強・お酒・コーヒー・筋トレ）だけ、この画面の
 * ボタンから行える。実際にGitHubへ書き込む権限（PAT）は持たず、専用の中継役
 * habit-relay（tmhys/gas、GAS）に軽量な合言葉だけを渡して依頼する
 * （tmhys/gas の habit-relay/README.md 参照）。英語学習・タイマーはアプリ起動の
 * 自動検知のままなので、ここには出てこない（Tasker側で完結）。
 */

const DATA_URL = 'data/habits.json';
const RECORDABLE_HABITS = [
  { id: 'gijutsushi', label: '📘 技術士勉強' },
  { id: 'alcohol', label: '🍺 お酒' },
  { id: 'coffee', label: '☕ コーヒー' },
  { id: 'strength', label: '💪 筋トレ' },
];

let fullData = null; // {generatedAt, days:[...], habits:[{id,label,mode,done:[...]}]}
let rangeDays = 30;
let recordPending = new Set();

function todayYmd() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function load() {
  renderRecordPanel(); // データ取得を待たず、まずボタンだけ出す
  try {
    const res = await fetch(DATA_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    fullData = await res.json();
  } catch (e) {
    document.getElementById('grid-wrap').innerHTML =
      '<div class="empty-note">データを読み込めませんでした（' + escapeHtml(String(e.message || e)) + '）。<br>' +
      'まだ一度も記録していない場合は、上のボタンで最初の1件を記録すると表示されます。</div>';
    return;
  }
  renderUpdatedAt();
  render();
  renderRecordPanel();
}

function renderUpdatedAt() {
  const el = document.getElementById('updated-at');
  if (!fullData || !fullData.generatedAt) { el.textContent = ''; return; }
  el.textContent = '最終更新: ' + fullData.generatedAt;

  // 最新の日付が「今日」からどれだけ離れているかで鮮度を軽く警告する。
  // habit-snapshot-daily.yml が毎朝6:30 JSTに更新する想定なので、
  // 2日以上ずれていたら転載が止まっている可能性がある。
  const days = fullData.days || [];
  const last = days[days.length - 1];
  if (last && last < todayYmd()) {
    const diffDays = Math.round((new Date(todayYmd()) - new Date(last)) / 86400000);
    if (diffDays >= 2) {
      el.textContent += '（更新が' + diffDays + '日止まっています）';
    }
  }
}

function render() {
  if (!fullData) return;
  const allDays = fullData.days || [];
  const days = allDays.slice(Math.max(0, allDays.length - rangeDays));
  const today = todayYmd();

  const grid = document.getElementById('grid-wrap');
  if (!fullData.habits || !fullData.habits.length || !days.length) {
    grid.innerHTML = '<div class="empty-note">まだデータがありません。Taskerから1件記録すると表示されます。</div>';
    return;
  }

  const cols = days.length + 1; // 先頭はラベル列
  const el = document.createElement('div');
  el.className = 'habit-grid';
  el.style.gridTemplateColumns = '110px repeat(' + days.length + ', 28px)';

  // --- ヘッダ行(日付) ---
  el.appendChild(makeCell('g-label g-head', ''));
  days.forEach((ymd) => {
    const day = Number(ymd.slice(8, 10));
    const isFirstOfMonth = day === 1;
    const label = isFirstOfMonth ? (Number(ymd.slice(5, 7)) + '/' + day) : String(day);
    const cell = makeCell('g-head' + (isFirstOfMonth ? ' g-month' : ''), label);
    cell.dataset.date = ymd;
    el.appendChild(cell);
  });

  // --- 習慣ごとの行 ---
  fullData.habits.forEach((h) => {
    const doneSet = new Set(h.done || []);
    const doneInRange = days.filter((d) => doneSet.has(d)).length;
    const stat = h.mode === 'log' ? (doneInRange ? doneInRange + '回' : '') : (doneInRange + '/' + days.length);

    const labelCell = makeCell('g-label', '');
    const nameSpan = document.createElement('span');
    nameSpan.textContent = h.label;
    const statSpan = document.createElement('span');
    statSpan.className = 'g-stat';
    statSpan.textContent = stat;
    labelCell.appendChild(nameSpan);
    labelCell.appendChild(statSpan);
    el.appendChild(labelCell);

    days.forEach((ymd) => {
      const done = doneSet.has(ymd);
      const isToday = ymd === today;
      const cell = document.createElement('div');
      cell.className = 'g-cell g-day' + (done ? ' done' : '') + (isToday ? ' today' : '');
      cell.dataset.habit = h.id;
      cell.dataset.date = ymd;
      cell.innerHTML = '<div class="dot"></div>';
      cell.addEventListener('click', () => showDetail(h, ymd, done));
      el.appendChild(cell);
    });
  });

  grid.innerHTML = '';
  grid.appendChild(el);

  // 初期表示は直近の日付側(右端)が見えるようスクロールしておく
  grid.scrollLeft = grid.scrollWidth;
}

function makeCell(cls, text) {
  const d = document.createElement('div');
  d.className = 'g-cell ' + cls;
  d.textContent = text;
  return d;
}

function showDetail(habit, ymd, done) {
  const el = document.getElementById('detail');
  el.classList.remove('hidden');
  el.textContent = ymd + '　' + habit.label + '　' + (done ? '✅ 実施' : '— 未実施');
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---- 記録ボタン（habit-relay 経由） ----

function relaySettings() {
  try {
    return {
      url: localStorage.getItem('habitRelayUrl') || '',
      token: localStorage.getItem('habitRelayToken') || '',
    };
  } catch (e) {
    return { url: '', token: '' };
  }
}

function saveRelaySettings(url, token) {
  try {
    localStorage.setItem('habitRelayUrl', url);
    localStorage.setItem('habitRelayToken', token);
  } catch (e) { /* プライベートモード等で保存できなくても致命的ではない */ }
}

function renderRecordPanel() {
  const panel = document.getElementById('record-panel');
  const { url, token } = relaySettings();
  panel.innerHTML = '';

  if (!url || !token) {
    const hint = document.createElement('div');
    hint.className = 'record-setup-hint';
    hint.textContent = '⚙️ タップして記録ボタンを設定（habit-relayのURL・合言葉）';
    hint.addEventListener('click', openSettings);
    panel.appendChild(hint);
    return;
  }

  const today = todayYmd();
  const doneMap = {};
  if (fullData && fullData.habits) {
    fullData.habits.forEach((h) => { doneMap[h.id] = new Set(h.done || []); });
  }

  RECORDABLE_HABITS.forEach((h) => {
    const btn = document.createElement('button');
    const doneToday = doneMap[h.id] && doneMap[h.id].has(today);
    btn.className = 'record-btn' + (doneToday ? ' done-today' : '');
    btn.textContent = h.label;
    btn.disabled = recordPending.has(h.id);
    if (recordPending.has(h.id)) btn.classList.add('pending');
    btn.addEventListener('click', () => recordHabit(h.id, h.label));
    panel.appendChild(btn);
  });
}

async function recordHabit(habitId, label) {
  const { url, token } = relaySettings();
  if (!url || !token) { openSettings(); return; }

  recordPending.add(habitId);
  renderRecordPanel();

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // CORSプリフライトを避ける
      body: JSON.stringify({ token, habit: habitId, epoch: String(Math.floor(Date.now() / 1000)) }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'unknown error');

    showToast(label + ' を記録しました');
    if (fullData && fullData.habits) {
      const today = todayYmd();
      const h = fullData.habits.find((x) => x.id === habitId);
      if (h) {
        h.done = h.done || [];
        if (!h.done.includes(today)) h.done.push(today);
      }
      if (!fullData.days.includes(today)) fullData.days.push(today);
    }
  } catch (e) {
    showToast('記録に失敗しました（' + String(e.message || e) + '）');
  } finally {
    recordPending.delete(habitId);
    renderRecordPanel();
    render();
  }
}

let toastTimer = null;
function showToast(text) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

// ---- 設定モーダル ----

function openSettings() {
  const { url, token } = relaySettings();
  document.getElementById('settings-url').value = url;
  document.getElementById('settings-token').value = token;
  document.getElementById('settings-modal').classList.remove('hidden');
}

function closeSettings() {
  document.getElementById('settings-modal').classList.add('hidden');
}

document.getElementById('settings-btn').addEventListener('click', openSettings);
document.getElementById('settings-cancel').addEventListener('click', closeSettings);
document.getElementById('settings-modal').addEventListener('click', (e) => {
  if (e.target.id === 'settings-modal') closeSettings();
});
document.getElementById('settings-save').addEventListener('click', () => {
  const url = document.getElementById('settings-url').value.trim();
  const token = document.getElementById('settings-token').value.trim();
  saveRelaySettings(url, token);
  closeSettings();
  renderRecordPanel();
  showToast('設定を保存しました');
});

document.querySelectorAll('.range-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    rangeDays = Number(btn.dataset.days);
    document.querySelectorAll('.range-btn').forEach((b) => b.classList.toggle('active', b === btn));
    document.getElementById('detail').classList.add('hidden');
    render();
  });
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* PWA機能が無くても本体は動く */ });
  });
}

load();
