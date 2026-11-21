const assert = require('node:assert/strict'),
  path = require('node:path');
const { _electron } = require('playwright');
(async () => {
  let app;
  const decisions = [],
    prompts = [];
  try {
    if (process.env.UOBTKD_ESCAPE_BROWSER) {
      const { chromium } = require('playwright');
      const { createUiServer } = require('../apps/desktop/server.cjs');
      const server = createUiServer(
        path.resolve('UoBTKD Training Suite/nginx/html/train'),
        path.resolve('apps/desktop'),
        { receiverAddress: '127.0.0.1:1' }
      );
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const browser = await chromium.launch({ channel: 'msedge', headless: true });
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto('http://127.0.0.1:' + server.address().port);
      app = {
        firstWindow: async () => page,
        windows: () => context.pages(),
        close: async () => {
          await browser.close();
          server.close();
        }
      };
    } else {
      app = await _electron.launch({
        executablePath: require('electron'),
        args: [path.resolve('.')],
        env: {
          ...process.env,
          UOBTKD_DESKTOP_DATA: path.resolve('test-results/escape-profile-' + Date.now()),
          UOBTKD_RECEIVER_ADDRESS: '127.0.0.1:1'
        }
      });
    }
    const page = await app.firstWindow();
    page.on('dialog', (dialog) => {
      prompts.push(dialog.message());
      decisions.shift() ? dialog.accept() : dialog.dismiss();
    });
    await page.getByRole('button', { name: 'Competition', exact: true }).click();
    await page.getByRole('button', { name: 'Continue to protector test', exact: true }).click();
    await page.getByLabel('Blue competitor name', { exact: true }).fill('Blue');
    await page.getByLabel('Red competitor name', { exact: true }).fill('Red');
    await page.getByRole('button', { name: 'Enter match mode', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.locator('.pss-competition-setup').waitFor();
    assert.equal(prompts.length, 0);
    await page.getByRole('button', { name: 'Enter match mode', exact: true }).click();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByRole('tab', { name: 'Spectator display', exact: true }).click();
    const frame = page.frameLocator('.pss-spectator-frame');
    await frame.locator('body').click();
    await frame.locator('body').press('Space');
    await page.waitForFunction(
      () =>
        document.querySelector('.pss-competition').__vue__.gvi.game[0].competition.phase ===
        'running'
    );
    await frame.locator('body').press('Space');
    await page.waitForFunction(
      () =>
        document.querySelector('.pss-competition').__vue__.gvi.game[0].competition.phase ===
        'paused'
    );
    const windows = app.windows().length;
    await frame.locator('body').press('Escape');
    const confirmation = page.getByRole('alertdialog', { name: 'Leave match mode' });
    await confirmation.waitFor();
    assert.equal(app.windows().length, windows);
    assert(
      await confirmation
        .getByRole('button', { name: 'Cancel', exact: true })
        .evaluate((el) => el === document.activeElement)
    );
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.pss-competition'));
    assert.equal(prompts.length, 0);
    assert.equal(
      await page.evaluate(
        () => document.querySelector('.pss-competition').__vue__.gvi.game[0].competition.phase
      ),
      'paused'
    );
    await frame.locator('body').press('Escape');
    await confirmation.getByRole('button', { name: 'Leave match', exact: true }).click();
    await page.locator('.pss-competition-setup').waitFor();
    assert.equal(prompts.length, 0);
    await page.keyboard.press('Escape');
    await page.locator('.pss-referee-setup').waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Competition', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(prompts.length, 0);
    console.log(
      'Electron Escape passed: ready match leaves immediately; started match prompts from inside spectator preview; Cancel stays paused, repeated Escape works and confirmation returns to testing.'
    );
  } finally {
    if (app) await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
