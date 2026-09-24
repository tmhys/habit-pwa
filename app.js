/**
 * 習慣トラッカー（Loop Habit Tracker 風）。
 *
 * 表示データは同じリポジトリの data/habits.json。tmhys/github_obsidian
 * （非公開、日記本体を含む）から、実施した日付だけを自動転載したもの。
 * このアプリ・このリポジトリのどこにも日記の文章は入らない。
 *
 * 画面構成は Loop Habit Tracker（org.isoron.uhabits）に寄せている:
 *  - 一覧: 習慣ごとに「スコアの輪・名前・直近数日のチェック欄」を1行で出す。
 *    チェック欄をタップするとその日の実施を記録する（過去の日も可）。
 *  - 詳細: 習慣名をタップすると、概要・スコア推移・履歴・カレンダー・
 *    連続記録・曜日別頻度を出す。
 *
 * 記録・習慣の追加削除は、実際にGitHubへ書き込む権限（PAT）は持たず、専用の中継役
 * habit-relay（tmhys/gas、GAS）に軽量な合言葉だけを渡して依頼する
 * （tmhys/gas の habit-relay/README.md 参照）。日記（detect: auto）は日記本体から
 * 自動判定するので、ここからは記録できない。
 *
 * 中継役は「追加」しかできない（取り消しは不可）。そのためタップ直後は
 * 数秒だけ送信を待ち、その間に「元に戻す」を押せば送らずに済むようにしている。
 * 送信済みの記録は data/habits.json に反映されるまで（数分かかる）
 * この端末の localStorage に「送信済み」として覚えておき、表示に混ぜる。
 */

const DATA_URL = 'data/habits.json';
const UNDO_MS = 4000;
const PENDING_TTL_DAYS = 3; // これより古い「送信済み」はスナップショットに載らなくても捨てる
const CONFIG_TTL_MS = 86400000; // 習慣の追加・削除の依頼は1日で諦める（失敗していたら元に戻して見せる）

// 習慣ごとの色（identity）。どの画面でも名前と一緒に出すので、色だけで区別はさせない。
// scripts/validate_palette.js（dataviz skill）でライト背景に対して検証済み。
const HABIT_COLORS = {
  light: {
    diary: '#7e57c2', english: '#43a047', gijutsushi: '#1e88e5', alcohol: '#c88a00',
    coffee: '#a0522d', timer: '#0097a7', strength: '#e53935',
  },
  dark: {
    diary: '#9575cd', english: '#43a047', gijutsushi: '#1e88e5', alcohol: '#c88a00',
    coffee: '#a0522d', timer: '#0097a7', strength: '#ef5350',
  },
};
// アプリから追加した習慣には、この順で色を割り当てる（上と合わせて検証済み）。
const EXTRA_COLORS = ['#3949ab', '#d81b60', '#689f38', '#8e24aa', '#00897b'];
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

let fullData = null; // {generatedAt, days:[...], habits:[{id,label,mode,done:[...]}]}
let pending = loadPending(); // [{habit, ymd, sentAt}] 送信済みだがスナップショット未反映
let pendingConfig = loadPendingConfig(); // [{op, id, label, mode, sentAt}] 習慣の追加・削除の依頼
const queued = new Map(); // "habit|ymd" -> timer id（元に戻せる待ち時間中）
let openHabitId = null;
let historyUnit = 'week';

// ---------------------------------------------------------------- 日付

