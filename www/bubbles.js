// 텔레그램 캡쳐에서 '말풍선'을 찾아, 말풍선 하나를 기록 하나로 만든다.
// - 말풍선: 흰색(또는 아주 연한 초록) 둥근 네모. 배경 무늬·날짜 표시·입력칸과 구별한다.
// - 내용: 말풍선 안의 '검은 글씨'만. 보낸 사람 이름·"전달됨"(색 글씨), 조회수·시간(회색 글씨)은 뺀다.
import { parseDateLine } from './parse.js';

const lum = (r, g, b) => (r * 299 + g * 587 + b * 114) / 1000;

/** 말풍선 바탕색인지 (흰색 또는 내 메시지의 연한 초록) */
function isBubblePixel(r, g, b) {
  const l = lum(r, g, b);
  const sat = Math.max(r, g, b) - Math.min(r, g, b);
  return l > 236 && sat < 62;
}

/**
 * 말풍선 네모들을 찾는다.
 * @param {ImageData} img 원래 색 그대로의 그림
 * @returns {{x0:number,y0:number,x1:number,y1:number}[]}
 */
export function findBubbles(img) {
  const { data, width: W, height: H } = img;
  const rows = [];
  for (let y = 0; y < H; y++) {
    let count = 0;
    let left = W;
    let right = -1;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (isBubblePixel(data[i], data[i + 1], data[i + 2])) {
        count++;
        if (x < left) left = x;
        right = x;
      }
    }
    // 글자가 있는 줄도 바탕이 대부분이라 흰 점이 많다
    rows.push(count > W * 0.22 && right - left > W * 0.25 ? { left, right, count } : null);
  }
  const bands = [];
  let start = -1;
  for (let y = 0; y <= H; y++) {
    const on = y < H && rows[y];
    if (on && start < 0) start = y;
    if (!on && start >= 0) {
      if (y - start > H * 0.02) bands.push([start, y - 1]);
      start = -1;
    }
  }
  const out = [];
  const excluded = [];
  for (const [y0, y1] of bands) {
    const ls = [];
    const rs = [];
    for (let y = y0; y <= y1; y++) {
      ls.push(rows[y].left);
      rs.push(rows[y].right);
    }
    ls.sort((a, b) => a - b);
    rs.sort((a, b) => a - b);
    const x0 = ls[Math.floor(ls.length / 2)];
    const x1 = rs[Math.floor(rs.length / 2)];
    // 위쪽 제목줄, 아래쪽 입력칸은 말풍선이 아니다
    const tooTop = y0 < H * 0.075;
    const tooBottom = y0 > H * 0.9 && y1 - y0 < H * 0.06;
    if (!tooTop && !tooBottom) out.push({ x0, y0, x1, y1 });
    else excluded.push({ x0, y0, x1, y1 });
  }
  out.excluded = excluded; // 제목줄·잘린 말풍선 등 (날짜 표시 찾을 때 피함)
  return out;
}

/** 낱말 글씨 색: 'ink'(검정, 내용) | 'gray'(시간·조회수) | 'color'(이름·전달됨) | 'light'(흰 글씨) */
export function inkColor(img, bbox) {
  const { data, width: W, height: H } = img;
  const x0 = Math.max(0, Math.floor(bbox.x0));
  const x1 = Math.min(W - 1, Math.ceil(bbox.x1));
  const y0 = Math.max(0, Math.floor(bbox.y0));
  const y1 = Math.min(H - 1, Math.ceil(bbox.y1));
  const px = [];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = (y * W + x) * 4;
      px.push([data[i], data[i + 1], data[i + 2], lum(data[i], data[i + 1], data[i + 2])]);
    }
  if (!px.length) return 'light';
  px.sort((a, b) => a[3] - b[3]);
  // 가장 진한 15% 를 글씨로 본다
  const ink = px.slice(0, Math.max(1, Math.floor(px.length * 0.15)));
  const avg = [0, 1, 2, 3].map((k) => ink.reduce((s, p) => s + p[k], 0) / ink.length);
  const bg = px[Math.floor(px.length * 0.9)][3];
  const sat = Math.max(avg[0], avg[1], avg[2]) - Math.min(avg[0], avg[1], avg[2]);
  if (bg - avg[3] < 40) return 'light';
  if (sat > 55) return 'color';
  if (avg[3] > 105) return 'gray';
  return 'ink';
}

