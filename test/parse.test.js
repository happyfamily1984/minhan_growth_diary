import test from 'node:test';
import assert from 'node:assert/strict';
import { parseText, parseDateLine, parseDateTime, linesToBubbles } from '../www/parse.js';

const T = '2026-11-13';

test('날짜 구분선', () => {
  assert.equal(parseDateLine('11월 13일', T), '2026-11-13');
  assert.equal(parseDateLine('12월 25일', T), '2025-12-25'); // 미래면 작년
  assert.equal(parseDateLine('2024년 3월 1일 금요일', T), '2024-03-01');
  assert.equal(parseDateLine('2024.03.01 (금)', T), '2024-03-01');
  assert.equal(parseDateLine('오늘', T), T);
  assert.equal(parseDateLine('어제', T), '2026-11-12');
  assert.equal(parseDateLine('엄마 11월 13일에 가자', T), null);
});

test('날짜+시간', () => {
  assert.deepEqual(parseDateTime('13.11.2026 18:20', T), { date: '2026-11-13', time: '18:20' });
  assert.deepEqual(parseDateTime('2026-10-01 07:03:11', T), { date: '2026-10-01', time: '07:03' });
  assert.deepEqual(parseDateTime('2026. 10. 1. 오후 6:20', T), { date: '2026-10-01', time: '18:20' });
});

test('텔레그램 PC 복사 형식', () => {
  const items = parseText('엄마, [01.10.2026 19:03]\n민한이가 그러는데\n아빠는 왜 수염이 나?\n\n아빠, [02.10.2026 08:00]\n"오늘 학교 안 가?"', T);
  assert.deepEqual(items, [
    { text: '민한이가 그러는데\n아빠는 왜 수염이 나?'.replace(/\s+/g, ' '), date: '2026-10-01', time: '19:03', from: '엄마' },
    { text: '오늘 학교 안 가?', date: '2026-10-02', time: '08:00', from: '아빠' },
  ]);
});

test('휴대폰 복사 형식', () => {
  const items = parseText('[13.11.26 18:20] 엄마: 달이 나를 따라와\n[13.11.26 18:21] 엄마: 왜 따라와?', T);
  assert.equal(items.length, 2);
  assert.equal(items[0].date, '2026-11-13');
  assert.equal(items[1].text, '왜 따라와?');
});

test('그냥 글: 날짜 줄 + 한 줄씩', () => {
  const items = parseText('11월 10일\n공룡은 왜 없어졌어? 오후 3:12\n나 배고파\n\n11월 12일\n“엄마 사랑해”', T);
  assert.deepEqual(items.map((i) => [i.date, i.text, i.time]), [
    ['2026-11-10', '공룡은 왜 없어졌어?', '15:12'],
    ['2026-11-10', '나 배고파', ''],
    ['2026-11-12', '엄마 사랑해', ''],
  ]);
});

test('날짜가 없으면 null', () => {
  assert.deepEqual(parseText('구름이 솜사탕 같아', T), [{ text: '구름이 솜사탕 같아', date: null, time: '', from: '' }]);
});

test('캡쳐 OCR 줄 → 말풍선', () => {
  const L = (text, x0, x1, y0) => ({ text, confidence: 90, bbox: { x0, x1, y0, y1: y0 + 30 } });
  const b = linesToBubbles(
    [L('11월 12일', 450, 630, 0), L('엄마 이거 봐', 40, 400, 100), L('구름이 솜사탕 같아 18:20', 40, 500, 130), L('그러네 18:21', 700, 1040, 220)],
    1080,
    T,
  );
  assert.deepEqual(b, [
    { text: '엄마 이거 봐 구름이 솜사탕 같아', side: 'left', date: '2026-11-12', time: '18:20', from: '' },
    { text: '그러네', side: 'right', date: '2026-11-12', time: '18:21', from: '' },
  ]);
});

test('텔레그램 복사: 보낸 사람·시간·부호는 빼고 날짜와 내용만', () => {
  const raw = [
    '엄마, [12.11.2026 21:05]',
    '민한이가 자기 전에 한 말 ✓✓',
    '',
    '아빠 [13.11.2026 07:40]:',
    '> 엄마는 왜 매일 일찍 일어나? (편집됨)',
    '[사진]',
    '',
    '[13.11.26 08:10] 엄마: “나 오늘 용감했어!”',
  ].join('\n');
  assert.deepEqual(
    parseText(raw, T).map((i) => [i.date, i.text]),
    [
      ['2026-11-12', '민한이가 자기 전에 한 말'],
      ['2026-11-13', '엄마는 왜 매일 일찍 일어나?'],
      ['2026-11-13', '나 오늘 용감했어!'],
    ],
  );
});
