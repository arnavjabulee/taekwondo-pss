/* Browser regression check with synthetic athletes; never contacts a receiver. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = path.resolve(__dirname, '../LedaSport-English/nginx/html/train');
const artifacts = path.resolve(__dirname, '../test-results');
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

async function main() {
  fs.mkdirSync(artifacts, { recursive: true });
  const server = http.createServer((request, response) => {
    if (request.url === '/favicon.ico') {
      response.writeHead(204);
      response.end();
      return;
    }
    let file = path.resolve(
      web,
      '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    );
    if (!path.extname(file)) file = path.join(web, 'index.html');
    if (!file.startsWith(web + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.routeWebSocket('**', (socket) => socket.close());
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.stack));
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(message.text());
    });
    await page.addInitScript(() => {
      const rows = [
        {
          index: 1,
          name: 'Alex Morgan',
          weight: 58,
          court: 1,
          toukui: '000000000011',
          huju: '000000000001'
        },
        {
          index: 2,
          name: 'Sam Taylor',
          weight: 62,
          court: 1,
          toukui: '000000000012',
          huju: '000000000002'
        },
        {
          index: 3,
          name: 'Jordan Lee',
          weight: 54,
          court: 2,
          toukui: '000000000013',
          huju: '000000000003'
        },
        {
          index: 4,
          name: 'Casey Brown',
          weight: 60,
          court: 2,
          toukui: '000000000014',
          huju: '000000000004'
        }
      ];
      localStorage.setItem(
        'xlgame_settings',
        JSON.stringify({ changci_begin: 0, changci_end: 4, game_begin: 0, game_end: 4, extra: '' })
      );
      rows.forEach((row, index) =>
        localStorage.setItem(index + '_xlgamedata', JSON.stringify(row))
      );
    });
    const base = 'http://127.0.0.1:' + server.address().port;
    await page.goto(base + '/gamedata');
    await page
      .locator('.leda-athletes')
      .waitFor({ timeout: 10000 })
      .catch(async (error) => {
        await page.screenshot({ path: path.join(artifacts, 'failure.png') });
        console.log(await page.locator('body').innerText());
        console.log(errors);
        throw error;
      });
    assert.equal(await page.locator('.leda-athletes .leda-colour-blue').count(), 2);
    await page.screenshot({ path: path.join(artifacts, 'athletes.png') });
    await page.getByRole('button', { name: 'Train', exact: true }).click();
    await page.locator('.leda-courts:visible').waitFor();
    await page.evaluate(() => {
      window.LEDA_SENSOR_MONITOR.receive('000000000002,value:2865');
      window.LEDA_SENSOR_MONITOR.receive('000000000003,value:582');
    });
    await page
      .locator('.leda-courts:visible')
      .getByText('Body: 2865 raw (L71.63)', { exact: true })
      .waitFor();
    await page.screenshot({ path: path.join(artifacts, 'courts.png') });
    await page.getByRole('button', { name: 'Sensor levels', exact: true }).click();
    await page.getByRole('dialog', { name: 'Sensor levels' }).waitFor();
    await page.evaluate(() => window.OnVkSpace());
    assert.equal(await page.getByRole('button', { name: 'Start', exact: true }).isVisible(), true);
    await page.getByText('Meets threshold', { exact: true }).first().waitFor();
    assert.equal(await page.locator('.leda-threshold-field input').count(), 3);
    await page.locator('.leda-threshold-field input').first().fill('71');
    await page.locator('.leda-threshold-field input').first().press('Tab');
    const saved = await page.evaluate(
      () => JSON.parse(localStorage.getItem('0_changdi_data')).lidu
    );
    assert.equal(saved, 71);
    await page.screenshot({ path: path.join(artifacts, 'sensors.png') });
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').isVisible(), false);
    assert.equal(
      await page
        .getByRole('button', { name: 'Sensor levels', exact: true })
        .evaluate((el) => el === document.activeElement),
      true
    );
    await page.getByRole('button', { name: 'Sensor levels', exact: true }).click();
    await page.getByRole('button', { name: 'Listen for hits', exact: true }).click();
    await page
      .getByRole('alert')
      .getByText(/Receiver offline/)
      .waitFor();
    await page.getByRole('button', { name: 'Close sensor levels' }).click();
    // Check the denser layout at a laptop viewport.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: path.join(artifacts, 'courts-laptop.png') });
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
    for (const count of [1, 8, 16]) {
      await page.locator('.dropdown-toggle').click();
      await page
        .locator('.dropdown-item')
        .getByText('Courts × ' + count, { exact: true })
        .click();
      await page.locator('.leda-courts:visible').waitFor();
      await page.screenshot({ path: path.join(artifacts, 'courts-' + count + '.png') });
    }
    assert.deepEqual(errors, []);
    console.log(
      'Browser checks passed: roster, court routing, live readings, threshold persistence, dialog keyboard/focus, offline feedback, and laptop viewport.'
    );
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
