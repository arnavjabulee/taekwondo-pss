const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { chromium } = require('playwright');
const CameraMP4 = require('../apps/replay/camera-mp4.js');
const mp4 = require('../services/judge-bridge/mp4.cjs');
const { createBridge } = require('../services/judge-bridge/server.cjs');
const {
  createCameraProxy,
  createCameraTunnel
} = require('../services/judge-bridge/camera-tunnel.cjs');
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = (server) => 'http://127.0.0.1:' + server.address().port;

async function main() {
  const fixture = fs.readFileSync(path.resolve('tools/fixtures/replay-h264.mp4'));
  const segments = [];
  const parser = new CameraMP4((data) => segments.push(Buffer.from(data)));
  for (let at = 0; at < fixture.length; at += 137) parser.push(fixture.subarray(at, at + 137));
  parser.finish();
  const format = mp4.initialization(segments[0]);
  assert(segments.length > 2);
  for (const data of segments.slice(1))
    assert(mp4.fragment(mp4.normalize(data), format).frames > 0);
  const truncated = new CameraMP4(() => {});
  truncated.push(fixture.subarray(0, 5));
  assert.throws(() => truncated.finish(), /incomplete/);
  assert.throws(
    () => new CameraMP4(() => {}).push(Buffer.from([0, 0, 0, 0, 109, 100, 97, 116])),
    /fragmented MP4/
  );
  assert.throws(
    () => new CameraMP4(() => {}).push(new Uint8Array(9 * 1024 * 1024)),
    /streamable MP4/
  );
  let finishHelper,
    cancelledSpawns = 0;
  const cancelled = createCameraTunnel({
    helper: () =>
      new Promise((resolve) => {
        finishHelper = resolve;
      }),
    spawn: () => {
      cancelledSpawns++;
      throw new Error('Cancelled download must not launch.');
    }
  });
  const starting = cancelled.start('http://127.0.0.1:9');
  await cancelled.stop();
  finishHelper('unused-helper');
  assert.equal((await starting).phase, 'off');
  assert.equal(cancelledSpawns, 0);
  let killed = false;
  const unconnected = createCameraTunnel({
    helper: async () => 'test-helper',
    timeout: 30,
    spawn: () => {
      const instance = new EventEmitter();
      instance.stdout = new PassThrough();
      instance.stderr = new PassThrough();
      instance.kill = () => {
        killed = true;
        return true;
      };
      setImmediate(() => instance.stderr.write('https://not-connected.trycloudflare.com\n'));
      return instance;
    }
  });
  assert.equal((await unconnected.start('http://127.0.0.1:9')).phase, 'error');
  assert.equal(unconnected.state().url, '');
  assert(killed);
  await unconnected.stop();

  let child,
    spawned = 0;
  const tunnel = createCameraTunnel({
    helper: async () => 'test-helper',
    verifyPublic: async () => {},
    spawn(executable, args, options) {
      spawned++;
      assert.equal(executable, 'test-helper');
      assert.equal(options.windowsHide, true);
      assert(args.includes('http2'));
      const instance = (child = new EventEmitter());
      instance.stdout = new PassThrough();
      instance.stderr = new PassThrough();
      instance.kill = () => {
        setImmediate(() => instance.emit('exit', 0));
        return true;
      };
      setImmediate(() =>
        instance.stderr.write(
          'Your quick tunnel: https://test-camera-link.trycloudflare.com\nRegistered tunnel connection\n'
        )
      );
      return instance;
    }
  });
  const bridge = createBridge({
    cameraTunnel: tunnel,
    replayDirectory: path.resolve('test-results/browser-camera-recordings')
  });
  let proxy, browser;
  try {
    await listen(bridge.server);
    const base = address(bridge.server),
      desktopOrigin = 'http://127.0.0.1:11818';
    const key = (
      await (
        await fetch(base + '/api/desktop/bootstrap', { headers: { Origin: desktopOrigin } })
      ).json()
    ).key;
    async function desktop(route, data) {
      const response = await fetch(base + '/api/desktop/replay/' + route, {
        method: data === undefined ? 'GET' : 'POST',
        headers: {
          Origin: desktopOrigin,
          Authorization: 'Bearer ' + key,
          'Content-Type': 'application/json'
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) })
      });
      assert.equal(response.status, 200, await response.clone().text());
      return response.json();
    }
    assert.equal(
      (
        await fetch(base + '/api/desktop/replay/tunnel', {
          method: 'POST',
          body: '{"enabled":true}'
        })
      ).status,
      403
    );
    assert.equal((await tunnel.start(base)).phase, 'ready');
    assert.equal((await tunnel.start(base)).phase, 'ready');
    assert.equal(spawned, 1);
    assert.equal(
      (await desktop('state')).browserCamera.url,
      'https://test-camera-link.trycloudflare.com'
    );
    const publicOrigin = tunnel.state().url;
    proxy = createCameraProxy(base, () => publicOrigin);
    await listen(proxy);
    const publicBase = address(proxy);
    for (const route of [
      '/api/desktop/bootstrap',
      '/api/desktop/replay/state',
      '/api/desktop/replay/media?index=init',
      '/replay',
      '/camera.apk',
      '/',
      '/api/judge/pair'
    ])
      assert.equal((await fetch(publicBase + route)).status, 403, route);
    assert.equal((await fetch(publicBase + '/camera')).status, 200);
    assert.equal((await fetch(publicBase + '/browser-camera.js')).status, 200);
    assert.equal(
      (
        await fetch(publicBase + '/api/camera/pair', {
          method: 'POST',
          headers: { Origin: 'https://attacker.example' },
          body: '{}'
        })
      ).status,
      403
    );
    assert.equal((await fetch(publicBase + '/api/camera/state')).status, 401);
    assert.equal(
      await new Promise((resolve, reject) => {
        const request = http.request(
          publicBase,
          { path: 'http://example.com/camera' },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          }
        );
        request.on('error', reject);
        request.end();
      }),
      400
    );
    let state = await desktop('state');
    const paired = await fetch(publicBase + '/api/camera/pair', {
      method: 'POST',
      headers: { Origin: publicOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: state.code, name: 'Tunnel test camera' })
    });
    assert.equal(paired.status, 200, await paired.clone().text());
    const credentials = await paired.json();
    assert.equal(
      (
        await fetch(publicBase + '/api/camera/state', {
          headers: { Origin: publicOrigin, Authorization: 'Bearer ' + credentials.token }
        })
      ).status,
      200
    );
    await desktop('remove', {});
    await desktop('tunnel', { enabled: false });
    assert.equal(tunnel.state().phase, 'off');
    await tunnel.start(base);
    child.emit('exit', 1);
    assert.equal(tunnel.state().phase, 'error');
    assert.equal(tunnel.state().url, '');

    browser = await chromium.launch({
      channel: 'msedge',
      headless: true,
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required'
      ]
    });
    const context = await browser.newContext({
      permissions: ['camera'],
      viewport: { width: 844, height: 390 }
    });
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const panel = await context.newPage();
    await panel.goto(base + '/replay');
    await panel.waitForFunction(() => document.querySelector('#code').textContent.length === 6);
    await panel.locator('#enable-browser').click();
    await panel.waitForFunction(() =>
      document.querySelector('#address').value.startsWith('https://test-camera-link.')
    );
    assert.match(
      await panel.locator('#qr').getAttribute('data-url'),
      /^https:\/\/test-camera-link\.trycloudflare\.com\/camera#code=\d{6}$/
    );
    await panel.locator('#disable-browser').click();
    await panel.waitForFunction(
      () => !document.querySelector('#address').value.startsWith('https://')
    );
    await panel.close();
    state = await desktop('state');
    await page.goto(base + '/camera#code=' + state.code);
    await page.locator('#pair-browser').click();
    await page.waitForFunction(() =>
      document.querySelector('#browser-status').textContent.includes('Waiting for approval')
    );
    await desktop('approve', {});
    await page.locator('#start-browser').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('#start-browser').disabled);
    assert(
      await page.evaluate(() => MediaRecorder.isTypeSupported('video/mp4')),
      'Browser test requires MP4 recording support.'
    );
    await page.locator('#start-browser').click();
    await page.waitForFunction(() => document.querySelector('#preview').videoWidth > 0);
    await page.waitForFunction(() =>
      document.querySelector('#browser-status').textContent.startsWith('Recording ·')
    );
    const deadline = Date.now() + 15000;
    do {
      state = await desktop('state');
      if (state.segments.length >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    } while (Date.now() < deadline);
    assert(state.segments.length >= 2, await page.locator('#browser-status').innerText());
    assert.match(state.codec, /^avc[13]\./);
    assert.equal(
      await page.locator('#preview').evaluate((video) => getComputedStyle(video).objectFit),
      'contain'
    );
    await page.locator('#stop-browser').click();
    await page.waitForFunction(
      () =>
        document.querySelector('#browser-status').textContent === 'Recording saved on the desktop.'
    );
    state = await desktop('state');
    assert.equal(state.recording, false);
    assert(fs.statSync(state.recordingPath).size > 1000);
    assert.equal(await page.evaluate(() => document.querySelector('#preview').srcObject), null);
    // A second recording starts a fresh generation without retaining stale parser/upload state.
    const firstGeneration = state.generation;
    await page.locator('#start-browser').click();
    await page.waitForFunction(() =>
      document.querySelector('#browser-status').textContent.startsWith('Recording ·')
    );
    await page.waitForTimeout(2200);
    await page.locator('#stop-browser').click();
    await page.waitForFunction(
      () =>
        document.querySelector('#browser-status').textContent === 'Recording saved on the desktop.'
    );
    assert.notEqual((await desktop('state')).generation, firstGeneration);
    assert.deepEqual(errors, []);
    console.log(
      'Browser camera passed: incremental fMP4, real H.264 capture/uploads, ordered recording restart, camera-only proxy, authentication, blocked cross-origin/desktop access, tunnel lifecycle and cleanup.'
    );
  } finally {
    if (browser) await browser.close();
    if (proxy) {
      proxy.closeAllConnections();
      await new Promise((resolve) => proxy.close(resolve));
    }
    await bridge.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
