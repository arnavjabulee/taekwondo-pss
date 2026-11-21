const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createUiServer } = require('../apps/desktop/server.cjs');
const path = require('node:path');
(async () => {
  const server = createUiServer(
    path.resolve('UoBTKD Training Suite/nginx/html/train'),
    path.resolve('apps/desktop')
  );
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const size of [
      { width: 1280, height: 720 },
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 }
    ]) {
      const page = await browser.newPage({ viewport: size });
      page.on('dialog', (d) => d.accept());
      await page.goto(base);
      await page.evaluate(() => {
        localStorage.clear();
        localStorage.setItem('uobtkd_desktop_migration_v1', '1');
      });
      await page.reload();
      async function check(label) {
        await page.waitForTimeout(100);
        const problems = await page.evaluate(() => {
          const errors = [];
          if (
            document.documentElement.scrollHeight > innerHeight + 1 ||
            document.documentElement.scrollWidth > innerWidth + 1
          )
            errors.push('Page scrolls');
          for (const element of document.querySelectorAll(
            '.pss-court,.pss-participant,.pss-free'
          )) {
            if (!element.getBoundingClientRect().height) continue;
            if (element.scrollHeight > element.clientHeight + 2)
              errors.push(
                element.className +
                  ' scrolls/clips ' +
                  element.scrollHeight +
                  '/' +
                  element.clientHeight
              );
          }
          for (const element of document.querySelectorAll('button,input,select')) {
            const b = element.getBoundingClientRect();
            if (!b.width || !b.height) continue;
            if (b.bottom > innerHeight + 1 || b.top < -1 || b.right > innerWidth + 1 || b.left < -1)
              errors.push(
                (element.textContent || element.getAttribute('aria-label') || element.tagName) +
                  ' outside viewport'
              );
          }
          return errors;
        });
        assert.deepEqual(problems, [], label + ' ' + size.width + 'x' + size.height);
      }
      await check('home');
      await page.getByRole('button', { name: 'Court Training', exact: true }).click();
      await check('court');
      await page.goto(base);
      await page.getByRole('button', { name: 'Competition', exact: true }).click();
      await page.getByRole('button', { name: 'Continue to protector test', exact: true }).click();
      await check('protector test');
      await page.getByLabel('Blue competitor name', { exact: true }).fill('Blue');
      await page.getByLabel('Red competitor name', { exact: true }).fill('Red');
      await page.getByRole('button', { name: 'Enter match mode', exact: true }).click();
      await check('competition');
      const points = await page
        .locator('.pss-courts:visible .pss-point-controls')
        .first()
        .locator('button')
        .evaluateAll((buttons) =>
          buttons.map((b) => {
            const r = b.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y };
          })
        );
      for (let i = 0; i < 3; i++) {
        assert(Math.abs(points[i].x - points[i + 3].x) < 1);
        assert(points[i + 3].y > points[i].y);
      }

      await page.getByRole('button', { name: 'Start', exact: true }).click();
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      await check('paused competition');
      await page.goto(base);
      await page.getByRole('button', { name: 'Free Training', exact: true }).click();
      for (let i = 0; i < 6; i++)
        await page.getByRole('button', { name: 'Add person', exact: true }).click();
      await check('free training');
      await page.close();
      console.log('No scrolling or clipped controls at ' + size.width + 'x' + size.height);
    }
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
