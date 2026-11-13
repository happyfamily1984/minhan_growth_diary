// 아주 단순한 JSON 파일 저장소. 가족용 앱이라 이 정도로 충분하다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const empty = () => ({ entries: [], inbox: [], telegram: { offset: 0 } });

let state = empty();

export function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    state = { ...empty(), ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
  } else {
    save();
  }
}

let saveTimer = null;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

export const db = () => state;
export const newId = () => crypto.randomUUID();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = (s) => typeof s === 'string' && DATE_RE.test(s);

export function addEntry({ date, text, note = '', time = '', source = 'manual', meta = null }) {
  if (!isDate(date)) throw new Error('date 형식은 YYYY-MM-DD 입니다');
  text = String(text || '').trim();
  if (!text) throw new Error('민한이가 한 말을 입력해 주세요');
  const now = new Date().toISOString();
  const entry = {
    id: newId(),
    date,
    time: String(time || ''),
    text,
    note: String(note || '').trim(),
    source,
    meta,
    createdAt: now,
    updatedAt: now,
  };
  state.entries.push(entry);
  return entry;
}
