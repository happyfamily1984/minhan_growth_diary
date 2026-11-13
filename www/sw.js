// 인터넷이 없어도 열리도록 앱 파일을 저장해 둔다 (웹으로 쓸 때만)
const CACHE = 'minhan-v4';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'store.js', 'parse.js', 'shared.js', 'ocr-prep.js', 'photo.js', 'local-store.js', 'firebase-config.js', 'vendor/firebase.js', 'icon.svg', 'manifest.webmanifest'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))));
self.addEventListener('activate', (e) =>
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))),
);
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && new URL(e.request.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))),
  );
});
