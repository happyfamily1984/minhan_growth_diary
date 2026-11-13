// 글자 읽기(OCR) 도구와 한글/영어 사전을 앱 안에 넣는다 (인터넷 없이도 동작)
import fs from 'node:fs';
import path from 'node:path';

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
for (const lang of ['kor']) cp(`@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`, `lang/${lang}.traineddata.gz`);
console.log('vendor 준비 완료:', out);