function ymdOf(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function parseYmd(ymd) {
  return new Date(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
}
function todayYmd() { return ymdOf(new Date()); }
function addDays(ymd, n) {
  const d = parseYmd(ymd);
  d.setDate(d.getDate() + n);
  return ymdOf(d);
}
function diffDays(a, b) { // b - a（日数）
  return Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
}
function weekdayOf(ymd) { return parseYmd(ymd).getDay(); }
function shortDate(ymd) { return Number(ymd.slice(5, 7)) + '/' + Number(ymd.slice(8, 10)); }

// ---------------------------------------------------------------- データ

async function load() {
  try {
    const res = await fetch(DATA_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    fullData = await res.json();
  } catch (e) {
    if (!fullData) {
      document.getElementById('habit-list').innerHTML =
        '<div class="empty-note">データを読み込めませんでした（' + escapeHtml(String(e.message || e)) + '）。</div>';
    }
    return;
  }
  prunePending();
  prunePendingConfig();
  renderUpdatedAt();
  renderAll();
}

// スナップショットの習慣に、依頼中の追加・削除を重ねたもの
function habits() {
  let list = ((fullData && fullData.habits) || []).slice();
  pendingConfig.forEach((c) => {
    if (c.op === 'add' && !list.some((h) => h.id === c.id)) {
      list.push({ id: c.id, label: c.label, mode: c.mode, detect: 'manual', done: [] });
    } else if (c.op === 'remove') {
      list = list.filter((h) => h.id !== c.id);
    }
  });
  return list;
}

// 日記（auto）以外はタップで記録できる。detect を持たない古いスナップショットでは日記だけ除く。
function isRecordable(h) {
  return h.detect ? h.detect !== 'auto' : h.id !== 'diary';
}
function habitById(id) { return habits().find((h) => h.id === id); }

// データの先頭日。スコア・カレンダーはここから今日までを対象にする。
function dataStart() {
  const days = (fullData && fullData.days) || [];
  return days.length ? days[0] : addDays(todayYmd(), -59);
}

function isQueued(habitId, ymd) { return queued.has(habitId + '|' + ymd); }

// スナップショット + 送信済み + 送信待ちを合わせた「実施した日」の集合。
function doneSet(h) {
  const set = new Set(h.done || []);
  pending.forEach((p) => { if (p.habit === h.id) set.add(p.ymd); });
  queued.forEach((_, key) => {
    const [hid, ymd] = key.split('|');
    if (hid === h.id) set.add(ymd);
  });
  return set;
}

function habitColor(id) {
  const mode = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  if (HABIT_COLORS[mode][id]) return HABIT_COLORS[mode][id];
  const extra = habits().filter((h) => !HABIT_COLORS.light[h.id]).findIndex((h) => h.id === id);
  return EXTRA_COLORS[Math.max(0, extra) % EXTRA_COLORS.length];
}

// ---------------------------------------------------------------- 集計

// Loop Habit Tracker と同じ指数平滑の「習慣の強さ」スコア（毎日の習慣の場合）。
// 実施した日は 1、しなかった日は 0 を入れて、半減期13日で平滑する。
const SCORE_MULTIPLIER = Math.pow(0.5, 1 / 13);

function scoreSeries(h) {
  const set = doneSet(h);
  const today = todayYmd();
  const start = dataStart();
  const out = [];
  let score = 0;
  for (let ymd = start; ymd <= today; ymd = addDays(ymd, 1)) {
    score = score * SCORE_MULTIPLIER + (set.has(ymd) ? 1 - SCORE_MULTIPLIER : 0);
    out.push({ ymd, score });
  }
  return out;
}

function streaks(h) {
  const set = doneSet(h);
  const today = todayYmd();
  const list = [];
  let cur = null;
  for (let ymd = dataStart(); ymd <= today; ymd = addDays(ymd, 1)) {
    if (set.has(ymd)) {
      if (cur) { cur.end = ymd; cur.len++; } else { cur = { start: ymd, end: ymd, len: 1 }; }
    } else if (cur) {
      list.push(cur); cur = null;
    }
  }
  if (cur) list.push(cur);
  // 今日がまだでも、昨日まで続いていれば「継続中」とみなす
  const last = list[list.length - 1];
  const current = last && (last.end === today || last.end === addDays(today, -1)) ? last.len : 0;
  return { list, current };
}

// ---------------------------------------------------------------- 描画: 一覧

function renderUpdatedAt() {
  const el = document.getElementById('updated-at');
  if (!fullData || !fullData.generatedAt) { el.textContent = ''; return; }
  el.textContent = '更新 ' + fullData.generatedAt.slice(5);

  // habit-snapshot-daily.yml が毎朝更新する想定なので、2日以上ずれていたら警告する
  const days = fullData.days || [];
  const last = days[days.length - 1];
  if (last && last < todayYmd()) {
    const lag = diffDays(last, todayYmd());
    if (lag >= 2) el.textContent += '（' + lag + '日止まっています）';
  }
}

function renderAll() {
  renderSetupHint();
  renderList();
  if (openHabitId) renderDetail();
}

function renderSetupHint() {
  const { url, token } = relaySettings();
  document.getElementById('setup-hint').classList.toggle('hidden', !!(url && token));
}

function visibleDayCount() {
  const w = document.getElementById('habit-list').clientWidth || window.innerWidth - 32;
  return Math.max(3, Math.min(10, Math.floor((w - 190) / 40)));
}

function listDays() {
  const n = visibleDayCount();
  const today = todayYmd();
  const days = [];
  for (let i = 0; i < n; i++) days.push(addDays(today, -i)); // 新しい日が左（Loopの既定）
  return prefs().reverse ? days.reverse() : days;
}

function renderList() {
  if (!fullData) return;
  const list = document.getElementById('habit-list');
  if (!habits().length) {
    list.innerHTML = '<div class="empty-note">まだ習慣がありません。</div>';
    return;
  }
  const days = listDays();
  const today = todayYmd();
  list.innerHTML = '';

  // ヘッダ（曜日と日付）
  const head = document.createElement('div');
  head.className = 'hl-row hl-head';
  head.appendChild(el('div', 'hl-name'));
  const headDays = el('div', 'hl-days');
  days.forEach((ymd) => {
    const wd = weekdayOf(ymd);
    const c = el('div', 'hl-day-head' + (wd === 0 ? ' sun' : wd === 6 ? ' sat' : '') + (ymd === today ? ' is-today' : ''));
    c.innerHTML = '<span>' + WEEKDAYS[wd] + '</span><b>' + Number(ymd.slice(8, 10)) + '</b>';
    headDays.appendChild(c);
  });
  head.appendChild(headDays);
  list.appendChild(head);

  habits().forEach((h) => {
    const color = habitColor(h.id);
    const set = doneSet(h);
    const series = scoreSeries(h);
    const score = series.length ? series[series.length - 1].score : 0;

    const row = el('div', 'hl-row');
    row.style.setProperty('--hc', color);

    const name = el('button', 'hl-name');
    name.innerHTML = ringSvg(score, 24) + '<span class="hl-label">' + escapeHtml(h.label) + '</span>';
    name.setAttribute('aria-label', h.label + ' の詳細（スコア' + Math.round(score * 100) + '%）');
    name.addEventListener('click', () => openDetail(h.id));
    row.appendChild(name);

    const cells = el('div', 'hl-days');
    days.forEach((ymd) => {
      const done = set.has(ymd);
      const b = el('button', 'hl-check' + (done ? ' done' : '') + (isQueued(h.id, ymd) ? ' queued' : ''));
      b.textContent = done ? '✓' : '×';
      b.setAttribute('aria-label', shortDate(ymd) + ' ' + h.label + (done ? ' 実施' : ' 未実施'));
      b.addEventListener('click', () => onCheckTap(h, ymd));
      cells.appendChild(b);
    });
    row.appendChild(cells);
    list.appendChild(row);
  });
}

// スコアの輪（Loop の一覧左端の円グラフ）
function ringSvg(score, size) {
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, score));
  return '<svg class="ring" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">' +
    '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" style="fill:none;stroke:var(--track);stroke-width:4"/>' +
    '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" style="fill:none;stroke:var(--hc);stroke-width:4;stroke-linecap:round" ' +
    'stroke-dasharray="' + (c * pct).toFixed(2) + ' ' + c.toFixed(2) + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"' +
    (pct === 0 ? ' opacity="0"' : '') + '/></svg>';
}

// ---------------------------------------------------------------- 記録（タップ）

function onCheckTap(h, ymd) {
  const key = h.id + '|' + ymd;
  if (queued.has(key)) { // 送信待ち中にもう一度タップ = 取り消し
    cancelQueued(key);
    return;
  }
  if (doneSet(h).has(ymd)) {
    showToast(isRecordable(h)
      ? '記録済みです。取り消しは Obsidian のストリームノートから行ってください'
      : shortDate(ymd) + ' は実施済みです（自動判定）');
    return;
  }
  if (!isRecordable(h)) {
    showToast(h.label + ' は自動で判定される習慣なので、ここからは記録できません');
    return;
  }
  const { url, token } = relaySettings();
  if (!url || !token) {
    showToast('先に記録の設定をしてください');
    openSettings();
    return;
  }

  if (navigator.vibrate) navigator.vibrate(15);
  const timer = setTimeout(() => sendRecord(h, ymd), UNDO_MS);
  queued.set(key, timer);
  renderAll();
  showToast(h.label + '（' + shortDate(ymd) + '）を記録します', { label: '元に戻す', onClick: () => cancelQueued(key) }, UNDO_MS);
}

function cancelQueued(key) {
  clearTimeout(queued.get(key));
  queued.delete(key);
  renderAll();
  showToast('取り消しました');
}

async function sendRecord(h, ymd) {
  const key = h.id + '|' + ymd;
  // 過去の日を記録するときは、その日の正午の時刻を送る（log_habit.py はエポックから日付を決める）
  const when = ymd === todayYmd() ? new Date() : new Date(parseYmd(ymd).getTime() + 12 * 3600000);
  try {
    await relayPost({ habit: h.id, epoch: String(Math.floor(when.getTime() / 1000)) });
    pending.push({ habit: h.id, ymd, sentAt: Date.now() });
    savePending();
  } catch (e) {
    showToast('記録に失敗しました（' + String(e.message || e) + '）');
  } finally {
    queued.delete(key);
    renderAll();
  }
}

function loadPending() {
  try { return JSON.parse(localStorage.getItem('habitPendingRecords') || '[]'); } catch (e) { return []; }
}
function savePending() {
  try { localStorage.setItem('habitPendingRecords', JSON.stringify(pending)); } catch (e) { /* 保存できなくても致命的ではない */ }
}
// スナップショットに反映されたもの・古すぎるものを捨てる
function prunePending() {
  const cutoff = Date.now() - PENDING_TTL_DAYS * 86400000;
  pending = pending.filter((p) => {
    const h = habitById(p.habit);
    if (h && (h.done || []).includes(p.ymd)) return false;
    return p.sentAt > cutoff;
  });
  savePending();
}

// ---------------------------------------------------------------- 習慣の追加・削除

function loadPendingConfig() {
  try { return JSON.parse(localStorage.getItem('habitPendingConfig') || '[]'); } catch (e) { return []; }
}
function savePendingConfig() {
  try { localStorage.setItem('habitPendingConfig', JSON.stringify(pendingConfig)); } catch (e) { /* 致命的ではない */ }
}
function prunePendingConfig() {
  const cutoff = Date.now() - CONFIG_TTL_MS;
  const ids = new Set(((fullData && fullData.habits) || []).map((h) => h.id));
  pendingConfig = pendingConfig.filter((c) => {
    const reflected = c.op === 'add' ? ids.has(c.id) : !ids.has(c.id);
    return !reflected && c.sentAt > cutoff;
  });
  savePendingConfig();
}

// 表示名は日本語なので、idは時刻から作る（英小文字+数字。Tasker から使うなら後で見て打てる長さ）
function newHabitId() {
  return 'h' + Date.now().toString(36);
}

async function relayPost(payload) {
  const { url, token } = relaySettings();
  if (!url || !token) throw new Error('記録の設定（中継URL・合言葉）が未入力です');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // CORSプリフライトを避ける
    body: JSON.stringify(Object.assign({ token }, payload)),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'unknown error');
  return data;
}

