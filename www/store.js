// 클라우드(Firebase) 저장소. 폰에도 복사본을 두어서 인터넷이 없어도 쓰고,
// 연결되면 자동으로 올라가고, 다른 폰(아내/남편)에서 쓴 것도 바로 내려온다.
import {
  initializeApp,
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  connectAuthEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  connectFirestoreEmulator,
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  onSnapshot,
} from './vendor/firebase.js';
import { firebaseConfig, FAMILY_ID, FAMILY_EMAIL, toFirebasePassword } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }) });

// 테스트용: 주소에 ?emu=1 을 붙이면 컴퓨터의 Firebase 에뮬레이터에 연결
if (new URLSearchParams(location.search).has('emu')) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(fs, '127.0.0.1', 8080);
}

const base = `families/${FAMILY_ID}`;
const entriesCol = collection(fs, `${base}/entries`);
const photosCol = collection(fs, `${base}/photos`);
const peopleCol = collection(fs, `${base}/people`); // 사주보기에 추가한 가족
const analysesCol = collection(fs, `${base}/analyses`); // 월별 AI 분석 (문서 이름 = YYYY-MM)
const aiSettingsDoc = doc(fs, `${base}/settings/ai`); // AI 키 (가족 계정만 읽을 수 있음)
const photoDataDoc = (id) => doc(fs, `${base}/photoData/${id}`);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
let currentAuthor = ''; // 이 폰에서 쓰는 사람 (아빠/엄마/직접 쓴 이름)
const sortKey = (e) => `${e.date} ${e.time || '99:99'} ${e.createdAt}`;
const sorted = (list) => [...list].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

let entries = new Map();
let photos = new Map();
let people = new Map();
let analyses = new Map();
let analysesReady = false;
let aiSettings = {};
let ready = { entries: false, photos: false };
const listeners = new Set();
let syncState = { offline: false, pending: false };
const emit = () => listeners.forEach((fn) => fn());

let unsubs = [];
function startListening(onReady) {
  const done = () => ready.entries && ready.photos && onReady?.();
  const track = (snap) => {
    syncState = { offline: snap.metadata.fromCache, pending: snap.metadata.hasPendingWrites };
  };
  unsubs.push(
    onSnapshot(entriesCol, { includeMetadataChanges: true }, (snap) => {
      entries = new Map(snap.docs.map((d) => [d.id, d.data()]));
      track(snap);
      ready.entries = true;
      done();
      emit();
    }, (err) => console.error('entries', err)),
    onSnapshot(photosCol, { includeMetadataChanges: true }, (snap) => {
      photos = new Map(snap.docs.map((d) => [d.id, d.data()]));
      track(snap);
      ready.photos = true;
      done();
      emit();
    }, (err) => console.error('photos', err)),
    onSnapshot(peopleCol, (snap) => {
      people = new Map(snap.docs.map((d) => [d.id, d.data()]));
      emit();
    }, (err) => console.error('people', err)),
    onSnapshot(analysesCol, (snap) => {
      analyses = new Map(snap.docs.map((d) => [d.id, d.data()]));
      analysesReady = true;
      emit();
    }, (err) => console.error('analyses', err)),
    onSnapshot(aiSettingsDoc, (snap) => {
      aiSettings = snap.exists() ? snap.data() : {};
      emit();
    }, (err) => console.error('ai settings', err)),
  );
}

// 오프라인이면 서버 응답을 기다리지 않는다 (폰에 먼저 저장되고 나중에 올라감)
const write = (p) => p.catch((err) => console.error('저장 실패', err));

function normalize(e) {
  if (!DATE_RE.test(e.date || '')) throw new Error('날짜를 확인해 주세요');
  const text = String(e.text || '').trim();
  if (!text) throw new Error('내용을 입력해 주세요');
  const now = new Date().toISOString();
  return {
    id: e.id || crypto.randomUUID(),
    kind: ['did', 'funny'].includes(e.kind) ? e.kind : 'say', // say 한 말 · funny 웃긴 말 · did 한 일
    date: e.date,
    time: String(e.time || ''),
    text,
    note: String(e.note || '').trim(),
    source: e.source || 'manual',
    author: e.author ?? currentAuthor, // 처음 쓴 사람 (고쳐도 그대로)
    createdAt: e.createdAt || now,
    updatedAt: now,
  };
}

export const auth$ = {
  /** 로그인 상태가 정해지면 cb(true|false) */
  watch(cb) {
    return onAuthStateChanged(auth, (user) => {
      unsubs.forEach((u) => u());
      unsubs = [];
      ready = { entries: false, photos: false };
      analysesReady = false;
      if (user) startListening(() => cb(true));
      else cb(false);
    });
  },
  async login(pin) {
    try {
      await signInWithEmailAndPassword(auth, FAMILY_EMAIL, toFirebasePassword(pin));
    } catch (e) {
      const code = e.code || '';
      if (/wrong-password|invalid-credential|user-not-found|invalid-login/.test(code)) throw new Error('비밀번호가 틀렸어요');
      if (/too-many-requests/.test(code)) throw new Error('너무 여러 번 틀렸어요. 잠시 뒤에 다시 해 주세요');
      if (/network/.test(code)) throw new Error('인터넷 연결을 확인해 주세요 (처음 한 번은 인터넷이 필요해요)');
      throw new Error('로그인하지 못했어요: ' + code);
    }
  },
  logout: () => signOut(auth),
  /** 폰 알림(15분마다 새 글 확인)이 로그인할 때 쓰는 토큰 */
  refreshToken: () => auth.currentUser?.refreshToken || '',
};

