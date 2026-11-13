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
const PLAIN = ['나무', '불', '흙', '쇠', '물'];
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

// 일간별 장점·조심할 점
const DM_MORE = [
  { plus: '솔직하고 책임감이 강하며 꿈이 커요.', minus: '고집이 세서 한번 정하면 잘 바꾸지 않아요. 다른 의견도 들어 보면 더 크게 자라요.' },
  { plus: '눈치가 빠르고 사교성이 좋아 어디서든 사랑받아요.', minus: '남의 눈치를 많이 보다 마음이 지칠 수 있어요. 내 생각을 분명히 말하는 연습이 좋아요.' },
  { plus: '긍정적이고 용감하며 정이 많아요.', minus: '감정이 빨리 끓었다 식어요. 시작한 일을 끝까지 마무리하는 힘을 기르면 좋아요.' },
  { plus: '배려심이 깊고 손재주와 집중력이 뛰어나요.', minus: '속마음을 잘 드러내지 않아 혼자 끙끙 앓을 수 있어요. 마음을 나누면 가벼워져요.' },
  { plus: '침착하고 믿음직하며 의리가 있어요.', minus: '변화를 싫어하고 느긋해 보일 수 있어요. 새로운 것에 한 발 먼저 나서 보면 좋아요.' },
  { plus: '세심하고 성실하며 살림·관리 능력이 좋아요.', minus: '걱정이 많고 생각이 복잡해질 때가 있어요. 너무 완벽하려 하지 않아도 괜찮아요.' },
  { plus: '정의롭고 추진력이 있으며 뒤끝이 없어요.', minus: '말이 직설적이라 오해를 살 수 있어요. 부드러운 말투가 더 큰 힘이 돼요.' },
  { plus: '감각이 뛰어나고 깔끔하며 맡은 일을 완벽하게 해내요.', minus: '예민하고 상처를 잘 받아요. 스스로를 칭찬해 주는 습관이 좋아요.' },
  { plus: '배짱이 있고 생각의 폭이 넓으며 적응력이 좋아요.', minus: '하고 싶은 게 많아 한곳에 오래 머물기 어려워요. 우선순위를 정하면 좋아요.' },
  { plus: '영리하고 인정이 많으며 아이디어가 샘솟아요.', minus: '기분에 따라 마음이 자주 바뀔 수 있어요. 규칙적인 생활이 중심을 잡아 줘요.' },
];
const JOB_EL = {
  목: '선생님·교육, 책·출판, 디자인, 환경·식물, 의료(한의학), 기획',
  화: '방송·연예, 예술·공연, 광고·마케팅, 요리, IT·게임, 강연',
  토: '건축·부동산, 농업·식품, 상담·복지, 공무원, 중개·무역 관리',
  금: '법조·경찰, 금융·회계, 엔지니어·기계, 외과 의사, 군인, 운동선수',
  수: '연구·과학, 무역·여행, IT·데이터, 심리·철학, 작가, 해양·수산',
};
const JOB_GOD = {
  비겁: '내 힘으로 해내는 일(자기 사업, 프리랜서, 운동)',
  식상: '만들고 표현하는 일(예술, 요리, 유튜브·창작, 연구개발, 교육)',
  재성: '사람과 돈이 오가는 일(사업, 영업, 금융, 유통)',
  관성: '조직과 규칙 속에서 빛나는 일(공무원, 대기업, 법·의료, 군·경찰)',
  인성: '배우고 가르치는 일(교수, 연구원, 의사, 작가, 상담)',
};
const SAMHAP = [[8, 0, 4], [2, 6, 10], [5, 9, 1], [11, 3, 7]]; // 신자진, 인오술, 사유축, 해묘미
const STEM_HAP = { 0: 5, 5: 0, 1: 6, 6: 1, 2: 7, 7: 2, 3: 8, 8: 3, 4: 9, 9: 4 }; // 갑기·을경·병신·정임·무계

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

