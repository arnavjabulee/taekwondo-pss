const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { chromium } = require('playwright');
const { createUiServer } = require('../apps/desktop/server.cjs');
(async () => {
  const root = path.resolve('test-results/live-preview-' + Date.now()),
    styles = path.join(root, 'src/styles/app.css'),
    web = path.join(root, 'web');
  fs.mkdirSync(path.dirname(styles), { recursive: true });
  fs.copyFileSync('src/styles/app.css', styles);
  fs.mkdirSync(path.join(root, 'apps/desktop'), { recursive: true });
  fs.copyFileSync('apps/desktop/desktop.css', path.join(root, 'apps/desktop/desktop.css'));
  fs.cpSync('UoBTKD Training Suite/nginx/html/train', web, { recursive: true });
  const server = createUiServer(web, path.resolve('apps/desktop'), {
    previewRoot: root,
    receiverAddress: '127.0.0.1:1'
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.getByRole('button', { name: 'Competition', exact: true }).waitFor();
    await page.evaluate(() => (window.__preserved = 1));
    fs.appendFileSync(
      styles,
      '\n:root body .pss-home .pss-launcher-mode {color:rgb(120,180,240)!important;}'
    );
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector('.pss-launcher-mode')).color ===
        'rgb(120, 180, 240)'
    );
    assert.equal(
      await page.evaluate(() => window.__preserved),
      1,
      'Style updates do not reload the page'
    );
    await page.getByRole('button', { name: 'Free Training', exact: true }).click();
    await page.getByRole('button', { name: 'Add person', exact: true }).click();
    await page.locator('[data-person-name]').first().fill('Preview person');
    fs.appendFileSync(path.join(web, 'index.js'), '\n/* live preview test */');
    await page.waitForTimeout(1600);
    assert.equal(
      await page.evaluate(() => window.__preserved),
      1,
      'Script reload deferred away from Home'
    );
    assert.equal(await page.locator('[data-person-name]').first().inputValue(), 'Preview person');
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.waitForFunction(() => window.__preserved === undefined);
    await page.getByRole('button', { name: 'Free Training', exact: true }).click();
    await page.evaluate(() => {
      window.__manual = 1;
      window.PSS_DESKTOP.reloadInterface();
    });
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => window.__manual), 1);
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.waitForFunction(() => window.__manual === undefined);
    console.log(
      'Live preview passed: CSS updates without reload, interface reload waits for Home, draft person remains intact, manual reload queues safely.'
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
