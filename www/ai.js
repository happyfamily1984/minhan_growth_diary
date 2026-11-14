// 월별 AI 성장 분석: 그 달의 기록을 Claude 에게 보내서 민한이의 상황·심리·발달을 긍정적으로 읽어 달라고 한다.
// 구글 Gemini 무료 등급을 Firebase(우리 가족 클라우드)로 불러서 쓴다 → 돈이 들지 않고, 키도 따로 필요 없다
// (사주·글자 읽기와 달리 인터넷이 필요하다)
import { getAI, getGenerativeModel, GoogleAIBackend, AIError } from './vendor/firebase.js';
import { firebaseApp } from './store.js';
import { age, BIRTH_DATE } from './shared.js';

// 앞에서부터 써 보고, 없어진 모델이면 다음 것으로
const MODELS = ['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const KIND_KO = { say: '한 말', funny: '웃긴 말', did: '한 일' };

const SYSTEM = `당신은 아동발달과 아동심리를 깊이 공부한 따뜻한 전문가이자, 한 가족의 성장일기를 함께 읽는 다정한 조력자입니다.
부모가 기록한 아이(민한이)의 말과 행동을 읽고, 그 달의 민한이를 긍정적이고 강점 중심으로 분석해 부모에게 들려줍니다.

원칙
- 기록에 실제로 나온 말과 행동을 근거로 이야기합니다. 기록에 없는 일은 지어내지 않습니다. 기록을 인용할 때는 원래 표현을 짧게 그대로 따옵니다.
- 긍정적·강점 중심으로 해석합니다. 걱정스러워 보이는 모습도 그 나이에 자연스러운 성장 과정으로서 어떤 의미가 있는지 따뜻하게 풀어 줍니다. 진단명, 병리적 표현, 다른 아이와의 비교, 점수 매기기는 하지 않습니다.
- 그 나이(만 나이) 아이의 일반적인 발달 특징(언어, 인지, 정서, 사회성, 자아)과 연결해 설명하되 단정하지 않습니다.
- 부모가 읽고 뿌듯하고 힘이 나도록 쉽고 다정한 한국어 존댓말로 씁니다. 전문용어를 쓰면 바로 쉬운 말로 풀어 줍니다.
- 기록이 적거나 어떤 영역의 기록이 없으면 그 부분은 짧게, 있는 기록 안에서만 이야기합니다.

형식 (제목은 아래 그대로 ## 로 시작하고, 각 부분은 2~5문장 또는 짧은 목록 "- " 으로. 전체 1500~2500자 정도. 굵게는 **이렇게**)
## 🌈 이달의 민한이 한눈에
## 🏡 요즘 민한이의 상황 (생활과 관심사)
## 💬 말과 생각 (언어·인지 발달)
## 💗 마음과 감정 (정서·심리)
## 🤝 관계와 사회성
## 😂 유머와 상상력
## ✨ 이달에 반짝인 순간
## 👨‍👩‍👦 부모님께 드리는 작은 팁
## 💌 민한이에게 한마디`;

/** 그 달 민한이 나이 (그 달 마지막 날, 이번 달이면 오늘 기준) */
export function monthAge(month, today) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const d = last > today ? today : last;
  return d < BIRTH_DATE ? { years: 0, months: 0, days: 0 } : age(d);
}
/** "10세 10월" (알림·제목에 쓰는 짧은 이름) */
export function monthLabel(month, today) {
  const a = monthAge(month, today);
  return `${a.years}세 ${Number(month.slice(5))}월`;
}

