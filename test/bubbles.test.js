import test from 'node:test';
import assert from 'node:assert/strict';
import { findBubbles, inkColor } from '../www/bubbles.js';

// 초록 배경(200,215,160)에 흰 말풍선 두 개가 있는 가짜 캡쳐
function fakeShot() {
  const W = 200, H = 400;
  const data = new Uint8ClampedArray(W * H * 4);
  const fill = (x0, y0, x1, y1, [r, g, b]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set([r, g, b, 255], (y * W + x) * 4);
  };
  fill(0, 0, W, H, [200, 215, 160]);
  fill(10, 60, 150, 140, [255, 255, 255]); // 말풍선 1
  fill(10, 160, 170, 260, [255, 255, 255]); // 말풍선 2
  fill(20, 70, 60, 80, [40, 40, 40]); // 검은 글씨
  fill(20, 170, 60, 180, [220, 60, 120]); // 분홍 이름
  fill(100, 240, 140, 250, [140, 150, 145]); // 회색 시간
  return { data, width: W, height: H };
}

test('말풍선 찾기', () => {
  const b = findBubbles(fakeShot());
  assert.equal(b.length, 2);
  assert.ok(b[0].y0 >= 58 && b[0].y1 <= 142 && b[1].y0 >= 158);
});

test('글씨 색 구분', () => {
  const img = fakeShot();
  assert.equal(inkColor(img, { x0: 15, y0: 65, x1: 65, y1: 85 }), 'ink');
  assert.equal(inkColor(img, { x0: 15, y0: 165, x1: 65, y1: 185 }), 'color');
  assert.equal(inkColor(img, { x0: 95, y0: 235, x1: 145, y1: 255 }), 'gray');
});
