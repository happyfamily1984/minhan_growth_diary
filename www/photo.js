// 사진을 줄여서 저장한다: 큰 사진(가로·세로 중 긴 쪽 1280px) + 목록용 작은 사진(360px)
const MAX = 1280;
const THUMB = 360;
const LIMIT = 900 * 1024; // Firestore 문서 하나는 1MB 까지

function draw(bmp, size) {
  const { width, height } = sizeOf(bmp);
  const scale = Math.min(1, size / Math.max(width, height));
  const c = document.createElement('canvas');
  c.width = Math.round(width * scale);
  c.height = Math.round(height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

/** 파일 앞부분으로 사진 종류를 알아낸다 (안드로이드에서 종류 정보가 비어 오는 경우가 있음) */
function sniffType(b) {
  const hex = [...b.slice(0, 12)].map((x) => x.toString(16).padStart(2, '0')).join('');
  const ascii = String.fromCharCode(...b.slice(0, 12));
  if (hex.startsWith('89504e47')) return 'image/png';
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  if (ascii.startsWith('GIF8')) return 'image/gif';
  if (hex.startsWith('424d')) return 'image/bmp';
  if (/ftyp(heic|heix|hevc|mif1|msf1)/.test(String.fromCharCode(...b.slice(4, 12)))) return 'image/heic';
  if (/ftypavif/.test(String.fromCharCode(...b.slice(4, 12)))) return 'image/avif';
  return '';
}

/**
 * 고른 사진을 그릴 수 있는 그림으로 연다. 안드로이드 사진 선택 창이 준 파일은
 * 먼저 끝까지 읽은 다음, 종류를 붙여서 열고, 안 되면 <img> 로 한 번 더 시도한다.
 */
export async function decodeImage(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (!buf.length) throw new Error('사진 파일을 읽지 못했어요. 갤러리에서 다시 골라 주세요.');
  const type = sniffType(buf) || file.type || 'image/jpeg';
  const blob = new Blob([buf], { type });
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {}
  try {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    await img.decode();
    // 그린 뒤 주소를 정리
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return img;
  } catch {}
  if (type === 'image/heic')
    throw new Error('HEIC(아이폰·일부 삼성 사진) 형식은 열 수 없어요. 캡쳐 화면이나 JPG 사진으로 골라 주세요.');
  throw new Error('이 사진은 열 수 없어요. 다른 사진으로 골라 주세요.');
}
const sizeOf = (img) => ({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });

export async function shrinkPhoto(file) {
  const bmp = await decodeImage(file);
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