async function addHabit() {
  const labelEl = document.getElementById('new-habit-label');
  const idEl = document.getElementById('new-habit-id');
  const label = labelEl.value.trim();
  const id = idEl.value.trim() || newHabitId();
  const mode = document.getElementById('new-habit-mode').value;
  if (!label) { showToast('表示名を入れてください'); return; }
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(id)) { showToast('IDは英小文字で始まる英小文字・数字・_ にしてください'); return; }
  if (habits().some((h) => h.id === id)) { showToast('そのIDはもう使われています'); return; }
  try {
    await relayPost({ action: 'add-habit', id, label, mode });
  } catch (e) {
    showToast('追加できませんでした（' + String(e.message || e) + '）');
    return;
  }
  pendingConfig = pendingConfig.filter((c) => c.id !== id);
  pendingConfig.push({ op: 'add', id, label, mode, sentAt: Date.now() });
  savePendingConfig();
  labelEl.value = '';
  idEl.value = '';
  renderAll();
  renderHabitManager();
  showToast(label + ' を追加しました（Obsidian側への反映は数分後）');
}

async function removeHabit(h) {
  if (!confirm(h.label + ' を一覧から削除しますか？\n（これまでの記録は Obsidian に残ります。同じID「' + h.id + '」で追加し直せば元に戻ります）')) return;
  try {
    await relayPost({ action: 'remove-habit', id: h.id });
  } catch (e) {
    showToast('削除できませんでした（' + String(e.message || e) + '）');
    return;
  }
  pendingConfig = pendingConfig.filter((c) => c.id !== h.id);
  pendingConfig.push({ op: 'remove', id: h.id, sentAt: Date.now() });
  savePendingConfig();
  renderAll();
  renderHabitManager();
  showToast(h.label + ' を削除しました');
}

