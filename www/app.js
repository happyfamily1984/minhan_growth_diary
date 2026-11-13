import { BIRTH_DATE, BIRTH_INSTANT, dayNumber, dateOfDay, age, todaySeoul } from './shared.js';
import { store, auth$ } from './store.js';
import { store as localStore } from './local-store.js';
import { shrinkPhoto, photoTakenDate, decodeImage } from './photo.js';
import { parseText, linesToBubbles } from './parse.js';
import { binarize } from './ocr-prep.js';
import { bubblesFromOcr } from './bubbles.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const SOURCE_LABEL = { paste: '붙여넣기', ocr: '캡쳐', telegram: '텔레그램', export: '대화 파일' };
const KIND = {
  say: { icon: '💬', label: '한 말', field: '민한이가 한 말', ph: '“엄마, 구름이 솜사탕처럼 생겼어!”' },
  did: { icon: '🌱', label: '한 일', field: '민한이가 한 일', ph: '처음으로 혼자 자전거를 탔어요' },
};
const native = Boolean(window.Capacitor?.isNativePlatform?.());

function prettyDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${y}년 ${m}월 ${d}일 (${WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
}
const ageText = (ymd) => {
  const a = age(ymd);
  return `만 ${a.years}살 ${a.months}개월 ${a.days}일`;
};
const nowTimeSeoul = () =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
const AUTHOR_ICON = { 아빠: '👨', 엄마: '👩' };
const authorLabel = (name) => `${AUTHOR_ICON[name] || '🙂'} ${esc(name)}`;
const dayText = (d) => (d >= BIRTH_DATE ? `탄생 ${dayNumber(d).toLocaleString()}일째` : '태어나기 전');

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2400);
}

// ---------------- 기록 카드 ----------------
function entryCard(e, { showDate = false } = {}) {
  const el = document.createElement('div');
  const kind = KIND[e.kind] || KIND.say;
  el.className = `entry kind-${e.kind || 'say'}`;
  const src = SOURCE_LABEL[e.source];
  el.innerHTML = `
    <div class="entry-text">${esc(e.text)}</div>
    ${e.note ? `<div class="entry-note">${esc(e.note)}</div>` : ''}
    <div class="entry-meta">
      <span class="badge">${kind.icon} ${kind.label}</span>
      ${showDate ? `<span>${prettyDate(e.date)}</span>` : ''}
      <span>${dayText(e.date)}</span>
      ${showDate ? `<span>${ageText(e.date)}</span>` : ''}
      ${e.time ? `<span>${esc(e.time)}</span>` : ''}
      ${src ? `<span>${src}</span>` : ''}
    </div>
    ${e.author ? `<span class="author-mini">${esc(e.author)}</span>` : ''}`;
  el.addEventListener('click', () => openEditor(e.date, e));
  return el;
}

function renderList(container, list, opts = {}) {
  container.replaceChildren();
  if (!list.length) {
    const art = opts.art ? `<img class="art" src="img/${opts.art}" alt="">` : opts.face ? '<div class="face">‿</div>' : '';
    container.innerHTML = `<div class="empty">${art}${opts.title ? `<b>${opts.title}</b>` : ''}${opts.empty || '아직 기록이 없어요'}</div>`;
    return;
  }
  for (const e of list) container.append(entryCard(e, opts));
}

// ---------------- 화면 전환 (안드로이드 뒤로가기 지원) ----------------
const VIEWS = ['home', 'calendar', 'photos', 'import', 'search'];
let currentView = 'home';
function showView(name, { push = true } = {}) {
  if (!VIEWS.includes(name)) name = 'home';
  if (push && name !== currentView) history.pushState({ view: name }, '', name === 'home' ? '#' : `#${name}`);
  currentView = name;
  for (const s of $$('.view')) s.hidden = s.id !== `view-${name}`;
  for (const b of $$('.bottom [data-view]')) b.classList.toggle('active', b.dataset.view === name);
  $('#bannerImg').src = `img/banner-${name}.webp`;
  const left = $('#topLeftBtn');
  left.textContent = name === 'home' ? '🔍' : '🏠';
  left.setAttribute('aria-label', name === 'home' ? '찾기' : '처음 화면');
  window.scrollTo(0, 0);
  refresh();
}
$('#topLeftBtn').addEventListener('click', () => showView(currentView === 'home' ? 'search' : 'home'));
$('#settingsBtn').addEventListener('click', () => {
  showView('search');
  setTimeout(() => $('#settingsBox').scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
});
for (const b of $$('[data-view]')) b.addEventListener('click', () => showView(b.dataset.view));

// 창(dialog) 은 열 때 history 를 하나 쌓아서, 안드로이드 뒤로가기로 닫히게 한다
function openDialog(d) {
  history.pushState({ dialog: d.id }, '');
  d.showModal();
}
function closeDialog(d) {
  if (!d.open) return;
  if (history.state?.dialog === d.id) history.back(); // popstate 에서 닫힘
  else d.close();
}
window.addEventListener('popstate', () => {
  const open = $$('dialog').find((d) => d.open);
  if (open) {
    open.close();
    return;
  }
  showView(location.hash.slice(1) || 'home', { push: false });
});
for (const d of $$('dialog')) {
  d.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeDialog(d);
  });
  for (const b of $$('[data-close]', d)) b.addEventListener('click', () => closeDialog(d));
}

