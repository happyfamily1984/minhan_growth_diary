import { BIRTH_DATE, BIRTH_INSTANT, dayNumber, dateOfDay, age, todaySeoul } from './shared.js';
import { store, auth$ } from './store.js';
import { store as localStore } from './local-store.js';
import { shrinkPhoto, photoTakenDate, decodeImage } from './photo.js';
import { readSaju } from './saju.js';
import { parseText, linesToBubbles, parseDateLine } from './parse.js';
import { binarize } from './ocr-prep.js';
import { bubblesFromOcr, findBubbles, datePillCandidates, pillCanvas, gapRegions, findPillsByColor } from './bubbles.js';
import { kv } from './kv.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const SOURCE_LABEL = { paste: '붙여넣기', ocr: '캡쳐', telegram: '텔레그램', export: '대화 파일' };
const KIND = {
  say: { icon: '💬', label: '한 말', field: '민한이가 한 말', ph: '“엄마, 구름이 솜사탕처럼 생겼어!”' },
  funny: { icon: '😂', label: '웃긴 말', field: '민한이가 한 웃긴 말', ph: '“아빠는 왜 수염이 나? 고양이야?”' },
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
// ---------------- 새 글 (빨간 N) ----------------
// 다른 사람이 쓴 글 중 이 폰에서 아직 안 본 것. 한 번 화면에 나오면 '본 것'이 된다.
const SEEN_KEY = 'minhan-seen';
const seen = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY) || 'null');
    if (v?.base) return { base: v.base, ids: new Set(v.ids || []) };
  } catch {}
  return { base: new Date().toISOString(), ids: new Set() }; // 처음 깐 폰은 지금부터
})();
function saveSeen() {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify({ base: seen.base, ids: [...seen.ids].slice(-3000) }));
  } catch {}
}
saveSeen();
const shownNew = new Set(); // 이번 화면에서 N 을 보여 준 글 (화면을 옮기면 비움)
const myName = () => {
  try {
    return localStorage.getItem('minhan-author') || '';
  } catch {
    return '';
  }
};
const isNewEntry = (e) => e.author && e.author !== myName() && e.createdAt > seen.base && !seen.ids.has(e.id);
function newEntries() {
  return store
    .all()
    .filter(isNewEntry)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

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
  el.dataset.id = e.id;
  const pics = store.photos({ entryId: e.id });
  if (pics.length) {
    const strip = document.createElement('div');
    strip.className = 'entry-photos';
    for (const ph of pics) {
      const im = document.createElement('img');
      im.src = ph.thumb;
      im.alt = '';
      im.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openPhoto(ph);
      });
      strip.append(im);
    }
    el.insertBefore(strip, el.querySelector('.entry-meta'));
  }
  if (isNewEntry(e)) {
    shownNew.add(e.id);
    seen.ids.add(e.id);
    saveSeen();
  }
  if (shownNew.has(e.id)) el.insertAdjacentHTML('afterbegin', '<span class="new-badge" aria-label="새 글">N</span>');
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
const VIEWS = ['home', 'calendar', 'photos', 'import', 'search', 'all'];
let currentView = 'home';
// 폰 앱: 안드로이드 뒤로가기를 직접 처리한다 (메뉴 안의 행동 → 메뉴 첫 화면 → 오늘 → 종료할까요?)
const AppPlugin = window.Capacitor?.Plugins?.App;
const nativeBack = native && !!AppPlugin;
const actionStack = { calendar: [], all: [] }; // 메뉴 안에서 한 행동(되돌리기용)
let viewTrail = []; // 설정 → 가져오기처럼 안쪽으로 들어간 화면들
function showView(name, { push = true, sub = false } = {}) {
  if (!VIEWS.includes(name)) name = 'home';
  if (!nativeBack && push && name !== currentView) history.pushState({ view: name }, '', name === 'home' ? '#' : `#${name}`);
  if (nativeBack && name !== currentView) {
    if (sub) viewTrail.push(currentView);
    else if (push) viewTrail = [];
    if (name === 'home') viewTrail = [];
    if (push) for (const k in actionStack) if (k !== name) actionStack[k] = []; // 다른 메뉴로 가면 새로 시작
  }
  if (name !== currentView) shownNew.clear();
  currentView = name;
  for (const s of $$('.view')) s.hidden = s.id !== `view-${name}`;
  for (const b of $$('.bottom [data-view]')) b.classList.toggle('active', b.dataset.view === name);
  $('#bannerImg').src = `img/banner-${{ all: 'search', search: 'search' }[name] || name}.webp`;
  requestAnimationFrame(() => growAll());
  const left = $('#topLeftBtn');
  left.textContent = name === 'home' ? '🔍' : '🏠';
  left.setAttribute('aria-label', name === 'home' ? '찾기' : '처음 화면');
  window.scrollTo(0, 0);
  refresh();
}
$('#topLeftBtn').addEventListener('click', () => {
  if (currentView !== 'home') return showView('home');
  showView('all', { sub: true }); // 찾기는 전체보기에서
  setTimeout(() => $('#allSearch').focus(), 200);
});
$('#settingsBtn').addEventListener('click', () => {
  showView('search', { sub: true });
  setTimeout(() => $('#settingsBox').scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
});
for (const b of $$('[data-view]')) b.addEventListener('click', () => showView(b.dataset.view));

// 창(dialog) 은 열 때 history 를 하나 쌓아서, 안드로이드 뒤로가기로 닫히게 한다
function openDialog(d) {
  if (!nativeBack) history.pushState({ dialog: d.id }, '');
  d.showModal();
}
function closeDialog(d) {
  if (!d.open) return;
  if (!nativeBack && history.state?.dialog === d.id) history.back(); // popstate 에서 닫힘
  else d.close();
}

/** 안드로이드 뒤로가기 */
function goBack() {
  const exitDlg = $('#exitDialog');
  const open = $$('dialog').filter((d) => d.open).pop();
  if (open) return closeDialog(open); // 열린 창(종료할까요? 포함)부터 닫는다
  const st = actionStack[currentView];
  if (st?.length) return restoreAction(currentView, st.pop()); // 메뉴 안에서 한 행동 되돌리기
  if (viewTrail.length) return showView(viewTrail.pop(), { push: false });
  if (currentView !== 'home') return showView('home', { push: false });
  if (window.scrollY > 120) return window.scrollTo({ top: 0, behavior: 'smooth' }); // 오늘 맨 위부터
  openDialog(exitDlg);
}
let restoring = false;
function pushAction(view, snap) {
  if (!nativeBack || restoring) return;
  const st = actionStack[view];
  const last = st[st.length - 1];
  if (last && JSON.stringify(last) === JSON.stringify(snap)) return;
  st.push(snap);
  if (st.length > 60) st.shift();
}
const snapCal = () => pushAction('calendar', { calMonth, selectedDate });
const snapAll = () =>
  pushAction('all', { ages: [...allFilter.ages], kinds: [...allFilter.kinds], authors: [...allFilter.authors], order: allFilter.order, withPhoto: !!allFilter.withPhoto, q: $('#allSearch').value });
function restoreAction(view, snap) {
  restoring = true;
  if (view === 'calendar') {
    calMonth = snap.calMonth;
    selectedDate = snap.selectedDate;
    renderCalendar();
  } else if (view === 'all') {
    allFilter.ages = new Set(snap.ages);
    allFilter.kinds = new Set(snap.kinds);
    allFilter.authors = new Set(snap.authors);
    allFilter.order = snap.order;
    allFilter.withPhoto = !!snap.withPhoto;
    $('#allSearch').value = snap.q;
    saveAllFilter();
    renderAll();
  }
  restoring = false;
}
if (nativeBack) {
  AppPlugin.addListener('backButton', goBack);
  $('#exitYes').addEventListener('click', () => AppPlugin.exitApp());
}
$('#exitNo').addEventListener('click', () => closeDialog($('#exitDialog')));
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
  if (currentView === 'all') renderAll();
  if (currentView === 'search') renderNotifyCheck();
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
  // 다른 사람이 새로 쓴 글 (오늘 날짜가 아닌 것도 여기서 한 번 보여 준다)
  const fresh = [...newEntries(), ...store.all().filter((e) => shownNew.has(e.id) && !isNewEntry(e))]
    .filter((e, i, a) => a.findIndex((x) => x.id === e.id) === i)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  $('#freshWrap').hidden = !fresh.length;
  if (fresh.length) renderList($('#freshList'), fresh, { showDate: true });
  else $('#freshList').replaceChildren();
  const past = (await store.list({ md: today.slice(5) })).filter((e) => e.date < today).reverse();
  $('#memoriesWrap').hidden = !past.length;
  renderList($('#memories'), past, { showDate: true });
  renderParents(today);
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
/** 기록자 고르기: 아빠 / 엄마 / 기타(직접 쓰기) */
function makeAuthorPicker(root) {
  root.innerHTML = `<div class="author-chips">
      <button type="button" class="chip" data-a="아빠">👨 아빠</button>
      <button type="button" class="chip" data-a="엄마">👩 엄마</button>
      <button type="button" class="chip" data-a="기타">🙂 기타</button>
    </div>
    <input type="text" class="author-other" maxlength="10" placeholder="이름 (예: 할머니)" hidden />`;
  const other = $('.author-other', root);
  let chosen = '';
  const show = () => {
    for (const b of $$('[data-a]', root)) b.classList.toggle('on', b.dataset.a === chosen);
    other.hidden = chosen !== '기타';
  };
  for (const b of $$('[data-a]', root))
    b.addEventListener('click', () => {
      chosen = b.dataset.a;
      show();
      if (chosen === '기타') other.focus();
      root.dispatchEvent(new Event('change', { bubbles: true }));
    });
  return {
    set(name) {
      chosen = !name ? '' : ['아빠', '엄마'].includes(name) ? name : '기타';
      other.value = chosen === '기타' ? name : '';
      show();
    },
    get: () => (chosen === '기타' ? other.value.trim() : chosen),
  };
}
const editorAuthor = makeAuthorPicker($('#editorAuthor'));
const photoAuthor = makeAuthorPicker($('#photoAuthor'));

// --- 글에 붙이는 사진 ---
let attachOld = []; // 이미 붙어 있는 사진 (고칠 때)
let attachRemoved = new Set();
let attachNew = []; // 새로 붙일 사진 {data, thumb, width, height}
function renderAttach() {
  const list = $('#attachList');
  list.replaceChildren();
  const add = (thumb, onRemove, onOpen) => {
    const d = document.createElement('div');
    d.className = 'attach-item';
    d.innerHTML = `<img src="${thumb}" alt=""><button type="button" class="attach-x" aria-label="빼기">✕</button>`;
    $('img', d).addEventListener('click', onOpen || (() => {}));
    $('.attach-x', d).addEventListener('click', onRemove);
    list.append(d);
  };
  for (const ph of attachOld.filter((x) => !attachRemoved.has(x.id)))
    add(ph.thumb, () => (attachRemoved.add(ph.id), renderAttach()), () => openPhoto(ph));
  attachNew.forEach((ph, i) => add(ph.thumb, () => (attachNew.splice(i, 1), renderAttach(), saveAttachDraft())));
}
const saveAttachDraft = () => kv.set('write-photos', { editingId: editing?.id || null, photos: attachNew });
async function addAttachFiles(files) {
  for (const f of files) {
    try {
      attachNew.push(await shrinkPhoto(f));
    } catch (err) {
      toast(err.message || '사진을 열 수 없어요');
    }
  }
  renderAttach();
  saveAttachDraft();
}
/** 사진 찍기: 폰 앱은 카메라로 바로 (갤러리에도 저장), 웹은 카메라 입력 */
$('#takePhotoBtn').addEventListener('click', async () => {
  const Camera = window.Capacitor?.Plugins?.Camera;
  if (native && Camera?.takePhoto) {
    try {
      const r = await Camera.takePhoto({ quality: 90, saveToGallery: true, correctOrientation: true });
      const blob = await (await fetch(r.webPath)).blob();
      await addAttachFiles([blob]);
      toast('사진을 찍었어요 · 갤러리에도 저장했어요 📷');
    } catch (err) {
      if (!/cancel/i.test(err?.message || '')) toast('사진을 찍지 못했어요: ' + (err?.message || err));
    }
  } else $('#cameraFile').click();
});
for (const id of ['#cameraFile', '#attachFile'])
  $(id).addEventListener('change', async (e) => {
    const files = await readNow(e.target);
    if (files?.length) addAttachFiles(files);
  });
$('#attachFile').closest('label').addEventListener('click', async (e) => {
  if (!(native && window.Capacitor?.Plugins?.Camera)) return;
  e.preventDefault();
  try {
    const files = await pickFromGallery();
    if (files.length) addAttachFiles(files);
  } catch (err) {
    if (!/cancel/i.test(err?.message || '')) toast('사진을 고르지 못했어요');
  }
});

function openEditor(date, entry = null) {
  editing = entry;
  form.reset();
  form.date.value = entry?.date || date || todaySeoul();
  form.date.min = BIRTH_DATE;
  form.kind.value = entry?.kind || 'say';
  form.text.value = entry?.text || '';
  form.note.value = entry?.note || '';
  // 같은 글을 쓰다 만 게 있으면 이어서
  const d = draft.get('write');
  if (d && (d.editingId || null) === (entry?.id || null) && (d.text || d.note)) {
    form.date.value = d.date || form.date.value;
    form.kind.value = d.kind || form.kind.value;
    form.text.value = d.text || '';
    form.note.value = d.note || '';
    setTimeout(() => toast('쓰던 내용을 이어서 보여 드려요 📝'), 300);
  }
  setKind(form.kind.value);
  editorAuthor.set(entry ? entry.author || '' : myName());
  attachOld = entry ? store.photos({ entryId: entry.id }) : [];
  attachRemoved = new Set();
  attachNew = [];
  renderAttach();
  // 붙이던 사진이 임시저장돼 있으면 이어서
  kv.get('write-photos').then((w) => {
    if (w && (w.editingId || null) === (entry?.id || null) && w.photos?.length && editor.open && !attachNew.length) {
      attachNew = w.photos;
      renderAttach();
    }
  });
  saveWriteDraft(true);
  $('#editorDelete').hidden = !entry;
  updateEditorDay();
  openDialog(editor);
  requestAnimationFrame(() => growAll(editor));
  if (!entry) form.text.focus();
}
const closeEditor = () => closeDialog(editor);
/** 쓰기창 내용을 계속 저장. open: 쓰기창이 열려 있는지 (앱이 새로 열리면 다시 열어 줌) */
function saveWriteDraft(open = editor.open) {
  draft.set('write', {
    editingId: editing?.id || null,
    date: form.date.value,
    kind: form.kind.value,
    text: form.text.value,
    note: form.note.value,
    open,
  });
}
form.addEventListener('input', () => saveWriteDraft());
form.addEventListener('change', () => saveWriteDraft());
editor.addEventListener('close', () => {
  const d = draft.get('write');
  if (d) draft.set('write', { ...d, open: false });
});
/** 앱이 새로 열렸을 때 쓰다 만 쓰기창이 있으면 다시 열기 */
async function restoreWrite() {
  const d = draft.get('write');
  const w = await kv.get('write-photos');
  if (!d?.open || !(d.text || d.note || w?.photos?.length)) return;
  const entry = d.editingId ? store.all().find((e) => e.id === d.editingId) : null;
  if (d.editingId && !entry) return draft.clear('write');
  openEditor(d.date, entry);
}
function updateEditorDay() {
  const d = form.date.value;
  $('#editorDay').textContent = d && d >= BIRTH_DATE ? `${dayText(d)} · ${ageText(d)}` : '';
}
form.date.addEventListener('input', updateEditorDay);
for (const r of $$('input[name=kind]', form)) r.addEventListener('change', () => setKind(form.kind.value));
$('#editorCancel').addEventListener('click', () => {
  draft.clear('write');
  kv.del('write-photos');
  attachNew = [];
  closeEditor();
});
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  // 시간은 따로 고르지 않고, 처음 저장한 순간의 시간을 쓴다 (고칠 때는 그대로)
  const body = { date: form.date.value, kind: form.kind.value, text: form.text.value, note: form.note.value, time: editing ? editing.time : nowTimeSeoul() };
  if (body.date < BIRTH_DATE) return toast('태어난 날 이후로 골라 주세요');
  const author = editorAuthor.get();
  if (author) body.author = author;
  // 사진만 있고 글이 없으면 '사진' 이라고 적어 둔다
  if (!body.text.trim() && (attachNew.length || attachOld.length - attachRemoved.size > 0)) body.text = '📷 사진';
  try {
    const saved = editing ? await store.update(editing.id, body) : (await store.put([body]))[0];
    for (const ph of attachNew) await store.addPhoto({ ...ph, date: saved.date, entryId: saved.id, author: saved.author });
    for (const id of attachRemoved) await store.removePhoto(id);
    // 날짜·기록자를 바꿨으면 붙은 사진도 같이
    for (const ph of attachOld.filter((x) => !attachRemoved.has(x.id)))
      if (ph.date !== saved.date || ph.author !== saved.author) await store.updatePhoto(ph.id, { date: saved.date, author: saved.author });
    attachNew = [];
    kv.del('write-photos');
    draft.clear('write');
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
  for (const ph of store.photos({ entryId: editing.id })) await store.removePhoto(ph.id); // 붙은 사진도 같이
  await store.remove(editing.id);
  kv.del('write-photos');
  draft.clear('write');
  closeEditor();
  toast('지웠어요');
  refresh();
});
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
  snapCal();
  if (calMonth > BIRTH_DATE.slice(0, 7)) calMonth = shiftMonth(calMonth, -1);
  renderCalendar();
});
$('#calNext').addEventListener('click', () => {
  snapCal();
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
      snapCal();
      selectDate(d);
      closeDialog(monthPicker);
      renderCalendar();
    });
    months.append(b);
  }
  $('#pickTitle').textContent = `${pickYear}년`;
}
$('#pickToday').addEventListener('click', () => {
  snapCal();
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
      if (ymd !== selectedDate) snapCal();
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
  renderPhotoGrid($('#dayPhotos'), store.photos({ date: selectedDate, standalone: true }));
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
  const list = store.photos({ standalone: true });
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
/** 사진 메뉴: 카메라로 찍어서 바로 넣기 (폰 갤러리에도 저장) */
$('#photoCamBtn').addEventListener('click', async () => {
  const Camera = window.Capacitor?.Plugins?.Camera;
  if (native && Camera?.takePhoto) {
    try {
      const r = await Camera.takePhoto({ quality: 90, saveToGallery: true, correctOrientation: true });
      const blob = await (await fetch(r.webPath)).blob();
      handlePhotoFiles([new File([blob], 'camera.jpg', { type: blob.type || 'image/jpeg', lastModified: Date.now() })]);
    } catch (err) {
      if (!/cancel/i.test(err?.message || '')) toast('사진을 찍지 못했어요: ' + (err?.message || err));
    }
  } else $('#photoCamFile').click();
});
$('#photoCamFile').addEventListener('change', async (e) => {
  const files = await readNow(e.target);
  if (files?.length) handlePhotoFiles(files);
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
  photoAuthor.set(p.author || '');
  $('#photoOfEntry').hidden = !p.entryId;
  $('#photoViewDay').innerHTML = `${dayText(p.date)} · ${ageText(p.date)}${p.author ? ` · ${esc(p.author)}` : ''}`;
  openDialog(photoView);
  requestAnimationFrame(() => growAll(photoView));
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
  const author = photoAuthor.get();
  await store.updatePhoto(viewing.id, { date: pform.date.value, caption: pform.caption.value, ...(author ? { author } : {}) });
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
// '날짜가 안 보이면' 날짜를 바꾸면, 날짜를 못 찾은 기록 후보들도 같이 바뀐다
let fallbackTouched = false;
let pickerRows = [];
let pickerSave = null; // 지금 보이는 후보 목록의 임시저장 함수
$('#fallbackDate').addEventListener('change', () => {
  const d = $('#fallbackDate').value;
  if (!d) return;
  fallbackTouched = true;
  let n = 0;
  for (const r of pickerRows) {
    if (!r.auto || !r.row.isConnected) continue;
    r.date.value = d;
    n++;
  }
  if (n) toast(`${n}개를 ${prettyDate(d)}로 바꿨어요`);
  pickerSave?.();
});

$('#parseBtn').addEventListener('click', () => {
  const items = parseText(pasteBox.value, todaySeoul());
  if (!items.length) return toast('붙여넣은 글이 없어요');
  renderPicker(mergeSameDate(items.map((i) => ({ ...i, checked: true }))), 'paste');
});

pasteBox.addEventListener('input', () => {
  if (pasteBox.value.trim()) draft.set('paste', pasteBox.value);
  else draft.clear('paste');
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
    const images = [];
    for (const [i, file] of files.entries()) {
      status.textContent = `글자 읽는 중… (${i + 1}/${files.length})`;
      bar.style.width = '0%';
      previews.push(URL.createObjectURL(file));
      images.push(file);
      const { canvas, width, original, bin } = await prepareImage(file);
      const { data } = await worker.recognize(canvas, {}, { blocks: true });
      const lines = ocrLines(data);
      // 캡쳐에 날짜가 없으면: 사진 만든 날짜 → 없으면 위에서 고른 날짜
      const shotDate = file.lastModified ? todaySeoul(new Date(file.lastModified)) : null;
      // 말풍선을 찾으면 말풍선 하나 = 기록 하나, 못 찾으면 예전 방식(줄 묶기)
      const rects = findBubbles(original);
      let found = null;
      if (rects.length) {
        status.textContent = `말풍선 ${rects.length}개 읽는 중… (${i + 1}/${files.length})`;
        const dates = await readDatePills(worker, lines, original, rects);
        const bubbleLines = [];
        for (const [k, r] of rects.entries()) {
          bar.style.width = `${Math.round(((k + 1) / rects.length) * 100)}%`;
          bubbleLines.push(...(await readBubble(worker, original, r)));
        }
        found = bubblesFromOcr(lines, original, todaySeoul(), bin, { rects, bubbleLines, dates, trustSpaces: true });
      }
      found ||= linesToBubbles(lines, width, todaySeoul());
      const color = document.createElement('canvas');
      color.width = original.width;
      color.height = original.height;
      color.getContext('2d').putImageData(original, 0, 0);
      for (const b of found) {
        const { rect, dateBox, ...rest } = b;
        all.push({
          ...rest,
          shotDate,
          checked: false,
          crops: rect ? [cropBubble(color, rect)] : [],
          dateCrop: dateBox ? cropBubble(color, widen(dateBox, original.width)) : null, // 캡쳐 속 날짜 표시 부분
        });
      }
    }
    renderPicker(mergeSameDate(all), 'ocr', previews, { images });
  } catch (err) {
    // 원인을 알 수 있게 사진 정보도 작게 보여 준다
    const info = files.map((f) => `${f.type || '종류 없음'} · ${Math.round((f.size || 0) / 1024)}KB`).join(', ');
    importResult.innerHTML = `<div class="card error">${esc(err.message || err)}<br><small class="muted">${esc(info)}</small></div>`;
  }
}

/** 그림 일부를 잘라 그 부분만 읽고, 위치를 원래 그림 기준으로 되돌린다 */
async function ocrRegion(worker, src, r, psm, scale = 1) {
  const pad = 8;
  const x = Math.max(0, Math.floor(r.x0 - pad));
  const y = Math.max(0, Math.floor(r.y0 - pad));
  const w = Math.min(src.width - x, Math.ceil(r.x1 - r.x0 + pad * 2));
  const h = Math.min(src.height - y, Math.ceil(r.y1 - r.y0 + pad * 2));
  const part = document.createElement('canvas');
  part.width = w;
  part.height = h;
  part.getContext('2d').putImageData(src, -x, -y);
  let c = part;
  if (scale !== 1) {
    // 글씨가 작으면 잘못 읽어서, 키운 다음 흑백으로 바꿔 읽는다
    c = document.createElement('canvas');
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(part, 0, 0, c.width, c.height);
    const im = ctx.getImageData(0, 0, c.width, c.height);
    binarize(im);
    ctx.putImageData(im, 0, 0);
  }
  await worker.setParameters({ tessedit_pageseg_mode: psm });
  const { data } = await worker.recognize(c, {}, { blocks: true });
  await worker.setParameters({ tessedit_pageseg_mode: '4' });
  const move = (b) => ({ x0: b.x0 / scale + x, x1: b.x1 / scale + x, y0: b.y0 / scale + y, y1: b.y1 / scale + y });
  return ocrLines(data).map((l) => ({ ...l, bbox: move(l.bbox), words: (l.words || []).map((wd) => ({ ...wd, bbox: move(wd.bbox) })) }));
}

/** 말풍선 하나를 따로 읽는다. 잘 안 읽혔으면(영어가 섞인 경우 등) 한글+영어 사전으로 한 번 더 읽어 나은 쪽 */
async function readBubble(worker, original, r) {
  // 원래 색 그림에서 잘라 2배로 키워 읽는다 (작은 글씨 오타 줄이기)
  const kor = await ocrRegion(worker, original, r, '6', 2);
  if (!kor.some((l) => (l.confidence ?? 100) < 72 || looksGarbled(l.text))) return kor;
  let alt;
  try {
    alt = await ocrRegion(await getBilingualWorker(), original, r, '6', 2);
  } catch (err) {
    console.error('eng', err);
    return kor;
  }
  // 줄마다: 한글로 읽은 줄이 이상하고(숫자·부호 뒤범벅) 영어로 읽은 줄에 진짜 영어 낱말이 있으면 영어 쪽
  return kor.map((line) => {
    const twin = alt
      .map((a) => ({ a, o: Math.min(a.bbox.y1, line.bbox.y1) - Math.max(a.bbox.y0, line.bbox.y0) }))
      .sort((x, y) => y.o - x.o)[0];
    if (!twin || twin.o <= 0) return line;
    const better = (twin.a.confidence ?? 0) > (line.confidence ?? 0);
    return better && looksEnglish(twin.a.text) && looksGarbled(line.text) ? fixEnglish(twin.a) : line;
  });
}

/** 진짜 영어 낱말(소문자 2글자 이상)이 있고, 대문자 뒤범벅(AHOOFE 같은 것)이 아닌지 */
/** 줄 끝의 조회수·시간 부분(👁 6 오후 9:02 가 '< 6 오후 902' 처럼 읽힌 것)은 떼고 본다 */
const dropTail = (t) =>
  String(t)
    .trim()
    .replace(/\s*[<>＜＞《》«»‹›〈〉@©®◎。].*$/u, '')
    .replace(/\s*(?:오전|오후|오호|오흐|ㅇㅎ)\s*[\d:;.]+.*$/, '')
    .trim();
function looksEnglish(text) {
  const words = dropTail(text).match(/[A-Za-z]{2,}/g) || [];
  const lower = words.filter((w) => /[a-z]{2,}/.test(w));
  const caps = words.filter((w) => /^[A-Z]{3,}$/.test(w));
  return lower.length >= 2 && caps.length === 0;
}
/** 한글 사전으로 읽은 줄이 숫자·부호 뒤범벅인지 (영어를 한글로 잘못 읽은 경우) */
function looksGarbled(text) {
  const t = dropTail(text);
  return /[<>]|\d{3,}|\d[가-힣]\d|[가-힣]\d{2,}[가-힣<]/.test(t);
}
/** 영어로 읽을 때 자주 틀리는 것 바로잡기: 맨 앞 '|' → 'I' */
function fixEnglish(line) {
  const words = (line.words || []).map((w, i) => (i === 0 && /^[|l]$/.test(w.text) ? { ...w, text: 'I' } : w));
  return { ...line, words, text: String(line.text).replace(/^\|\s/, 'I ') };
}

/** 한 줄짜리 그림 읽기 */
async function readLine(worker, canvas) {
  await worker.setParameters({ tessedit_pageseg_mode: '7' });
  const { data } = await worker.recognize(canvas);
  await worker.setParameters({ tessedit_pageseg_mode: '4' });
  return String(data.text || '').replace(/\s+/g, ' ').trim();
}

/** 가운데 색 바탕 글씨(날짜 표시)만 잘라 다시 읽어 날짜를 찾는다 */
async function readDatePills(worker, lines, original, rects) {
  const out = [];
  const boxes = [
    ...datePillCandidates(lines, original).map((b) => ({ b, pad: true })),
    ...gapRegions(rects, original).map((b) => ({ b, pad: false })),
  ];
  for (const { b: box, pad } of boxes) {
    const c = pillCanvas(original, box, pad);
    await worker.setParameters({ tessedit_pageseg_mode: '7' });
    const { data } = await worker.recognize(c);
    await worker.setParameters({ tessedit_pageseg_mode: '4' });
    const text = String(data.text || '').replace(/\s+/g, ' ').trim();
    // '2월 15일 입' 처럼 옆 글자가 붙어도 날짜 부분만 찾는다
    const m = text.match(/(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    const d = m ? parseDateLine(m[0], todaySeoul()) : parseDateLine(text, todaySeoul());
    if (d && !out.some((x) => Math.abs(x.y - box.y0) < 40 && x.date === d)) out.push({ y: box.y0, date: d, box: pad ? box : tightBox(original, box) });
  }
  // 찾은 날짜 표시의 색을 배워서, 말풍선에 겹쳐 걸린 날짜 표시를 더 찾는다
  for (const box of findPillsByColor(original, out.map((o) => o.box))) {
    if (out.some((o) => Math.abs(o.y - box.y0) < 30)) continue;
    const text = await readLine(worker, pillCanvas(original, box, false));
    const m = text.match(/(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    const d = m ? parseDateLine(m[0], todaySeoul()) : null;
    if (d) out.push({ y: box.y0, date: d, box });
  }
  out.sort((a, b) => a.y - b.y);
  return out;
}

let bilingualP;
function getBilingualWorker() {
  bilingualP ??= (async () => {
    const base = new URL('vendor/', location.href).href;
    const w = await window.Tesseract.createWorker(['kor', 'eng'], 1, {
      workerPath: base + 'worker.min.js',
      corePath: base + 'core/',
      langPath: base + 'lang',
      gzip: false,
      cacheMethod: 'none',
    });
    return w;
  })().catch((e) => {
    bilingualP = null;
    throw e;
  });
  return bilingualP;
}

/** 날짜 표시 상자를 옆으로 넓혀서(가운데 기준) 잘라 보여 줄 범위 */
function widen(b, W) {
  const h = b.y1 - b.y0;
  const cx = (b.x0 + b.x1) / 2;
  const half = Math.max((b.x1 - b.x0) / 2 + h, W * 0.16);
  return { x0: Math.max(0, cx - half), x1: Math.min(W - 1, cx + half), y0: b.y0 - h * 0.3, y1: b.y1 + h * 0.3 };
}
/** 넓은 틈 영역 안에서 실제 날짜 표시(색 바탕) 부분만 좁힌다 */
function tightBox(img, r) {
  const { data, width: W } = img;
  const cx = Math.round((r.x0 + r.x1) / 2);
  let top = -1;
  let bottom = -1;
  // 가운데 세로줄에서 배경과 다른(진한) 부분을 찾는다
  const lumAt = (x, y) => {
    const i = (Math.round(y) * W + x) * 4;
    return (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  };
  const vals = [];
  for (let y = Math.ceil(r.y0); y < r.y1; y++) vals.push(lumAt(cx, y));
  const sorted = [...vals].sort((a, b) => a - b);
  const bg = sorted[Math.floor(sorted.length * 0.8)];
  vals.forEach((v, k) => {
    if (bg - v > 18) {
      if (top < 0) top = k;
      bottom = k;
    }
  });
  if (top < 0) return r;
  return { x0: r.x0 + (r.x1 - r.x0) * 0.25, x1: r.x1 - (r.x1 - r.x0) * 0.25, y0: r.y0 + top, y1: r.y0 + bottom };
}

/** 같은 날짜인 후보들은 처음부터 하나로 합친다 (날짜를 못 찾은 것끼리도 하나로) */
function mergeSameDate(items) {
  const out = [];
  for (const it of items) {
    const key = it.date || 'none';
    const same = out.find((o) => (o.date || 'none') === key);
    if (!same) {
      out.push({ ...it, crops: [...(it.crops || [])] });
      continue;
    }
    same.text = [same.text, it.text].filter((t) => String(t || '').trim()).join('\n\n');
    same.crops.push(...(it.crops || []));
    same.checked = same.checked || it.checked;
  }
  return out;
}

/** 말풍선 부분만 잘라 작은 그림으로 (후보 옆에 보여 주고 임시저장에도 넣음) */
function cropBubble(src, r) {
  const pad = 6;
  const x = Math.max(0, r.x0 - pad);
  const y = Math.max(0, r.y0 - pad);
  const w = Math.min(src.width - x, r.x1 - r.x0 + pad * 2);
  const h = Math.min(src.height - y, r.y1 - r.y0 + pad * 2);
  const scale = Math.min(1, 640 / w);
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext('2d').drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.75);
}

/** 글 길이에 맞춰 입력칸 높이를 저절로 맞춘다 (끝까지 다 보이게) */
function autoGrow(ta) {
  if (!ta.offsetParent) return; // 안 보이는 칸은 보일 때 다시 맞춤
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 2 + 'px';
}
function growAll(root = document) {
  for (const ta of root.querySelectorAll('textarea.grow')) autoGrow(ta);
}
document.addEventListener('input', (e) => e.target.matches?.('textarea.grow') && autoGrow(e.target));
addEventListener('resize', () => growAll());

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
// ---------------- 임시저장 (앱이 새로 열려도 쓰던 것 이어서) ----------------
const draft = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem('minhan-draft-' + key) || 'null');
    } catch {
      return null;
    }
  },
  set(key, v) {
    try {
      localStorage.setItem('minhan-draft-' + key, JSON.stringify(v));
    } catch {}
  },
  clear(key) {
    try {
      localStorage.removeItem('minhan-draft-' + key);
    } catch {}
  },
};

function renderPicker(items, source, previews = [], { restored = false, images = [] } = {}) {
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
    ${previews.length ? `<details class="ocr-originals"${restored ? '' : ' open'}><summary>📷 올린 캡쳐 ${previews.length}장 보기</summary>${previews.map((u) => `<img class="ocr-img" src="${u}" alt="캡쳐">`).join('')}</details>` : ''}
    <div class="pick-tools">
      <button class="btn small" data-sel="all">모두 선택</button>
      <button class="btn small" data-sel="none">선택 해제</button>
      <button class="btn small" data-merge>🔗 선택 합치기</button>
      ${hasSides ? '<button class="btn small" data-sel="left">왼쪽 말풍선</button><button class="btn small" data-sel="right">오른쪽 말풍선</button>' : ''}
    </div>
    <div class="pick-tools">
      <span class="small">모두</span>
      <button class="btn small" data-allkind="say">💬 한 말로</button>
      <button class="btn small" data-allkind="funny">😂 웃긴 말로</button>
      <button class="btn small" data-allkind="did">🌱 한 일로</button>
      <input type="date" class="all-date" min="${BIRTH_DATE}" aria-label="모두 이 날짜로">
      <button class="btn small" data-alldate>날짜로</button>
    </div>
    ${restored ? '<div class="draft-note">📝 하던 것을 이어서 보여 드려요 <button type="button" class="btn small" data-drop>지우기</button></div>' : ''}
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
        <div class="pick-crops"></div>
        <textarea class="pick-text grow" rows="1">${esc(it.text)}</textarea>
        <div class="pick-meta">
          <input type="date" class="pick-date" min="${BIRTH_DATE}" value="${it.dateValue || it.date || (!fallbackTouched && it.shotDate) || fallback()}">
          ${it.date || it.auto === false ? '' : '<span class="warn">날짜 못 찾음</span>'}
          <button type="button" class="kind-btn"></button>
          <button type="button" class="merge-up">⬆ 위와 합치기</button>
        </div>
      </div>`;
    const r = { it, row, cb: $('input[type=checkbox]', row), ta: $('textarea', row), date: $('.pick-date', row), kindBtn: $('.kind-btn', row), kind: 'say' };
    const setRowKind = (k) => {
      r.kind = k;
      r.kindBtn.textContent = `${KIND[k].icon} ${KIND[k].label}`;
    };
    r.setKind = setRowKind;
    setRowKind(KIND[it.kind] ? it.kind : 'say');
    r.kindBtn.addEventListener('click', () => {
      setRowKind({ say: 'funny', funny: 'did', did: 'say' }[r.kind] || 'say'); // 한 말 → 웃긴 말 → 한 일
      saveDraft();
    });
    r.crops = [...(it.crops || [])];
    // 날짜 비교용: 캡쳐 속 날짜 표시 그림, 없으면 사진 날짜 안내
    if (source === 'ocr') {
      $('.pick-crops', row).insertAdjacentHTML(
        'beforebegin',
        it.dateCrop
          ? `<div class="pick-datecrop"><span>캡쳐 날짜</span><img src="${it.dateCrop}" alt="캡쳐 날짜"></div>`
          : `<div class="pick-datecrop none">📷 캡쳐에 날짜 표시가 없어요${it.shotDate ? ` · 사진 날짜 ${prettyDate(it.shotDate)}` : ''}</div>`,
      );
    }
    r.showCrops = () => {
      $('.pick-crops', row).innerHTML = r.crops.map((u) => `<img src="${u}" alt="말풍선">`).join('');
    };
    r.showCrops();
    requestAnimationFrame(() => autoGrow(r.ta));
    $('.merge-up', row).addEventListener('click', () => {
      const i = rows.indexOf(r);
      if (i > 0) mergeRows([rows[i - 1], r]);
    });
    r.auto = it.auto ?? !it.date; // 글에서 날짜를 못 찾은 것 → 위의 날짜를 따라감
    r.date.addEventListener('change', () => {
      $('.warn', row)?.remove();
      r.auto = false; // 직접 고친 날짜는 그대로 둔다
    });
    listEl.append(row);
    return r;
  });

  pickerRows = rows;
  /** 여러 후보를 하나로 (맨 위 것에 글·말풍선 그림을 이어 붙임) */
  function mergeRows(list) {
    if (list.length < 2) return toast('합칠 것을 2개 이상 체크해 주세요');
    const [first, ...rest] = list;
    const dates = new Set(list.map((r) => r.date.value));
    if (dates.size > 1 && !confirm(`날짜가 서로 달라요. 맨 위 것(${prettyDate(first.date.value)})으로 합칠까요?`)) return;
    first.ta.value = [first.ta.value.trim(), ...rest.map((r) => r.ta.value.trim())].filter(Boolean).join('\n\n');
    for (const r of rest) {
      first.crops.push(...r.crops);
      if (r.cb.checked) first.cb.checked = true;
      r.row.remove();
      rows.splice(rows.indexOf(r), 1);
    }
    first.showCrops();
    autoGrow(first.ta);
    refreshMergeButtons();
    update();
    saveDraft();
    toast(`${list.length}개를 하나로 합쳤어요`);
  }
  function refreshMergeButtons() {
    rows.forEach((r, i) => ($('.merge-up', r.row).hidden = i === 0));
  }
  refreshMergeButtons();
  $('[data-merge]', card).addEventListener('click', () => mergeRows(rows.filter((r) => r.cb.checked)));
  let saveTimer;
  function saveDraft() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!rows.length) return kv.del('import');
      kv.set('import', {
        source,
        images,
        savedAt: new Date().toISOString(),
        items: rows.map((r) => ({
          crops: r.crops,
          dateCrop: r.it.dateCrop || null,
          shotDate: r.it.shotDate || null,
          text: r.ta.value,
          date: r.it.date || null,
          dateValue: r.date.value,
          auto: r.auto,
          kind: r.kind,
          checked: r.cb.checked,
          side: r.it.side || '',
          time: r.it.time || '',
        })),
      });
    }, 300);
  }
  listEl.addEventListener('input', saveDraft);
  listEl.addEventListener('change', saveDraft);
  pickerSave = saveDraft;
  $('[data-drop]', card)?.addEventListener('click', () => {
    if (!confirm('하던 목록을 지울까요?')) return;
    rows.length = 0;
    kv.del('import');
    importResult.replaceChildren();
  });
  saveDraft();
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
      saveDraft();
    });
  }
  for (const b of $$('[data-allkind]', card))
    b.addEventListener('click', () => {
      rows.forEach((r) => r.cb.checked && r.setKind(b.dataset.allkind));
      saveDraft();
    });
  $('[data-alldate]', card).addEventListener('click', () => {
    const d = $('.all-date', card).value;
    for (const r of rows) if (r.cb.checked) (r.date.value = d), (r.auto = false), $('.warn', r.row)?.remove();
    saveDraft();
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
      refreshMergeButtons();
      update();
      saveDraft();
      if (!rows.length) {
        importResult.innerHTML = `<div class="card empty">다 넣었어요! <button class="btn small" id="goCal">달력에서 보기</button></div>`;
        $('#goCal').addEventListener('click', () => {
          selectDate(dates.at(-1));
          showView('calendar');
        });
        if (source === 'paste') {
          pasteBox.value = '';
          draft.clear('paste');
        }
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

/** 앱이 새로 열렸을 때: 하던 가져오기 목록, 붙여넣기 글, 쓰기창 되살리기 */
async function restoreDrafts() {
  const paste = draft.get('paste');
  if (paste && !pasteBox.value) pasteBox.value = paste;
  // 예전 버전(글만 저장)에서 넘어온 것
  const old = draft.get('import');
  if (old?.items?.length && !(await kv.get('import'))) await kv.set('import', old);
  draft.clear('import');
  const imp = await kv.get('import');
  if (imp?.items?.length && !pickerRows.length) {
    const images = imp.images || [];
    renderPicker(imp.items, imp.source || 'ocr', images.map((b) => URL.createObjectURL(b)), { restored: true, images });
    if (currentView === 'home') toast('하던 가져오기 목록이 있어요 (가져오기 탭)');
  }
  restoreWrite();
}

// ---------------- 가족 (아빠·엄마) ----------------
const FAMILY = {
  child: { name: '민한이', label: '민한이', date: BIRTH_DATE, time: '11:55', icon: '👶' },
  dad: { name: '아빠', label: '아빠', date: '1983-06-07', time: '08:30', icon: '👨' },
  mom: { name: '엄마', label: '엄마', date: '1980-09-29', time: '18:03', icon: '👩' },
};
const daysSince = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
function yearsOld(from, to) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return ty - fy - (tm < fm || (tm === fm && td < fd) ? 1 : 0);
}
const koTime = (t) => {
  const [h, m] = t.split(':').map(Number);
  return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}시${m ? ` ${m}분` : ''}`;
};
function renderParents(today) {
  $('#parents').innerHTML = ['dad', 'mom']
    .map((k) => {
      const f = FAMILY[k];
      const [y, m, d] = f.date.split('-').map(Number);
      return `<div class="parent-row">
        <span class="parent-name">${f.icon} ${f.label}</span>
        <span class="parent-info">${y}.${m}.${d} · 탄생 ${daysSince(f.date, today).toLocaleString()}일째 · 만 ${yearsOld(f.date, today)}살</span>
        <button class="chip small-chip" data-saju="${k}">사주보기</button>
      </div>`;
    })
    .join('');
}

// ---------------- 사주보기 ----------------
const sajuDialog = $('#sajuDialog');
let sajuNow = null;
const EL_ICON = ['🌳', '🔥', '⛰️', '🪙', '💧'];
const EL_LABEL = ['목', '화', '토', '금', '수'];
function openSaju(key, tab = 'life') {
  const f = FAMILY[key];
  const now = new Date();
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  const others = { child: ['dad', 'mom'], dad: ['mom', 'child'], mom: ['dad', 'child'] }[key].map((k) => FAMILY[k]);
  sajuNow = readSaju(f, todaySeoul(), hhmm, others);
  const [y, m, d] = f.date.split('-').map(Number);
  $('#sajuTitle').textContent = `🔮 ${f.label} 사주`;
  $('#sajuBirth').textContent = `${y}년 ${m}월 ${d}일 ${koTime(f.time)} (양력)`;
  const cols = [['시', sajuNow.chart[0]], ['일', sajuNow.chart[1]], ['월', sajuNow.chart[2]], ['년', sajuNow.chart[3]]];
  $('#sajuChart').innerHTML = cols
    .map(([lab, p]) => `<div class="pillar${lab === '일' ? ' me' : ''}"><small>${lab}</small><b>${p.hanja[0]}</b><b>${p.hanja[1]}</b><span>${p.ko}</span></div>`)
    .join('');
  $('#sajuElements').innerHTML = sajuNow.counts.map((c, i) => `<span class="el el-${i}">${EL_ICON[i]} ${EL_LABEL[i]} ${c}</span>`).join('');
  showSajuTab(tab);
  if (!sajuDialog.open) openDialog(sajuDialog);
}
function showSajuTab(tab) {
  for (const b of $$('#sajuTabs button')) b.classList.toggle('on', b.dataset.tab === tab);
  const sec = sajuNow.sections[tab];
  const blocks = sec.blocks
    ? sec.blocks.map((b) => `<div class="saju-block"><h5>${esc(b.t)}</h5>${b.p.map((t) => `<p>${esc(t)}</p>`).join('')}</div>`).join('')
    : sec.text.map((t) => `<p>${esc(t)}</p>`).join('');
  $('#sajuBody').innerHTML = `<h4>${sec.title}</h4><div class="saju-sub">${esc(sec.head)}</div>${blocks}`;
  $('#sajuBody').scrollIntoView({ block: 'nearest' });
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-saju]');
  if (b) openSaju(b.dataset.saju, b.dataset.tab || 'life');
});
for (const b of $$('#sajuTabs button')) b.addEventListener('click', () => showSajuTab(b.dataset.tab));

// ---------------- 전체보기 ----------------
const ALL_KEY = 'minhan-all-filter';
const allFilter = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(ALL_KEY) || 'null');
    // 예전에 저장한 조건에는 '웃긴 말'이 없어서 켜 준다
    if (v && !v.kinds.includes('funny')) v.kinds.push('funny');
    if (v) return { ages: new Set(v.ages), kinds: new Set(v.kinds), authors: new Set(v.authors), order: v.order || 'new', withPhoto: !!v.withPhoto };
  } catch {}
  return { ages: new Set(), kinds: new Set(['say', 'funny', 'did', 'photo']), authors: new Set(), order: 'new' };
})();
function saveAllFilter() {
  try {
    localStorage.setItem(ALL_KEY, JSON.stringify({ ages: [...allFilter.ages], kinds: [...allFilter.kinds], authors: [...allFilter.authors], order: allFilter.order, withPhoto: !!allFilter.withPhoto }));
  } catch {}
}
const ageOf = (date) => age(date).years;
function chip(label, on, onClick) {
  const b = document.createElement('button');
  b.className = 'chip' + (on ? ' on' : '');
  b.innerHTML = label;
  b.addEventListener('click', onClick);
  return b;
}
/** 여러 개 고르기: 비어 있으면 '전체' */
function toggleIn(set, v) {
  snapAll();
  set.has(v) ? set.delete(v) : set.add(v);
  saveAllFilter();
  renderAll();
}
let allTimer;
let lastQuery = '';
$('#allSearch').addEventListener('focus', () => (lastQuery = $('#allSearch').value));
$('#allSearch').addEventListener('change', () => {
  // 찾기를 마치면(입력 끝) 그 전 상태를 되돌리기용으로 남긴다
  const now = $('#allSearch').value;
  $('#allSearch').value = lastQuery;
  snapAll();
  $('#allSearch').value = now;
  lastQuery = now;
});
$('#allSearch').addEventListener('input', () => {
  clearTimeout(allTimer);
  allTimer = setTimeout(renderAll, 200);
});
function renderAll() {
  const today = todaySeoul();
  const entries = store.all();
  const photos = store.photos();
  // --- 고르기 칸 ---
  const maxAge = ageOf(today);
  const fAge = $('#fAge');
  fAge.replaceChildren(chip('전체', !allFilter.ages.size, () => (snapAll(), allFilter.ages.clear(), saveAllFilter(), renderAll())));
  // 기록이 있는 나이만 (새 나이에 기록이 생기면 저절로 늘어남)
  const agesWith = [...new Set([...entries, ...photos].map((x) => ageOf(x.date)))].filter((a) => a >= 0 && a <= maxAge).sort((a, b) => a - b);
  for (const a of agesWith) fAge.append(chip(`${a}세`, allFilter.ages.has(a), () => toggleIn(allFilter.ages, a)));
  const fKind = $('#fKind');
  const KINDS_ALL = ['say', 'funny', 'did', 'photo'];
  fKind.replaceChildren(
    chip('전체', KINDS_ALL.every((k) => allFilter.kinds.has(k)), () => {
      snapAll();
      allFilter.kinds = new Set(KINDS_ALL);
      saveAllFilter();
      renderAll();
    }),
  );
  $('#fPhoto').replaceChildren(
    chip('전체', !allFilter.withPhoto, () => (snapAll(), (allFilter.withPhoto = false), saveAllFilter(), renderAll())),
    chip('📎 사진 있는 글만', !!allFilter.withPhoto, () => (snapAll(), (allFilter.withPhoto = true), saveAllFilter(), renderAll())),
  );
  for (const [k, l] of [['say', '💬 한 말'], ['funny', '😂 웃긴 말'], ['did', '🌱 한 일'], ['photo', '📷 사진']])
    fKind.append(
      chip(l, allFilter.kinds.has(k), () => {
        if (allFilter.kinds.has(k) && allFilter.kinds.size === 1) return; // 하나는 남긴다
        toggleIn(allFilter.kinds, k);
      }),
    );
  const authors = [...new Set([...entries, ...photos].map((x) => x.author).filter(Boolean))].sort((a, b) =>
    ['아빠', '엄마'].indexOf(b) - ['아빠', '엄마'].indexOf(a) || a.localeCompare(b),
  );
  const fAuthor = $('#fAuthor');
  fAuthor.replaceChildren(chip('전체', !allFilter.authors.size, () => (snapAll(), allFilter.authors.clear(), saveAllFilter(), renderAll())));
  for (const a of authors) fAuthor.append(chip(esc(a), allFilter.authors.has(a), () => toggleIn(allFilter.authors, a)));
  $('#fOrder').replaceChildren(
    chip('최신순', allFilter.order === 'new', () => (snapAll(), (allFilter.order = 'new'), saveAllFilter(), renderAll())),
    chip('오래된순', allFilter.order === 'old', () => (snapAll(), (allFilter.order = 'old'), saveAllFilter(), renderAll())),
  );
  // --- 거르기 ---
  const q = $('#allSearch').value.trim().toLowerCase();
  const pass = (date, author, text) =>
    (!allFilter.ages.size || allFilter.ages.has(ageOf(date))) &&
    (!allFilter.authors.size || allFilter.authors.has(author || '')) &&
    (!q || String(text).toLowerCase().includes(q));
  const items = [
    ...entries
      .filter((e) => allFilter.kinds.has(e.kind || 'say') && pass(e.date, e.author, `${e.text} ${e.note}`))
      .filter((e) => !allFilter.withPhoto || store.photos({ entryId: e.id }).length)
      .map((e) => ({ type: 'entry', date: e.date, key: `${e.time || '99:99'}${e.createdAt}`, e })),
    ...(allFilter.kinds.has('photo') && !allFilter.withPhoto ? photos.filter((p) => !p.entryId && pass(p.date, p.author, p.caption)).map((p) => ({ type: 'photo', date: p.date, key: `zz${p.createdAt}`, p })) : []),
  ];
  // 날짜별로 묶기
  const byDate = new Map();
  for (const it of items) {
    if (!byDate.has(it.date)) byDate.set(it.date, []);
    byDate.get(it.date).push(it);
  }
  const dates = [...byDate.keys()].sort();
  if (allFilter.order === 'new') dates.reverse();
  const nEntries = items.filter((i) => i.type === 'entry').length;
  const nPhotos = items.length - nEntries;
  $('#allCount').textContent = `${dates.length.toLocaleString()}일 · 글 ${nEntries.toLocaleString()}개${nPhotos ? ` · 사진 ${nPhotos}장` : ''}`;
  const mark = (t) => {
    const safe = esc(t);
    if (!q) return safe;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    return safe.replace(re, (m) => `<mark>${m}</mark>`);
  };
  const list = $('#allList');
  const frag = document.createDocumentFragment();
  for (const d of dates) {
    const [y, m, dd] = d.split('-').map(Number);
    const row = document.createElement('div');
    row.className = 'all-row';
    row.innerHTML = `<div class="all-date"><span>${y}년</span><b>${m}월 ${dd}일</b><small>(${ageOf(d)}세)</small></div><div class="all-items"></div>`;
    const box = $('.all-items', row);
    const its = byDate.get(d).sort((a, b) => a.key.localeCompare(b.key));
    for (const it of its) {
      if (it.type === 'entry') {
        const e = it.e;
        const el = document.createElement('div');
        el.className = `all-item kind-${e.kind || 'say'}`;
        const pics = store.photos({ entryId: e.id });
        el.innerHTML = `<div class="all-text">${mark(e.text)}</div>${e.note ? `<div class="all-note">${mark(e.note)}</div>` : ''}${
          pics.length ? `<div class="all-pics">${pics.map((ph) => `<img src="${ph.thumb}" data-pid="${ph.id}" alt="">`).join('')}</div>` : ''
        }${e.author ? `<span class="all-author">${esc(e.author)}</span>` : ''}`;
        for (const im of $$('.all-pics img', el))
          im.addEventListener('click', (ev) => {
            ev.stopPropagation();
            openPhoto(pics.find((x) => x.id === im.dataset.pid));
          });
        el.addEventListener('click', () => openEditor(e.date, e));
        box.append(el);
      } else {
        const p = it.p;
        const el = document.createElement('button');
        el.className = 'all-photo';
        el.innerHTML = `<img src="${p.thumb}" alt="" loading="lazy"><span>${p.caption ? mark(p.caption) : '📷 사진'}</span>`;
        el.addEventListener('click', () => openPhoto(p));
        box.append(el);
      }
    }
    frag.append(row);
  }
  list.replaceChildren(frag);
  if (!dates.length) list.innerHTML = '<div class="empty">조건에 맞는 기록이 없어요</div>';
}