function renderHabitManager() {
  const list = document.getElementById('manage-list');
  list.innerHTML = '';
  habits().forEach((h) => {
    const row = el('div', 'manage-row');
    row.style.setProperty('--hc', habitColor(h.id));
    const name = el('span', 'manage-name');
    name.textContent = h.label;
    const meta = el('span', 'manage-meta');
    meta.textContent = h.id + (h.detect === 'auto' ? '・自動判定' : '') + (h.mode === 'log' ? '・回数' : '');
    const del = el('button', 'manage-del');
    del.textContent = '削除';
    del.setAttribute('aria-label', h.label + ' を削除');
    del.addEventListener('click', () => removeHabit(h));
    row.appendChild(name);
    row.appendChild(meta);
    row.appendChild(del);
    list.appendChild(row);
  });
}

// ---------------------------------------------------------------- 描画: 詳細

function openDetail(id) {
  openHabitId = id;
  history.pushState({ detail: id }, '');
  document.getElementById('detail').classList.remove('hidden');
  document.body.classList.add('no-scroll');
  renderDetail();
  document.getElementById('detail-body').scrollTop = 0;
}

function closeDetail() {
  openHabitId = null;
  hideTooltip();
  document.getElementById('detail').classList.add('hidden');
  document.body.classList.remove('no-scroll');
}

