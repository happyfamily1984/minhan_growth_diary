// 사주(四柱) 계산과 풀이. AI 없이 만세력 계산 + 정해 둔 풀이 문장으로 만든다. (재미로 보는 운세)
//  - 년주·월주: 해의 황경(절기)으로 입춘·절입을 계산
//  - 일주: 율리우스일 기준 (1949-10-01 = 갑자일)
//  - 시주: 한국 표준시 기준 30분 늦춘 시(자시 23:30~01:30)
export const STEMS = ['갑', '을', '병', '정', '무', '기', '경', '신', '임', '계'];
export const STEMS_H = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
export const BRANCHES = ['자', '축', '인', '묘', '진', '사', '오', '미', '신', '유', '술', '해'];
export const BRANCHES_H = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const ANIMALS = ['쥐', '소', '호랑이', '토끼', '용', '뱀', '말', '양', '원숭이', '닭', '개', '돼지'];
const EL = ['목', '화', '토', '금', '수'];
const EL_NAME = { 목: '나무(木)', 화: '불(火)', 토: '흙(土)', 금: '쇠(金)', 수: '물(水)' };
const STEM_EL = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4];
const BRANCH_EL = [4, 2, 0, 0, 2, 1, 1, 2, 3, 3, 2, 4];
const BRANCH_MAIN_STEM = [9, 5, 0, 1, 4, 2, 3, 5, 6, 7, 4, 8]; // 지지 속 대표 천간 (자=계 …)
const CLASH = { 0: 6, 1: 7, 2: 8, 3: 9, 4: 10, 5: 11, 6: 0, 7: 1, 8: 2, 9: 3, 10: 4, 11: 5 };
const HARMONY = { 0: 1, 1: 0, 2: 11, 11: 2, 3: 10, 10: 3, 4: 9, 9: 4, 5: 8, 8: 5, 6: 7, 7: 6 };

const mod = (a, n) => ((a % n) + n) % n;
const rad = (d) => (d * Math.PI) / 180;

/** 해의 겉보기 황경 (도) — Meeus 간이식 */
function sunLongitude(utcMs) {
  const jd = utcMs / 86400000 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = rad(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) + (0.019993 - 0.000101 * T) * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M);
  const omega = rad(125.04 - 1934.136 * T);
  return mod(L0 + C - 0.00569 - 0.00478 * Math.sin(omega), 360);
}

