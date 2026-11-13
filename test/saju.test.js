import test from 'node:test';
import assert from 'node:assert/strict';
import { fourPillars, readSaju } from '../www/saju.js';

const ko = (p) => [p.year, p.month, p.day, p.hour].filter(Boolean).map((x) => x.ko).join(' ');

test('기준일: 1949-10-01 갑자일, 2000-01-01 무오일', () => {
  assert.equal(fourPillars('1949-10-01').day.ko, '갑자');
  assert.equal(fourPillars('2000-01-01').day.ko, '무오');
});

test('입춘 전후로 해가 바뀐다', () => {
  assert.equal(fourPillars('2016-02-03', '12:00').year.ko, '을미'); // 입춘(2/4) 전
  assert.equal(fourPillars('2016-02-05', '12:00').year.ko, '병신');
  assert.equal(fourPillars('2016-02-22', '11:55').month.ko, '경인'); // 병년 → 경인월
});

test('시주: 30분 늦춘 시 기준', () => {
  assert.equal(fourPillars('2016-02-22', '11:55').hour.b, 6); // 오시
  assert.equal(fourPillars('1983-06-07', '08:30').hour.b, 4); // 진시
  assert.equal(fourPillars('1980-09-29', '18:03').hour.b, 9); // 유시
});

test('풀이가 만들어진다', () => {
  const r = readSaju({ name: '민한이', date: '2016-02-22', time: '11:55' }, '2026-11-13');
  for (const k of ['life', 'year', 'month', 'day']) assert.ok(r.sections[k].text.length >= 1);
  console.log(ko(r.pillars), '|', r.sections.life.head, '|', r.sections.year.head, '|', r.sections.day.head);
  console.log(ko(fourPillars('1983-06-07', '08:30')), '/', ko(fourPillars('1980-09-29', '18:03')));
});