/** 두 사람 궁합: 일간 관계, 천간합, 일지·띠의 합과 충, 부족한 기운 채워 주기 */
function compatibility(meName, me, meA, otherName, ot, otA) {
  let score = 60;
  const notes = [];
  const a = STEM_EL[me.day.s];
  const b = STEM_EL[ot.day.s];
  const withO = josa(otherName, '과', '와');
  if (STEM_HAP[me.day.s] === ot.day.s) {
    score += 15;
    notes.push('두 사람의 타고난 기운(일간)이 서로 끌어당기는 짝(천간합)이에요. 말하지 않아도 마음이 통하는 인연이에요.');
  }
  if (a === b) {
    score += 8;
    notes.push(`둘 다 ${EL_NAME[EL[a]]} 기운이라 생각과 취향이 꼭 닮았어요. 친구처럼 편하고, 같은 것을 좋아해서 함께하는 시간이 즐거워요.`);
  } else if (mod(b + 1, 5) === a) {
    score += 14;
    notes.push(`${otherName}의 기운이 ${meName}의 기운을 키워 주는 관계예요(${josa(PLAIN[b], '이', '가')} ${josa(PLAIN[a], '을', '를')} 살려요). ${josa(meName, '은', '는')} ${withO} 함께 있으면 마음이 든든하고 힘이 나요.`);
  } else if (mod(a + 1, 5) === b) {
    score += 12;
    notes.push(`${meName}의 기운이 ${otherName}의 기운을 살려 주는 관계예요(${josa(PLAIN[a], '이', '가')} ${josa(PLAIN[b], '을', '를')} 키워요). ${meName}의 존재가 ${otherName}에게 큰 기쁨과 힘이 돼요.`);
  } else if (mod(a + 2, 5) === b) {
    score += 2;
    notes.push(`${meName}의 기운이 ${otherName}의 기운을 단단하게 잡아 주는 관계예요(${josa(PLAIN[a], '이', '가')} ${josa(PLAIN[b], '을', '를')} 다듬어요). 서로에게 든든한 버팀목이 돼요.`);
  } else {
    score += 2;
    notes.push(`${otherName}의 기운이 ${meName}의 기운을 바르게 이끌어 주는 관계예요(${josa(PLAIN[b], '이', '가')} ${josa(PLAIN[a], '을', '를')} 다듬어요). ${josa(otherName, '이', '가')} 곁에 있으면 ${josa(meName, '이', '가')} 한 단계씩 쑥쑥 자라요.`);
  }
  if (HARMONY[me.day.b] === ot.day.b) (score += 8), notes.push('마음 깊은 곳(일지)이 서로 잘 맞아 함께 지내기 편해요.');
  if (CLASH[me.day.b] === ot.day.b) (score += 3), notes.push('서로 다른 매력을 가지고 있어, 함께하면 몰랐던 세상을 알려 주는 사이예요.');
  const sameGroup = SAMHAP.some((g) => g.includes(me.year.b) && g.includes(ot.year.b) && me.year.b !== ot.year.b);
  if (sameGroup || HARMONY[me.year.b] === ot.year.b) (score += 7), notes.push(`${ANIMALS[me.year.b]}띠와 ${ANIMALS[ot.year.b]}띠는 서로 잘 어울리는 띠예요.`);
  else if (CLASH[me.year.b] === ot.year.b) (score += 2), notes.push(`${ANIMALS[me.year.b]}띠와 ${ANIMALS[ot.year.b]}띠는 서로 부족한 점을 채워 주는 사이예요. 이야기를 많이 나눌수록 더 가까워져요.`);
  if (otA.counts[meA.useful] >= 2) (score += 6), notes.push(`${josa(otherName, '이', '가')} ${meName}에게 필요한 ${EL_NAME[EL[meA.useful]]} 기운을 많이 가지고 있어 곁에 있으면 힘이 돼요.`);
  if (meA.counts[otA.useful] >= 2) (score += 5), notes.push(`${josa(meName, '도', '도')} ${otherName}에게 필요한 ${EL_NAME[EL[otA.useful]]} 기운을 채워 줘요.`);
  if (notes.length < 3)
    notes.push(`${meName}의 장점(${DM_MORE[me.day.s].plus.replace(/\.$/, '')})과 ${otherName}의 장점(${DM_MORE[ot.day.s].plus.replace(/\.$/, '')})이 만나 서로를 더 빛나게 해 줘요.`);
  // 좋은 점 위주로: 점수는 높게, 한마디도 좋은 쪽으로
  score = Math.max(80, Math.min(99, Math.round(score + 12)));
  const word = score >= 95 ? '천생연분 💖' : score >= 90 ? '찰떡궁합 💞' : score >= 85 ? '아주 좋은 궁합 😊' : '함께라서 더 좋은 궁합 🥰';
  notes.push(`${josa(meName, '과', '와')} ${josa(otherName, '은', '는')} 서로에게 소중한 선물 같은 사이예요. 함께 웃고 이야기하는 시간이 많을수록 더 깊어져요.`);
  return { score, word, notes };
}

const starText = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

/**
 * 사람 한 명의 사주 풀이
 * @param person { name, date, time }
 * @param today 'YYYY-MM-DD' (한국 날짜)
 */
