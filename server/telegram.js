// 텔레그램 봇 (long polling).
// - 봇에게 보내거나, 봇이 초대된 대화방의 메시지는 '받은 메시지함'에 쌓인다.
// - "민한: ..." / "#민한 ..." / "/m ..." 으로 시작하면 바로 일기에 저장된다.
// - 캡쳐(사진)를 보내면 받은 메시지함에 저장되고, 앱에서 글자를 읽어(OCR) 옮길 수 있다.
import { db, save, newId, addEntry } from './db.js';
import { seoulParts } from './time.js';
import { dayNumber } from '../public/shared.js';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ALLOWED = (process.env.TELEGRAM_ALLOWED_CHATS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const INBOX_LIMIT = 3000;
const API = `https://api.telegram.org/bot${TOKEN}`;

let botInfo = null;
let lastError = null;
let running = false;

export const telegramEnabled = () => Boolean(TOKEN);
export const telegramStatus = () => ({
  enabled: telegramEnabled(),
  running,
  username: botInfo?.username || null,
  allowedChats: ALLOWED,
  lastError,
});

async function call(method, params = {}) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`${method}: ${data.description}`);
  return data.result;
}

const reply = (msg, text) =>
  call('sendMessage', {
    chat_id: msg.chat.id,
    text,
    reply_to_message_id: msg.message_id,
    allow_sending_without_reply: true,
  }).catch((e) => console.error('[telegram] reply 실패', e.message));

function senderName(msg) {
  const o = msg.forward_origin;
  if (o) {
    if (o.sender_user) return fullName(o.sender_user);
    if (o.sender_user_name) return o.sender_user_name;
    if (o.chat) return o.chat.title;
  }
  if (msg.from) return fullName(msg.from);
  return msg.sender_chat?.title || '알 수 없음';
}
const fullName = (u) => [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || '';

const DIRECT_RE = /^\s*(?:\/m(?:@\w+)?\s+|#민한\s*|민한(?:이)?\s*[:：]\s*)([\s\S]+)$/;

async function handleMessage(msg) {
  const chatId = String(msg.chat.id);
  const text = msg.text || msg.caption || '';

  if (/^\/(start|help)(@\w+)?\b/.test(text)) {
    return reply(
      msg,
      [
        '👶 민한이 성장일기 봇이에요.',
        '',
        '• "민한: 오늘 한 말" 또는 "/m 오늘 한 말" → 바로 일기에 저장',
        '• 그 밖의 메시지 → 앱의 [가져오기 › 텔레그램 받은 메시지]에 모여요',
        '• 대화 캡쳐 사진 → 앱에서 글자를 읽어 옮길 수 있어요',
        '• /id → 이 대화방 ID 확인',
      ].join('\n'),
    );
  }
  if (/^\/id(@\w+)?\b/.test(text)) {
    return reply(msg, `이 대화방 ID: ${chatId}`);
  }

  if (ALLOWED.length && !ALLOWED.includes(chatId)) return; // 허용되지 않은 방은 무시

  const when = seoulParts(new Date((msg.forward_origin?.date || msg.date) * 1000));
  const base = {
    chatId,
    chatTitle: msg.chat.title || fullName(msg.chat) || '개인 대화',
    messageId: msg.message_id,
    from: senderName(msg),
    date: when.date,
    time: when.time,
  };

  const direct = text.match(DIRECT_RE);
  if (direct) {
    const entry = addEntry({
      date: base.date,
      time: base.time,
      text: direct[1].trim(),
      source: 'telegram',
      meta: { chatTitle: base.chatTitle, from: base.from },
    });
    save();
    return reply(msg, `✅ ${entry.date} (탄생 ${dayNumber(entry.date).toLocaleString()}일째)에 저장했어요.`);
  }

  const photo = msg.photo?.at(-1);
  const imageDoc = msg.document?.mime_type?.startsWith('image/') ? msg.document : null;
  if (photo || imageDoc) {
    pushInbox({ ...base, type: 'photo', fileId: (photo || imageDoc).file_id, text });
    save();
    if (msg.chat.type === 'private') {
      reply(msg, '📸 캡쳐를 받았어요. 앱의 [가져오기 › 텔레그램 받은 메시지]에서 글자를 읽어 옮길 수 있어요.');
    }
    return;
  }

  if (text && !text.startsWith('/')) {
    pushInbox({ ...base, type: 'text', text });
    save();
  }
}

function pushInbox(item) {
  const inbox = db().inbox;
  inbox.push({ id: newId(), receivedAt: new Date().toISOString(), ...item });
  if (inbox.length > INBOX_LIMIT) inbox.splice(0, inbox.length - INBOX_LIMIT);
}

export async function downloadFile(fileId) {
  const file = await call('getFile', { file_id: fileId });
  const res = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`);
  if (!res.ok) throw new Error('파일 다운로드 실패');
  return { buffer: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') };
}

export async function startTelegram() {
  if (!TOKEN) {
    console.log('[telegram] TELEGRAM_BOT_TOKEN 이 없어 봇을 끕니다.');
    return;
  }
  running = true;
  while (true) {
    try {
      if (!botInfo) {
        botInfo = await call('getMe');
        console.log(`[telegram] @${botInfo.username} 연결됨`);
      }
      const state = db().telegram;
      const updates = await call('getUpdates', {
        offset: state.offset,
        timeout: 50,
        allowed_updates: ['message', 'channel_post'],
      });
      for (const u of updates) {
        state.offset = u.update_id + 1;
        const msg = u.message || u.channel_post;
        if (msg) await handleMessage(msg).catch((e) => console.error('[telegram]', e));
      }
      if (updates.length) save();
      lastError = null;
    } catch (e) {
      lastError = e.message;
      console.error('[telegram]', e.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