function refresh() {
  if (currentView === 'home') renderHome();
  if (currentView === 'calendar') renderCalendar();
  if (currentView === 'photos') renderGallery();
  if (currentView === 'search') runSearch();
}

// ---------------- 오늘 ----------------
function milestones(today) {
  const n = dayNumber(today);
  const next100 = Math.ceil((n + 1) / 100) * 100;
  const next1000 = Math.ceil((n + 1) / 1000) * 1000;
  const out = [[`${next100.toLocaleString()}일`, dateOfDay(next100)]];
  if (next1000 !== next100) out.push([`${next1000.toLocaleString()}일`, dateOfDay(next1000)]);
  const md = BIRTH_DATE.slice(5);
  let y = Number(today.slice(0, 4));
  if (`${y}-${md}` <= today) y += 1;
  out.push([`${age(today).years + 1}번째 생일`, `${y}-${md}`]);
  return out.map(([label, d]) => ({ label, left: dayNumber(d) - n })).sort((a, b) => a.left - b.left);
}

function tickLive() {
  const ms = Date.now() - BIRTH_INSTANT;
  $('#heroLive').textContent = `태어난 지 ${Math.floor(ms / 3600000).toLocaleString()}시간 ${Math.floor((ms / 60000) % 60)}분 ${Math.floor((ms / 1000) % 60)}초`;
}

async function renderHome() {
  const today = todaySeoul();
  $('#heroDate').textContent = prettyDate(today);
  $('#heroDay').textContent = dayNumber(today).toLocaleString();
  $('#heroAge').textContent = ageText(today);
  $('#heroNext').innerHTML = milestones(today)
    .slice(0, 2)
    .map((x) => `<div class="dday ${x.label.includes('생일') ? 'pink' : ''}"><div class="lbl">${x.label.includes('생일') ? '🎁' : '🗓️'} ${x.label}까지</div><b>D-${x.left}</b></div>`)
    .join('');
  tickLive();
  renderList($('#todayList'), await store.list({ date: today }), {
    face: true,
    empty: '오늘은 아직 기록이 없어요.<br>민한이가 무슨 말을 하고, 무엇을 했나요?',
  });
  const past = (await store.list({ md: today.slice(5) })).filter((e) => e.date < today).reverse();
  $('#memoriesWrap').hidden = !past.length;
  renderList($('#memories'), past, { showDate: true });
  renderPhotoGrid($('#todayPhotos'), store.photos({ date: today }));
}
setInterval(() => currentView === 'home' && !document.hidden && tickLive(), 1000);

// ---------------- 쓰기창 ----------------
const editor = $('#editor');
const form = $('#editorForm');
let editing = null;

function setKind(kind) {
  const k = KIND[kind] || KIND.say;
  $('#textLabel').textContent = k.field;
  form.text.placeholder = k.ph;
}
function openEditor(date, entry = null) {
  editing = entry;
  form.reset();
  form.date.value = entry?.date || date || todaySeoul();
  form.date.min = BIRTH_DATE;
  form.kind.value = entry?.kind || 'say';
  setKind(form.kind.value);
  form.text.value = entry?.text || '';
  form.note.value = entry?.note || '';
  $('#editorDelete').hidden = !entry;
  updateEditorDay();
  openDialog(editor);
  if (!entry) form.text.focus();
}
const closeEditor = () => closeDialog(editor);
function updateEditorDay() {
  const d = form.date.value;
  $('#editorDay').textContent = d && d >= BIRTH_DATE ? `${dayText(d)} · ${ageText(d)}` : '';
}
form.date.addEventListener('input', updateEditorDay);
for (const r of $$('input[name=kind]', form)) r.addEventListener('change', () => setKind(form.kind.value));
$('#editorCancel').addEventListener('click', closeEditor);
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  // 시간은 따로 고르지 않고, 처음 저장한 순간의 시간을 쓴다 (고칠 때는 그대로)
  const body = { date: form.date.value, kind: form.kind.value, text: form.text.value, note: form.note.value, time: editing ? editing.time : nowTimeSeoul() };
  if (body.date < BIRTH_DATE) return toast('태어난 날 이후로 골라 주세요');
  try {
    if (editing) await store.update(editing.id, body);
    else await store.put([body]);
    closeEditor();
    toast('저장했어요 💛');
    if (currentView === 'calendar') selectDate(body.date);
    refresh();
  } catch (err) {
    toast(err.message);
  }
});
$('#editorDelete').addEventListener('click', async () => {
  if (!editing || !confirm('이 기록을 지울까요?')) return;
  await store.remove(editing.id);
  closeEditor();
  toast('지웠어요');
  refresh();
});
$('#writeToday').addEventListener('click', () => openEditor(todaySeoul()));
$('#navWrite').addEventListener('click', () => openEditor(currentView === 'calendar' ? selectedDate : todaySeoul()));

