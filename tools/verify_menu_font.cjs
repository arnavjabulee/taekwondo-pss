const assert = require('node:assert/strict'),
  path = require('node:path');
const { chromium } = require('playwright');
const { createUiServer } = require('../apps/desktop/server.cjs');
(async () => {
  const server = createUiServer(
    path.resolve('dist/electron/UoBTKD Training Suite-win32-x64/resources/suite/web'),
    path.resolve('apps/desktop'),
    { previewRoot: path.resolve('.'), receiverAddress: '127.0.0.1:1' }
  );
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.getByRole('button', { name: 'Competition', exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    for (const name of [
      'Competition',
      'Court Training',
      'Free Training',
      'Equipment',
      'Settings',
      'Quit'
    ]) {
      const style = await page.getByRole('button', { name, exact: true }).evaluate((el) => ({
        caps: getComputedStyle(el).fontVariantCaps,
        family: getComputedStyle(el).fontFamily
      }));
      assert.equal(style.caps, 'all-small-caps');
      assert(style.family.includes('Source Sans 3'));
    }
    assert.equal(await page.getByText('Start a session', { exact: true }).count(), 0);
    const session = await page.context().newCDPSession(page);
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const doc = await session.send('DOM.getDocument');
    const node = await session.send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: '.pss-launcher-mode'
    });
    const fonts = await session.send('CSS.getPlatformFontsForNode', { nodeId: node.nodeId });
    assert(
      fonts.fonts.some((font) => font.isCustomFont && font.familyName.includes('Source Sans'))
    );
    console.log(
      'Verified genuine bundled font and all-small-caps on all six buttons:',
      fonts.fonts.map((f) => f.familyName)
    );
    await page.screenshot({ path: 'test-results/menu-small-caps.png' });
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
