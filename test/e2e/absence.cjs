const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const mk = async (role) => { const p = await (await b.newContext({ ...devices['Pixel 7'] })).newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
    await p.goto('http://localhost:5173/?emu=1'); await p.click(`#loginForm .role-btn[data-role=${role}]`); await p.fill('#pin', '0000'); await p.press('#pin', 'Enter'); await p.waitForSelector('#app:visible'); return p; };
  const mom = await mk('엄마'), dad = await mk('아빠');
  await mom.click('.bottom [data-view=calendar]'); await dad.click('.bottom [data-view=calendar]'); await mom.waitForTimeout(500);
  console.log('달력 카드:', await mom.textContent('#absEntryTitle'), '|', await mom.textContent('#absEntrySub'), '| 날 버튼:', await mom.textContent('#dayAbsence'));
  await mom.click('#goAbsence'); await mom.waitForTimeout(300);
  console.log('화면:', await mom.textContent('#absTitle'), '|', await mom.textContent('#absRange'));
  await mom.fill('#absLimit', '7'); await mom.press('#absLimit', 'Enter'); await mom.locator('#absLimit').blur(); await mom.waitForTimeout(300);
  console.log('토스트:', await mom.textContent('#toast'));
  const add = async (date, type, note) => { await mom.click('#absAdd'); await mom.fill('#absenceForm input[name=date]', date); await mom.click(`#absenceForm label:has(input[value=${type}]) span`); await mom.fill('#absenceForm input[name=note]', note); await mom.click('#absenceForm button[type=submit]'); await mom.waitForTimeout(400); };
  await add('2026-11-03', 'normal', '감기'); await add('2026-11-10', 'excused', '병원 진단서'); await add('2026-11-17', 'outside', '가족 체험학습'); await add('2026-09-15', 'normal', '장염');
  console.log('게이지:', (await mom.textContent('#absGauge')).replace(/\s+/g, ' '), '| 종류:', (await mom.textContent('#absKinds')).replace(/\s+/g, ' '));
  console.log('목록:', await mom.$$eval('.abs-item', x => x.map(i => i.textContent.replace(/\s+/g, ' ').trim())));
  await mom.screenshot({ path: 'abs-view.png', fullPage: true });
  await dad.waitForTimeout(1200);
  console.log('아빠 토스트:', await dad.textContent('#toast'), '| 아빠 카드:', await dad.textContent('#absEntrySub'), '| N', await dad.isVisible('#absEntryDot'));
  console.log('아빠 달력 표시:', await dad.$$eval('.cal-day.absent', x => x.map(i => i.textContent)));
  await dad.click('.cal-day.abs-outside'); await dad.waitForTimeout(300); console.log('아빠 고른 날:', await dad.textContent('#dayAbsence'));
  await dad.locator('#calGrid').screenshot({ path: 'abs-cal.png' });
  // 고치기: 인정 → 일반
  await dad.click('#dayAbsence [data-abs-edit]'); await dad.click('#absenceForm label:has(input[value=normal]) span'); await dad.click('#absenceForm button[type=submit]'); await dad.waitForTimeout(400);
  console.log('고친 뒤 아빠 토스트:', await dad.textContent('#toast'));
  // 날짜 위 결석 넣기 (오늘)
  await dad.click('#goAbsence'); await dad.waitForTimeout(300); console.log('아빠 화면 N:', await dad.$$eval('.abs-item .new-dot', x => x.length), (await dad.textContent('#absGauge')).replace(/\s+/g, ' '));
  await dad.waitForTimeout(1800); await dad.click('#topLeftBtn'); await dad.click('.bottom [data-view=calendar]'); await dad.waitForTimeout(300); console.log('본 뒤 N:', await dad.isVisible('#absEntryDot'));
  // 넘기기
  await mom.fill('#absLimit', '2'); await mom.locator('#absLimit').blur(); await mom.waitForTimeout(500); console.log('넘음:', (await mom.textContent('#absGauge')).replace(/\s+/g, ' '));
  console.log('errs', mom.errs, dad.errs); await b.close();
})();
