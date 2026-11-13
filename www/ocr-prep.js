// 캡쳐 사진을 글자 읽기 좋게 흑백으로 바꾼다 (말풍선 색, 배경 무늬 제거)
// ImageData 를 받아 같은 크기의 흑백 ImageData 데이터로 바꾼다.
export function binarize(img) {
  const { data, width, height } = img;
  const n = width * height;
  const gray = new Uint8ClampedArray(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const g = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000;
    gray[i] = g;
    hist[gray[i]]++;
  }
  // Otsu
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) ** 2;
    if (v > best) (best = v), (thr = t);
  }
  // 1 = 글자(검정), 0 = 바탕(흰색)
  const ink = new Uint8Array(n);
  let dark = 0;
  for (let i = 0; i < n; i++) dark += ink[i] = gray[i] <= thr ? 1 : 0;
  if (dark > n / 2) for (let i = 0; i < n; i++) ink[i] ^= 1; // 다크 모드: 뒤집기
  invertPills(ink, width, height);
  for (let i = 0; i < n; i++) {
    const v = ink[i] ? 0 : 255;
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return thr;
}

/** 날짜 표시처럼 '어두운 둥근 칸 안의 흰 글자'를 찾아 흰 바탕의 검은 글자로 바꾼다 */
function invertPills(ink, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (!ink[start] || seen[start]) continue;
    let top = 0, count = 0;
    let x0 = w, x1 = 0, y0 = h, y1 = 0;
    const pixels = [];
    stack[top++] = start;
    seen[start] = 1;
    while (top) {
      const p = stack[--top];
      count++;
      pixels.push(p);
      const x = p % w, y = (p / w) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && ink[p - 1] && !seen[p - 1]) (seen[p - 1] = 1), (stack[top++] = p - 1);
      if (x < w - 1 && ink[p + 1] && !seen[p + 1]) (seen[p + 1] = 1), (stack[top++] = p + 1);
      if (y > 0 && ink[p - w] && !seen[p - w]) (seen[p - w] = 1), (stack[top++] = p - w);
      if (y < h - 1 && ink[p + w] && !seen[p + w]) (seen[p + w] = 1), (stack[top++] = p + w);
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    // 글자 획은 가늘어서 채움 비율이 낮다. 둥근 칸은 넓고 꽉 차 있다.
    if (bh < 16 || bw < bh * 2.5 || count / (bw * bh) < 0.55 || bw > w * 0.95) continue;
    // 줄마다 칸의 왼쪽~오른쪽 끝 안쪽만 뒤집는다 (둥근 모서리 바깥은 그대로)
    const left = new Int32Array(bh).fill(w), right = new Int32Array(bh).fill(-1);
    for (const p of pixels) {
      const x = p % w, r = ((p / w) | 0) - y0;
      if (x < left[r]) left[r] = x;
      if (x > right[r]) right[r] = x;
    }
    for (let r = 0; r < bh; r++) {
      const row = (y0 + r) * w;
      for (let x = left[r]; x <= right[r]; x++) ink[row + x] ^= 1;
    }
  }
}