// ---------------- 달력 ----------------
let calMonth = todaySeoul().slice(0, 7);
let selectedDate = todaySeoul();

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
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
// 년·월 고르기: 태어난 해(2016년, 0살)부터 올해까지
const monthPicker = $('#monthPicker');
let pickYear = null;
$('#calTitleBtn').addEventListener('click', () => {
  pickYear = Number(calMonth.slice(0, 4));
  renderMonthPicker();
  openDialog(monthPicker);
});
function renderMonthPicker() {
  const today = todaySeoul();
  const thisYear = Number(today.slice(0, 4));
  const birthYear = Number(BIRTH_DATE.slice(0, 4));
  const years = $('#pickYears');
  years.replaceChildren();
  for (let y = birthYear; y <= thisYear; y++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'year-btn' + (y === pickYear ? ' on' : '');
    b.innerHTML = `<b>${y}년</b><small>${y === birthYear ? '0살 · 태어난 해' : `${y - birthYear}살`}</small>`;
    b.addEventListener('click', () => {
      pickYear = y;
      renderMonthPicker();
    });
    years.append(b);
  }
  requestAnimationFrame(() => $('.year-btn.on', years)?.scrollIntoView({ block: 'nearest', inline: 'center' }));
  const months = $('#pickMonths');
  months.replaceChildren();
  for (let m = 1; m <= 12; m++) {
    const ym = `${pickYear}-${String(m).padStart(2, '0')}`;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'month-btn' + (ym === calMonth ? ' on' : '');
    b.textContent = `${m}월`;
    b.disabled = ym < BIRTH_DATE.slice(0, 7) || ym > today.slice(0, 7);
    b.addEventListener('click', () => {
      // 그 달에 오늘이 있으면 오늘, 태어난 달이면 생일, 아니면 1일을 고른다
      const d = ym === today.slice(0, 7) ? today : ym === BIRTH_DATE.slice(0, 7) ? BIRTH_DATE : `${ym}-01`;
      selectDate(d);
      closeDialog(monthPicker);
      renderCalendar();
    });
    months.append(b);
  }
  $('#pickTitle').textContent = `${pickYear}년`;
}
$('#pickToday').addEventListener('click', () => {
  selectDate(todaySeoul());
  closeDialog(monthPicker);
  renderCalendar();
});
$('#writeDay').addEventListener('click', () => openEditor(selectedDate));

async function renderCalendar() {
  const [counts, total] = await Promise.all([store.counts(), store.total()]);
  const photoDays = store.photoDates();
  const [y, m] = calMonth.split('-').map(Number);
  const today = todaySeoul();
  $('#calTitle').textContent = `${y}년 ${m}월`;
  const first = new Date(Date.UTC(y, m - 1, 1));
  const start = first.getTime() - first.getUTCDay() * 86400000;
  const grid = $('#calGrid');
  grid.replaceChildren();
  let monthCount = 0;
  for (let i = 0; i < 42; i++) {
    const d = new Date(start + i * 86400000);
    const ymd = d.toISOString().slice(0, 10);
    const inMonth = d.getUTCMonth() === m - 1;
    if (i >= 35 && !inMonth && i % 7 === 0) break;
    const c = counts[ymd] || 0;
    if (inMonth) monthCount += c;
    const btn = document.createElement('button');
    btn.className = ['cal-day', !inMonth && 'other', ymd === today && 'today', ymd === selectedDate && 'selected', c && 'has', photoDays[ymd] && 'has-photo', ymd === BIRTH_DATE && 'birth', d.getUTCDay() === 0 && 'sun', d.getUTCDay() === 6 && 'sat']
      .filter(Boolean)
      .join(' ');
    btn.innerHTML = `<span>${d.getUTCDate()}</span>`;
    btn.disabled = ymd < BIRTH_DATE;
    btn.addEventListener('click', () => {
      selectDate(ymd);
      renderCalendar();
    });
    grid.append(btn);
  }
  $('#calFoot').textContent = `이번 달 ${monthCount}개 · 전체 ${total.toLocaleString()}개의 기록`;
  $('#dayTitle').textContent = prettyDate(selectedDate);
  $('#daySub').innerHTML = selectedDate >= BIRTH_DATE ? `<span class="nw">탄생 <b>${dayNumber(selectedDate).toLocaleString()}</b>일째</span> · <span class="nw">${ageText(selectedDate)}</span>` : '';
  $('#writeDay').hidden = selectedDate < BIRTH_DATE;
  renderList($('#dayList'), await store.list({ date: selectedDate }), {
    art: 'empty-book.webp',
    title: selectedDate === BIRTH_DATE ? '👶 민한이가 태어난 날' : '이 날의 기록이 없어요',
    empty: selectedDate === BIRTH_DATE ? '2016년 2월 22일 오전 11시 55분' : '오늘의 일을 기록하고<br>소중한 추억을 남겨보세요! 💗',
  });
  renderPhotoGrid($('#dayPhotos'), store.photos({ date: selectedDate }));
}

