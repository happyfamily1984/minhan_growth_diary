// 붙여넣은 글 / 캡쳐에서 읽은 글을 날짜별 기록 후보로 나눈다.
// 브라우저와 Node(테스트) 양쪽에서 쓴다.

const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const validDate = (y, m, d) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const fullYear = (y) => (y < 100 ? 2000 + y : y);

const WEEKDAY = String.raw`(?:\s*[(（]?\s*[월화수목금토일](?:요일)?\s*[)）]?)?`;
const KO_DATE = new RegExp(String.raw`^(?:(\d{2,4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일${WEEKDAY}$`);
const NUM_DATE = new RegExp(String.raw`^(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})\s*\.?${WEEKDAY}$`);

/** 연도가 없는 날짜는 '오늘 이전의 가장 가까운 해'로 본다 */
function withYear(y, m, d, today) {
  if (y) return validDate(y, m, d) ? ymd(y, m, d) : null;
  let year = Number(today.slice(0, 4));
  if (!validDate(year, m, d) && !validDate(year - 1, m, d)) return null;
  let s = ymd(year, m, d);
  if (s > today) s = ymd(year - 1, m, d);
  return s;
}

/** 줄 전체가 날짜 구분선인지 ("11월 13일", "2026년 11월 13일 금요일", "2026.11.13", "오늘", "어제") */
export function parseDateLine(line, today) {
  const s = line.trim().replace(/^[-—=·•\s]+|[-—=·•\s]+$/g, '');
  if (s === '오늘' || /^today$/i.test(s)) return today;
  if (s === '어제' || /^yesterday$/i.test(s)) return addDays(today, -1);
  let m = s.match(KO_DATE);
  if (m) return withYear(m[1] ? fullYear(Number(m[1])) : 0, Number(m[2]), Number(m[3]), today);
  m = s.match(NUM_DATE);
  if (m) return withYear(Number(m[1]), Number(m[2]), Number(m[3]), today);
  return null;
}

function to24(h, m, ampm) {
  h = Number(h);
  if (/오후|pm/i.test(ampm || '') && h < 12) h += 12;
  if (/오전|am/i.test(ampm || '') && h === 12) h = 0;
  return h < 24 && Number(m) < 60 ? `${pad(h)}:${pad(m)}` : '';
}

/** "[13.11.2026 18:20]" "2026-11-13 18:20:05" "2026. 11. 13. 오후 6:20" 같은 날짜+시간 */
export function parseDateTime(str, today) {
  const s = str.trim();
  let date = null;
  let m = s.match(/(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/); // 년.월.일
  if (m) date = withYear(Number(m[1]), Number(m[2]), Number(m[3]), today);
  else if ((m = s.match(/(\d{1,2})\s*[./]\s*(\d{1,2})\s*[./]\s*(\d{2,4})/))) {
    // 일.월.년 (텔레그램 기본) — 단, 'AM/PM' 이 붙은 미국식은 월/일/년
    let [a, b, y] = [Number(m[1]), Number(m[2]), fullYear(Number(m[3]))];
    const us = /[AP]M/i.test(s) && s.includes('/');
    date = us ? withYear(y, a, b, today) : withYear(y, b, a, today);
  } else if ((m = s.match(/(?:(\d{2,4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/))) {
    date = withYear(m[1] ? fullYear(Number(m[1])) : 0, Number(m[2]), Number(m[3]), today);
  }
  const t = s.match(/(오전|오후)?\s*(\d{1,2})\s*:\s*(\d{2})(?::\d{2})?\s*([AaPp][Mm])?/);
  const time = t ? to24(t[2], t[3], t[1] || t[4]) : '';
  return { date, time };
}

const QUOTES = /^["'“”‘’「『]+|["'“”‘’」』]+$/g;
// 텔레그램이 붙이는 부호/표시: 읽음 표시, (편집됨), 앞의 >, » 같은 것
const MARKS = /[✓✔√☑]+|\((?:편집됨|수정됨|edited)\)|\b(?:edited)\b/gi;
const cleanText = (s) =>
  s
    .replace(MARKS, ' ')
    .replace(/^[\s>»›•·\-–—|]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(QUOTES, '')
    .trim();

// 내용이 아닌 줄 (전달/답장 표시, 사진·스티커 자리표시 등)
const NOISE = [
  /^(?:forwarded from|전달(?:된 메시지|됨)?|.{1,40}(?:님)?(?:으로|에게)부터 전달됨?)\b/i,
  /^(?:in reply to|답장|회신)\b/i,
  /^\[?\s*(?:사진|동영상|스티커|파일|음성 메시지|GIF|photo|video|sticker|file|voice message)\s*\]?$/i,
  /^(?:오전|오후)?\s*\d{1,2}\s*:\s*\d{2}\s*(?:[AaPp][Mm])?\s*[✓✔√]*$/, // 시간만 있는 줄
  /^[\s✓✔√☑·•\-–—_=*~]+$/, // 부호만 있는 줄
];
const isNoise = (line) => NOISE.some((re) => re.test(line));

// 텔레그램 PC에서 여러 메시지를 복사했을 때: "엄마, [13.11.2026 18:20]"
const HEADER_COMMA = /^(.{1,40}?),?\s*\[([^\]]*\d{1,2}\s*:\s*\d{2}[^\]]*)\]\s*:?\s*$/;
// 휴대폰에서 복사: "[13.11.26 18:20] 엄마: 내용"  /  "[오후 6:20] 엄마 : 내용"
const HEADER_BRACKET = /^\[([^\]]+)\]\s*([^:：]{1,40}?)\s*[:：]\s*(.*)$/;
// 카카오톡 형식: "[엄마] [오후 6:20] 내용"
const HEADER_KAKAO = /^\[([^\]]{1,40})\]\s*\[([^\]]+)\]\s*(.*)$/;
// 줄 끝 시간 "… 18:20" / "… 오후 6:20" 은 떼어낸다
const TIME_TAIL = /\s+(?:(오전|오후)\s*)?(\d{1,2})\s*:\s*(\d{2})\s*([AaPp][Mm])?\s*[✓✔√]*\s*$/;

/**
 * 붙여넣은 글을 기록 후보로 나눈다.
 * @returns {{text:string,date:string|null,time:string,from:string}[]}
 *   date 가 null 이면 날짜를 찾지 못한 것 (화면에서 기본 날짜를 쓴다)
 */
export function parseText(raw, today) {
  const lines = String(raw || '').replace(/\r/g, '').split('\n');
  const hasHeaders = lines.some((l) => HEADER_COMMA.test(l.trim()) || HEADER_BRACKET.test(l.trim()) || HEADER_KAKAO.test(l.trim()));
  const items = [];
  let date = null;
  let cur = null;

  const flush = () => {
    if (cur) {
      cur.text = cleanText(cur.text);
      if (cur.text) items.push(cur);
    }
    cur = null;
  };
  const begin = (text, { from = '', time = '', d = date } = {}) => {
    flush();
    cur = { text, date: d, time, from };
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (!hasHeaders) flush();
      continue;
    }
    if (isNoise(line)) continue;
    const dl = parseDateLine(line, today);
    if (dl) {
      flush();
      date = dl;
      continue;
    }
    let m;
    if ((m = line.match(HEADER_COMMA))) {
      const dt = parseDateTime(m[2], today);
      if (dt.date) date = dt.date;
      begin('', { from: m[1].trim(), time: dt.time });
      continue;
    }
    if ((m = line.match(HEADER_KAKAO)) || (m = line.match(HEADER_BRACKET))) {
      const kakao = HEADER_KAKAO.test(line);
      const [stamp, from] = kakao ? [m[2], m[1]] : [m[1], m[2]];
      const dt = parseDateTime(stamp, today);
      if (dt.date) date = dt.date;
      begin(m[3], { from: from.trim(), time: dt.time });
      continue;
    }
    // 머리말 없는 글: 한 줄 = 한 기록
    let text = line;
    let time = '';
    const tm = text.match(TIME_TAIL);
    if (tm) {
      time = to24(tm[2], tm[3], tm[1] || tm[4]);
      text = text.replace(TIME_TAIL, '');
    }
    if (hasHeaders && cur) cur.text += (cur.text ? '\n' : '') + text;
    else begin(text, { time });
    if (!hasHeaders) flush();
  }
  flush();
  return items.map((it) => ({ ...it, text: it.text }));
}

