// 서버와 브라우저가 함께 쓰는 계산 함수
export const CHILD_NAME = '민한';
export const BIRTH_DATE = '2016-02-22';
export const BIRTH_TIME = '11:55';
// 한국 시간 2016-02-22 11:55 = UTC 02:55
export const BIRTH_INSTANT = Date.UTC(2016, 1, 22, 2, 55);

const toUTC = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

/** 태어난 날을 1일째로 센 날짜 번호 (백일 = 100일째) */
export function dayNumber(ymd) {
  return Math.round((toUTC(ymd) - toUTC(BIRTH_DATE)) / 86400000) + 1;
}

/** 날짜 번호 → YYYY-MM-DD */
export function dateOfDay(n) {
  return new Date(toUTC(BIRTH_DATE) + (n - 1) * 86400000).toISOString().slice(0, 10);
}

/** 만 나이 (년, 개월, 일) */
export function age(ymd) {
  const [by, bm, bd] = BIRTH_DATE.split('-').map(Number);
  let [y, m, d] = ymd.split('-').map(Number);
  let years = y - by;
  let months = m - bm;
  let days = d - bd;
  if (days < 0) {
    months -= 1;
    days += new Date(Date.UTC(y, m - 1, 0)).getUTCDate(); // 전달의 일 수
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years, months, days };
}

export function todaySeoul(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