// ---------------- 사진 (기록과 따로) ----------------
function renderPhotoGrid(container, list, { showDate = false } = {}) {
  container.replaceChildren();
  for (const p of list) {
    const b = document.createElement('button');
    b.className = 'photo-thumb';
    b.innerHTML = `<img src="${p.thumb}" alt="${esc(p.caption)}" loading="lazy">${p.caption ? `<span>${esc(p.caption)}</span>` : ''}${showDate ? `<i>${Number(p.date.slice(8))}일</i>` : ''}`;
    b.addEventListener('click', () => openPhoto(p));
    container.append(b);
  }
}

function renderGallery() {
  const wrap = $('#gallery');
  wrap.replaceChildren();
  const list = store.photos();
  if (!list.length) {
    wrap.innerHTML = `<p class="photo-empty-title">아직 사진이 없어요. 민한이 사진을 넣어 보세요</p>
      <label class="photo-empty"><img src="img/empty-camera.webp" alt=""><b>사진을 선택해 주세요!</b></label>`;
    $('.photo-empty', wrap).addEventListener('click', () => $('#photoFile').click());
    return;
  }
  const byMonth = new Map();
  for (const p of list) {
    const k = p.date.slice(0, 7);
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k).push(p);
  }
  for (const [ym, items] of byMonth) {
    const [y, m] = ym.split('-').map(Number);
    const a = age(items[items.length - 1].date);
    const h = document.createElement('h2');
    h.className = 'section-title';
    h.textContent = `${y}년 ${m}월 · 만 ${a.years}살 ${a.months}개월`;
    const grid = document.createElement('div');
    grid.className = 'photo-grid';
    renderPhotoGrid(grid, items, { showDate: true });
    wrap.append(h, grid);
  }
}

// 사진 고르기 → 날짜·설명 확인 → 넣기
const photoAdd = $('#photoAdd');
let pendingPhotos = [];
$('#photoFile').addEventListener('change', async (e) => {
  const files = await readNow(e.target);
  if (files) handlePhotoFiles(files);
});
async function handlePhotoFiles(files) {
  if (!files.length) return;
  const list = $('#photoAddList');
  list.innerHTML = '<div class="muted">사진 준비 중…</div>';
  $('#photoAddInfo').textContent = '';
  openDialog(photoAdd);
  pendingPhotos = [];
  for (const f of files) {
    try {
      const [shrunk, taken] = await Promise.all([shrinkPhoto(f), f.takenDate || photoTakenDate(f)]);
      const fileDay = f.lastModified ? todaySeoul(new Date(f.lastModified)) : null;
      let date = taken || fileDay || todaySeoul();
      if (date < BIRTH_DATE) date = todaySeoul();
      pendingPhotos.push({ ...shrunk, date });
    } catch (err) {
      toast(err.message || '읽을 수 없는 사진이 있어요');
    }
  }
  list.replaceChildren();
  for (const p of pendingPhotos) {
    const row = document.createElement('div');
    row.className = 'photo-add-row';
    row.innerHTML = `<img src="${p.thumb}" alt="">
      <div class="photo-add-fields">
        <input type="date" min="${BIRTH_DATE}" value="${p.date}" aria-label="날짜">
        <input type="text" placeholder="설명 (선택)" aria-label="설명">
      </div>`;
    p.row = row;
    list.append(row);
  }
  const kb = Math.round(pendingPhotos.reduce((sum, p) => sum + p.data.length * 0.75, 0) / 1024);
  $('#photoAddInfo').textContent = `${pendingPhotos.length}장 · 약 ${kb.toLocaleString()}KB`;
}
$('#photoAddForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    for (const p of pendingPhotos) {
      const [dateEl, capEl] = p.row.querySelectorAll('input');
      if (!dateEl.value || dateEl.value < BIRTH_DATE) return toast('날짜를 확인해 주세요');
      p.date = dateEl.value;
      p.caption = capEl.value;
    }
    const n = pendingPhotos.length;
    for (const { row, ...p } of pendingPhotos) await store.addPhoto(p);
    toast(`사진 ${n}장을 넣었어요 💛`);
    pendingPhotos = [];
    closeDialog(photoAdd);
    refresh();
  } catch (err) {
    toast(err.message);
  }
});

