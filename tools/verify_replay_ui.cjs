const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { chromium } = require('playwright');
const { createBridge } = require('../services/judge-bridge/server.cjs');
const mp4 = require('../services/judge-bridge/mp4.cjs');
async function main() {
  let opens = 0;
  const bridge = createBridge({
    openReplay: async () => {
      opens++;
    },
    replayDirectory: path.resolve('test-results/replay-recordings')
  });
  await new Promise((r) => bridge.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + bridge.server.address().port,
    origin = 'http://127.0.0.1:10808';
  let key, token, generation, browser;
  async function api(route, data, auth = key) {
    const response = await fetch(base + route, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {
        Origin: route.startsWith('/api/desktop/') ? origin : base,
        Authorization: 'Bearer ' + (auth || ''),
        'Content-Type': Buffer.isBuffer(data) ? 'video/mp4' : 'application/json'
      },
      ...(data === undefined ? {} : { body: Buffer.isBuffer(data) ? data : JSON.stringify(data) })
    });
    assert.equal(response.status, 200, await response.clone().text());
    return response;
  }
  try {
    key = (await (await api('/api/desktop/bootstrap', undefined, '')).json()).key;
    await api('/api/desktop/replay/open', {});
    assert.equal(opens, 1);
    const state = await (await api('/api/desktop/replay/state')).json();
    token = (
      await (
        await api('/api/camera/pair', { code: state.code, name: 'Synthetic camera' }, '')
      ).json()
    ).token;
    await api('/api/desktop/replay/approve', {});
    generation = (await (await api('/api/camera/start', {}, token)).json()).generation;
    const bytes = fs.readFileSync(path.resolve(__dirname, 'fixtures/replay-h264.mp4')),
      top = mp4.boxes(bytes),
      first = top.find((b) => b.type === 'moof');
    const init = bytes.subarray(0, first.at),
      format = mp4.initialization(init);
    let index = 0;
    await api('/api/camera/chunk?generation=' + generation + '&index=' + index++, init, token);
    const fragments = [];
    for (let i = 0; i < top.length; i++)
      if (top[i].type === 'moof') {
        const data = bytes.subarray(top[i].at, top[i + 1].end);
        fragments.push(data);
        await api('/api/camera/chunk?generation=' + generation + '&index=' + index++, data, token);
      }
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({
      viewport: { width: 1400, height: 1000 },
      acceptDownloads: true
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + '/replay');
    await page.waitForFunction(() => document.querySelector('video').videoWidth === 1280);
    assert.equal(
      await page.locator('details').getAttribute('open'),
      null,
      'Connection setup collapses when video arrives'
    );
    await page.getByRole('button', { name: 'Replay last 5 s', exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('#status').textContent.startsWith('Replay ready')
    );
    await page.getByRole('button', { name: 'Frame →', exact: true }).click();
    assert((await page.locator('video').evaluate((v) => v.currentTime)) > 0);
    await page.getByLabel('Playback speed', { exact: true }).selectOption('0.1');
    assert.equal(await page.locator('video').evaluate((v) => v.playbackRate), 0.1);
    await page.locator('#timeline').evaluate((n) => {
      n.value = 0.75;
      n.dispatchEvent(new Event('input'));
    });
    assert(Math.abs((await page.locator('video').evaluate((v) => v.currentTime)) - 0.75) < 0.01);
    const before = await page.locator('video').evaluate((v) => v.currentTime);
    const liveState = await (await api('/api/desktop/replay/state')).json();
    const more = mp4.rebase(fragments[0], -Math.round(liveState.end * format.timescale));
    await api('/api/camera/chunk?generation=' + generation + '&index=' + index++, more, token);
    await page.waitForTimeout(700);
    assert.equal(
      await page.locator('video').evaluate((v) => v.currentTime),
      before,
      'Recording continues without moving the paused replay'
    );
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save buffered clip', exact: true }).click();
    await (await downloaded).saveAs(path.resolve('test-results/replay-ui-export.mp4'));
    const width = await page.locator('video').evaluate((v) => v.videoWidth);
    assert.equal(width, 1280);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.resolve('test-results/replay-desktop.png') });
    await api('/api/camera/stop?generation=' + generation, {}, token);
    const final = await (await api('/api/desktop/replay/state')).json();
    assert(
      fs.statSync(final.recordingPath).size > bytes.length,
      'Full recording persists independently of rolling replay'
    );
    const phone = await browser.newPage();
    await phone.goto(base + '/camera#code=' + state.code);
    assert.equal(await phone.locator('#code').innerText(), state.code);
    assert(
      (await phone.locator('#open').getAttribute('href')).startsWith('uobtkd-camera://pair?server=')
    );
    console.log(
      'Replay UI passed: actual H.264/fMP4 decoding, frame timestamps, scrubbing, slow motion, ongoing capture, clip export and durable recording.'
    );
  } finally {
    if (browser) await browser.close();
    await bridge.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
