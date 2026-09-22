/**
 * 習慣グリッド ビューア。
 *
 * データ元は同じリポジトリの data/habits.json。tmhys/github_obsidian
 * （非公開、日記本体を含む）から、実施した日付だけを自動転載したもの。
 * このアプリ・このリポジトリのどこにも日記の文章は入らない。
 *
 * 読み取り専用。記録はTasker（アプリ起動検知・ワンタップボタン）側で行う
 * （tmhys/github_obsidian の _scripts/README.md「習慣トラッカー」参照）。
 */

const DATA_URL = 'data/habits.json';

let fullData = null; // {generatedAt, days:[...], habits:[{id,label,mode,done:[...]}]}
let rangeDays = 30;

function todayYmd() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function load() {
  try {
    const res = await fetch(DATA_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    fullData = await res.json();
  } catch (e) {
    document.getElementById('grid-wrap').innerHTML =
      '<div class="empty-note">データを読み込めませんでした（' + escapeHtml(String(e.message || e)) + '）。<br>' +
      'まだ一度もTaskerから記録していない場合は、最初の1件を記録すると表示されます。</div>';
    return;
  }
  renderUpdatedAt();
  render();
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
