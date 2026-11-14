// 글자 읽기(OCR) 도구와 한글/영어 사전을 앱 안에 넣는다 (인터넷 없이도 동작)
import fs from 'node:fs';
import path from 'node:path';
import { buildSync } from 'esbuild';
import { gunzipSync } from 'node:zlib';

const out = path.resolve('www/vendor');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'core'), { recursive: true });
fs.mkdirSync(path.join(out, 'lang'), { recursive: true });

const cp = (from, to) => fs.copyFileSync(path.resolve('node_modules', from), path.join(out, to));
cp('tesseract.js/dist/tesseract.min.js', 'tesseract.min.js');
cp('tesseract.js/dist/worker.min.js', 'worker.min.js');
for (const f of fs.readdirSync('node_modules/tesseract.js-core')) {
  if (/^tesseract-core.*\.wasm\.js$/.test(f) && f.includes('lstm')) cp(`tesseract.js-core/${f}`, `core/${f}`);
}
// 사전은 압축을 풀어서 넣는다: 안드로이드 APK 를 만들 때 '.gz' 파일 이름이 바뀌어 버려서 앱에서 못 찾기 때문
for (const lang of ['kor', 'eng']) {
  const gz = fs.readFileSync(path.resolve('node_modules', `@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`));
  fs.writeFileSync(path.join(out, 'lang', `${lang}.traineddata`), gunzipSync(gz));
}
// 글꼴: 제목은 주아체, 본문은 고운돋움 (한글은 필요한 글자 조각만 그때그때 불러옴)
for (const font of ['jua', 'gowun-dodum']) {
  const from = path.resolve('node_modules/@fontsource', font);
  const to = path.join(out, 'fonts', font);
  fs.mkdirSync(path.join(to, 'files'), { recursive: true });
  fs.copyFileSync(path.join(from, 'index.css'), path.join(to, 'index.css'));
  for (const f of fs.readdirSync(path.join(from, 'files'))) {
    if (f.endsWith('.woff2')) fs.copyFileSync(path.join(from, 'files', f), path.join(to, 'files', f));
  }
}
buildSync({ entryPoints: ['src/firebase.js'], bundle: true, format: 'esm', minify: true, outfile: path.join(out, 'firebase.js'), logLevel: 'warning' });
buildSync({ entryPoints: ['src/anthropic.js'], bundle: true, format: 'esm', minify: true, platform: 'browser', outfile: path.join(out, 'anthropic.js'), logLevel: 'warning' });
console.log('vendor 준비 완료:', out);
