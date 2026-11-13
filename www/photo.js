// 사진을 줄여서 저장한다: 큰 사진(가로·세로 중 긴 쪽 1280px) + 목록용 작은 사진(360px)
const MAX = 1280;
const THUMB = 360;
const LIMIT = 900 * 1024; // Firestore 문서 하나는 1MB 까지

function draw(bmp, size) {
  const scale = Math.min(1, size / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

export async function shrinkPhoto(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  let size = MAX;
  let quality = 0.8;
  let canvas = draw(bmp, size);
  let data = canvas.toDataURL('image/jpeg', quality);
  while (data.length > LIMIT && quality > 0.4) {
    quality -= 0.1;
    if (quality < 0.6) canvas = draw(bmp, (size = Math.round(size * 0.8)));
    data = canvas.toDataURL('image/jpeg', quality);
  }
  const thumb = draw(bmp, THUMB).toDataURL('image/jpeg', 0.7);
  return { data, thumb, width: canvas.width, height: canvas.height };
}

/** 사진을 찍은 날짜 (JPEG 안의 촬영 정보) — 없으면 null */
export async function photoTakenDate(file) {
  try {
    const head = new Uint8Array(await file.slice(0, 128 * 1024).arrayBuffer());
    let s = '';
    for (let i = 0; i < head.length; i++) s += String.fromCharCode(head[i]);
    const all = [...s.matchAll(/(\d{4}):(\d{2}):(\d{2}) \d{2}:\d{2}:\d{2}/g)].map((m) => `${m[1]}-${m[2]}-${m[3]}`);
    // 보통 촬영 시각이 가장 이른 값
    return all.filter((d) => d > '2000').sort()[0] || null;
  } catch {
    return null;
  }
}