// 사진 크게 보기 / 설명 고치기 / 지우기
const photoView = $('#photoView');
const pform = $('#photoViewForm');
let viewing = null;
async function openPhoto(p) {
  viewing = p;
  const img = $('#photoViewImg');
  img.src = p.thumb;
  pform.date.value = p.date;
  pform.date.min = BIRTH_DATE;
  pform.caption.value = p.caption || '';
  $('#photoViewDay').innerHTML = `${dayText(p.date)} · ${ageText(p.date)}${p.author ? ` · ${esc(p.author)}` : ''}`;
  openDialog(photoView);
  try {
    const full = await store.photoData(p.id);
    if (full && viewing === p) img.src = full;
  } catch {
    /* 인터넷이 없으면 작은 사진만 보인다 */
  }
}
pform.date.addEventListener('input', () => {
  const d = pform.date.value;
  $('#photoViewDay').textContent = d >= BIRTH_DATE ? `${dayText(d)} · ${ageText(d)}` : '';
});
pform.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!pform.date.value || pform.date.value < BIRTH_DATE) return toast('날짜를 확인해 주세요');
  await store.updatePhoto(viewing.id, { date: pform.date.value, caption: pform.caption.value });
  toast('저장했어요');
  closeDialog(photoView);
});
$('#photoDelete').addEventListener('click', async () => {
  if (!confirm('이 사진을 지울까요?')) return;
  await store.removePhoto(viewing.id);
  toast('지웠어요');
  closeDialog(photoView);
});

// ---------------- 찾기 / 백업 ----------------
let searchTimer;
$('#searchInput').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 200);
});
async function runSearch() {
  const q = $('#searchInput').value.trim();
  const list = (await store.list({ q })).reverse();
  $('#searchInfo').innerHTML = q ? `"${esc(q)}" <b>${list.length}개</b>` : `<b>전체 ${list.length}개</b> (최신순)`;
  renderList($('#searchList'), list.slice(0, 300), { showDate: true, empty: '찾는 기록이 없어요' });
}

$('#backupBtn').addEventListener('click', async () => {
  const json = await store.exportJson();
  const name = `민한이성장일기-백업-${todaySeoul()}.json`;
  try {
    if (native) {
      const { Filesystem, Share } = window.Capacitor.Plugins;
      const { uri } = await Filesystem.writeFile({ path: name, data: json, directory: 'CACHE', encoding: 'utf8' });
      await Share.share({ title: '민한이 성장일기 백업', files: [uri], dialogTitle: '백업 파일 저장할 곳 고르기' });
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    }
  } catch (err) {
    if (!/cancel/i.test(err?.message || '')) toast('백업하지 못했어요: ' + err.message);
  }
});
$('#restoreFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const n = await store.importJson(await file.text());
    toast(`기록 ${n}개를 되살렸어요`);
    refresh();
  } catch {
    toast('백업 파일을 읽지 못했어요');
  }
});

// ---------------- 가져오기: 붙여넣기 / 캡쳐 ----------------
const pasteBox = $('#pasteBox');
const importResult = $('#importResult');
$('#fallbackDate').value = todaySeoul();
$('#fallbackDate').min = BIRTH_DATE;

$('#parseBtn').addEventListener('click', () => {
  const items = parseText(pasteBox.value, todaySeoul());
  if (!items.length) return toast('붙여넣은 글이 없어요');
  renderPicker(items.map((i) => ({ ...i, checked: true })), 'paste');
});

// 캡쳐 사진을 바로 붙여넣기 해도 된다
pasteBox.addEventListener('paste', (e) => {
  const imgs = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (imgs.length) {
    e.preventDefault();
    Promise.all(imgs.map(async (f) => new File([await f.arrayBuffer()], f.name || 'paste.png', { type: f.type })))
      .then(ocrImages)
      .catch(() => toast('붙여넣은 사진을 읽지 못했어요'));
  }
});
$('#ocrFile').addEventListener('change', async (e) => {
  const files = await readNow(e.target);
  if (files?.length) ocrImages(files);
});

/**
 * 고른 파일을 그 자리에서 바로 끝까지 읽어 둔다.
 * 안드로이드 앱 안에서는 사진 선택 창이 준 파일을 잠깐만 읽을 수 있어서, 나중에 읽으면 권한 오류가 난다.
 */
async function readNow(input) {
  const picked = [...input.files];
  try {
    return await Promise.all(
      picked.map(async (f) => new File([await f.arrayBuffer()], f.name || 'photo', { type: f.type, lastModified: f.lastModified })),
    );
  } catch (err) {
    toast('사진을 읽지 못했어요. 다시 골라 주세요.');
    console.error(err);
    return null;
  } finally {
    input.value = '';
  }
}

/** 폰 앱에서는 안드로이드 기본 사진 선택 창으로 고른다 (권한 문제 없음) */
async function pickFromGallery() {
  const Camera = window.Capacitor?.Plugins?.Camera;
  const { results = [] } = await Camera.chooseFromGallery({ mediaType: 0, allowMultipleSelection: true, limit: 0, includeMetadata: true, quality: 100 });
  return Promise.all(
    results
      .filter((r) => r.webPath)
      .map(async (r, i) => {
        const blob = await (await fetch(r.webPath)).blob();
        const fmt = (r.metadata?.format || 'jpeg').toLowerCase();
        const made = Date.parse(r.metadata?.creationDate || '');
        const f = new File([blob], `photo-${i}.${fmt}`, { type: blob.type || `image/${fmt}`, lastModified: made || Date.now() });
        if (made) f.takenDate = todaySeoul(new Date(made));
        return f;
      }),
  );
}
if (native && window.Capacitor?.Plugins?.Camera) {
  const nativePick = (input, handler) => {
    input.closest('label')?.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        const files = await pickFromGallery();
        if (files.length) handler(files);
      } catch (err) {
        if (!/cancel/i.test(err?.message || '')) toast('사진을 고르지 못했어요: ' + (err?.message || err));
      }
    });
    // 다른 곳에서 input.click() 을 불러도 기본 선택 창으로
    input.click = () => input.closest('label')?.click();
  };
  nativePick($('#ocrFile'), ocrImages);
  nativePick($('#photoFile'), handlePhotoFiles);
}