const OCR_TICKS = /\s+(?:[vV]{1,2}|ㄴ~?|[✓✔√]+)\s*$/;
const OCR_TIME_TAIL = /\s+(?:오전|오후)\s*[\d:;.,\s]{1,6}\S{0,3}$/;

/**
 * OCR 결과 줄(글자 + 위치)을 말풍선 단위로 묶는다.
 * @param lines  [{text, bbox:{x0,x1,y0,y1}, confidence}]
 * @param width  사진 가로 크기
 */
export function linesToBubbles(lines, width, today) {
  const bubbles = [];
  let date = null;
  let prev = null;
  for (const line of lines) {
    let text = String(line.text || '').replace(/\s+/g, ' ').trim();
    if (!text || (line.confidence ?? 100) < 30 || /^[\s✓✔√☑·•\-–—_=*~|]+$/.test(text)) continue;
    const { x0, x1, y0, y1 } = line.bbox;
    const center = (x0 + x1) / 2;
    const centered = Math.abs(center - width / 2) < width * 0.15;
    const dl = centered && text.length < 24 ? parseDateLine(text, today) : null;
    if (dl) {
      date = dl;
      prev = null;
      continue;
    }
    let time = '';
    text = text.replace(OCR_TICKS, '');
    const tm = text.match(TIME_TAIL) || text.match(/^(?:(오전|오후)\s*)?(\d{1,2})\s*:\s*(\d{2})\s*([AaPp][Mm])?\s*[✓✔√]*$/);
    if (tm) {
      time = to24(tm[2], tm[3], tm[1] || tm[4]);
      text = text.replace(TIME_TAIL, '').replace(/^(?:(오전|오후)\s*)?\d{1,2}\s*:\s*\d{2}.*$/, '').trim();
    }
    // 잘못 읽힌 시간 꼬리 ("오후 13", "오후 0:20") 도 뗀다
    text = text.replace(OCR_TIME_TAIL, '').replace(/^(?:오전|오후)\s*[\d:;.,\s]{0,6}$/, '').trim();
    if (!text) {
      if (prev && time) prev.time = time;
      continue;
    }
    const side = center < width * 0.5 ? 'left' : 'right';
    const h = y1 - y0;
    if (prev && prev.side === side && !prev.time && y0 - prev.y1 < h * 0.9) {
      prev.text += ' ' + text;
      prev.y1 = y1;
      prev.time = time;
    } else {
      prev = { text, side, date, time, y1 };
      bubbles.push(prev);
    }
  }
  return bubbles.map(({ y1, ...b }) => ({ ...b, text: cleanText(b.text), from: '' })).filter((b) => b.text);
}
