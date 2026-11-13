import { BIRTH_DATE, BIRTH_INSTANT, dayNumber, dateOfDay, age, todaySeoul } from './shared.js';
import { store } from './store.js';
import { parseText, linesToBubbles } from './parse.js';
import { binarize } from './ocr-prep.js';

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
    </div>`;
  el.addEventListener('click', () => openEditor(e.date, e));
  return el;
}

function renderList(container, list, opts = {}) {
  container.replaceChildren();
  if (!list.length) {
    container.innerHTML = `<div class="empty">${opts.empty || '아직 기록이 없어요'}</div>`;
    return;
  }
  for (const e of list) container.append(entryCard(e, opts));
}

// ---------------- 화면 전환 (안드로이드 뒤로가기 지원) ----------------
const VIEWS = ['home', 'calendar', 'import', 'search'];
let currentView = 'home';
function showView(name, { push = true } = {}) {
  if (!VIEWS.includes(name)) name = 'home';
  if (push && name !== currentView) history.pushState({ view: name }, '', name === 'home' ? '#' : `#${name}`);
  currentView = name;
  for (const s of $$('.view')) s.hidden = s.id !== `view-${name}`;
  for (const b of $$('.bottom [data-view]')) b.classList.toggle('active', b.dataset.view === name);
  window.scrollTo(0, 0);
  refresh();
}
for (const b of $$('.bottom [data-view]')) b.addEventListener('click', () => showView(b.dataset.view));
window.addEventListener('popstate', () => {
  if (editor.open) {
    editor.close();
    return;
  }
  showView(location.hash.slice(1) || 'home', { push: false });
});

function refresh() {
  if (currentView === 'home') renderHome();
  if (currentView === 'calendar') renderCalendar();
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
  $('#heroNext').innerHTML = milestones(today).map((x) => `<span>${x.label}까지 D-${x.left}</span>`).join('');
  tickLive();
  renderList($('#todayList'), await store.list({ date: today }), {
    empty: '오늘은 아직 기록이 없어요. 민한이가 무슨 말을 하고, 무엇을 했나요?',
  });
  const past = (await store.list({ md: today.slice(5) })).filter((e) => e.date < today).reverse();
  $('#memoriesWrap').hidden = !past.length;
  renderList($('#memories'), past, { showDate: true });
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
  form.time.value = entry?.time || '';
  $('#editorDelete').hidden = !entry;
  updateEditorDay();
  history.pushState({ editor: true }, '');
  editor.showModal();
  if (!entry) form.text.focus();
}
function closeEditor() {
  if (history.state?.editor) history.back(); // popstate 에서 닫힘
  else editor.close();
}
function updateEditorDay() {
  const d = form.date.value;
  $('#editorDay').textContent = d && d >= BIRTH_DATE ? `${dayText(d)} · ${ageText(d)}` : '';
}
form.date.addEventListener('input', updateEditorDay);
for (const r of $$('input[name=kind]', form)) r.addEventListener('change', () => setKind(form.kind.value));
editor.addEventListener('cancel', (e) => {
  e.preventDefault();
  closeEditor();
});
$('#editorCancel').addEventListener('click', closeEditor);
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = { date: form.date.value, kind: form.kind.value, text: form.text.value, note: form.note.value, time: form.time.value };
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
$('#calTitle').addEventListener('click', () => {
  selectDate(todaySeoul());
  renderCalendar();
});
$('#writeDay').addEventListener('click', () => openEditor(selectedDate));

async function renderCalendar() {
  const [counts, total] = await Promise.all([store.counts(), store.total()]);
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
    btn.className = ['cal-day', !inMonth && 'other', ymd === today && 'today', ymd === selectedDate && 'selected', c && 'has', ymd === BIRTH_DATE && 'birth', d.getUTCDay() === 0 && 'sun', d.getUTCDay() === 6 && 'sat']
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
  $('#daySub').textContent = selectedDate >= BIRTH_DATE ? `${dayText(selectedDate)} · ${ageText(selectedDate)}` : '';
  $('#writeDay').hidden = selectedDate < BIRTH_DATE;
  renderList($('#dayList'), await store.list({ date: selectedDate }), {
    empty: selectedDate === BIRTH_DATE ? '👶 민한이가 태어난 날 (오전 11시 55분)' : '이 날의 기록이 없어요',
  });
}

// ---------------- 찾기 / 백업 ----------------
let searchTimer;
$('#searchInput').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 200);
});
async function runSearch() {
  const q = $('#searchInput').value.trim();
  const list = (await store.list({ q })).reverse();
  $('#searchInfo').textContent = q ? `"${q}" ${list.length}개` : `전체 ${list.length}개 (최신순)`;
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
    ocrImages(imgs);
  }
});
$('#ocrFile').addEventListener('change', (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (files.length) ocrImages(files);
});

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
      gzip: true,
      cacheMethod: 'none',
      logger: (m) => onProgress.current?.(m),
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
    const worker = await getWorker(progressRef);
    const all = [];
    const previews = [];
    for (const [i, file] of files.entries()) {
      status.textContent = `글자 읽는 중… (${i + 1}/${files.length})`;
      bar.style.width = '0%';
      previews.push(URL.createObjectURL(file));
      const { canvas, width } = await prepareImage(file);
      const { data } = await worker.recognize(canvas);
      // 캡쳐에 날짜가 없으면: 사진 만든 날짜 → 없으면 위에서 고른 날짜
      const shotDate = file.lastModified ? todaySeoul(new Date(file.lastModified)) : null;
      for (const b of linesToBubbles(data.lines || [], width, todaySeoul())) {
        all.push({ ...b, date: b.date || shotDate, checked: false });
      }
    }
    renderPicker(all, 'ocr', previews);
  } catch (err) {
    importResult.innerHTML = `<div class="card error">${esc(err.message || err)}</div>`;
  }
}

/** 흑백으로 바꾸고, 작은 사진은 키워서 글자를 잘 읽게 한다 */
async function prepareImage(file) {
  const bmp = await createImageBitmap(file);
  const scale = bmp.width < 1000 ? Math.min(2, 1080 / bmp.width) : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  binarize(img);
  ctx.putImageData(img, 0, 0);
  return { canvas, width: canvas.width };
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
showView(location.hash.slice(1) || 'home', { push: false });
takeShared();
if (!native && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