const SPACE_PX = 0.26; // 흑백 그림에서 빈 세로칸이 글자 높이의 이만큼보다 넓으면 띄어쓰기
const SPACE_GAP = 0.35; // 글자 높이에 비해 이만큼 이상 떨어져 있어야 띄어쓰기
const TIME_RE = /(?:(오전|오후)\s*)?(\d{1,2})\s*[:;.]\s*(\d{2})/;
const NOISE_WORD = /^(?:[<>@©®◎○●·•.,'"`~_\-=|\\/*]+|\d{1,4}|[vV]{1,2}|ㄴ~?|[✓✔√]+)$/;

/**
 * OCR 결과 + 원래 그림으로 말풍선별 기록을 만든다.
 * @param lines  tesseract 결과의 data.lines (각 줄에 words 가 있음)
 * @param img    OCR 에 쓴 것과 같은 크기의 원래 색 그림(ImageData)
 * @param bin    같은 크기의 흑백 그림(띄어쓰기 찾기용, 없어도 됨)
 * @returns {{text,date,time,side,from}[] | null}  말풍선을 못 찾으면 null
 */
export function bubblesFromOcr(lines, img, today, bin = null, opts = {}) {
  const rects = opts.rects || findBubbles(img);
  if (!rects.length) return null;
  // 말풍선마다 따로 읽은 줄이 있으면 그걸 쓴다 (화면 전체로 읽으면 빠뜨리는 말풍선이 있음)
  const textSource = opts.bubbleLines || lines;
  const W = img.width;
  const inside = (r, b) => {
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    return cx >= r.x0 - 4 && cx <= r.x1 + 4 && cy >= r.y0 - 4 && cy <= r.y1 + 4;
  };
  // 말풍선 밖의 가운데 줄에서 날짜 구분선("1월 6일")을 찾는다
  const dates = [];
  for (const line of lines) {
    if (rects.some((r) => inside(r, line.bbox))) continue;
    const text = String(line.text || '').replace(/\s+/g, ' ').trim();
    const cx = (line.bbox.x0 + line.bbox.x1) / 2;
    if (Math.abs(cx - W / 2) > W * 0.2 || text.length > 24) continue;
    const d = parseDateLine(text, today);
    if (d) dates.push({ y: line.bbox.y0, date: d, box: line.bbox });
  }
  // 따로 다시 읽은 날짜 표시 (말풍선·시간과 겹친 것)
  for (const d of opts.dates || []) dates.push(d);
  dates.sort((a, b) => a.y - b.y);
  const out = [];
  for (const r of rects) {
    const mine = textSource.filter((l) => inside(r, l.bbox)).sort((a, b) => a.bbox.y0 - b.bbox.y0);
    const textLines = [];
    let time = '';
    let prevBottom = null;
    let lineH = 0;
    for (const line of mine) {
      const words = (line.words?.length ? line.words : [{ text: line.text, bbox: line.bbox }]).filter((w) => String(w.text).trim());
      const kept = [];
      for (const w of words) {
        const c = inkColor(img, w.bbox);
        if (c === 'gray') {
          const t = String(w.text);
          const m = `${t}`.match(TIME_RE);
          if (m) {
            let h = Number(m[2]);
            const ampm = words.find((x) => /오전|오후/.test(x.text))?.text || m[1] || '';
            if (/오후/.test(ampm) && h < 12) h += 12;
            if (/오전/.test(ampm) && h === 12) h = 0;
            if (h < 24 && Number(m[3]) < 60) time = `${String(h).padStart(2, '0')}:${m[3]}`;
          }
          continue;
        }
        if (c !== 'ink') continue;
        if (NOISE_WORD.test(String(w.text).trim())) {
          // 숫자만 있는 낱말은 회색 조회수일 때가 많다. 글씨 줄 중간의 숫자는 남긴다.
          const isEdge = w === words[words.length - 1] || w === words[words.length - 2];
          if (isEdge && !/^\d+살|^\d+개/.test(w.text)) continue;
        }
        kept.push(w);
      }
      // 글씨 없이 부호만 남은 줄(프로필 사진이 '@' 로 읽힌 것 등)은 버린다
      if (!kept.length || kept.every((w) => !/[가-힣a-zA-Z0-9]/.test(w.text))) continue;
      // 한글은 글자 조각마다 낱말로 나오기도 해서, 실제로 띄어진 곳에만 띄어쓰기를 넣는다
      // 키워서 따로 읽은 말풍선은 글자 읽기 도구의 띄어쓰기가 정확해서 그대로 쓴다
      const joined = opts.trustSpaces
        ? joinBySpaces(kept, words, line.text)
        : bin
          ? spaceByPixels(kept, line.bbox, bin)
          : spaceByBoxes(kept, line.bbox);
      const h = line.bbox.y1 - line.bbox.y0;
      lineH = lineH ? (lineH + h) / 2 : h;
      if (prevBottom !== null && line.bbox.y0 - prevBottom > lineH * 0.9 && textLines.length) textLines.push('');
      textLines.push(joined);
      prevBottom = line.bbox.y1;
    }
    const text = textLines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\s*(?:[<>@©®◎]+\s*\d*\s*)+$/g, '')
      .trim();
    if (!text) continue;
    // 말풍선 위쪽에 겹쳐 걸린 날짜 표시도 그 말풍선 날짜로 본다
    const above = dates.filter((d) => d.y < r.y0 + Math.min(70, (r.y1 - r.y0) * 0.4)).pop();
    const cx = (r.x0 + r.x1) / 2;
    out.push({ text, date: above?.date || null, time, side: cx < W / 2 ? 'left' : 'right', from: '', rect: r, dateBox: above?.box || null });
  }
  return out;
}

/** 글자 상자 간격으로 띄어쓰기 (흑백 그림이 없을 때) */
function spaceByBoxes(kept, lb) {
  const lh = lb.y1 - lb.y0 || 1;
  const gaps = kept.slice(1).map((w, i) => (w.bbox.x0 - kept[i].bbox.x1) / lh);
  const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 0;
  const thr = Math.max(SPACE_GAP, median + 0.25);
  let out = String(kept[0].text).trim();
  gaps.forEach((g, i) => (out += (g > thr ? ' ' : '') + String(kept[i + 1].text).trim()));
  return out;
}

// 글자 하나가 차지하는 대략의 너비 (한글을 1 로)
const charWidth = (c) => (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(c) ? 1 : /[A-Z0-9]/.test(c) ? 0.6 : /[a-z]/.test(c) ? 0.5 : /[?!]/.test(c) ? 0.45 : 0.3);

/**
 * 흑백 그림에서 그 줄의 빈 세로칸을 재서 띄어쓰기를 넣는다.
 * 글자 상자 위치는 부정확해서, 글자 수와 너비 비율로 빈칸 자리를 글자 사이에 맞춘다.
 */
function spaceByPixels(kept, lb, bin) {
  const { data, width: W } = bin;
  const chars = [...kept.map((w) => String(w.text).trim()).join('').replace(/\s+/g, '')];
  if (chars.length < 2) return chars.join('');
  const x0 = Math.max(0, Math.floor(Math.min(...kept.map((w) => w.bbox.x0))));
  const x1 = Math.min(W - 1, Math.ceil(Math.max(...kept.map((w) => w.bbox.x1))));
  const pad = Math.round((lb.y1 - lb.y0) * 0.1);
  const y0 = Math.max(0, lb.y0 + pad);
  const y1 = Math.min(bin.height - 1, lb.y1 - pad);
  const ink = [];
  for (let x = x0; x <= x1; x++) {
    let has = false;
    for (let y = y0; y <= y1 && !has; y++) if (data[(y * W + x) * 4] < 128) has = true;
    ink.push(has);
  }
  let first = ink.indexOf(true);
  let last = ink.lastIndexOf(true);
  if (first < 0) return chars.join('');
  const span = last - first + 1;
  const lh = lb.y1 - lb.y0 || 1;
  // 빈 세로칸이 글자 높이의 일정 비율보다 넓으면 띄어쓰기
  const spaces = [];
  let run = 0;
  for (let i = first; i <= last; i++) {
    if (!ink[i]) run++;
    else {
      if (run > lh * SPACE_PX) spaces.push((i - run / 2 - first) / span);
      run = 0;
    }
  }
  if (!spaces.length) return chars.join('');
  const total = chars.reduce((s, c) => s + charWidth(c), 0);
  const cum = [0];
  for (const c of chars) cum.push(cum[cum.length - 1] + charWidth(c) / total);
  const at = new Set();
  for (const sp of spaces) {
    let best = 1;
    for (let k = 1; k < chars.length; k++) if (Math.abs(cum[k] - sp) < Math.abs(cum[best] - sp)) best = k;
    // 숫자 사이(16살)에는 띄어쓰기를 넣지 않는다
    if (!(/\d/.test(chars[best - 1]) && /\d/.test(chars[best]))) at.add(best);
  }
  return chars.map((c, i) => (at.has(i) ? ' ' : '') + c).join('');
}

/**
 * 날짜 표시처럼 보이는 곳: 화면 가운데에 있고, 글씨가 색 바탕 위의 흰 글씨(또는 색 글씨)인 짧은 줄.
 * 시간·말풍선과 겹쳐 잘못 읽히기 쉬워서, 이 부분만 잘라 다시 읽는다.
 * @returns {{x0,y0,x1,y1}[]}
 */
export function datePillCandidates(lines, img) {
  const W = img.width;
  const out = [];
  for (const line of lines) {
    const words = (line.words || []).filter((w) => String(w.text).trim());
    const colored = words.filter((w) => {
      const c = inkColor(img, w.bbox);
      return c === 'color' || c === 'light';
    });
    if (!colored.length) continue;
    const box = {
      x0: Math.min(...colored.map((w) => w.bbox.x0)),
      x1: Math.max(...colored.map((w) => w.bbox.x1)),
      y0: Math.min(...colored.map((w) => w.bbox.y0)),
      y1: Math.max(...colored.map((w) => w.bbox.y1)),
    };
    const cx = (box.x0 + box.x1) / 2;
    if (Math.abs(cx - W / 2) > W * 0.12 || box.x1 - box.x0 > W * 0.5) continue;
    if (box.y0 < img.height * 0.03) continue; // 맨 위 상태 표시줄
    out.push(box);
  }
  return out;
}

/** 날짜 표시 부분을 잘라 '흰 바탕 검은 글씨'로 바꾼 그림 (다시 읽기용) */
export function pillCanvas(img, box, pad = true) {
  const h = box.y1 - box.y0;
  const px = pad ? h * 0.3 : 0;
  const py = pad ? h * 0.35 : 0;
  const x0 = Math.max(0, Math.round(box.x0 - px));
  const x1 = Math.min(img.width - 1, Math.round(box.x1 + px));
  const y0 = Math.max(0, Math.round(box.y0 - py));
  const y1 = Math.min(img.height - 1, Math.round(box.y1 + py));
  const w = x1 - x0 + 1;
  const hh = y1 - y0 + 1;
  const scale = Math.max(1, 64 / hh);
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(hh * scale);
  const ctx = c.getContext('2d');
  const src = new ImageData(w, hh);
  const vals = [];
  for (let y = 0; y < hh; y++)
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * img.width + (x0 + x)) * 4;
      vals.push(lum(img.data[i], img.data[i + 1], img.data[i + 2]));
    }
  // 가장 밝은 쪽(흰 글씨)을 검게
  const sorted = [...vals].sort((a, b) => a - b);
  const thr = (sorted[Math.floor(sorted.length * 0.5)] + sorted[Math.floor(sorted.length * 0.97)]) / 2;
  vals.forEach((v, k) => {
    const o = v > thr ? 0 : 255;
    src.data.set([o, o, o, 255], k * 4);
  });
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = hh;
  tmp.getContext('2d').putImageData(src, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(tmp, 0, 0, c.width, c.height);
  return c;
}