/** 양력 날짜의 율리우스 일수 */
function jdn(y, m, d) {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

const pillar = (s, b) => ({ s, b, ko: STEMS[s] + BRANCHES[b], hanja: STEMS_H[s] + BRANCHES_H[b] });

/**
 * 한국 시간 기준 날짜·시각으로 사주를 구한다.
 * @param {string} date 'YYYY-MM-DD'   @param {string} [time] 'HH:MM' (없으면 시주 없음)
 */
export function fourPillars(date, time) {
  let [y, m, d] = date.split('-').map(Number);
  const [hh, mi] = (time || '12:00').split(':').map(Number);
  const minutes = hh * 60 + mi;
  const utc = Date.UTC(y, m - 1, d, hh, mi) - 9 * 3600000; // 한국 시간 → 세계시
  const lon = sunLongitude(utc);
  // 년: 입춘(황경 315°) 전이면 지난해
  let sy = y;
  if (m <= 2 && lon >= 250 && lon < 315) sy -= 1;
  const year = pillar(mod(sy - 4, 10), mod(sy - 4, 12));
  // 월: 입춘부터 30°마다 (0=인월)
  const mIdx = Math.floor(mod(lon - 315, 360) / 30);
  const month = pillar(mod(((year.s % 5) * 2 + 2) + mIdx, 10), mod(mIdx + 2, 12));
  // 일: 23:30 이후면 다음 날로 (자시가 새 날의 시작)
  let dayJ = jdn(y, m, d);
  if (time && minutes >= 23 * 60 + 30) dayJ += 1;
  const di = mod(dayJ - 2433191, 60);
  const day = pillar(di % 10, di % 12);
  let hour = null;
  if (time) {
    const hIdx = Math.floor(mod(minutes - (23 * 60 + 30), 1440) / 120);
    hour = pillar(mod((day.s % 5) * 2 + hIdx, 10), hIdx);
  }
  return { year, month, day, hour };
}

/** 일간(나) 기준으로 다른 천간이 무슨 십신인지 */
function tenGod(dayStem, other) {
  const a = STEM_EL[dayStem];
  const b = STEM_EL[other];
  const same = dayStem % 2 === other % 2;
  if (a === b) return same ? '비견' : '겁재';
  if (mod(a + 1, 5) === b) return same ? '식신' : '상관';
  if (mod(a + 2, 5) === b) return same ? '편재' : '정재';
  if (mod(b + 2, 5) === a) return same ? '편관' : '정관';
  return same ? '편인' : '정인';
}
const GOD_GROUP = { 비견: '비겁', 겁재: '비겁', 식신: '식상', 상관: '식상', 편재: '재성', 정재: '재성', 편관: '관성', 정관: '관성', 편인: '인성', 정인: '인성' };

// ---------------- 풀이 문장 ----------------
const DAY_MASTER = [
  { img: '큰 나무 🌳', text: '곧게 하늘로 뻗는 큰 나무처럼 정직하고 반듯해요. 무엇이든 먼저 시작하는 힘이 있고, 사람들을 이끄는 리더 기질이 있어요. 한번 마음먹으면 쉽게 굽히지 않는 뚝심도 있어요.' },
  { img: '풀과 꽃 🌷', text: '바람에 살랑이는 풀과 꽃처럼 부드럽고 유연해요. 어디서든 잘 어울리고 적응력이 뛰어나요. 섬세하게 다른 사람 마음을 살피는 따뜻함이 있어요.' },
  { img: '햇님 ☀️', text: '하늘의 해처럼 밝고 활발해요. 주변을 환하게 밝히는 분위기 메이커이고, 생각과 마음을 시원하게 표현해요. 열정이 넘치고 숨기는 게 없어요.' },
  { img: '촛불 🕯️', text: '은은한 촛불처럼 따뜻하고 세심해요. 한 가지에 깊이 몰두하는 집중력이 있고, 가까운 사람을 살뜰히 챙겨요. 겉은 조용해도 속은 뜨거운 사람이에요.' },
  { img: '큰 산 ⛰️', text: '든든한 큰 산처럼 믿음직하고 너그러워요. 쉽게 흔들리지 않고 주변 사람들을 넉넉하게 품어 줘요. 약속을 잘 지키고 듬직해서 기대고 싶은 사람이에요.' },
  { img: '기름진 밭 🌾', text: '씨앗을 품어 키우는 밭처럼 꼼꼼하고 알뜰해요. 차근차근 실속을 챙기고, 다른 사람을 돌보고 길러 주는 마음이 커요. 현실 감각이 좋아요.' },
  { img: '단단한 바위 🪨', text: '단단한 쇠와 바위처럼 의리 있고 결단력이 있어요. 옳고 그름이 분명하고, 정한 일은 시원하게 밀고 나가요. 겉으론 무뚝뚝해도 속정이 깊어요.' },
  { img: '반짝이는 보석 💎', text: '반짝이는 보석처럼 섬세하고 깔끔해요. 아름다운 것을 알아보는 눈이 있고 자존심이 강해요. 작은 것까지 정성 들여 다듬는 완벽주의 면이 있어요.' },
  { img: '넓은 바다 🌊', text: '넓은 바다처럼 생각이 크고 지혜로워요. 자유롭게 여기저기 흘러가며 많은 것을 받아들이는 포용력이 있어요. 머리 회전이 빠르고 아이디어가 풍부해요.' },
  { img: '촉촉한 단비 🌧️', text: '땅을 적시는 단비처럼 영리하고 감수성이 풍부해요. 상상력이 뛰어나고 눈치가 빨라요. 조용히 주변을 살리는 고마운 사람이에요.' },
];
const EL_TIP = {
  목: { good: '자라고 배우는 힘', lack: '꾸준히 하나씩 해 나가는 습관이 힘이 돼요. 숲 산책, 식물 키우기, 초록색 물건이 좋아요.', color: '초록색', num: '3, 8', dir: '동쪽' },
  화: { good: '밝게 표현하는 힘', lack: '햇볕을 쬐고 몸을 많이 움직이면 좋아요. 마음을 말로 표현해 보면 기운이 살아나요. 빨간색·주황색이 좋아요.', color: '빨간색', num: '2, 7', dir: '남쪽' },
  토: { good: '믿음직하게 버티는 힘', lack: '규칙적으로 먹고 자는 생활이 중심을 잡아 줘요. 흙을 만지는 놀이, 노란색·갈색이 좋아요.', color: '노란색', num: '5, 10', dir: '가운데' },
  금: { good: '결단하고 마무리하는 힘', lack: '정리정돈과 약속 지키기를 연습하면 좋아요. 흰색·금색, 악기나 운동처럼 반복 연습이 좋아요.', color: '흰색', num: '4, 9', dir: '서쪽' },
  수: { good: '생각하고 지혜를 모으는 힘', lack: '책 읽기와 충분한 휴식, 물을 자주 마시는 게 좋아요. 파란색·검은색이 좋아요.', color: '파란색', num: '1, 6', dir: '북쪽' },
};
// 십신별: 성격(평생), 기간 운(올해·이달), 오늘
const GOD_TEXT = {
  비견: { life: '자기 생각이 뚜렷하고 독립심이 강해요. 친구와 함께할 때 힘이 나요.', period: '친구·동료와 어깨를 나란히 하는 시기예요. 함께하면 힘이 되지만 고집이 부딪힐 수 있으니 양보하는 마음이 도움이 돼요.', day: '친구와 함께하면 즐거운 날! 내 생각만 고집하지 않으면 더 좋아요.' },
  겁재: { life: '경쟁심과 승부욕이 있어 지기 싫어해요. 그 힘이 노력하는 원동력이 돼요.', period: '경쟁하고 도전하는 기운이 커져요. 의욕이 넘치지만 욕심내다 지칠 수 있으니 쉬어 가며 해요. 돈과 물건은 꼼꼼히 챙겨요.', day: '의욕이 넘치는 날. 서두르지 말고, 물건 잃어버리지 않게 조심해요.' },
  식신: { life: '먹는 복과 재주가 있고 마음이 넉넉해요. 좋아하는 것을 즐기며 잘 해내요.', period: '하고 싶은 것을 마음껏 해 보는 즐거운 시기예요. 배우고 만들고 표현하는 일이 잘 풀리고, 먹을 복도 따라와요.', day: '맛있는 것 먹고 하고 싶은 것 하는 신나는 날! 재주가 빛나요.' },
  상관: { life: '말재주와 아이디어가 뛰어나고 틀에 얽매이지 않아요. 창의력이 큰 무기예요.', period: '번뜩이는 생각과 말솜씨가 빛나는 시기예요. 새로운 시도가 좋지만, 말이 앞서면 오해가 생길 수 있으니 한 번 더 생각하고 말해요.', day: '아이디어가 반짝이는 날. 말은 부드럽게 하면 더 좋아요.' },
  편재: { life: '활동적이고 통이 커요. 여기저기 다니며 기회를 잘 잡아요.', period: '활동 범위가 넓어지고 생각지 못한 기회가 오는 시기예요. 새로운 곳, 새로운 사람을 만나 보세요. 씀씀이는 조금 조절해요.', day: '바깥 활동이 좋은 날. 뜻밖의 좋은 일이 생길 수 있어요.' },
  정재: { life: '성실하고 알뜰해요. 차곡차곡 모으고 계획대로 해내는 힘이 있어요.', period: '노력한 만큼 차곡차곡 쌓이는 안정적인 시기예요. 계획을 세우고 꾸준히 하면 결과가 좋아요.', day: '차분하게 할 일을 해내는 날. 작은 저축과 정리가 복을 불러요.' },
  편관: { life: '책임감과 추진력이 강하고 어려움 앞에서 용감해요.', period: '해야 할 일과 책임이 늘어나는 시기예요. 부담도 있지만 이겨 내면 한 단계 크게 성장해요. 무리하지 말고 건강을 챙겨요.', day: '조금 바쁘고 긴장되는 날. 차근차근 하면 잘 넘어가요. 안전 조심!' },
  정관: { life: '바르고 예의 바르며 규칙을 잘 지켜요. 믿음을 얻는 사람이에요.', period: '칭찬과 인정을 받는 시기예요. 규칙을 잘 지키고 성실하면 좋은 자리와 기회가 따라와요.', day: '칭찬받을 일이 생기는 날! 예의 바르게 하면 더 빛나요.' },
  편인: { life: '눈치가 빠르고 독특한 생각과 직감이 있어요. 혼자 깊이 파고드는 공부에 강해요.', period: '생각이 깊어지고 새로운 공부나 취미에 끌리는 시기예요. 혼자만의 시간이 도움이 되지만 너무 고민만 하지 말아요.', day: '책이나 새로운 것에 빠져드는 날. 생각을 너무 오래 끌지 말아요.' },
  정인: { life: '배우기를 좋아하고 마음이 따뜻해요. 윗사람의 사랑과 도움을 많이 받아요.', period: '배움과 도움이 들어오는 시기예요. 공부가 잘되고 어른들의 응원과 도움을 받아요. 감사한 마음을 표현해 보세요.', day: '도움과 사랑을 받는 날. 공부나 독서가 잘돼요.' },
};

function analyze(p) {
  const pillars = [p.year, p.month, p.day, p.hour].filter(Boolean);
  const counts = [0, 0, 0, 0, 0];
  for (const x of pillars) {
    counts[STEM_EL[x.s]]++;
    counts[BRANCH_EL[x.b]]++;
  }
  const me = STEM_EL[p.day.s];
  const parent = mod(me - 1, 5);
  // 나를 돕는 기운(같은 오행 + 나를 낳는 오행), 월지는 두 배로
  let support = 0;
  for (const x of pillars) {
    if (x !== p.day && [me, parent].includes(STEM_EL[x.s])) support++;
    const w = x === p.month ? 2 : 1;
    if ([me, parent].includes(BRANCH_EL[x.b])) support += w;
  }
  const total = pillars.length * 2 - 1 + 1; // 일간 제외 + 월지 가중
  const strong = support >= total / 2;
  // 쓰면 좋은 기운: 강하면 내가 낳고 다스리는 쪽, 약하면 나를 돕는 쪽
  const useful = strong ? mod(me + 1, 5) : parent;
  const gods = {};
  for (const x of pillars) {
    if (x !== p.day) gods[tenGod(p.day.s, x.s)] = (gods[tenGod(p.day.s, x.s)] || 0) + 1;
    const g = tenGod(p.day.s, BRANCH_MAIN_STEM[x.b]);
    gods[g] = (gods[g] || 0) + 1;
  }
  return { counts, me, strong, useful, gods };
}

const josa = (name, a, b) => {
  const last = name.charCodeAt(name.length - 1);
  const has = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0;
  return name + (has ? a : b);
};

/** 기간(해·달·날) 기운과 나의 관계로 운세를 만든다 */
function periodFortune(p, a, pl, kind) {
  const gS = tenGod(p.day.s, pl.s);
  const gB = tenGod(p.day.s, BRANCH_MAIN_STEM[pl.b]);
  const good = a.strong ? ['식상', '재성', '관성'] : ['인성', '비겁'];
  let score = 3 + (good.includes(GOD_GROUP[gS]) ? 1 : -0.5) + (good.includes(GOD_GROUP[gB]) ? 0.6 : 0);
  const notes = [];
  if (CLASH[p.day.b] === pl.b) {
    score -= 1;
    notes.push('나의 기운과 부딪히는 기운이 있어 변화가 생기기 쉬워요. 이동·운동할 때 안전에 더 신경 써요.');
  }
  if (HARMONY[p.day.b] === pl.b) {
    score += 0.7;
    notes.push('나와 잘 맞는 기운이 들어와 사람 사이가 부드럽고 손발이 잘 맞아요.');
  }
  if (STEM_EL[pl.s] === a.useful || BRANCH_EL[pl.b] === a.useful) {
    score += 0.5;
    notes.push(`나에게 필요한 ${EL_NAME[EL[a.useful]]} 기운이 들어와 힘이 돼요.`);
  }
  const stars = Math.max(1, Math.min(5, Math.round(score)));
  const t = GOD_TEXT[gS];
  const sub = GOD_TEXT[gB];
  const body =
    kind === 'day'
      ? [t.day, sub.day !== t.day ? `그리고 ${sub.day}` : ''].filter(Boolean)
      : [t.period, `안쪽 기운으로는 '${gB}'이 함께해요. ${sub.period.split('.')[0]}.`];
  return { stars, gods: [gS, gB], text: [...body, ...notes] };
}

const starText = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

/**
 * 사람 한 명의 사주 풀이
 * @param person { name, date, time }
 * @param today 'YYYY-MM-DD' (한국 날짜)
 */
export function readSaju(person, today, nowTime = '12:00') {
  const p = fourPillars(person.date, person.time);
  const a = analyze(p);
  const name = person.name;
  const dm = DAY_MASTER[p.day.s];
  const most = a.counts.indexOf(Math.max(...a.counts));
  const lacking = a.counts.map((c, i) => (c === 0 ? i : -1)).filter((i) => i >= 0);
  const topGod = Object.entries(a.gods).sort((x, y) => y[1] - x[1])[0][0];
  const useful = EL[a.useful];

  const life = [
    `${josa(name, '은', '는')} ${STEMS[p.day.s]}${EL[STEM_EL[p.day.s]]}(${STEMS_H[p.day.s]}) 일간, ${dm.img}의 기운을 타고났어요. ${dm.text}`,
    `${BRANCHES[p.year.b]}(${ANIMALS[p.year.b]})띠이고, 사주에 ${EL_NAME[EL[most]]} 기운이 가장 많아 ${EL_TIP[EL[most]].good}이 두드러져요.` +
      (lacking.length ? ` ${lacking.map((i) => EL_NAME[EL[i]]).join('·')} 기운은 없는 편이에요.` : ' 다섯 기운이 모두 있어 고르게 갖춘 편이에요.'),
    `${a.strong ? '타고난 기운이 힘찬 편(신강)이라 스스로 해내는 힘이 강해요. 넘치는 힘을 배우고 표현하는 데 쓰면 좋아요.' : '타고난 기운이 섬세한 편(신약)이라 주변의 도움과 배움을 잘 받아들여요. 좋은 사람들과 함께할 때 크게 피어나요.'}`,
    `가장 많이 보이는 성향은 '${topGod}'이에요. ${GOD_TEXT[topGod].life}`,
    `나에게 힘이 되는 기운은 ${EL_NAME[useful]}이에요. ${EL_TIP[useful].lack}`,
  ];
  const ty = Number(today.slice(0, 4));
  const yearP = fourPillars(`${ty}-07-01`).year;
  const monthP = fourPillars(today, nowTime).month;
  const dayP = fourPillars(today, '12:00').day;
  const yr = periodFortune(p, a, yearP, 'year');
  const mo = periodFortune(p, a, monthP, 'month');
  const dy = periodFortune(p, a, dayP, 'day');
  const lucky = `행운의 색 ${EL_TIP[useful].color} · 숫자 ${EL_TIP[useful].num} · 방향 ${EL_TIP[useful].dir}`;
  return {
    name,
    pillars: p,
    chart: [p.hour, p.day, p.month, p.year],
    counts: a.counts,
    sections: {
      life: { title: '평생운세', head: `${dm.img} · ${a.strong ? '신강' : '신약'}`, text: life },
      year: { title: `${ty}년 운세`, head: `${yearP.ko}(${yearP.hanja})년 · ${starText(yr.stars)}`, text: yr.text },
      month: { title: '이달의 운세', head: `${monthP.ko}(${monthP.hanja})월 · ${starText(mo.stars)}`, text: mo.text },
      day: { title: '오늘의 운세', head: `${dayP.ko}(${dayP.hanja})일 · ${starText(dy.stars)}`, text: [...dy.text, lucky] },
    },
  };
}