export function buildPrompt({ month, entries, photos, today, prev }) {
  const a = monthAge(month, today);
  const [y, m] = month.split('-').map(Number);
  const lines = entries.map((e) => {
    const note = e.note ? ` (메모: ${e.note})` : '';
    return `- ${e.date}${e.time ? ' ' + e.time : ''} [${KIND_KO[e.kind] || '한 말'}] ${e.text}${note}${e.author ? ` — ${e.author} 기록` : ''}`;
  });
  const pics = photos.filter((p) => p.caption).map((p) => `- ${p.date} 사진 설명: ${p.caption}`);
  return [
    `민한이 (남자아이, 2016년 2월 22일생)의 ${y}년 ${m}월 성장일기입니다. 이 달의 민한이는 만 ${a.years}세 ${a.months}개월입니다.`,
    `기록 ${entries.length}개${pics.length ? `, 사진 설명 ${pics.length}개` : ''}가 있어요.`,
    '',
    '<기록>',
    ...lines,
    ...(pics.length ? ['', ...pics] : []),
    '</기록>',
    ...(prev ? ['', `참고: 지난번(${prev.month}) 분석의 요약입니다. 이어지는 성장이 보이면 짚어 주세요.`, '<지난분석요약>', prev.summary, '</지난분석요약>'] : []),
    '',
    `위 기록으로 ${y}년 ${m}월의 민한이를 형식에 맞춰 긍정적으로 분석해 주세요.`,
  ].join('\n');
}

/** 분석 결과 글에서 첫 부분(한눈에)만 뽑기 — 다음 달 분석에 이어 줄 때 */
export function summaryOf(text) {
  const parts = String(text || '').split(/^## /m);
  return (parts[1] || parts[0] || '').replace(/^[^\n]*\n/, '').trim().slice(0, 800);
}

function friendlyError(err) {
  const msg = String(err?.message || err || '');
  const code = err instanceof AIError ? err.code : '';
  if (code === 'api-not-enabled' || /not been used|is disabled|SERVICE_DISABLED|API_NOT_ENABLED/i.test(msg))
    return 'Firebase에서 AI 기능이 아직 꺼져 있어요. Firebase 콘솔 › AI Logic › 시작하기(Gemini Developer API)를 한 번 눌러 주세요';
  if (/429|quota|RESOURCE_EXHAUSTED|rate/i.test(msg)) return '오늘 무료로 쓸 수 있는 양을 다 썼거나 잠깐 많이 눌렀어요. 조금 뒤(또는 내일) 다시 해 주세요';
  if (code === 'fetch-error' || /Failed to fetch|NetworkError|network/i.test(msg)) return '인터넷 연결을 확인해 주세요';
  if (/SAFETY|blocked/i.test(msg)) return 'AI가 이번 분석을 하지 못했어요. 다시 한 번 눌러 주세요';
  return 'AI 분석 중 문제가 생겼어요: ' + msg.slice(0, 160);
}
const isModelGone = (err) => /\b404\b|not found|is not supported|NOT_FOUND/i.test(String(err?.message || ''));

/** 분석하기. onText(지금까지 쓴 글) 로 쓰는 중인 글을 보여 준다 */
export async function analyzeMonth({ month, entries, photos, today, prev, onText }) {
  const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });
  const prompt = buildPrompt({ month, entries, photos, today, prev });
  let lastErr;
  for (const name of MODELS) {
    const model = getGenerativeModel(ai, {
      model: name,
      systemInstruction: SYSTEM,
      generationConfig: { maxOutputTokens: 8192, temperature: 0.8 },
    });
    let text = '';
    try {
      const res = await model.generateContentStream(prompt);
      for await (const chunk of res.stream) {
        let part = '';
        try {
          part = chunk.text();
        } catch {}
        if (part) {
          text += part;
          onText?.(text);
        }
      }
      text = text.trim();
      if (!text) throw new Error('AI가 빈 답을 보냈어요. 다시 한 번 눌러 주세요');
      return { text, model: name };
    } catch (err) {
      lastErr = err;
      if (!text && isModelGone(err)) continue; // 다음 모델로
      break;
    }
  }
  throw new Error(friendlyError(lastErr));
}

/** 분석 글(## 제목, - 목록, **굵게**) → 화면용 HTML */
export function renderAnalysis(text, esc) {
  const out = [];
  let list = null;
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const flush = () => {
    if (list) out.push(`<ul>${list.join('')}</ul>`);
    list = null;
  };
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (/^#{1,4} /.test(line)) {
      flush();
      out.push(`<h3>${inline(line.replace(/^#+ /, ''))}</h3>`);
    } else if (/^[-*•] /.test(line)) {
      (list ||= []).push(`<li>${inline(line.slice(2))}</li>`);
    } else {
      flush();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  flush();
  return out.join('');
}