let workerP;
function getWorker(onProgress) {
  workerP ??= (async () => {
    if (!window.Tesseract) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'vendor/tesseract.min.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('글자 읽기 도구를 불러오지 못했어요'));
        document.head.append(s);
      });
    }
    const base = new URL('vendor/', location.href).href;
    const worker = await window.Tesseract.createWorker('kor', 1, {
      workerPath: base + 'worker.min.js',
      corePath: base + 'core/',
      langPath: base + 'lang',
      gzip: false, // 사전은 압축을 푼 채로 앱에 들어 있음 (scripts/vendor.mjs)
      cacheMethod: 'none',
      logger: (m) => onProgress.current?.(m),
      errorHandler: (e) => console.error('ocr', e),
    });
    await worker.setParameters({ tessedit_pageseg_mode: '4' }); // 크기가 다른 글줄이 한 줄씩 있는 화면
    return worker;
  })().catch((e) => {
    workerP = null;
    throw e;
  });
  return workerP;
}
const progressRef = { current: null };

async function ocrImages(files) {
  importResult.innerHTML = `<div class="card"><div class="ocr-status">글자 읽기 준비 중…</div><div class="progress"><div></div></div></div>`;
  const status = $('.ocr-status', importResult);
  const bar = $('.progress > div', importResult);
  progressRef.current = (m) => {
    if (m.status === 'recognizing text') bar.style.width = `${Math.round(m.progress * 100)}%`;
  };
  try {
    // 준비가 1분 넘게 안 되면 멈춘 것으로 보고 알려 준다
    const worker = await Promise.race([
      getWorker(progressRef),
      new Promise((_, reject) =>
        setTimeout(() => {
          workerP = null;
          reject(new Error('글자 읽기 도구를 준비하지 못했어요. 앱을 껐다가 다시 열어 주세요.'));
        }, 60000),
      ),
    ]);
    const all = [];
    const previews = [];
    for (const [i, file] of files.entries()) {
      status.textContent = `글자 읽는 중… (${i + 1}/${files.length})`;
      bar.style.width = '0%';
      previews.push(URL.createObjectURL(file));
      const { canvas, width, original, bin } = await prepareImage(file);
      const { data } = await worker.recognize(canvas, {}, { blocks: true });
      const lines = ocrLines(data);
      // 캡쳐에 날짜가 없으면: 사진 만든 날짜 → 없으면 위에서 고른 날짜
      const shotDate = file.lastModified ? todaySeoul(new Date(file.lastModified)) : null;
      // 말풍선을 찾으면 말풍선 하나 = 기록 하나, 못 찾으면 예전 방식(줄 묶기)
      const found = bubblesFromOcr(lines, original, todaySeoul(), bin) || linesToBubbles(lines, width, todaySeoul());
      for (const b of found) {
        all.push({ ...b, date: b.date || shotDate, checked: false });
      }
    }
    renderPicker(all, 'ocr', previews);
  } catch (err) {
    // 원인을 알 수 있게 사진 정보도 작게 보여 준다
    const info = files.map((f) => `${f.type || '종류 없음'} · ${Math.round((f.size || 0) / 1024)}KB`).join(', ');
    importResult.innerHTML = `<div class="card error">${esc(err.message || err)}<br><small class="muted">${esc(info)}</small></div>`;
  }
}

/** tesseract 결과에서 줄 목록(낱말 포함)을 꺼낸다 (버전마다 모양이 조금 달라서) */
function ocrLines(data) {
  if (data.lines?.length) return data.lines;
  const out = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) out.push(l);
  return out;
}

/** 흑백으로 바꾸고, 작은 사진은 키워서 글자를 잘 읽게 한다 */
async function prepareImage(file) {
  const bmp = await decodeImage(file);
  const w = bmp.naturalWidth || bmp.width;
  const h = bmp.naturalHeight || bmp.height;
  const scale = w < 1000 ? Math.min(2, 1080 / w) : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const original = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height); // 색 보기용
  binarize(img);
  ctx.putImageData(img, 0, 0);
  return { canvas, width: canvas.width, original, bin: img };
}

