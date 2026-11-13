import test from 'node:test';
import assert from 'node:assert/strict';
import { dayNumber, dateOfDay, age } from '../www/shared.js';

test('태어난 날은 1일째', () => {
  assert.equal(dayNumber('2016-02-22'), 1);
  assert.equal(dayNumber('2016-05-31'), 100); // 백일
  assert.equal(dateOfDay(100), '2016-05-31');
  assert.equal(dayNumber('2026-11-13'), 3918);
});

test('만 나이', () => {
  assert.deepEqual(age('2016-02-22'), { years: 0, months: 0, days: 0 });
  assert.deepEqual(age('2026-02-21'), { years: 9, months: 11, days: 30 });
  assert.deepEqual(age('2026-02-22'), { years: 10, months: 0, days: 0 });
  assert.deepEqual(age('2026-11-13'), { years: 10, months: 8, days: 22 });
});