function renderDetail() {
  const h = habitById(openHabitId);
  if (!h) { closeDetail(); return; }
  const color = habitColor(h.id);
  const screen = document.getElementById('detail');
  screen.style.setProperty('--hc', color);
  document.getElementById('detail-title').textContent = h.label;

  const body = document.getElementById('detail-body');
  body.innerHTML = '';
  body.appendChild(overviewCard(h));
  body.appendChild(scoreCard(h));
  body.appendChild(historyCard(h));
  body.appendChild(calendarCard(h));
  body.appendChild(streakCard(h));
  body.appendChild(frequencyCard(h));

  const note = el('p', 'detail-note');
  note.textContent = 'データの範囲: ' + dataStart() + ' 〜 今日（' + (diffDays(dataStart(), todayYmd()) + 1) + '日分）' +
    '　Tasker用ID: ' + h.id;
  body.appendChild(note);

  // カレンダーは最新（右端）が見えるようにしておく
  const cal = body.querySelector('.cal-scroll');
  if (cal) cal.scrollLeft = cal.scrollWidth;
}

function card(title) {
  const c = el('section', 'card');
  if (title) {
    const t = el('h3', 'card-title');
    t.textContent = title;
    c.appendChild(t);
  }
  return c;
}

function overviewCard(h) {
  const series = scoreSeries(h);
  const scoreAt = (back) => {
    const i = series.length - 1 - back;
    return i >= 0 ? series[i].score : null;
  };
  const now = scoreAt(0) || 0;
  const month = scoreAt(30);
  const year = scoreAt(365);
  const total = doneSet(h).size;
  const st = streaks(h);

  const fmtDelta = (v) => {
    if (v == null) return '—';
    const d = Math.round((now - v) * 100);
    return (d > 0 ? '+' : '') + d + '%';
  };

  const c = card('概要');
  const wrap = el('div', 'overview');
  wrap.innerHTML =
    '<div class="ov-ring">' + ringSvg(now, 64) + '<div class="ov-score">' + Math.round(now * 100) + '%</div></div>' +
    stat(fmtDelta(month), '30日前比') +
    stat(fmtDelta(year), '1年前比') +
    stat(total + '回', '合計') +
    stat(st.current + '日', '継続中');
  c.appendChild(wrap);
  if (h.mode === 'log') {
    const n = el('p', 'card-note');
    n.textContent = 'この習慣は「回数を記録するもの」です。スコアは「どれだけ習慣になっているか」を表します。';
    c.appendChild(n);
  }
  return c;
}

function stat(value, label) {
  return '<div class="ov-stat"><b>' + escapeHtml(value) + '</b><span>' + escapeHtml(label) + '</span></div>';
}

// スコアの推移（折れ線 + 十字線ツールチップ）
function scoreCard(h) {
  const c = card('スコア');
  const series = scoreSeries(h);
  if (series.length < 2) { c.appendChild(emptyNote()); return c; }

  const W = chartWidth();
  const H = 160;
  const pad = { l: 34, r: 10, t: 10, b: 22 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const x = (i) => pad.l + (i / (series.length - 1)) * iw;
  const y = (v) => pad.t + (1 - v) * ih;

  let svg = '<svg class="chart" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">';
  [0, 0.25, 0.5, 0.75, 1].forEach((v) => {
    svg += '<line x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="grid"/>';
    svg += '<text x="' + (pad.l - 6) + '" y="' + (y(v) + 3) + '" class="axis" text-anchor="end">' + v * 100 + '%</text>';
  });
  monthTicks(series.map((p) => p.ymd)).forEach(({ i, label }) => {
    svg += '<text x="' + x(i) + '" y="' + (H - 6) + '" class="axis" text-anchor="middle">' + label + '</text>';
  });
  const pts = series.map((p, i) => x(i).toFixed(1) + ',' + y(p.score).toFixed(1)).join(' ');
  svg += '<polyline points="' + pts + '" class="line"/>';
  svg += '<line class="crosshair hidden" y1="' + pad.t + '" y2="' + (pad.t + ih) + '"/>';
  svg += '<circle class="cross-dot hidden" r="4"/>';
  svg += '<rect x="' + pad.l + '" y="0" width="' + iw + '" height="' + H + '" class="hit"/>';
  svg += '</svg>';
  c.insertAdjacentHTML('beforeend', svg);

  const svgEl = c.querySelector('svg');
  const hit = svgEl.querySelector('.hit');
  const line = svgEl.querySelector('.crosshair');
  const dot = svgEl.querySelector('.cross-dot');
  const move = (e) => {
    const rect = svgEl.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.max(0, Math.min(series.length - 1, Math.round(((px - pad.l) / iw) * (series.length - 1))));
    const p = series[i];
    line.setAttribute('x1', x(i)); line.setAttribute('x2', x(i));
    dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(p.score));
    line.classList.remove('hidden'); dot.classList.remove('hidden');
    showTooltip(p.ymd + '<br><b>' + Math.round(p.score * 100) + '%</b>', rect.left + x(i), rect.top + y(p.score));
  };
  const leave = () => { line.classList.add('hidden'); dot.classList.add('hidden'); hideTooltip(); };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', leave);
  return c;
}

