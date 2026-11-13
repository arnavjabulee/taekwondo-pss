const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const { chromium } = require('playwright');
const { createBridge } = require('../services/judge-bridge/server.cjs');
const adb = process.env.ADB_PATH || 'C:/platform-tools/adb.exe',
  device = process.env.ANDROID_DEVICE || 'emulator-5554';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function command(args) {
  return (
    await run(adb, ['-s', device, ...args], {
      timeout: args[0] === 'install' ? 120000 : 30000,
      maxBuffer: 1024 * 1024
    })
  ).stdout;
}
async function until(fn, label, limit = 30000) {
  const end = Date.now() + limit;
  while (Date.now() < end) {
    if (await fn()) return;
    await sleep(500);
  }
  throw new Error('Timeout: ' + label);
}
async function tap(text) {
  await command(['shell', 'uiautomator', 'dump', '/sdcard/uobtkd-replay-ui.xml']);
  const xml = await command(['shell', 'cat', '/sdcard/uobtkd-replay-ui.xml']);
  const node = xml.match(new RegExp('<node[^>]*text="' + text + '"[^>]*>', 'i'));
  if (!node) throw new Error('Missing Android button ' + text + ' ' + xml.slice(-2000));
  const m = node[0].match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  await command([
    'shell',
    'input',
    'tap',
    String(((+m[1] + +m[3]) / 2) | 0),
    String(((+m[2] + +m[4]) / 2) | 0)
  ]);
}
async function main() {
  const bridge = createBridge({
    openReplay: async () => {},
    networkSetup: { status: async () => ({ state: 'ready' }) }
  });
  await new Promise((r) => bridge.server.listen(0, '0.0.0.0', r));
  const port = bridge.server.address().port,
    base = 'http://127.0.0.1:' + port,
    origin = 'http://127.0.0.1:10808';
  let key = '',
    browser;
  async function api(route, data) {
    const response = await fetch(base + '/api/desktop/replay/' + route, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {
        Origin: origin,
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json'
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) })
    });
    assert.equal(response.status, 200, await response.clone().text());
    return response;
  }
  try {
    key = (
      await (await fetch(base + '/api/desktop/bootstrap', { headers: { Origin: origin } })).json()
    ).key;
    console.log('Waiting for Android boot…');
    await until(
      async () => {
        try {
          return (await command(['shell', 'getprop', 'sys.boot_completed'])).trim() === '1';
        } catch {
          return false;
        }
      },
      'Android boot',
      180000
    );
    await command([
      'install',
      '-r',
      path.resolve('apps/camera-android/app/build/outputs/apk/debug/app-debug.apk')
    ]);
    await command([
      'shell',
      'pm',
      'grant',
      'uk.ac.bristol.uobtkd.camera',
      'android.permission.CAMERA'
    ]);
    await command(['shell', 'input', 'keyevent', '82']);
    const state = await (await api('state')).json();
    const link =
      'uobtkd-camera://pair?server=' +
      encodeURIComponent('http://10.0.2.2:' + port) +
      '&code=' +
      state.code;
    await command([
      'shell',
      'am',
      'start',
      '-W',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      "'" + link + "'"
    ]);
    await tap('Pair camera');
    await until(async () => !!(await (await api('state')).json()).camera, 'camera pairing');
    await api('approve', {});
    await sleep(1500);
    await tap('Start recording');
    await until(
      async () => {
        const s = await (await api('state')).json();
        if (s.error) throw new Error(s.error);
        return s.segments.length >= 4;
      },
      'fMP4 fragments',
      45000
    );
    console.log('Android camera uploads valid H.264 fMP4 fragments.');
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({
      viewport: { width: 1400, height: 1000 },
      acceptDownloads: true
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('response', async (r) => {
      if (r.status() >= 400)
        console.error(
          'Replay response:',
          new URL(r.url()).pathname,
          r.status(),
          (await r.text().catch(() => '')).slice(0, 300)
        );
    });
    page.on('console', (m) => {
      if (m.type() === 'error') console.error('Replay browser:', m.text());
    });
    await page.goto(base + '/replay');
    await page
      .waitForFunction(() => document.querySelector('video').videoWidth > 0, null, {
        timeout: 20000
      })
      .catch(async (error) => {
        console.error(
          'Replay player diagnostics:',
          await page.evaluate(() => ({
            status: document.querySelector('#status').textContent,
            error:
              document.querySelector('video').error &&
              document.querySelector('video').error.message,
            src: document.querySelector('video').src
          }))
        );
        throw error;
      });
    await page.getByRole('button', { name: 'Replay last 5 s', exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('#status').textContent.startsWith('Replay ready')
    );
    const before = await page.locator('video').evaluate((v) => v.currentTime);
    await page.getByRole('button', { name: 'Frame →', exact: true }).click();
    assert((await page.locator('video').evaluate((v) => v.currentTime)) > before);
    await page.getByLabel('Playback speed', { exact: true }).selectOption('0.25');
    assert.equal(await page.locator('video').evaluate((v) => v.playbackRate), 0.25);
    await page.locator('#timeline').evaluate((node) => {
      node.value = 0.6;
      node.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert(Math.abs((await page.locator('video').evaluate((v) => v.currentTime)) - 0.6) < 0.1);
    const end = (await (await api('state')).json()).end;
    await until(
      async () => (await (await api('state')).json()).end > end,
      'recording continues during replay'
    );
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save buffered clip', exact: true }).click();
    const clip = await download;
    fs.mkdirSync('test-results', { recursive: true });
    await clip.saveAs(path.resolve('test-results/replay-native.mp4'));
    await page.screenshot({ path: path.resolve('test-results/replay-desktop.png') });
    assert.deepEqual(errors, []);
    await tap('Stop recording');
    await until(async () => !(await (await api('state')).json()).recording, 'camera stops');
    const bytes = fs.readFileSync('test-results/replay-native.mp4');
    assert(bytes.includes(Buffer.from('moof')) && bytes.includes(Buffer.from('moov')));
    console.log(
      'Replay passed: real Android encoding/upload, desktop decode, scrubbing, frame step, slow motion, uninterrupted recording and MP4 clip export.'
    );
  } catch (e) {
    try {
      console.error(
        await command(['shell', 'uiautomator', 'dump', '/sdcard/uobtkd-replay-ui.xml'])
      );
      console.error((await command(['shell', 'cat', '/sdcard/uobtkd-replay-ui.xml'])).slice(-7000));
      console.error(
        (await command(['logcat', '-d', '-t', '100', '-s', 'AndroidRuntime:E'])).slice(-4000)
      );
    } catch {}
    throw e;
  } finally {
    if (browser) await browser.close();
    try {
      await command(['shell', 'am', 'force-stop', 'uk.ac.bristol.uobtkd.camera']);
    } catch {}
    await bridge.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