export const store = {
  setAuthor(name) {
    currentAuthor = String(name || '').trim();
  },
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  sync: () => syncState,

  // ---- 기록 ----
  async list({ date, md, q } = {}) {
    let list = [...entries.values()];
    if (date) list = list.filter((e) => e.date === date);
    if (md) list = list.filter((e) => e.date.slice(5) === md);
    if (q) {
      q = q.toLowerCase();
      list = list.filter((e) => `${e.text} ${e.note}`.toLowerCase().includes(q));
    }
    return sorted(list);
  },
  async counts() {
    const c = {};
    for (const e of entries.values()) c[e.date] = (c[e.date] || 0) + 1;
    return c;
  },
  all: () => [...entries.values()],
  ready: () => ready.entries,
  async total() {
    return entries.size;
  },
  async put(items) {
    const list = items.map(normalize);
    for (const e of list) {
      entries.set(e.id, e);
      write(setDoc(doc(entriesCol, e.id), e));
    }
    emit();
    return list;
  },
  async update(id, patch) {
    const cur = entries.get(id);
    if (!cur) throw new Error('기록을 찾을 수 없어요');
    return (await store.put([{ ...cur, ...patch, id }]))[0];
  },
  async remove(id) {
    entries.delete(id);
    write(deleteDoc(doc(entriesCol, id)));
    emit();
  },

  // ---- 사주보기에 추가한 가족 ----
  people: () => [...people.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  async savePerson(p) {
    if (!String(p.name || '').trim()) throw new Error('이름을 써 주세요');
    if (!DATE_RE.test(p.date || '')) throw new Error('생년월일을 골라 주세요');
    const now = new Date().toISOString();
    const v = {
      id: p.id || crypto.randomUUID(),
      name: String(p.name).trim(),
      date: p.date,
      time: /^\d{2}:\d{2}$/.test(p.time || '') ? p.time : '',
      createdAt: p.createdAt || now,
      updatedAt: now,
    };
    people.set(v.id, v);
    write(setDoc(doc(peopleCol, v.id), v));
    emit();
    return v;
  },
  async removePerson(id) {
    people.delete(id);
    write(deleteDoc(doc(peopleCol, id)));
    emit();
  },

  // ---- 월별 AI 분석 ----
  analyses: () => [...analyses.values()].sort((a, b) => b.month.localeCompare(a.month)),
  analysesReady: () => analysesReady,
  analysis: (month) => analyses.get(month) || null,
  /** 그 달 분석 문서에 덮어쓰기 (없던 칸만 바뀜) */
  saveAnalysis(month, patch) {
    const next = { ...(analyses.get(month) || {}), ...patch, month, updatedAt: new Date().toISOString() };
    analyses.set(month, next);
    emit();
    return write(setDoc(doc(analysesCol, month), next));
  },
  aiKey: () => aiSettings.apiKey || '',
  setAiKey(key) {
    aiSettings = { ...aiSettings, apiKey: String(key || '').trim(), updatedAt: new Date().toISOString() };
    emit();
    return write(setDoc(aiSettingsDoc, aiSettings));
  },

  // ---- 사진 (기록과 따로) ----
  /** standalone: 글에 붙지 않은 사진만, entryId: 그 글에 붙은 사진만 */
  photos({ date, standalone, entryId } = {}) {
    let list = [...photos.values()];
    if (date) list = list.filter((p) => p.date === date);
    if (standalone) list = list.filter((p) => !p.entryId);
    if (entryId) list = list.filter((p) => p.entryId === entryId);
    return list.sort((a, b) => `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`));
  },
  photoDates() {
    const c = {};
    for (const p of photos.values()) if (!p.entryId) c[p.date] = (c[p.date] || 0) + 1;
    return c;
  },
  /** { date, caption, thumb, data, width, height } — thumb/data 는 JPEG data URL */
  async addPhoto(p) {
    if (!DATE_RE.test(p.date || '')) throw new Error('날짜를 확인해 주세요');
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const meta = {
      id,
      date: p.date,
      caption: String(p.caption || '').trim(),
      thumb: p.thumb,
      width: p.width,
      height: p.height,
      author: p.author ?? currentAuthor,
      entryId: p.entryId || null, // 글에 붙은 사진이면 그 글
      createdAt: now,
      updatedAt: now,
    };
    photos.set(id, meta);
    write(setDoc(photoDataDoc(id), { data: p.data }));
    write(setDoc(doc(photosCol, id), meta));
    emit();
    return meta;
  },
  async updatePhoto(id, patch) {
    const cur = photos.get(id);
    if (!cur) throw new Error('사진을 찾을 수 없어요');
    const next = { ...cur, ...patch, caption: String(patch.caption ?? cur.caption).trim(), updatedAt: new Date().toISOString() };
    photos.set(id, next);
    write(setDoc(doc(photosCol, id), next));
    emit();
  },
  async removePhoto(id) {
    photos.delete(id);
    write(deleteDoc(doc(photosCol, id)));
    write(deleteDoc(photoDataDoc(id)));
    emit();
  },
  /** 큰 사진 (처음 볼 때 내려받고, 그 뒤로는 폰에 저장된 것을 씀) */
  async photoData(id) {
    const snap = await getDoc(photoDataDoc(id));
    return snap.exists() ? snap.data().data : null;
  },

  // ---- 백업 ----
  async exportJson() {
    return JSON.stringify({ app: 'minhan-growth-diary', version: 3, entries: sorted([...entries.values()]) }, null, 2);
  },
  async importJson(text) {
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : data.entries;
    if (!Array.isArray(list)) throw new Error('백업 파일이 아니에요');
    const ok = list.filter((e) => DATE_RE.test(e?.date || '') && String(e?.text || '').trim());
    await store.put(ok.map(({ updatedAt, meta, ...e }) => e));
    return ok.length;
  },
};