$('#goImport').addEventListener('click', () => showView('import', { sub: true }));

// ---------------- 폰 알림 (안드로이드) ----------------
// 앱이 꺼져 있어도 15분마다 새 글을 확인해서 알림을 띄운다 (MainActivity / NewEntryWorker)
const notify = window.AndroidNotify;
function setupNotify() {
  if (!notify) return;
  try {
    notify.configure(JSON.stringify({ refreshToken: auth$.refreshToken(), author: myName(), since: new Date().toISOString() }));
  } catch (err) {
    console.error('notify', err);
  }
}
/** 이 폰에서 본 글까지는 알림을 보내지 않게 알려 준다 */
function reportSeen() {
  if (!notify || !store.ready()) return;
  const last = store.all().reduce((m, e) => (e.createdAt > m ? e.createdAt : m), '');
  if (last) notify.seenUpTo(last);
}
let pendingOpen = null;
function takeOpen() {
  try {
    const id = notify?.takeOpen();
    if (id) pendingOpen = id;
  } catch {}
  openPending();
}
/** 알림을 누르면: 그 글이 있는 날짜의 달력으로 가서 그 글을 반짝 보여 준다 */
function openPending() {
  if (!pendingOpen || !store.ready()) return;
  const e = store.all().find((x) => x.id === pendingOpen);
  if (!e) return;
  pendingOpen = null;
  selectDate(e.date);
  showView('calendar');
  setTimeout(() => {
    const el = document.querySelector(`#dayList .entry[data-id="${CSS.escape(e.id)}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 2400);
  }, 350);
}
window.onAndroidOpen = takeOpen;

/** 새로 들어온 다른 사람의 글: 앱이 뒤에 있으면 바로 폰 알림, 보고 있으면 화면에 알려 줌 */
let knownIds = null;
function watchNewForNotify() {
  if (!store.ready()) return;
  const all = store.all();
  if (!knownIds) {
    knownIds = new Set(all.map((e) => e.id)); // 처음 불러온 것은 새 글이 아님
    return;
  }
  const fresh = all.filter((e) => !knownIds.has(e.id));
  fresh.forEach((e) => knownIds.add(e.id));
  const others = fresh.filter((e) => e.author && e.author !== myName()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!others.length) return;
  if (document.hidden && notify?.showNew) {
    notify.showNew(JSON.stringify(others.map(({ id, date, text, author, createdAt }) => ({ id, date, text, author, createdAt }))));
  } else {
    const who = others[0].author;
    toast(`💌 ${who}${/[가-힣]$/.test(who) && (who.charCodeAt(who.length - 1) - 0xac00) % 28 ? '이' : '가'} 새 내용을 올렸어요${others.length > 1 ? ` (${others.length}개)` : ''}`);
  }
}

/** 설정 > 알림 점검 */
function renderNotifyCheck() {
  const box = $('#notifyCheck');
  if (!box) return;
  if (!notify?.getStatus) {
    box.innerHTML = '<p class="muted small">알림은 휴대폰 앱에서만 돼요.</p>';
    return;
  }
  let st = {};
  try {
    st = JSON.parse(notify.getStatus() || '{}');
  } catch {}
  const ok = (b) => (b ? '✅' : '⚠️');
  box.innerHTML = `
    <ul class="check-list">
      <li>${ok(st.enabled)} 알림 허용: ${st.enabled ? '켜져 있어요' : '<b>꺼져 있어요</b> → 아래 [알림 설정]에서 켜 주세요'}</li>
      <li>${ok(st.batteryFree)} 배터리 제한: ${st.batteryFree ? '없어요' : '<b>있어요</b> → [배터리 제한 풀기]를 눌러 허용해 주세요 (안 풀면 확인이 몇 시간씩 늦어질 수 있어요)'}</li>
      <li>${ok(st.hasToken)} 로그인 정보: ${st.hasToken ? '있어요' : '없어요 (로그아웃 후 다시 들어와 주세요)'}</li>
      <li>✍️ 이 폰의 기록자: <b>${esc(st.author || '안 정함')}</b> (이 이름으로 쓴 글은 이 폰에 알림이 안 와요)</li>
      <li>🕐 마지막 확인: ${esc(st.lastRun || '아직 없음')} ${st.lastResult ? `· ${esc(st.lastResult)}` : ''}</li>
      ${st.lastError ? `<li>❗ 오류: <small>${esc(st.lastError)}</small></li>` : ''}
    </ul>
    <p class="muted small">앱을 보고 있을 때 온 새 글은 알림 대신 화면에 알려 드려요. 앱을 닫아 두면 15분마다 확인해요.</p>
    <div class="check-btns">
      <button class="btn small" data-n="test">🔔 시험 알림</button>
      <button class="btn small" data-n="check">🔄 지금 새 글 확인</button>
      <button class="btn small" data-n="settings">⚙️ 알림 설정</button>
      <button class="btn small" data-n="battery">🔋 배터리 제한 풀기</button>
    </div>`;
  box.querySelector('[data-n=test]').onclick = () => notify.testNotify();
  box.querySelector('[data-n=check]').onclick = () => {
    reportSeen();
    notify.checkNow();
    toast('확인 중이에요… 잠시 뒤 결과가 보여요');
    setTimeout(renderNotifyCheck, 6000);
  };
  box.querySelector('[data-n=settings]').onclick = () => notify.openNotifySettings();
  box.querySelector('[data-n=battery]').onclick = () => notify.askBattery();
}
document.addEventListener('visibilitychange', () => !document.hidden && currentView === 'search' && setTimeout(renderNotifyCheck, 300));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) reportSeen();
  else takeOpen();
});

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
  if (typeof setupNotify === 'function') setupNotify();
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
  watchNewForNotify();
  openPending();
  if (!document.hidden) reportSeen();
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
  setupNotify();
  if (!started) {
    started = true;
    showView(location.hash.slice(1) || 'home', { push: false });
    takeShared();
    takeOpen();
    restoreDrafts();
    migrateLocal();
    if (!readRole()) setTimeout(askRole, 300);
  } else refresh();
});

if (!native && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
