const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { createBridge } = require('../services/judge-bridge/server.cjs');
async function main() {
  fs.mkdirSync(path.resolve(__dirname, '../test-results'), { recursive: true });
  const web = path.resolve(__dirname, '../UoBTKD Training Suite/nginx/html/train');
  const server = http.createServer((req, res) => {
    let file = path.resolve(web, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!path.extname(file)) file = path.join(web, 'index.html');
    if (!file.startsWith(web + path.sep) || !fs.existsSync(file)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader(
      'Content-Type',
      {
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.html': 'text/html',
        '.png': 'image/png',
        '.mp3': 'audio/mpeg'
      }[path.extname(file)] || 'application/octet-stream'
    );
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let networkReady = false,
    enableCalls = 0,
    cancelSetup = true;
  const networkSetup = {
    status: async () => ({
      state: networkReady ? 'ready' : 'required',
      message: networkReady
        ? 'Phone connections enabled on your local network.'
        : 'Enable phone connections.'
    }),
    enable: async () => {
      enableCalls++;
      if (cancelSetup) throw new Error('Network setup was cancelled.');
      networkReady = true;
      return networkSetup.status();
    }
  };
  const bridge = createBridge({ desktopOrigins: [origin], networkSetup });
  await new Promise((resolve) => bridge.server.listen(0, '127.0.0.1', resolve));
  const endpoint = 'http://127.0.0.1:' + bridge.server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.routeWebSocket('**', (socket) => {
      if (socket.url().includes('/live/desktop')) socket.connectToServer();
      else socket.close();
    });
    const polled = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/desktop/sync')) polled.push(request.url());
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin);
    await page.waitForFunction(() => !!window.PSS_JUDGES);
    await page.evaluate((value) => window.PSS_JUDGES.setEndpoint(value), endpoint);
    await page.getByRole('button', { name: 'Competition', exact: true }).click();
    await page.locator('.pss-referee-setup').waitFor();
    assert.equal(await page.locator('.pss-competition-setup').count(), 0);
    await page.locator('select[aria-label="Number of mobile judges"]:visible').selectOption('1');
    await page.getByRole('button', { name: 'Connect mobile judges', exact: true }).click();
    await page.locator('[data-judge-code]:visible').waitFor();
    let code = await page.locator('[data-judge-code]:visible').innerText();
    assert.match(code, /^\d{6}$/);
    const originalCode = code;
    const originalQr = await page
      .locator('[data-judge-qr-url]:visible')
      .getAttribute('data-judge-qr-url');
    await page.getByRole('button', { name: 'Refresh pairing code', exact: true }).click();
    await page.waitForFunction(
      (old) => document.querySelector('[data-judge-code]').textContent !== old,
      originalCode
    );
    code = await page.locator('[data-judge-code]:visible').innerText();
    const invitation = await page
      .locator('[data-judge-qr-url]:visible')
      .getAttribute('data-judge-qr-url');
    assert.equal(new URLSearchParams(new URL(invitation).hash.slice(1)).get('code'), code);
    assert.notEqual(invitation, originalQr, 'Refreshing the code regenerates the invitation QR');
    assert.equal(await page.locator('[data-judge-qr-url]:visible svg').count(), 1);
    assert(await page.locator('[data-judge-qr-url]:visible svg').isVisible());
    await page
      .locator('[data-judge-qr-url]:visible')
      .screenshot({ path: path.resolve(__dirname, '../test-results/referee-qr.png') });
    fs.mkdirSync(path.resolve(__dirname, '../test-results'), { recursive: true });
    await page.screenshot({
      path: path.resolve(__dirname, '../test-results/referee-qr-setup.png')
    });
    await page.getByRole('button', { name: 'Enable phone connections', exact: true }).click();
    await page
      .locator('[data-judge-network]:visible')
      .getByText('Network setup was cancelled.', { exact: true })
      .waitFor();
    cancelSetup = false;
    await page.getByRole('button', { name: 'Enable phone connections', exact: true }).click();
    await page
      .locator('[data-judge-network]:visible')
      .getByText('Phone connections enabled on your local network.', { exact: true })
      .waitFor();
    assert.equal(enableCalls, 2);
    assert.equal(
      await page.getByRole('button', { name: 'Enable phone connections', exact: true }).count(),
      0
    );
    await page.getByRole('button', { name: 'Check network access', exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-judge-network]').textContent ===
        'Phone connections enabled on your local network.'
    );
    assert.equal(enableCalls, 2, 'Checking configured network access never prompts for elevation');
    const phones = [];
    for (const name of ['One', 'Two', 'Three']) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true
      });
      const phone = await context.newPage();
      phone.on('request', (request) => {
        if (/\/api\/judge\/(punch|state)/.test(request.url())) polled.push(request.url());
      });
      phone.on('pageerror', (error) => errors.push(error.message));
      await phone.goto(endpoint + '/' + new URL(invitation).hash);
      await phone.locator('#judge-name').fill(name);
      assert.equal(
        await phone.locator('#match-code').inputValue(),
        code,
        'Scanning pre-fills the match code'
      );
      await phone.getByRole('button', { name: 'Pair with match', exact: true }).click();
      await page.getByRole('button', { name: 'Approve ' + name, exact: true }).click();
      phones.push(phone);
      if (name === 'One' || name === 'Two') {
        await page
          .getByLabel('Number of mobile judges', { exact: true })
          .selectOption(name === 'One' ? '2' : '3');
        await phones[0]
          .locator('#policy')
          .getByText(
            name === 'One'
              ? 'Either judge scores. Same-side inputs within 3 seconds count once.'
              : 'Two different judges must agree within 3 seconds.',
            { exact: true }
          )
          .waitFor();
        await phones[0].waitForFunction(
          () => document.querySelector('#connection').textContent === 'Connected'
        );
      }
    }
    const blue = (phone) => phone.getByRole('button', { name: 'Blue punch', exact: true });
    assert(await blue(phones[0]).isDisabled());
    await page.getByRole('button', { name: 'Continue to protector test', exact: true }).click();
    await page.locator('.pss-competition-setup').waitFor();
    await phones[0].waitForFunction(
      () => document.querySelector('#connection').textContent === 'Connected'
    );
    await page.getByRole('button', { name: 'Corner referees', exact: true }).click();
    assert.equal(
      await page.locator('[data-judge-code]:visible').innerText(),
      code,
      'Back navigation preserves pairing'
    );
    await page.getByRole('button', { name: 'Continue to protector test', exact: true }).click();
    await page.getByLabel('Blue competitor name', { exact: true }).fill('Blue Judge Test');
    await page.getByLabel('Red competitor name', { exact: true }).fill('Red Judge Test');
    await page.getByRole('button', { name: 'Enter match mode', exact: true }).click();
    await page.locator('.pss-competition .uobtkd-courts:visible').waitFor();
    assert.equal(
      await page.locator('.pss-judge-panel:visible').count(),
      0,
      'Match mode has no inline judge panel'
    );
    await page.getByRole('button', { name: 'Corner referees', exact: true }).click();
    assert.equal(
      await page.locator('[data-judge-code]:visible').innerText(),
      code,
      'Match mode keeps approved referees'
    );
    await page.getByRole('button', { name: 'Return to match', exact: true }).click();
    polled.length = 0; // The one-shot paused handoff uses HTTP when closing the setup socket.
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await blue(phones[0]).waitFor({ state: 'visible' });
    await phones[0].waitForFunction(
      () => !document.querySelector('[aria-label="Blue punch"]').disabled
    );
    async function punch(phone) {
      await blue(phone).dispatchEvent('pointerdown', { button: 0, isPrimary: true });
    }
    const score = () => page.locator('.uobtkd-courts:visible .pss-score').first().innerText();
    await punch(phones[0]);
    await punch(phones[0]);
    await page.waitForTimeout(500);
    assert.equal(await score(), '0');
    await punch(phones[1]);
    await page.waitForFunction(
      () => document.querySelector('.pss-score').textContent.trim() === '1'
    );
    await punch(phones[2]);
    await page.waitForTimeout(500);
    assert.equal(await score(), '1');
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await phones[0].waitForFunction(
      () => document.querySelector('[aria-label="Blue punch"]').disabled
    );
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await phones[0].waitForFunction(
      () => !document.querySelector('[aria-label="Blue punch"]').disabled
    );
    await punch(phones[0]);
    await punch(phones[1]);
    await page.waitForFunction(
      () => document.querySelector('.pss-score').textContent.trim() === '2'
    );
    fs.mkdirSync(path.resolve(__dirname, '../test-results'), { recursive: true });
    await phones[0].screenshot({
      path: path.resolve(__dirname, '../test-results/judge-phone.png')
    });
    await page.screenshot({ path: path.resolve(__dirname, '../test-results/judge-desktop.png') });
    assert.deepEqual(
      polled,
      [],
      'Scoring and match updates use live sockets, without HTTP polling'
    );
    await page.getByRole('button', { name: 'Corner referees', exact: true }).click();
    await page.locator('.pss-referee-setup').waitFor();
    const pausedTime = await page.evaluate(
      () =>
        document.querySelector('.pss-referee-setup').__vue__.judgeHost.gvi.game[0].competition
          .remaining
    );
    await phones[0].waitForFunction(
      () => document.querySelector('[aria-label="Blue punch"]').disabled
    );
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.locator('select[aria-label="Number of mobile judges"]:visible').selectOption('2');
    assert.equal(
      await page.locator('select[aria-label="Number of mobile judges"]:visible').inputValue(),
      '3',
      'Cancelling a reduction keeps the old rule'
    );
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('select[aria-label="Number of mobile judges"]:visible').selectOption('2');
    await phones[2].locator('#pairing').waitFor({ state: 'visible' });
    await phones[0]
      .locator('#policy')
      .getByText('Either judge scores. Same-side inputs within 3 seconds count once.', {
        exact: true
      })
      .waitFor();
    await page.getByRole('button', { name: 'Return to match', exact: true }).click();
    assert.equal(await score(), '2', 'Managing referees preserves scores');
    assert.equal(
      await page.evaluate(
        () => document.querySelector('.uobtkd-training').__vue__.gvi.game[0].competition.remaining
      ),
      pausedTime,
      'Managing referees preserves the paused timer'
    );
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await phones[0].waitForFunction(
      () => !document.querySelector('[aria-label="Blue punch"]').disabled
    );
    await punch(phones[0]);
    await page.waitForFunction(
      () => document.querySelector('.pss-score').textContent.trim() === '3'
    );
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.evaluate(() =>
      document.querySelector('.uobtkd-training').__vue__.resetCompetitionMatch()
    );
    await phones[0].locator('#pairing').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Corner referees', exact: true }).click();
    await page.waitForFunction(
      (old) =>
        document.querySelector('[data-judge-code]') &&
        /^\d{6}$/.test(document.querySelector('[data-judge-code]').textContent) &&
        document.querySelector('[data-judge-code]').textContent !== old,
      code
    );
    await phones[0].locator('#pairing').waitFor({ state: 'visible' });
    assert.deepEqual(errors, []);
    console.log(
      'Mobile UI passed: pairing/approval, three-judge consensus, duplicate suppression, live desktop scores, pause/resume and fresh match pairing.'
    );
  } finally {
    if (browser) await browser.close();
    await bridge.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
