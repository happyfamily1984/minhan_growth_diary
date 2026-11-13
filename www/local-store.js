// 기기 안(IndexedDB)에 기록을 저장한다. 서버가 필요 없다.
const DB_NAME = 'minhan-diary';
const STORE = 'entries';

let dbp;
function open() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  });
}

let cache = null;
async function all() {
  cache ??= await tx('readonly', (s) => s.getAll());
  return cache;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const sortKey = (e) => `${e.date} ${e.time || '99:99'} ${e.createdAt}`;
const sorted = (list) => [...list].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

function normalize(e) {
  if (!DATE_RE.test(e.date || '')) throw new Error('날짜를 확인해 주세요');
  const text = String(e.text || '').trim();
  if (!text) throw new Error('내용을 입력해 주세요');
  const now = new Date().toISOString();
  return {
    id: e.id || crypto.randomUUID(),
    kind: e.kind === 'did' ? 'did' : 'say', // say: 한 말, did: 한 일
    date: e.date,
    time: String(e.time || ''),
    text,
    note: String(e.note || '').trim(),
    source: e.source || 'manual',
    meta: e.meta || null,
    createdAt: e.createdAt || now,
    updatedAt: now,
  };
}

export const store = {
  async list({ date, md, q } = {}) {
    let list = await all();
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
    for (const e of await all()) c[e.date] = (c[e.date] || 0) + 1;
    return c;
  },
  async total() {
    return (await all()).length;
  },
  /** 여러 개를 한 번에 저장 (같은 id 는 덮어씀) */
  async put(items) {
    const list = items.map(normalize);
    await all();
    await tx('readwrite', (s) => list.forEach((e) => s.put(e)));
    const ids = new Set(list.map((e) => e.id));
    cache = [...cache.filter((e) => !ids.has(e.id)), ...list];
    return list;
  },
  async update(id, patch) {
    const cur = (await all()).find((e) => e.id === id);
    if (!cur) throw new Error('기록을 찾을 수 없어요');
    return (await store.put([{ ...cur, ...patch, id }]))[0];
  },
  async remove(id) {
    await all();
    await tx('readwrite', (s) => s.delete(id));
    cache = cache.filter((e) => e.id !== id);
  },
  async exportJson() {
    return JSON.stringify({ app: 'minhan-growth-diary', version: 2, entries: sorted(await all()) }, null, 2);
  },
  /** 백업 파일 복원. 이미 있는 기록(같은 id)은 백업 내용으로 바뀐다 */
  async importJson(text) {
    const data = JSON.parse(text);
    const entries = Array.isArray(data) ? data : data.entries;
    if (!Array.isArray(entries)) throw new Error('백업 파일이 아니에요');
    const ok = entries.filter((e) => DATE_RE.test(e?.date || '') && String(e?.text || '').trim());
    await store.put(ok.map((e) => ({ ...e, updatedAt: undefined })));
    return ok.length;
  },
};

// 브라우저가 저장 공간을 마음대로 비우지 않도록 요청
navigator.storage?.persist?.().catch(() => {});
