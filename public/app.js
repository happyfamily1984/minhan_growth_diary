import { CHILD_NAME, BIRTH_DATE, BIRTH_INSTANT, dayNumber, dateOfDay, age, todaySeoul } from './shared.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const SOURCE_LABEL = { manual: null, telegram: '텔레그램', ocr: '캡쳐', export: '대화 파일' };

function prettyDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const w = WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}년 ${m}월 ${d}일 (${w})`;
}
const ageText = (ymd) => {
  const a = age(ymd);
  return `만 ${a.years}살 ${a.months}개월 ${a.days}일`;
};

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2400);
}

// ---------------- API ----------------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body ? { 'content-type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && path !== '/api/login') {
    showLogin();
    throw new Error('로그인이 필요해요');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '요청 실패');
  return data;
}

function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
}
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/login', { method: 'POST', body: { password: e.target.password.value } });
    $('#login').hidden = true;
    start();
  } catch (err) {
    $('#loginError').textContent = err.message;
  }
});

// ---------------- 공통: 기록 카드 ----------------
function entryCard(e, { showDate = false } = {}) {
  const el = document.createElement('div');
  el.className = 'entry';
  const src = SOURCE_LABEL[e.source];
  el.innerHTML = `
    <div class="entry-text">${esc(e.text)}</div>
    ${e.note ? `<div class="entry-note">${esc(e.note)}</div>` : ''}
    <div class="entry-meta">
      ${showDate ? `<span>${prettyDate(e.date)}</span>` : ''}
      <span>탄생 ${dayNumber(e.date).toLocaleString()}일째</span>
      ${showDate ? `<span>${ageText(e.date)}</span>` : ''}
      ${e.time ? `<span>${esc(e.time)}</span>` : ''}
      ${src ? `<span class="badge">${src}</span>` : ''}
      ${e.meta?.from ? `<span>${esc(e.meta.from)}</span>` : ''}
    </div>`;
  el.addEventListener('click', () => openEditor(e.date, e));
  return el;
}

function renderList(container, list, opts) {
  container.replaceChildren();
  if (!list.length) {
    container.innerHTML = `<div class="empty">${opts?.empty || '아직 기록이 없어요'}</div>`;
    return;
  }
  for (const e of list) container.append(entryCard(e, opts));
}

// ---------------- 화면 전환 ----------------
let currentView = 'home';
function showView(name) {
  currentView = name;
  for (const s of $$('.view')) s.hidden = s.id !== `view-${name}`;
  for (const b of $$('.bottom [data-view]')) b.classList.toggle('active', b.dataset.view === name);
  window.scrollTo(0, 0);
  refresh();
}
for (const b of $$('.bottom [data-view]')) b.addEventListener('click', () => showView(b.dataset.view));

function refresh() {
  if (currentView === 'home') renderHome();
  if (currentView === 'calendar') renderCalendar();
  if (currentView === 'import') renderImport();
  if (currentView === 'search') runSearch();
}

// ---------------- 오늘 ----------------
function milestones(today) {
  const n = dayNumber(today);
  const out = [];
  const next100 = Math.ceil((n + 1) / 100) * 100;
  const next1000 = Math.ceil((n + 1) / 1000) * 1000;
  out.push([`${next100.toLocaleString()}일`, dateOfDay(next100)]);
  if (next1000 !== next100) out.push([`${next1000.toLocaleString()}일`, dateOfDay(next1000)]);
  const a = age(today);
  const [, bm, bd] = BIRTH_DATE.split('-');
  let bYear = Number(today.slice(0, 4));
  if (`${bYear}-${bm}-${bd}` <= today) bYear += 1;
  out.push([`${a.years + 1}번째 생일`, `${bYear}-${bm}-${bd}`]);
  return out
    .map(([label, d]) => ({ label, d, left: dayNumber(d) - n }))
    .sort((x, y) => x.left - y.left);
}

function tickLive() {
  const ms = Date.now() - BIRTH_INSTANT;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms / 60000) % 60);
  const s = Math.floor((ms / 1000) % 60);
  $('#heroLive').textContent = `태어난 지 ${h.toLocaleString()}시간 ${m}분 ${s}초`;
}

async function renderHome() {
  const today = todaySeoul();
  $('#heroDate').textContent = prettyDate(today);
  $('#heroDay').textContent = dayNumber(today).toLocaleString();
  $('#heroAge').textContent = ageText(today);
  $('#heroNext').innerHTML = milestones(today)
    .map((x) => `<span>${x.label}까지 D-${x.left}</span>`)
    .join('');
  tickLive();

  const list = await api(`/api/entries?date=${today}`);
  renderList($('#todayList'), list, { empty: '오늘은 아직 기록이 없어요. 민한이가 어떤 말을 했나요?' });

  const past = (await api(`/api/entries?md=${today.slice(5)}`)).filter((e) => e.date < today).reverse();
  $('#memoriesWrap').hidden = !past.length;
  renderList($('#memories'), past, { showDate: true });
}
setInterval(() => currentView === 'home' && tickLive(), 1000);

// ---------------- 쓰기창 ----------------
const editor = $('#editor');
const form = $('#editorForm');
let editing = null;

function openEditor(date, entry = null) {
  editing = entry;
  form.reset();
  form.date.value = entry?.date || date || todaySeoul();
  form.date.min = BIRTH_DATE;
  form.text.value = entry?.text || '';
  form.note.value = entry?.note || '';
  form.time.value = entry?.time || '';
  $('#editorDelete').hidden = !entry;
  updateEditorDay();
  editor.showModal();
  form.text.focus();
}
function updateEditorDay() {
  const d = form.date.value;
  $('#editorDay').textContent = d && d >= BIRTH_DATE ? `탄생 ${dayNumber(d).toLocaleString()}일째 · ${ageText(d)}` : '';
}
form.date.addEventListener('input', updateEditorDay);
$('#editorCancel').addEventListener('click', () => editor.close());
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = { date: form.date.value, text: form.text.value, note: form.note.value, time: form.time.value };
  try {
    if (editing) await api(`/api/entries/${editing.id}`, { method: 'PUT', body });
    else await api('/api/entries', { method: 'POST', body });
    editor.close();
    toast('저장했어요 💛');
    if (currentView === 'calendar') selectDate(body.date);
    refresh();
  } catch (err) {
    toast(err.message);
  }
});
$('#editorDelete').addEventListener('click', async () => {
  if (!editing || !confirm('이 기록을 지울까요?')) return;
  await api(`/api/entries/${editing.id}`, { method: 'DELETE' });
  editor.close();
  toast('지웠어요');
  refresh();
});
$('#writeToday').addEventListener('click', () => openEditor(todaySeoul()));
$('#navWrite').addEventListener('click', () =>
  openEditor(currentView === 'calendar' ? selectedDate : todaySeoul()),
);

// ---------------- 달력 ----------------
let calMonth = todaySeoul().slice(0, 7);
let selectedDate = todaySeoul();

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
function selectDate(d) {
  selectedDate = d;
  calMonth = d.slice(0, 7);
}
$('#calPrev').addEventListener('click', () => {
  if (calMonth > BIRTH_DATE.slice(0, 7)) calMonth = shiftMonth(calMonth, -1);
  renderCalendar();
});
$('#calNext').addEventListener('click', () => {
  calMonth = shiftMonth(calMonth, 1);
  renderCalendar();
});
$('#calTitle').addEventListener('click', () => {
  selectDate(todaySeoul());
  renderCalendar();
});
$('#writeDay').addEventListener('click', () => openEditor(selectedDate));

async function renderCalendar() {
  const { counts, total } = await api('/api/entries/summary');
  const [y, m] = calMonth.split('-').map(Number);
  const today = todaySeoul();
  $('#calTitle').textContent = `${y}년 ${m}월`;

  const first = new Date(Date.UTC(y, m - 1, 1));
  const start = new Date(first.getTime() - first.getUTCDay() * 86400000);
  const grid = $('#calGrid');
  grid.replaceChildren();
  let monthCount = 0;
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const ymd = d.toISOString().slice(0, 10);
    const inMonth = d.getUTCMonth() === m - 1;
    if (i >= 35 && !inMonth && i % 7 === 0) break; // 6번째 줄이 비면 생략
    const btn = document.createElement('button');
    const c = counts[ymd] || 0;
    if (inMonth) monthCount += c;
    btn.className = [
      'cal-day',
      !inMonth && 'other',
      ymd === today && 'today',
      ymd === selectedDate && 'selected',
      c && 'has',
      ymd === BIRTH_DATE && 'birth',
      d.getUTCDay() === 0 && 'sun',
      d.getUTCDay() === 6 && 'sat',
    ]
      .filter(Boolean)
      .join(' ');
    btn.innerHTML = `<span>${d.getUTCDate()}</span>${c > 1 ? `<span class="cnt">${c}</span>` : ''}`;
    btn.disabled = ymd < BIRTH_DATE;
    btn.title = ymd >= BIRTH_DATE ? `탄생 ${dayNumber(ymd)}일째` : '';
    btn.addEventListener('click', () => {
      selectDate(ymd);
      renderCalendar();
    });
    grid.append(btn);
  }
  $('#calFoot').textContent = `이번 달 ${monthCount}개 · 전체 ${total.toLocaleString()}개의 말`;

  $('#dayTitle').textContent = prettyDate(selectedDate);
  $('#daySub').textContent =
    selectedDate >= BIRTH_DATE ? `탄생 ${dayNumber(selectedDate).toLocaleString()}일째 · ${ageText(selectedDate)}` : '';
  $('#writeDay').hidden = selectedDate < BIRTH_DATE;
  const list = await api(`/api/entries?date=${selectedDate}`);
  renderList($('#dayList'), list, {
    empty: selectedDate === BIRTH_DATE ? '👶 민한이가 태어난 날 (오전 11시 55분)' : '이 날의 기록이 없어요',
  });
}

// ---------------- 찾기 ----------------
let searchTimer;
$('#searchInput').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 200);
});
async function runSearch() {
  const q = $('#searchInput').value.trim();
  const list = (await api(`/api/entries${q ? `?q=${encodeURIComponent(q)}` : ''}`)).reverse();
  $('#searchInfo').textContent = q ? `"${q}" ${list.length}개` : `전체 ${list.length}개 (최신순)`;
  renderList($('#searchList'), list.slice(0, 300), { showDate: true, empty: '찾는 말이 없어요' });
}

// ---------------- 가져오기: 공통 선택 목록 ----------------
/**
 * items: [{ text, date?, time?, from?, side?, inboxId? }]
 * options: { source, needDate, onDone, extraInboxIds, groupBy }
 */
function renderPicker(container, items, options) {
  container.replaceChildren();
  if (!items.length) {
    container.innerHTML = '<div class="card empty">가져올 내용이 없어요</div>';
    return;
  }
  const card = document.createElement('div');
  card.className = 'card';
  const senders = [...new Set(items.map((i) => i.from).filter(Boolean))];
  const hasSides = items.some((i) => i.side);
  card.innerHTML = `
    <div class="pick-tools">
      ${options.needDate ? `<label>날짜 <input type="date" class="pick-date" min="${BIRTH_DATE}" value="${items.find((i) => i.date)?.date || todaySeoul()}"></label>` : ''}
      ${senders.length > 1 ? `<select class="pick-sender"><option value="">보낸 사람: 전체</option>${senders.map((s) => `<option>${esc(s)}</option>`).join('')}</select>` : ''}
      <button class="btn small" data-sel="all">모두 선택</button>
      <button class="btn small" data-sel="none">선택 해제</button>
      ${hasSides ? '<button class="btn small" data-sel="left">왼쪽 말풍선</button><button class="btn small" data-sel="right">오른쪽 말풍선</button>' : ''}
    </div>
    <p class="muted small">${CHILD_NAME}이가 한 말만 체크하세요. 글자는 눌러서 고칠 수 있어요.</p>
    <div class="pick-list"></div>
    <div class="sticky-actions">
      <span class="muted small pick-count">0개 선택</span>
      ${options.onDelete ? '<button class="btn small danger pick-delete">선택 삭제</button>' : ''}
      <button class="btn primary small pick-save" disabled>일기에 옮기기</button>
    </div>`;
  container.append(card);
  const listEl = $('.pick-list', card);

  const rows = items.map((it) => {
    const row = document.createElement('label');
    row.className = `pick ${it.side || ''}`;
    row.innerHTML = `
      <input type="checkbox">
      <div class="pick-body">
        <textarea class="pick-text" rows="1">${esc(it.text)}</textarea>
        <div class="pick-meta">${[it.from, it.date && !options.needDate ? prettyDate(it.date) : '', it.time].filter(Boolean).map(esc).join(' · ')}</div>
      </div>`;
    const ta = $('textarea', row);
    const fit = () => {
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    };
    requestAnimationFrame(fit);
    ta.addEventListener('input', fit);
    ta.addEventListener('click', (e) => e.preventDefault()); // 글자를 누르면 체크가 바뀌지 않게
    listEl.append(row);
    return { it, row, cb: $('input', row), ta };
  });

  const visible = () => rows.filter((r) => !r.row.hidden);
  const update = () => {
    const n = rows.filter((r) => r.cb.checked && !r.row.hidden).length;
    $('.pick-count', card).textContent = `${n}개 선택`;
    $('.pick-save', card).disabled = !n;
  };
  listEl.addEventListener('change', update);
  $('.pick-sender', card)?.addEventListener('change', (e) => {
    for (const r of rows) r.row.hidden = Boolean(e.target.value) && r.it.from !== e.target.value;
    update();
  });
  for (const b of $$('[data-sel]', card)) {
    b.addEventListener('click', () => {
      const k = b.dataset.sel;
      for (const r of visible()) r.cb.checked = k === 'all' ? true : k === 'none' ? false : r.it.side === k;
      update();
    });
  }
  const chosen = () => rows.filter((r) => r.cb.checked && !r.row.hidden);

  $('.pick-save', card).addEventListener('click', async () => {
    const commonDate = $('.pick-date', card)?.value;
    const sel = chosen();
    const payload = sel
      .map(({ it, ta }) => ({
        date: options.needDate ? commonDate : it.date,
        time: it.time || '',
        text: ta.value.trim(),
        source: options.source,
        meta: it.from ? { from: it.from } : null,
      }))
      .filter((x) => x.text);
    if (payload.some((p) => !p.date || p.date < BIRTH_DATE)) return toast('날짜를 확인해 주세요');
    const inboxIds = [...sel.map((r) => r.it.inboxId).filter(Boolean), ...(options.extraInboxIds || [])];
    try {
      await api('/api/entries', { method: 'POST', body: { items: payload, inboxIds } });
      toast(`${payload.length}개를 일기에 옮겼어요 💛`);
      for (const r of sel) r.row.remove();
      rows.splice(0, rows.length, ...rows.filter((r) => !sel.includes(r)));
      update();
      options.onDone?.();
    } catch (err) {
      toast(err.message);
    }
  });
  $('.pick-delete', card)?.addEventListener('click', async () => {
    const sel = chosen();
    if (!confirm(`${sel.length}개를 받은 메시지함에서 지울까요?`)) return;
    await options.onDelete(sel.map((r) => r.it.inboxId));
    for (const r of sel) r.row.remove();
    rows.splice(0, rows.length, ...rows.filter((r) => !sel.includes(r)));
    update();
  });
}

// ---------------- 가져오기: 탭 ----------------
let importSub = 'ocr';
for (const t of $$('.tab')) {
  t.addEventListener('click', () => {
    importSub = t.dataset.sub;
    renderImport();
  });
}
function renderImport() {
  for (const t of $$('.tab')) t.classList.toggle('active', t.dataset.sub === importSub);
  for (const s of $$('.sub')) s.hidden = s.dataset.sub !== importSub;
  if (importSub === 'inbox') renderInbox();
}

// ---------------- 캡쳐 사진 글자 읽기 (OCR) ----------------
let tesseractReady;
function loadTesseract() {
  tesseractReady ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => {
      tesseractReady = null;
      reject(new Error('글자 읽기 도구를 불러오지 못했어요 (인터넷 연결 확인)'));
    };
    document.head.append(s);
  });
  return tesseractReady;
}

const TIME_TAIL = /\s*(?:(?:오전|오후)\s*)?\d{1,2}\s*[:;.]\s*\d{2}\s*(?:[AaPp][Mm])?\s*[✓✔√vV/]*\s*$/;
const DATE_LINE = /^(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/;

/** OCR 결과 줄들을 말풍선 단위로 묶는다 */
function linesToBubbles(lines, width, fallbackDate) {
  const bubbles = [];
  let curDate = fallbackDate;
  let prev = null;
  for (const line of lines) {
    let text = line.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const { x0, x1, y0, y1 } = line.bbox;
    const center = (x0 + x1) / 2;
    const dm = text.match(DATE_LINE);
    if (dm && Math.abs(center - width / 2) < width * 0.15 && text.length < 20) {
      const yy = dm[1] || fallbackDate.slice(0, 4);
      curDate = `${yy}-${String(dm[2]).padStart(2, '0')}-${String(dm[3]).padStart(2, '0')}`;
      prev = null;
      continue;
    }
    const timeMatch = text.match(/(?:(오전|오후)\s*)?(\d{1,2})\s*[:;.]\s*(\d{2})\s*[✓✔√vV/]*\s*$/);
    let time = '';
    if (timeMatch) {
      let h = Number(timeMatch[2]);
      if (timeMatch[1] === '오후' && h < 12) h += 12;
      if (timeMatch[1] === '오전' && h === 12) h = 0;
      if (h < 24 && Number(timeMatch[3]) < 60) time = `${String(h).padStart(2, '0')}:${timeMatch[3]}`;
    }
    text = text.replace(TIME_TAIL, '').trim();
    if (!text || text.length < 1 || line.confidence < 30) continue;
    const side = x0 < width * 0.12 || center < width * 0.5 ? 'left' : 'right';
    const h = y1 - y0;
    if (prev && prev.side === side && prev.date === curDate && !prev.time && y0 - prev.y1 < h * 0.9) {
      prev.text += ' ' + text;
      prev.y1 = y1;
      prev.time = time;
    } else {
      prev = { text, side, date: curDate, time, y1 };
      bubbles.push(prev);
    }
  }
  return bubbles.map(({ y1, ...b }) => b);
}

async function ocrImages(images, container, { inboxIds = [], date } = {}) {
  container.innerHTML = `
    <div class="card"><div class="ocr-status">글자 읽기 준비 중…</div><div class="progress"><div></div></div></div>`;
  const status = $('.ocr-status', container);
  const bar = $('.progress > div', container);
  try {
    const Tesseract = await loadTesseract();
    const worker = await Tesseract.createWorker('kor+eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          status.textContent = '글자 읽는 중…';
          bar.style.width = `${Math.round(m.progress * 100)}%`;
        } else if (m.status?.includes('load')) status.textContent = '한글 사전 불러오는 중… (처음 한 번만 오래 걸려요)';
      },
    });
    const all = [];
    const previews = [];
    for (const [i, img] of images.entries()) {
      status.textContent = `글자 읽는 중… (${i + 1}/${images.length})`;
      const url = URL.createObjectURL(img);
      previews.push(url);
      const bmp = await createImageBitmap(img);
      const { data } = await worker.recognize(img);
      all.push(...linesToBubbles(data.lines || [], bmp.width, date || todaySeoul()));
    }
    await worker.terminate();
    container.innerHTML = previews.map((u) => `<img class="ocr-img" src="${u}" alt="캡쳐">`).join('');
    const pickWrap = document.createElement('div');
    container.append(pickWrap);
    const hasDetectedDate = all.some((b) => b.date !== (date || todaySeoul()));
    renderPicker(pickWrap, all, {
      source: 'ocr',
      needDate: !hasDetectedDate,
      extraInboxIds: inboxIds,
      onDone: () => inboxIds.length && renderInbox(),
    });
  } catch (err) {
    container.innerHTML = `<div class="card error">${esc(err.message)}</div>`;
  }
}

$('#ocrFile').addEventListener('change', (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (files.length) ocrImages(files, $('#ocrResult'));
});

// ---------------- 텔레그램 받은 메시지 ----------------
async function renderInbox() {
  const [st, inbox] = await Promise.all([api('/api/telegram/status'), api('/api/inbox')]);
  const box = $('#tgStatus');
  if (!st.enabled) {
    box.innerHTML = `
      <b>텔레그램 봇이 아직 연결되지 않았어요</b>
      <ol class="steps">
        <li>텔레그램에서 <b>@BotFather</b> 에게 <code>/newbot</code> 을 보내 봇을 만들고 토큰을 받아요.</li>
        <li>서버의 <code>.env</code> 파일에 <code>TELEGRAM_BOT_TOKEN=받은토큰</code> 을 적고 서버를 다시 켜요.</li>
        <li>단체방의 모든 대화를 받으려면 BotFather 에서 <code>/setprivacy</code> → 봇 선택 → <b>Disable</b>.</li>
      </ol>`;
  } else {
    box.innerHTML = `
      <b>${st.username ? '@' + esc(st.username) : '봇'} ${st.lastError ? '⚠️ 연결 오류' : '✅ 연결됨'}</b>
      ${st.lastError ? `<p class="error small">${esc(st.lastError)}</p>` : ''}
      <ul class="steps small">
        <li>봇에게 <b>캡쳐 사진</b>이나 민한이 메시지를 <b>전달</b>하거나, 봇을 <b>가족 단체방에 초대</b>하세요.</li>
        <li><code>민한: 할 말</code> 또는 <code>/m 할 말</code> 로 보내면 바로 일기에 저장돼요.</li>
        <li>그 밖의 메시지는 아래에 모여요. 민한이가 한 말만 골라 옮기세요.</li>
      </ul>`;
  }

  const wrap = $('#inboxList');
  wrap.replaceChildren();
  const photos = inbox.filter((x) => x.type === 'photo');
  const texts = inbox.filter((x) => x.type === 'text');

  for (const p of photos) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="pick-tools"><b>📸 캡쳐</b><span class="muted small">${esc(p.from)} · ${prettyDate(p.date)} ${esc(p.time)}</span></div>
      ${p.text ? `<p class="small">${esc(p.text)}</p>` : ''}
      <div class="pick-tools">
        <button class="btn primary small do-ocr">글자 읽어서 옮기기</button>
        <button class="btn small danger do-del">지우기</button>
      </div>
      <div class="ocr-out"></div>`;
    $('.do-ocr', card).addEventListener('click', async () => {
      const out = $('.ocr-out', card);
      out.innerHTML = '<div class="muted">사진 받는 중…</div>';
      try {
        const res = await fetch(`/api/inbox/${p.id}/image`);
        if (!res.ok) throw new Error((await res.json()).error || '사진을 받지 못했어요');
        ocrImages([await res.blob()], out, { inboxIds: [p.id], date: p.date });
      } catch (err) {
        out.innerHTML = `<div class="error">${esc(err.message)}</div>`;
      }
    });
    $('.do-del', card).addEventListener('click', async () => {
      await api('/api/inbox', { method: 'DELETE', body: { ids: [p.id] } });
      card.remove();
    });
    wrap.append(card);
  }

  const textWrap = document.createElement('div');
  wrap.append(textWrap);
  if (!texts.length && !photos.length) {
    textWrap.innerHTML = st.enabled ? '<div class="card empty">받은 메시지가 없어요</div>' : '';
    return;
  }
  if (texts.length) {
    renderPicker(
      textWrap,
      texts.map((t) => ({
        text: t.text,
        date: t.date,
        time: t.time,
        from: t.from + (t.chatTitle && t.chatTitle !== '개인 대화' ? ` (${t.chatTitle})` : ''),
        inboxId: t.id,
      })),
      {
        source: 'telegram',
        needDate: false,
        onDelete: (ids) => api('/api/inbox', { method: 'DELETE', body: { ids } }),
      },
    );
  }
}

// ---------------- 텔레그램 대화 내보내기(result.json) ----------------
const flatText = (t) => (Array.isArray(t) ? t.map((x) => (typeof x === 'string' ? x : x.text || '')).join('') : t || '');

$('#exportFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const out = $('#exportResult');
  try {
    const json = JSON.parse(await file.text());
    const msgs = (json.messages || json.chats?.list?.flatMap((c) => c.messages) || [])
      .filter((m) => m.type === 'message')
      .map((m) => ({
        text: flatText(m.text).trim(),
        date: String(m.date).slice(0, 10),
        time: String(m.date).slice(11, 16),
        from: m.forwarded_from || m.from || '',
      }))
      .filter((m) => m.text && m.date >= BIRTH_DATE)
      .reverse();
    renderPicker(out, msgs, { source: 'export', needDate: false });
    toast(`메시지 ${msgs.length}개를 찾았어요`);
  } catch {
    out.innerHTML = '<div class="card error">파일을 읽지 못했어요. 텔레그램 내보내기의 JSON 파일인지 확인해 주세요.</div>';
  }
});

// ---------------- 시작 ----------------
async function start() {
  try {
    await api('/api/me');
  } catch {
    return;
  }
  $('#app').hidden = false;
  showView('home');
}
start();