function monthTicks(ymds) {
  const out = [];
  ymds.forEach((ymd, i) => {
    if (ymd.slice(8, 10) === '01') out.push({ i, label: Number(ymd.slice(5, 7)) + '月' });
  });
  // 詰まりすぎる場合は間引く
  const maxTicks = Math.max(2, Math.floor(chartWidth() / 44));
  const step = Math.ceil(out.length / maxTicks);
  return out.filter((_, k) => k % step === 0);
}

// 履歴（週ごと・月ごとの回数の棒グラフ）
function historyCard(h) {
  const c = card('履歴');
  const toggle = el('div', 'seg');
  [['week', '週'], ['month', '月']].forEach(([u, label]) => {
    const b = el('button', 'seg-btn' + (historyUnit === u ? ' active' : ''));
    b.textContent = label;
    b.addEventListener('click', () => { historyUnit = u; renderDetail(); });
    toggle.appendChild(b);
  });
  c.querySelector('.card-title').appendChild(toggle);

  const set = doneSet(h);
  const buckets = [];
  const start = dataStart();
  const today = todayYmd();
  for (let ymd = start; ymd <= today; ymd = addDays(ymd, 1)) {
    let key;
    let label;
    if (historyUnit === 'week') {
      const sunday = addDays(ymd, -weekdayOf(ymd));
      key = sunday;
      label = shortDate(sunday) + '〜';
    } else {
      key = ymd.slice(0, 7);
      label = Number(ymd.slice(5, 7)) + '月';
    }
    let b = buckets[buckets.length - 1];
    if (!b || b.key !== key) { b = { key, label, count: 0 }; buckets.push(b); }
    if (set.has(ymd)) b.count++;
  }
  const shown = buckets.slice(-(historyUnit === 'week' ? 16 : 12));
  const max = Math.max(historyUnit === 'week' ? 7 : 1, ...shown.map((b) => b.count));

  const W = chartWidth();
  const H = 150;
  const pad = { l: 8, r: 8, t: 18, b: 22 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const slot = iw / shown.length;
  const bw = Math.max(4, Math.min(24, slot - 4));

  let svg = '<svg class="chart" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">';
  svg += '<line x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + (pad.t + ih) + '" y2="' + (pad.t + ih) + '" class="grid"/>';
  const labelEvery = Math.ceil(shown.length / Math.max(2, Math.floor(iw / 44)));
  shown.forEach((b, i) => {
    const cx = pad.l + slot * i + slot / 2;
    const bh = (b.count / max) * ih;
    if (bh > 0) svg += barPath(cx - bw / 2, pad.t + ih - bh, bw, bh);
    // 最新の棒と、月表示のときは全ての棒に値を出す（週表示は詰まるので最新だけ）
    if ((historyUnit === 'month' || i === shown.length - 1) && b.count > 0) {
      svg += '<text x="' + cx + '" y="' + (pad.t + ih - bh - 4) + '" class="value" text-anchor="middle">' + b.count + '</text>';
    }
    if ((shown.length - 1 - i) % labelEvery === 0) {
      svg += '<text x="' + cx + '" y="' + (H - 6) + '" class="axis" text-anchor="middle">' +
        (historyUnit === 'week' ? shortDate(b.key) : b.label) + '</text>';
    }
    svg += '<rect x="' + (pad.l + slot * i) + '" y="0" width="' + slot + '" height="' + H + '" class="hit" data-tip="' +
      escapeHtml(b.label + '<br><b>' + b.count + '回</b>') + '"/>';
  });
  svg += '</svg>';
  c.insertAdjacentHTML('beforeend', svg);
  return c;
}

// 上端だけ角を丸めた棒（基線側は角なし）
function barPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return '<path class="bar" d="M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
    'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z"/>';
}

