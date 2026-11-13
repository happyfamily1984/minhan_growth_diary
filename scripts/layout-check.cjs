// 폰 너비 × 글씨 크기 조합으로 모든 화면을 열어, 글씨가 넘치거나 한 줄이어야 할 곳이 줄바꿈되는지 검사
const { chromium } = require('playwright');
const ONE_LINE = ['.cal-title', '.pill', '.dday .lbl', '.dday b', '.btn', '.hero-age', '.day-title',
  '.seg span', '.year-btn b', '.month-btn', '.section-title', '.cal-week span', '.badge', '.date-pill',
  '.editor-day', '.round-btn', '.login-msg', '.role-q', '.photo-empty b', '.author-mini', '.write-day'];
const SHOTS = process.argv.includes('--shots');
const DIR = '/tmp/claude-0/-home-user-minhan-growth-diary/68acafee-43ec-5b40-a1d2-41541ac82342/scratchpad/';
(async () => {
  const b = await chromium.launch();
  const problems = [];
  for (const width of [360, 393, 412]) for (const zoom of [100, 115, 130]) {
    const ctx = await b.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    // 안드로이드 '글꼴 크기' 설정 흉내: 기본 글씨 크기를 키움
    await p.addInitScript((z) => {
      document.addEventListener('DOMContentLoaded', () => {
        const s = document.createElement('style');
        s.textContent = `html{font-size:${(16 * z) / 100}px}`;
        document.head.append(s);
      });
    }, zoom);
    await p.goto('http://localhost:5173/?emu=1');
    await p.waitForSelector('#pin:visible');
    const check = async (screen) => {
      await p.waitForTimeout(300);
      const r = await p.evaluate((sels) => {
        const out = [];
        const vis = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
        const docW = document.documentElement.scrollWidth;
        if (docW > innerWidth + 1) out.push(`가로로 넘침 (페이지 너비 ${docW} > ${innerWidth})`);
        const skip = (el) => el.closest('.pick-years') || ['IMG', 'svg'].includes(el.tagName) || el.matches('.land, .hero-land, .deco, .text-star, .paste-pen, .spark');
        for (const el of document.querySelectorAll('body *')) {
          if (!vis(el) || skip(el)) continue;
          const dlg = el.closest('dialog');
          if (dlg && !dlg.open) continue;
          const rc = el.getBoundingClientRect();
          if (rc.width && (rc.right > innerWidth + 1 || rc.left < -1))
            out.push(`화면 밖으로 나감: ${el.tagName.toLowerCase()}.${el.className} "${(el.textContent || '').trim().slice(0, 20)}"`);
          if (el.children.length === 0 && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2 && !['TEXTAREA', 'INPUT'].includes(el.tagName))
            out.push(`글씨가 칸을 넘침: ${el.tagName.toLowerCase()}.${el.className} "${el.textContent.trim().slice(0, 20)}"`);
        }
        for (const sel of sels) for (const el of document.querySelectorAll(sel)) {
          if (!vis(el) || !el.textContent.trim()) continue;
          const dlg = el.closest('dialog');
          if (dlg && !dlg.open) continue;
          const range = document.createRange();
          range.selectNodeContents(el);
          const tops = [...range.getClientRects()].filter((x) => x.width > 1).map((x) => x.top + x.height / 2);
          const lines = new Set(tops.map((t) => Math.round(t / 14)));
          const allowed = el.innerHTML.includes('<br') ? 2 : 1;
          if (lines.size > allowed) out.push(`줄바꿈됨: ${sel} "${el.textContent.trim().replace(/\s+/g, ' ').slice(0, 24)}"`);
        }
        return [...new Set(out)];
      }, ONE_LINE);
      for (const x of r) problems.push(`[${width}px 글씨${zoom}%] ${screen}: ${x}`);
      if (SHOTS && width === 360 && zoom === 130) await p.screenshot({ path: `${DIR}L-${screen}.png` });
    };
    await check('로그인');
    await p.click('#loginForm .role-btn[data-role=아빠]');
    await p.fill('#pin', '7374');
    await p.press('#pin', 'Enter');
    await p.waitForSelector('#app:visible');
    if (await p.$eval('#roleDialog', (d) => d.open)) { await p.click('#roleForm .role-btn[data-role=아빠]'); await p.click('#roleForm button[type=submit]'); }
    await check('오늘');
    for (const v of ['calendar', 'photos', 'import']) {
      await p.click(`.bottom [data-view=${v}]`);
      await check(v);
    }
    await p.click('.bottom [data-view=calendar]');
    await p.click('#calTitleBtn');
    await check('년월고르기');
    await p.click('#pickToday');
    await p.click('#settingsBtn');
    await check('찾기');
    await p.click('#roleBtn');
    await check('기록자');
    await p.click('#roleForm button[type=submit]');
    await p.click('#navWrite');
    await check('쓰기');
    await ctx.close();
  }
  console.log(problems.length ? problems.join('\n') : '문제 없음 ✓');
  await b.close();
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
