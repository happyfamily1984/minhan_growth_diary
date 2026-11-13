// 컴퓨터에서 미리 보기용 정적 서버: npm run serve
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('www');
const port = Number(process.env.PORT || 5173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.gz': 'application/gzip' };
http
  .createServer((req, res) => {
    let file = path.normalize(path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    if (!file.startsWith(root)) return res.writeHead(403).end();
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, () => console.log(`http://localhost:${port}`));