// カレンダー（縦に曜日・横に週。タップで記録）
function calendarCard(h) {
  const c = card('カレンダー');
  const set = doneSet(h);
  const today = todayYmd();
  const start = addDays(dataStart(), -weekdayOf(dataStart())); // 日曜始まりに揃える
  const scroll = el('div', 'cal-scroll');
  const grid = el('div', 'cal-grid');

  // 左端の曜日ラベル
  const labels = el('div', 'cal-col cal-labels');
  labels.appendChild(el('div', 'cal-month'));
  WEEKDAYS.forEach((w, i) => {
    const d = el('div', 'cal-wd');
    d.textContent = i % 2 === 1 ? w : '';
    labels.appendChild(d);
  });
  grid.appendChild(labels);

  for (let week = start; week <= today; week = addDays(week, 7)) {
    const col = el('div', 'cal-col');
    const m = el('div', 'cal-month');
    // その週に1日が含まれる列の上に月を出す
    for (let i = 0; i < 7; i++) {
      const d = addDays(week, i);
      if (d.slice(8, 10) === '01') { m.textContent = Number(d.slice(5, 7)) + '月'; break; }
    }
    col.appendChild(m);
    for (let i = 0; i < 7; i++) {
      const ymd = addDays(week, i);
      if (ymd > today || ymd < dataStart()) {
        col.appendChild(el('div', 'cal-cell out'));
        continue;
      }
      const done = set.has(ymd);
      const b = el('button', 'cal-cell' + (done ? ' done' : '') + (ymd === today ? ' today' : '') + (isQueued(h.id, ymd) ? ' queued' : ''));
      b.setAttribute('aria-label', ymd + (done ? ' 実施' : ' 未実施'));
      b.dataset.tip = ymd + '（' + WEEKDAYS[i] + '）<br><b>' + (done ? '実施' : '未実施') + '</b>';
      b.addEventListener('click', () => onCheckTap(h, ymd));
      col.appendChild(b);
    }
    grid.appendChild(col);
  }
  scroll.appendChild(grid);
  c.appendChild(scroll);
  if (isRecordable(h)) {
    const n = el('p', 'card-note');
    n.textContent = 'マスをタップすると、その日の分を記録できます。';
    c.appendChild(n);
  }
  return c;
}

// 連続記録（長い順に上位5件）
function streakCard(h) {
  const c = card('連続記録');
  const { list } = streaks(h);
  const top = list.slice().sort((a, b) => b.len - a.len || (a.end < b.end ? 1 : -1)).slice(0, 5);
  if (!top.length) { c.appendChild(emptyNote()); return c; }
  const max = top[0].len;
  top.sort((a, b) => (a.end < b.end ? 1 : -1)); // 表示は新しい順（Loopと同じ）
  top.forEach((s) => {
    const row = el('div', 'streak');
    const pct = Math.max(8, (s.len / max) * 100);
    row.innerHTML =
      '<span class="streak-date">' + shortDate(s.start) + '</span>' +
      '<div class="streak-track"><div class="streak-bar" style="width:' + pct + '%"><span>' + s.len + '日</span></div></div>' +
      '<span class="streak-date">' + shortDate(s.end) + '</span>';
    c.appendChild(row);
  });
  return c;
}

// 曜日別の頻度（縦に曜日・横に月。点の大きさが回数）
function frequencyCard(h) {
  const c = card('曜日別の頻度');
  const set = doneSet(h);
  const months = [];
  for (let ymd = dataStart(); ymd <= todayYmd(); ymd = addDays(ymd, 1)) {
    const key = ymd.slice(0, 7);
    let m = months[months.length - 1];
    if (!m || m.key !== key) { m = { key, counts: [0, 0, 0, 0, 0, 0, 0] }; months.push(m); }
    if (set.has(ymd)) m.counts[weekdayOf(ymd)]++;
  }
  const shown = months.slice(-12);
  const max = Math.max(1, ...shown.map((m) => Math.max(...m.counts)));

  const W = chartWidth();
  const rowH = 22;
  const pad = { l: 24, r: 8, t: 8, b: 22 };
  const H = pad.t + rowH * 7 + pad.b;
  const slot = (W - pad.l - pad.r) / Math.max(shown.length, 1);
  const rMax = Math.min(9, slot / 2 - 1);

  let svg = '<svg class="chart" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">';
  WEEKDAYS.forEach((w, i) => {
    svg += '<text x="' + (pad.l - 8) + '" y="' + (pad.t + rowH * i + rowH / 2 + 4) + '" class="axis" text-anchor="end">' + w + '</text>';
  });
  shown.forEach((m, j) => {
    const cx = pad.l + slot * j + slot / 2;
    svg += '<text x="' + cx + '" y="' + (H - 6) + '" class="axis" text-anchor="middle">' + Number(m.key.slice(5, 7)) + '月</text>';
    m.counts.forEach((n, i) => {
      const cy = pad.t + rowH * i + rowH / 2;
      const r = n ? Math.max(2.5, rMax * Math.sqrt(n / max)) : 1.5;
      svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r.toFixed(1) + '" class="' + (n ? 'freq-dot' : 'freq-zero') + '" data-tip="' +
        escapeHtml(Number(m.key.slice(5, 7)) + '月の' + WEEKDAYS[i] + '曜<br><b>' + n + '回</b>') + '"/>';
    });
  });
  svg += '</svg>';
  c.insertAdjacentHTML('beforeend', svg);
  return c;
}