/** 인식 결과를 확인하고 골라서 저장하는 목록 */
function renderPicker(items, source, previews = []) {
  const fallback = () => $('#fallbackDate').value || todaySeoul();
  importResult.replaceChildren();
  if (!items.length) {
    importResult.innerHTML = '<div class="card empty">읽은 글이 없어요. 사진이 흐리지 않은지 확인해 주세요.</div>';
    return;
  }
  const card = document.createElement('div');
  card.className = 'card';
  const hasSides = items.some((i) => i.side);
  card.innerHTML = `
    ${previews.map((u) => `<img class="ocr-img" src="${u}" alt="캡쳐">`).join('')}
    <div class="pick-tools">
      <button class="btn small" data-sel="all">모두 선택</button>
      <button class="btn small" data-sel="none">선택 해제</button>
      ${hasSides ? '<button class="btn small" data-sel="left">왼쪽 말풍선</button><button class="btn small" data-sel="right">오른쪽 말풍선</button>' : ''}
    </div>
    <div class="pick-tools">
      <span class="small">모두</span>
      <button class="btn small" data-allkind="say">💬 한 말로</button>
      <button class="btn small" data-allkind="did">🌱 한 일로</button>
      <input type="date" class="all-date" min="${BIRTH_DATE}" aria-label="모두 이 날짜로">
      <button class="btn small" data-alldate>날짜로</button>
    </div>
    <p class="muted small">민한이가 한 말·한 일만 체크하세요. 글자와 날짜는 눌러서 고칠 수 있어요.</p>
    <div class="pick-list"></div>
    <div class="sticky-actions">
      <span class="muted small pick-count"></span>
      <button class="btn primary small pick-save">일기에 넣기</button>
    </div>`;
  importResult.append(card);
  const listEl = $('.pick-list', card);
  $('.all-date', card).value = fallback();

  const rows = items.map((it) => {
    const row = document.createElement('div');
    row.className = `pick ${it.side || ''}`;
    row.innerHTML = `
      <input type="checkbox" ${it.checked ? 'checked' : ''} aria-label="선택">
      <div class="pick-body">
        <textarea class="pick-text" rows="1">${esc(it.text)}</textarea>
        <div class="pick-meta">
          <input type="date" class="pick-date" min="${BIRTH_DATE}" value="${it.date || fallback()}">
          ${it.date ? '' : '<span class="warn">날짜 못 찾음</span>'}
          <button type="button" class="kind-btn"></button>
        </div>
      </div>`;
    const r = { it, row, cb: $('input[type=checkbox]', row), ta: $('textarea', row), date: $('.pick-date', row), kindBtn: $('.kind-btn', row), kind: 'say' };
    const setRowKind = (k) => {
      r.kind = k;
      r.kindBtn.textContent = `${KIND[k].icon} ${KIND[k].label}`;
    };
    r.setKind = setRowKind;
    setRowKind('say');
    r.kindBtn.addEventListener('click', () => setRowKind(r.kind === 'say' ? 'did' : 'say'));
    const fit = () => {
      r.ta.style.height = 'auto';
      r.ta.style.height = r.ta.scrollHeight + 'px';
    };
    requestAnimationFrame(fit);
    r.ta.addEventListener('input', fit);
    r.date.addEventListener('change', () => $('.warn', row)?.remove());
    listEl.append(row);
    return r;
  });

  const update = () => {
    const n = rows.filter((r) => r.cb.checked).length;
    $('.pick-count', card).textContent = `${n}개 선택`;
    $('.pick-save', card).disabled = !n;
  };
  update();
  listEl.addEventListener('change', update);
  for (const b of $$('[data-sel]', card)) {
    b.addEventListener('click', () => {
      const k = b.dataset.sel;
      for (const r of rows) r.cb.checked = k === 'all' ? true : k === 'none' ? false : r.it.side === k;
      update();
    });
  }
  for (const b of $$('[data-allkind]', card)) b.addEventListener('click', () => rows.forEach((r) => r.cb.checked && r.setKind(b.dataset.allkind)));
  $('[data-alldate]', card).addEventListener('click', () => {
    const d = $('.all-date', card).value;
    for (const r of rows) if (r.cb.checked) (r.date.value = d), $('.warn', r.row)?.remove();
  });

  $('.pick-save', card).addEventListener('click', async () => {
    const sel = rows.filter((r) => r.cb.checked && r.ta.value.trim());
    if (sel.some((r) => !r.date.value || r.date.value < BIRTH_DATE)) return toast('날짜를 확인해 주세요');
    try {
      await store.put(
        sel.map((r) => ({ date: r.date.value, kind: r.kind, text: r.ta.value, source })),
      );
      const dates = [...new Set(sel.map((r) => r.date.value))].sort();
      toast(`${sel.length}개를 ${dates.length > 1 ? `${dates.length}개 날짜에` : prettyDate(dates[0]) + '에'} 넣었어요 💛`);
      for (const r of sel) r.row.remove();
      rows.splice(0, rows.length, ...rows.filter((r) => !sel.includes(r)));
      update();
      if (!rows.length) {
        importResult.innerHTML = `<div class="card empty">다 넣었어요! <button class="btn small" id="goCal">달력에서 보기</button></div>`;
        $('#goCal').addEventListener('click', () => {
          selectDate(dates.at(-1));
          showView('calendar');
        });
        if (source === 'paste') pasteBox.value = '';
      }
    } catch (err) {
      toast(err.message);
    }
  });
}

