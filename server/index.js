import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { load, save, db, addEntry, isDate } from './db.js';
import { startTelegram, telegramStatus, telegramEnabled, downloadFile } from './telegram.js';

const PORT = Number(process.env.PORT || 3000);
const PASSWORD = process.env.APP_PASSWORD || '';
const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const SESSION = PASSWORD ? crypto.createHash('sha256').update('minhan:' + PASSWORD).digest('hex') : '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

load();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 20 * 1024 * 1024) throw new HttpError(413, '요청이 너무 큽니다');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON 형식이 올바르지 않습니다');
  }
}

const cookies = (req) =>
  Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=').map(decodeURIComponent)));

const authed = (req) => !PASSWORD || cookies(req).sid === SESSION;

const sortEntries = (list) =>
  list.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || '') || a.createdAt.localeCompare(b.createdAt));

function findEntry(id) {
  const e = db().entries.find((x) => x.id === id);
  if (!e) throw new HttpError(404, '기록을 찾을 수 없습니다');
  return e;
}

async function api(req, res, url) {
  const { pathname: p, searchParams: q } = url;
  const m = req.method;

  if (p === '/api/login' && m === 'POST') {
    const { password } = await readJson(req);
    if (PASSWORD && password !== PASSWORD) throw new HttpError(401, '비밀번호가 틀렸어요');
    res.setHeader('set-cookie', `sid=${SESSION}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}`);
    return send(res, 200, { ok: true });
  }
  if (!authed(req)) throw new HttpError(401, '로그인이 필요해요');

  if (p === '/api/me') return send(res, 200, { ok: true, passwordProtected: Boolean(PASSWORD) });

  // ---- 기록 ----
  if (p === '/api/entries' && m === 'GET') {
    let list = db().entries;
    const date = q.get('date');
    const month = q.get('month');
    const query = (q.get('q') || '').trim().toLowerCase();
    if (date) list = list.filter((e) => e.date === date);
    if (month) list = list.filter((e) => e.date.startsWith(month));
    if (q.get('md')) list = list.filter((e) => e.date.slice(5) === q.get('md')); // 'N년 전 오늘'
    if (query) list = list.filter((e) => (e.text + ' ' + e.note).toLowerCase().includes(query));
    return send(res, 200, sortEntries([...list]));
  }
  if (p === '/api/entries/summary' && m === 'GET') {
    // 달력 표시용: 날짜별 개수
    const counts = {};
    for (const e of db().entries) counts[e.date] = (counts[e.date] || 0) + 1;
    return send(res, 200, { total: db().entries.length, counts });
  }
  if (p === '/api/entries' && m === 'POST') {
    const body = await readJson(req);
    const items = Array.isArray(body.items) ? body.items : [body];
    const created = [];
    try {
      for (const it of items) created.push(addEntry({ ...it, source: it.source || 'manual' }));
    } catch (e) {
      // 일부만 저장되는 일을 막는다
      const ids = new Set(created.map((c) => c.id));
      db().entries = db().entries.filter((x) => !ids.has(x.id));
      throw new HttpError(400, e.message);
    }
    if (Array.isArray(body.inboxIds)) {
      const done = new Set(body.inboxIds);
      db().inbox = db().inbox.filter((x) => !done.has(x.id));
    }
    save();
    return send(res, 201, Array.isArray(body.items) ? created : created[0]);
  }
  let mm = p.match(/^\/api\/entries\/([\w-]+)$/);
  if (mm && m === 'PUT') {
    const e = findEntry(mm[1]);
    const body = await readJson(req);
    if (body.date !== undefined) {
      if (!isDate(body.date)) throw new HttpError(400, '날짜 형식이 올바르지 않습니다');
      e.date = body.date;
    }
    if (body.text !== undefined) {
      if (!String(body.text).trim()) throw new HttpError(400, '내용이 비어 있어요');
      e.text = String(body.text).trim();
    }
    if (body.note !== undefined) e.note = String(body.note).trim();
    if (body.time !== undefined) e.time = String(body.time);
    e.updatedAt = new Date().toISOString();
    save();
    return send(res, 200, e);
  }
  if (mm && m === 'DELETE') {
    findEntry(mm[1]);
    db().entries = db().entries.filter((x) => x.id !== mm[1]);
    save();
    return send(res, 200, { ok: true });
  }

  // ---- 텔레그램 ----
  if (p === '/api/telegram/status') return send(res, 200, telegramStatus());
  if (p === '/api/inbox' && m === 'GET') return send(res, 200, [...db().inbox].reverse());
  if (p === '/api/inbox' && m === 'DELETE') {
    const { ids } = await readJson(req);
    const del = new Set(ids || []);
    db().inbox = db().inbox.filter((x) => !del.has(x.id));
    save();
    return send(res, 200, { ok: true });
  }
  mm = p.match(/^\/api\/inbox\/([\w-]+)\/image$/);
  if (mm && m === 'GET') {
    if (!telegramEnabled()) throw new HttpError(400, '텔레그램 봇이 꺼져 있어요');
    const item = db().inbox.find((x) => x.id === mm[1]);
    if (!item?.fileId) throw new HttpError(404, '사진이 없어요');
    const { buffer, type } = await downloadFile(item.fileId);
    res.writeHead(200, { 'content-type': type || 'image/jpeg', 'cache-control': 'private, max-age=86400' });
    return res.end(buffer);
  }

  // ---- 백업 ----
  if (p === '/api/backup' && m === 'GET') {
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="minhan-diary-${new Date().toISOString().slice(0, 10)}.json"`,
    });
    return res.end(JSON.stringify({ entries: db().entries }, null, 2));
  }

  throw new HttpError(404, '없는 주소입니다');
}

function serveStatic(req, res, url) {
  let file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC_DIR, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else serveStatic(req, res, url);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.message || '서버 오류' });
  }
});

server.listen(PORT, () => {
  console.log(`민한이 성장일기: http://localhost:${PORT}`);
  if (!PASSWORD) console.log('⚠️  APP_PASSWORD 가 없어 누구나 접속할 수 있어요. 인터넷에 공개한다면 꼭 설정하세요.');
});

startTelegram();

const shutdown = () => {
  save();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