function chartWidth() {
  const body = document.getElementById('detail-body');
  return Math.max(260, Math.min(560, (body.clientWidth || window.innerWidth) - 32 - 28));
}

function emptyNote() {
  const d = el('div', 'empty-note');
  d.textContent = 'まだ記録がありません';
  return d;
}

// ---------------------------------------------------------------- ツールチップ

let tooltipTimer = null;
function showTooltip(html, x, y) {
  const t = document.getElementById('tooltip');
  t.innerHTML = html;
  t.classList.remove('hidden');
  const w = t.offsetWidth;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2));
  t.style.left = left + 'px';
  t.style.top = Math.max(8, y - t.offsetHeight - 12) + 'px';
  clearTimeout(tooltipTimer);
  tooltipTimer = setTimeout(hideTooltip, 2500);
}
function hideTooltip() { document.getElementById('tooltip').classList.add('hidden'); }

// data-tip を持つ要素（棒・点・カレンダーのマス）に触れたら値を出す
document.getElementById('detail-body').addEventListener('pointerover', (e) => {
  const target = e.target.closest('[data-tip]');
  if (!target) return;
  const r = target.getBoundingClientRect();
  showTooltip(target.dataset.tip, r.left + r.width / 2, r.top);
});
document.getElementById('detail-body').addEventListener('pointerout', (e) => {
  if (e.pointerType === 'mouse' && e.target.closest('[data-tip]')) hideTooltip();
});
document.getElementById('detail-body').addEventListener('scroll', hideTooltip, { passive: true });

// ---------------------------------------------------------------- 共通

function el(tag, cls) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  return d;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

let toastTimer = null;
function showToast(text, action, ms) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = el('div', 'toast');
    document.body.appendChild(t);
  }
  t.innerHTML = '';
  const span = el('span');
  span.textContent = text;
  t.appendChild(span);
  if (action) {
    const b = el('button', 'toast-action');
    b.textContent = action.label;
    b.addEventListener('click', () => { t.classList.remove('show'); action.onClick(); });
    t.appendChild(b);
  }
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2400);
}

// ---------------------------------------------------------------- 設定

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

function prefs() {
  try { return { reverse: localStorage.getItem('habitReverseDays') === '1' }; } catch (e) { return { reverse: false }; }
}

function saveSettings(url, token, reverse) {
  try {
    localStorage.setItem('habitRelayUrl', url);
    localStorage.setItem('habitRelayToken', token);
    localStorage.setItem('habitReverseDays', reverse ? '1' : '0');
  } catch (e) { /* プライベートモード等で保存できなくても致命的ではない */ }
}

function openSettings() {
  const { url, token } = relaySettings();
  document.getElementById('settings-url').value = url;
  document.getElementById('settings-token').value = token;
  document.getElementById('settings-reverse').checked = prefs().reverse;
  renderHabitManager();
  document.getElementById('settings-modal').classList.remove('hidden');
}

function closeSettings() {
  document.getElementById('settings-modal').classList.add('hidden');
}

document.getElementById('settings-btn').addEventListener('click', openSettings);
document.getElementById('setup-hint').addEventListener('click', openSettings);
document.getElementById('settings-cancel').addEventListener('click', closeSettings);
document.getElementById('settings-modal').addEventListener('click', (e) => {
  if (e.target.id === 'settings-modal') closeSettings();
});
document.getElementById('new-habit-add').addEventListener('click', addHabit);
document.getElementById('settings-save').addEventListener('click', () => {
  saveSettings(
    document.getElementById('settings-url').value.trim(),
    document.getElementById('settings-token').value.trim(),
    document.getElementById('settings-reverse').checked,
  );
  closeSettings();
  renderAll();
  showToast('設定を保存しました');
});

document.getElementById('detail-back').addEventListener('click', () => history.back());
window.addEventListener('popstate', () => { if (openHabitId) closeDetail(); });

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderAll, 150);
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderAll);

// アプリに戻ってきたら最新のスナップショットを取り直す（日付送り・他端末での記録の反映）
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') load();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* PWA機能が無くても本体は動く */ });
  });
}

load();