/** 줄들의 평균 확신도 (0~100) */
export const avgConfidence = (lines) => (lines.length ? lines.reduce((s, l) => s + (l.confidence ?? 0), 0) / lines.length : 0);

/**
 * 말풍선 사이 빈 틈 중 날짜 표시가 들어갈 만큼 넓은 곳 (가운데 부분만).
 * 화면 전체 읽기에서 날짜 표시가 빠지는 경우가 있어서 틈마다 따로 읽는다.
 */
export function gapRegions(rects, img) {
  const W = img.width;
  const H = img.height;
  const all = [...rects, ...(rects.excluded || [])].sort((a, b) => a.y0 - b.y0);
  const out = [];
  let prev = H * 0.075; // 위쪽 제목줄 아래부터
  for (const r of [...all, { y0: H * 0.93 }]) {
    if (r.y0 - prev >= H * 0.018) out.push({ x0: W * 0.25, x1: W * 0.75, y0: prev + 2, y1: r.y0 - 2 });
    prev = Math.max(prev, r.y1 ?? prev);
  }
  return out;
}

/**
 * 이미 찾은 날짜 표시의 바탕색을 배워서, 같은 색 띠가 화면 가운데에 있는 곳을 더 찾는다.
 * (말풍선 위에 겹쳐 걸려서 글자 읽기로는 못 찾은 날짜 표시용)
 */
