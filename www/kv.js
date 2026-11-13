// 폰 안의 큰 임시저장 칸 (IndexedDB). 사진처럼 큰 것도 넣을 수 있다.
let dbp;
function open() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('minhan-drafts', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction('kv', mode);
    const req = fn(t.objectStore('kv'));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}
export const kv = {
  get: (k) => run('readonly', (s) => s.get(k)).catch(() => null),
  set: (k, v) => run('readwrite', (s) => s.put(v, k)).catch((e) => console.error('kv', e)),
  del: (k) => run('readwrite', (s) => s.delete(k)).catch(() => {}),
};
