const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { createBridge } = require('../services/judge-bridge/server.cjs');
const { createCameraTunnel } = require('../services/judge-bridge/camera-tunnel.cjs');

(async () => {
  const tunnel = createCameraTunnel({ root: path.resolve(__dirname, '..') });
  const bridge = createBridge({
    cameraTunnel: tunnel,
    replayDirectory: path.resolve('test-results/live-camera-recordings')
  });
  let browser;
  try {
    await new Promise((resolve) => bridge.server.listen(0, '127.0.0.1', resolve));
    console.log('Preparing the verified HTTPS helper and temporary camera-only tunnel…');
    const state = await tunnel.start('http://127.0.0.1:' + bridge.server.address().port);
    assert.equal(state.phase, 'ready', state.error);
    console.log('Temporary camera link created. Checking public access…');
    const base = 'http://127.0.0.1:' + bridge.server.address().port;
    const headers = { Origin: 'http://127.0.0.1:11818', 'Content-Type': 'application/json' };
    const auth = await (await fetch(base + '/api/desktop/bootstrap', { headers })).json();
    headers.Authorization = 'Bearer ' + auth.key;
    const desktop = async (route, data) => {
      const response = await fetch(base + '/api/desktop/replay/' + route, {
        headers,
        method: data === undefined ? 'GET' : 'POST',
        ...(data === undefined ? {} : { body: JSON.stringify(data) })
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    browser = await chromium.launch({
      channel: 'msedge',
      headless: true,
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required'
      ]
    });
    const context = await browser.newContext({ permissions: ['camera'] });
    const phone = await context.newPage();
    const camera = await desktop('state');
    let connected = false,
      lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await phone.goto(state.url + '/camera#code=' + camera.code, {
          timeout: 15000
        });
        assert.equal(response.status(), 200);
        await phone.locator('#pair-browser').waitFor({ timeout: 5000 });
        connected = true;
        break;
      } catch (error) {
        lastError = error;
        console.log('Public browser check retry:', error.message.split('\n')[0]);
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
    assert(connected, lastError?.message || 'Public camera page did not connect.');
    for (const route of ['/api/desktop/bootstrap', '/api/desktop/replay/state', '/replay'])
      assert.equal(
        await phone.evaluate(async (route) => (await fetch(route)).status, route),
        403,
        route
      );
    await phone.locator('#pair-browser').click();
    await phone.waitForFunction(() =>
      document.querySelector('#browser-status').textContent.includes('Waiting for approval')
    );
    await desktop('approve', {});
    await phone.waitForFunction(() => !document.querySelector('#start-browser').disabled);
    await phone.locator('#start-browser').click();
    await phone.waitForFunction(() =>
      document.querySelector('#browser-status').textContent.startsWith('Recording ·')
    );
    const deadline = Date.now() + 20000;
    let recorded;
    do {
      recorded = await desktop('state');
      if (recorded.segments.length > 1) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    assert(recorded.segments.length > 1, await phone.locator('#browser-status').innerText());
    await phone.locator('#stop-browser').click();
    await phone.waitForFunction(
      () =>
        document.querySelector('#browser-status').textContent === 'Recording saved on the desktop.'
    );
    assert.equal((await desktop('state')).recording, false);
    console.log(
      'Live HTTPS tunnel passed: synthetic browser video pairs, records and saves through Cloudflare; desktop/replay controls remain inaccessible.'
    );
  } finally {
    if (browser) await browser.close();
    await bridge.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