export function findPillsByColor(img, known) {
  const { data, width: W, height: H } = img;
  known = known.filter(Boolean);
  if (!known.length) return [];
  // 1) 바탕색 배우기: 날짜 표시마다 흰 글씨가 아닌 점들의 가운데 값 (배경이 위아래로 색이 달라서 여러 개)
  // 날짜 표시는 항상 가운데에 있으니, 가운데 좁은 부분만 본다 (옆의 배경 무늬가 섞이지 않게)
  const half = Math.round(W * 0.04);
  const med = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const colors = [];
  for (const k of known) {
    const rs = [], gs = [], bs = [];
    for (let y = Math.max(0, Math.floor(k.y0)); y <= Math.min(H - 1, k.y1); y += 2)
      for (let x = Math.round(W / 2) - half; x <= Math.round(W / 2) + half; x += 2) {
        const i = (y * W + x) * 4;
        if (lum(data[i], data[i + 1], data[i + 2]) < 225) rs.push(data[i]), gs.push(data[i + 1]), bs.push(data[i + 2]);
      }
    if (rs.length >= 15) colors.push([med(rs), med(gs), med(bs)]);
  }
  // 흰 말풍선 위에 걸친 날짜 표시는 색과 상관없이 '흰 바탕 사이의 색 띠'로도 찾는다
  // (검은 글씨는 빼고, 색이 있는 중간 밝기만: 날짜 표시 바탕)
  const onWhite = scanPills(img, (i) => {
    const l = lum(data[i], data[i + 1], data[i + 2]);
    const sat = Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
    return l > 95 && l < 215 && sat > 30;
  });
  if (!colors.length) return onWhite;
  const match = (i) =>
    colors.some((pc) => Math.abs(data[i] - pc[0]) + Math.abs(data[i + 1] - pc[1]) + Math.abs(data[i + 2] - pc[2]) < 62);
  const byColor = scanPills(img, match);
  return [...byColor, ...onWhite.filter((b) => !byColor.some((c) => Math.abs(c.y0 - b.y0) < 30))];
}