// ---------------- 다른 앱에서 [공유] 로 받은 글/캡쳐 (안드로이드) ----------------
async function takeShared() {
  let raw = null;
  try {
    raw = window.AndroidShare?.take();
  } catch {}
  if (!raw) return;
  const { text = '', images = [] } = JSON.parse(raw);
  showView('import');
  if (images.length) {
    const blobs = await Promise.all(images.map((u) => fetch(u).then((r) => r.blob())));
    ocrImages(blobs);
  } else if (text.trim()) {
    pasteBox.value = text;
    $('#parseBtn').click();
  }
}
window.onAndroidShare = takeShared;
document.addEventListener('visibilitychange', () => !document.hidden && takeShared());

// ---------------- 시작 ----------------
// ---------------- 로그인 (가족 비밀번호) ----------------
let started = false;
// ---- 기록자 (이 폰에 저장) ----
const ROLE_KEY = 'minhan-author';
const readRole = () => {
  try {
    return localStorage.getItem(ROLE_KEY) || '';
  } catch {
    return '';
  }
};
function saveRole(name) {
  try {
    localStorage.setItem(ROLE_KEY, name);
  } catch {}
  store.setAuthor(name);
  $('#roleName').textContent = name;
}
store.setAuthor(readRole());
$('#roleName').textContent = readRole() || '안 정함';

/** 아빠/엄마/기타(직접 쓰기) 고르는 칸. 고른 이름을 돌려준다 (없으면 '') */
function setupRolePick(root) {
  const other = $('.role-other', root);
  let chosen = '';
  const select = (role, otherName = '') => {
    chosen = role;
    $('#loginError').textContent = '';
    for (const b of $$('.role-btn', root)) b.classList.toggle('on', b.dataset.role === role);
    other.hidden = role !== '기타';
    if (role === '기타') {
      other.value = otherName;
      other.focus();
    }
  };
  for (const b of $$('.role-btn', root)) b.addEventListener('click', () => select(b.dataset.role));
  return {
    reset() {
      const cur = readRole();
      if (!cur) select('');
      else if (cur in AUTHOR_ICON) select(cur);
      else select('기타', cur);
      other.hidden = chosen !== '기타';
    },
    value: () => (chosen === '기타' ? other.value.trim() : chosen),
    chosen: () => chosen,
  };
}
const loginRole = setupRolePick($('#loginForm'));
loginRole.reset();
const dialogRole = setupRolePick($('#roleForm'));
const roleDialog = $('#roleDialog');
function askRole() {
  dialogRole.reset();
  openDialog(roleDialog);
}
$('#roleForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = dialogRole.value();
  if (!name) return toast(dialogRole.chosen() === '기타' ? '이름을 써 주세요' : '아빠, 엄마, 기타 중에 골라 주세요');
  saveRole(name);
  closeDialog(roleDialog);
  toast(`${name}(으)로 기록할게요`);
  refresh();
});
$('#roleBtn').addEventListener('click', askRole);

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = loginRole.value();
  if (!name) {
    $('#loginError').textContent = loginRole.chosen() === '기타' ? '이름을 써 주세요' : '누가 쓰는지 골라 주세요';
    return;
  }
  saveRole(name);
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  $('#loginError').textContent = '';
  try {
    await auth$.login($('#pin').value.trim());
  } catch (err) {
    $('#loginError').textContent = err.message;
    $('#pin').select();
  } finally {
    btn.disabled = false;
  }
});
$('#logoutBtn').addEventListener('click', async () => {
  if (confirm('이 폰에서 로그아웃할까요? (기록은 클라우드에 그대로 있어요)')) await auth$.logout();
});

/** 예전(폰에만 저장하던 버전)의 기록을 클라우드로 옮긴다 */
async function migrateLocal() {
  try {
    const old = await localStore.list();
    if (!old.length) return;
    await store.put(old.map(({ meta, updatedAt, ...e }) => e));
    for (const e of old) await localStore.remove(e.id);
    toast(`이 폰에 있던 기록 ${old.length}개를 클라우드로 옮겼어요`);
  } catch (err) {
    console.error('migrate', err);
  }
}

function showSync() {
  const { offline, pending } = store.sync();
  $('#syncState').textContent = offline ? '오프라인 · 나중에 올라가요' : pending ? '올리는 중…' : '';
  $('#syncState').title = offline ? '인터넷이 연결되면 자동으로 맞춰져요' : '클라우드와 맞춰져 있어요';
}
let refreshTimer;
store.onChange(() => {
  showSync();
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 50);
});

auth$.watch((loggedIn) => {
  $('#loading').hidden = true;
  $('#login').hidden = loggedIn;
  $('#app').hidden = !loggedIn;
  if (!loggedIn) {
    $('#pin').value = '';
    setTimeout(() => $('#pin').focus(), 100);
    return;
  }
  if (!started) {
    started = true;
    showView(location.hash.slice(1) || 'home', { push: false });
    takeShared();
    migrateLocal();
    if (!readRole()) setTimeout(askRole, 300);
  } else refresh();
});

if (!native && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
