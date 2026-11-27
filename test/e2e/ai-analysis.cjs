const { chromium, devices } = require('playwright');
const TEXT = `## 🌈 이달의 민한이 한눈에\n이번 달 민한이는 **호기심**이 가득했어요.\n\n## 💬 말과 생각 (언어·인지 발달)\n- "공룡은 왜 없어졌어?" 라는 질문이 멋져요\n- 비유를 써요\n\n## 💌 민한이에게 한마디\n민한아, 사랑해!`;
function gsse() { return TEXT.match(/[\s\S]{1,20}/g).map(t => 'data: ' + JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: t }] } }] }) + '\r\n\r\n').join(''); }
function sse() {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  let out = ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } });
  out += ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
  for (const part of TEXT.match(/[\s\S]{1,20}/g)) out += ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: part } });
  out += ev('content_block_stop', { index: 0 });
  out += ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 50 } });
  out += ev('message_stop', {});
  return out;
}
(async () => {
  const b = await chromium.launch();
  let reqBody = null, reqHeaders = null; const seen = [];
  const mk = async (role) => { const ctx = await b.newContext({ ...devices['Pixel 7'] });
    await ctx.route('https://firebasevertexai.googleapis.com/**', async (r) => { const u = r.request().url(); seen.push(u.replace(/^.*models\//, '').replace(/\?.*/, ''));
      if (u.includes('gemini-3.6-flash')) return r.fulfill({ status: 404, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: { code: 404, message: 'models/gemini-3.6-flash is not found', status: 'NOT_FOUND' } }) });
      reqBody = JSON.parse(r.request().postData()); await new Promise(z => setTimeout(z, 1500)); r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: gsse() }); });
    const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
    await p.goto('http://localhost:5173/?emu=1'); await p.click(`#loginForm .role-btn[data-role=${role}]`); await p.fill('#pin', '0000'); await p.press('#pin', 'Enter'); await p.waitForSelector('#app:visible'); return p; };
  const dad = await mk('아빠'), mom = await mk('엄마');
  await dad.evaluate(async () => { const { store } = await import('./store.js');
    await store.put([{ date: '2026-10-03', kind: 'say', text: '공룡은 왜 없어졌어?' }, { date: '2026-10-10', kind: 'funny', text: '아빠 배는 수박 같아' }, { date: '2026-10-21', kind: 'did', text: '혼자 자전거를 탔다' }]); });
  await dad.waitForTimeout(800);
  await dad.click('#goAnalysis'); await dad.waitForTimeout(400);
  console.log('제목:', await dad.textContent('#aiTitle'), '| meta:', (await dad.textContent('#aiMeta')).replace(/\s+/g, ' '), '| 버튼:', await dad.textContent('#aiRun'), '| 힌트:', await dad.textContent('#aiHint'));
  await dad.click('#aiRun'); await dad.waitForTimeout(700);
  console.log('분석 중 버튼:', await dad.textContent('#aiRun'), '| 엄마 홈:', await mom.textContent('#aiEntrySub'));
  await dad.screenshot({ path: 'ai-running.png' });
  await dad.waitForTimeout(2500);
  console.log('결과 h3:', await dad.$$eval('#aiResult h3', x => x.map(i => i.textContent)), '| foot:', await dad.textContent('.ai-foot'));
  console.log('부른 모델:', seen, '| system?', !!reqBody.systemInstruction, '| config', JSON.stringify(reqBody.generationConfig));

  await mom.waitForTimeout(1200);
  console.log('엄마 토스트:', await mom.textContent('#toast'), '| 엄마 홈 N:', await mom.isVisible('#aiEntryDot'), await mom.textContent('#aiEntrySub'));
  await mom.click('#goAnalysis'); await mom.waitForTimeout(400);
  console.log('엄마가 본 달:', await mom.textContent('#aiTitle'), '| 버튼:', await mom.textContent('#aiRun'));
  await mom.screenshot({ path: 'ai-result.png', fullPage: true });
  await mom.click('#topLeftBtn'); await mom.waitForTimeout(300); console.log('본 뒤 N:', await mom.isVisible('#aiEntryDot'));
  // 업데이트: 새 기록 추가 후 다시
  await mom.evaluate(async () => { const { store } = await import('./store.js'); await store.put([{ date: '2026-10-25', kind: 'say', text: '하늘이 파래' }]); });
  await mom.click('#goAnalysis'); await mom.waitForTimeout(400); console.log('업데이트 힌트:', await mom.textContent('#aiHint'));
  await mom.click('#aiRun'); await mom.waitForTimeout(3500);
  console.log('업데이트 후:', await mom.textContent('.ai-foot'), '| 아빠 토스트:', await dad.textContent('#toast'));
  const a = await mom.evaluate(async () => { const { store } = await import('./store.js'); const x = store.analysis('2026-10'); return { v: x.version, hist: x.history.length, label: x.label, by: x.requestedBy }; });
  console.log(a);
  // 알림 눌러 열기 흉내
  await dad.evaluate(() => { window.AndroidNotify = undefined; });
  console.log('errs', dad.errs, mom.errs); await b.close();
})();