/** 화면 가운데에서 match 에 맞는 점이 띠처럼 이어지는 곳을 상자로 */
function scanPills(img, match) {
  const { width: W, height: H } = img;
  const data = img.data;
  // 2) 줄마다 가운데에서 그 색 띠가 얼마나 넓게 이어지는지
  const cx = Math.round(W / 2);
  const gapMax = Math.round(W * 0.03);
  const rows = [];
  const seeded = new Set(); // 가운데가 그 색인 줄 (띠가 배경과 섞여 너무 넓어도)
  for (let y = Math.floor(H * 0.075); y < H * 0.93; y++) {
    const row = y * W;
    let seed = -1;
    for (let d = 0; d <= W * 0.03 && seed < 0; d++) {
      if (match((row + cx - d) * 4)) seed = cx - d;
      else if (match((row + cx + d) * 4)) seed = cx + d;
    }
    if (seed < 0) continue;
    seeded.add(y);
    const extend = (dir) => {
      let x = seed, last = seed, gap = 0;
      while (x > 0 && x < W - 1 && gap <= gapMax) {
        x += dir;
        if (match((row + x) * 4)) (last = x), (gap = 0);
        else gap++;
      }
      return last;
    };
    const left = extend(-1), right = extend(1);
    const w = right - left, c = (left + right) / 2;
    if (w >= W * 0.08 && w <= W * 0.5 && Math.abs(c - W / 2) < W * 0.06) rows.push({ y, left, right });
  }
  // 3) 이어진 줄들을 상자로
  const out = [];
  let cur = null;
  const close = () => {
    if (!cur) return;
    // 좌우는 줄들의 가운데 값 (배경과 섞여 넓게 잡힌 몇 줄에 끌려가지 않게)
    const mid = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
    out.push({ x0: mid(cur.ls), x1: mid(cur.rs), y0: cur.y0, y1: cur.y1 });
  };
  for (const r of rows) {
    if (cur && r.y - cur.y1 <= 3) {
      cur.y1 = r.y;
      cur.ls.push(r.left);
      cur.rs.push(r.right);
    } else {
      close();
      cur = { ls: [r.left], rs: [r.right], y0: r.y, y1: r.y };
    }
  }
  close();
  // 배경과 색이 비슷해서 빠진 위아래 줄까지 넓힌다 (말풍선 위에 반쯤 걸친 날짜 표시)
  for (const b of out) {
    const h = b.y1 - b.y0;
    let up = 0;
    while (up < h * 0.8 && seeded.has(b.y0 - 1)) b.y0--, up++;
    let down = 0;
    while (down < h * 0.8 && seeded.has(b.y1 + 1)) b.y1++, down++;
  }
  return out.filter((b) => b.y1 - b.y0 >= H * 0.012 && b.y1 - b.y0 <= H * 0.06);
}

/**
 * 줄 글자(line.text)의 띄어쓰기대로 낱말을 잇는다.
 * 낱말 목록은 글자 조각으로 잘게 나뉘어 있어도, 줄 글자에는 띄어쓰기가 바르게 들어 있다.
 */
function joinBySpaces(kept, words, lineText) {
  const text = String(lineText || '');
  const spaceBefore = new Map();
  let pos = 0;
  for (const w of words) {
    const t = String(w.text).trim();
    let sp = false;
    while (pos < text.length && /\s/.test(text[pos])) (sp = true), pos++;
    const at = text.indexOf(t, pos);
    if (at >= 0 && at - pos <= 2) {
      if (/\s/.test(text.slice(pos, at))) sp = true;
      pos = at + t.length;
    }
    spaceBefore.set(w, sp);
  }
  return kept.map((w, i) => (i > 0 && spaceBefore.get(w) ? ' ' : '') + String(w.text).trim()).join('');
}