export function readSaju(person, today, nowTime = '12:00', others = []) {
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
  // ---- 평생운세 자세히 ----
  const godsSorted = Object.entries(a.gods).sort((x, y) => y[1] - x[1]).map((x) => x[0]);
  const groups = {};
  for (const [g, n] of Object.entries(a.gods)) groups[GOD_GROUP[g]] = (groups[GOD_GROUP[g]] || 0) + n;
  const topGroup = Object.entries(groups).sort((x, y) => y[1] - x[1])[0][0];
  const second = godsSorted.find((g) => GOD_GROUP[g] !== GOD_GROUP[topGod]);
  const yinCount = [p.year, p.month, p.day, p.hour].filter(Boolean).reduce((n, x) => n + (x.s % 2) + (x.b % 2), 0);
  const total = [p.year, p.month, p.day, p.hour].filter(Boolean).length * 2;
  const personality = [
    `장점: ${DM_MORE[p.day.s].plus}`,
    `조심할 점: ${DM_MORE[p.day.s].minus}`,
    `'${topGod}' 성향이 가장 강해요. ${GOD_TEXT[topGod].life}` + (second ? ` 또 '${second}' 성향도 있어 ${GOD_TEXT[second].life}` : ''),
    yinCount > total / 2 + 1
      ? '음(陰)의 기운이 많아 차분하고 생각이 깊은 편이에요. 속으로 정리한 뒤 행동해요.'
      : yinCount < total / 2 - 1
        ? '양(陽)의 기운이 많아 활발하고 행동이 빨라요. 생각보다 몸이 먼저 움직여요.'
        : '음과 양이 고르게 있어 차분함과 활발함을 함께 가지고 있어요.',
  ];
  const elFirst = EL[STEM_EL[p.day.s]];
  const jobs = [
    `타고난 ${EL_NAME[elFirst]} 기운으로는 ${JOB_EL[elFirst]} 쪽이 잘 맞아요.`,
    `사주에 '${topGroup}' 기운이 많아 ${JOB_GOD[topGroup]}에서 힘을 발휘해요.`,
    `힘이 되는 ${EL_NAME[useful]} 기운과 관련된 ${JOB_EL[useful].split(', ').slice(0, 3).join(', ')} 분야도 운을 살려 줘요.`,
  ];
  const usefulStems = STEMS.filter((_, i) => STEM_EL[i] === a.useful).join('·');
  const sam = SAMHAP.find((g) => g.includes(p.year.b)).filter((b) => b !== p.year.b);
  const goodAnimals = [...new Set([...sam, HARMONY[p.year.b]])].map((b) => ANIMALS[b] + '띠');
  const match = [
    `${EL_NAME[useful]} 기운을 타고난 사람(${usefulStems} 일간)이 곁에 있으면 서로 힘이 돼요.`,
    `띠로는 ${goodAnimals.join(', ')}와 잘 어울려요. ${ANIMALS[CLASH[p.year.b]]}띠와는 서로 다른 매력이 있어 함께하면 배울 게 많아요.`,
    a.strong
      ? '스스로 힘이 넘치는 편이라, 차분하게 들어 주고 방향을 잡아 주는 사람과 잘 맞아요.'
      : '마음이 섬세한 편이라, 따뜻하게 응원해 주고 믿어 주는 사람과 잘 맞아요.',
  ];
  const blocks = [
    { t: '🌱 타고난 기운', p: life.slice(0, 3) },
    { t: '😊 성격 특성', p: personality },
    { t: '💼 어울리는 직업', p: jobs },
    { t: '🤝 잘 맞는 사람', p: match },
  ];
  for (const o of others) {
    const op = fourPillars(o.date, o.time);
    const oa = analyze(op);
    const c = compatibility(name, p, a, o.name, op, oa);
    // 누가 보든 같은 점수가 나오게 (양쪽에서 본 점수의 가운데)
    const back = compatibility(o.name, op, oa, name, p, a);
    c.score = Math.round((c.score + back.score) / 2);
    c.word = c.score >= 95 ? '천생연분 💖' : c.score >= 90 ? '찰떡궁합 💞' : c.score >= 85 ? '아주 좋은 궁합 😊' : '함께라서 더 좋은 궁합 🥰';
    blocks.push({ t: `💞 ${josa(o.name, '과', '와')}의 궁합 · ${c.score}점 ${c.word}`, p: c.notes });
  }
  blocks.push({ t: '🍀 생활 조언', p: [life[4]] });

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
      life: { title: '평생운세', head: `${dm.img} · ${a.strong ? '신강' : '신약'}`, text: [], blocks },
      year: { title: `${ty}년 운세`, head: `${yearP.ko}(${yearP.hanja})년 · ${starText(yr.stars)}`, text: yr.text },
      month: { title: '이달의 운세', head: `${monthP.ko}(${monthP.hanja})월 · ${starText(mo.stars)}`, text: mo.text },
      day: { title: '오늘의 운세', head: `${dayP.ko}(${dayP.hanja})일 · ${starText(dy.stars)}`, text: [...dy.text, lucky] },
    },
  };
}
