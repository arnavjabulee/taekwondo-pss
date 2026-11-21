const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { _electron: electron } = require('playwright');
const { WebSocketServer } = require('ws');
const mp4 = require('../services/judge-bridge/mp4.cjs');
function header(packet) {
  let at = 1,
    value = 0,
    mult = 1;
  do {
    value += (packet[at] & 127) * mult;
    mult *= 128;
  } while (packet[at++] & 128);
  return at;
}
function publish(topic, text) {
  const body = Buffer.concat([
    Buffer.from([0, Buffer.byteLength(topic)]),
    Buffer.from(topic),
    Buffer.from(text)
  ]);
  let n = body.length,
    bytes = [];
  do {
    let digit = n % 128;
    n = Math.floor(n / 128);
    if (n) digit |= 128;
    bytes.push(digit);
  } while (n);
  return Buffer.concat([Buffer.from([0x30, ...bytes]), body]);
}
(async () => {
  const broker = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((r) => broker.once('listening', r));
  const sockets = new Set();
  broker.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let pending = Buffer.alloc(0);
    socket.on('message', (raw) => {
      pending = Buffer.concat([pending, Buffer.from(raw)]);
      while (pending.length > 1) {
        let at = 1,
          n = 0,
          mult = 1;
        do {
          if (at >= pending.length) return;
          n += (pending[at] & 127) * mult;
          mult *= 128;
        } while (pending[at++] & 128);
        if (pending.length < at + n) return;
        const packet = pending.subarray(0, at + n);
        pending = pending.subarray(at + n);
        const type = packet[0] >> 4;
        if (type === 1) socket.send(Buffer.from([0x20, 2, 0, 0]));
        if (type === 8) socket.send(Buffer.from([0x90, 3, packet[at], packet[at + 1], 0]));
        if (type === 12) socket.send(Buffer.from([0xd0, 0]));
        if (type === 3 && ((packet[0] >> 1) & 3) === 1) {
          const length = packet.readUInt16BE(at),
            id = at + 2 + length;
          socket.send(Buffer.from([0x40, 2, packet[id], packet[id + 1]]));
        }
      }
    });
  });
  let app;
  try {
    app = await electron.launch({
      executablePath: process.env.UOBTKD_DESKTOP_EXE || require('electron'),
      args: [path.resolve(__dirname, '..')],
      env: {
        ...process.env,
        UOBTKD_DESKTOP_DATA: path.resolve('test-results/electron-profile-' + randomUUID()),
        UOBTKD_RECEIVER_ADDRESS: '127.0.0.1:' + broker.address().port
      }
    });
    console.log('Electron launched');
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Free Training', exact: true }).waitFor();
    assert(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen()),
      'Main window must start in true fullscreen'
    );

    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    assert.equal(await page.evaluate(() => typeof window.UOBTKD_DESKTOP.quit), 'function');
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('uobtkd_desktop_migration_v1', '1');
      localStorage.setItem(
        'uobtkd_equipment_v1',
        JSON.stringify({
          records: [{ id: '000000000001', type: 'body', colour: 'Blue', size: '3', order: 1 }],
          counters: {}
        })
      );
    });
    await page.reload();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Connection', exact: true }).click();
    assert.equal(
      await page.getByLabel('Receiver address', { exact: true }).inputValue(),
      '127.0.0.1:' + broker.address().port
    );
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByRole('button', { name: 'Free Training', exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('.pss-free').__vue__.$parent.online === true
    );
    await page.getByRole('button', { name: 'Add person', exact: true }).click();
    const person = page.locator('.pss-free-person').first();
    await person.locator('[data-person-name]').fill('Electron Test');
    await person.getByLabel(/^Body protector for /).selectOption('000000000001');
    await page.getByRole('button', { name: 'Start tracking', exact: true }).click();
    for (const socket of sockets) socket.send(publish('DevData', '000000000001,value:2865'));
    await person.locator('.pss-free-score').filter({ hasText: 'Score: 1' }).waitFor();
    const opened = app.waitForEvent('window');
    await page.getByRole('button', { name: 'Open spectator window', exact: true }).click();
    const spectator = await opened;
    await spectator.waitForLoadState();
    assert(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((w) => w.isFullScreen())
      )
    );
    const closed = spectator.waitForEvent('close');
    await spectator.keyboard.press('Escape').catch((error) => {
      if (!spectator.isClosed()) throw error;
    });
    await closed;
    assert(await person.isVisible());
    await page.evaluate(() => window.PSS_JUDGES.openReplay());
    console.log('Scoring and spectator passed; opening replay');
    await page.locator('#desktop-replay').waitFor();
    const replay = page.frameLocator('#desktop-replay iframe');
    await replay.locator('#status').waitFor();
    // Feed the same fMP4 fixture used by the Android replay tests into the real local service.
    const base = 'http://127.0.0.1:8976',
      origin = 'http://127.0.0.1:11818';
    let key = (
      await (await fetch(base + '/api/desktop/bootstrap', { headers: { Origin: origin } })).json()
    ).key;
    async function api(route, data, token = key) {
      const response = await fetch(base + route, {
        method: data === undefined ? 'GET' : 'POST',
        headers: {
          Origin: route.startsWith('/api/desktop') ? origin : base,
          Authorization: 'Bearer ' + token,
          'Content-Type': Buffer.isBuffer(data) ? 'video/mp4' : 'application/json'
        },
        ...(data === undefined ? {} : { body: Buffer.isBuffer(data) ? data : JSON.stringify(data) })
      });
      assert.equal(response.status, 200, await response.clone().text());
      return response.json();
    }
    let state = await api('/api/desktop/replay/state');
    if (state.camera && state.camera.name !== 'Electron test camera') {
      assert.deepEqual(errors, []);
      console.log(
        'Fullscreen, scoring, spectator and embedded replay view passed. Preserving the real paired camera; synthetic video test skipped.'
      );
      return;
    }
    if (state.camera) {
      assert.equal(
        state.camera.name,
        'Electron test camera',
        'Do not replace a real camera during tests'
      );
      state = await api('/api/desktop/replay/remove', {});
    }
    if (Date.now() >= state.codeExpires) state = await api('/api/desktop/replay/rotate', {});
    const camera = await api(
      '/api/camera/pair',
      { code: state.code, name: 'Electron test camera' },
      ''
    );
    await api('/api/desktop/replay/approve', {});
    const stream = await api('/api/camera/start', {}, camera.token);
    const bytes = fs.readFileSync(path.resolve('tools/fixtures/replay-h264.mp4')),
      boxes = mp4.boxes(bytes),
      first = boxes.find((b) => b.type === 'moof');
    let index = 0;
    await api(
      '/api/camera/chunk?generation=' + stream.generation + '&index=' + index++,
      bytes.subarray(0, first.at),
      camera.token
    );
    for (let i = 0; i < boxes.length; i++)
      if (boxes[i].type === 'moof')
        await api(
          '/api/camera/chunk?generation=' + stream.generation + '&index=' + index++,
          bytes.subarray(boxes[i].at, boxes[i + 1].end),
          camera.token
        );
    await page.locator('#desktop-replay iframe').evaluate((frame) => {
      frame.src = frame.src;
    });
    await replay.locator('video').evaluate(
      (video) =>
        new Promise((resolve, reject) => {
          if (video.videoWidth) return resolve();
          video.addEventListener('loadeddata', resolve, { once: true });
          setTimeout(() => reject(new Error('Video decode timeout')), 15000);
        })
    );
    assert.equal(await replay.locator('video').evaluate((video) => video.videoWidth), 1280);
    await replay.getByRole('button', { name: 'Replay last 5 s', exact: true }).click();
    await replay
      .locator('#status')
      .filter({ hasText: /Replay ready/ })
      .waitFor();
    await replay.getByLabel('Playback speed', { exact: true }).selectOption('0.25');
    assert.equal(await replay.locator('video').evaluate((video) => video.playbackRate), 0.25);
    await replay.locator('body').press('Escape');
    assert.equal(await page.locator('#desktop-replay').evaluate((d) => d.open), false);
    await api('/api/camera/stop?generation=' + stream.generation, {}, camera.token);
    await api('/api/desktop/replay/remove', {});
    await page.screenshot({ path: 'test-results/electron-desktop.png' });
    assert.deepEqual(errors, []);
    console.log(
      'Electron passed: isolated renderer, receiver MQTT input to score, settings, fullscreen spectator/Escape and embedded H.264 fMP4 replay/scrubbing/slow motion.'
    );
  } finally {
    console.log('Closing Electron test');
    if (app) await app.close();
    console.log('Electron test closed');
    for (const socket of sockets) socket.terminate();
    broker.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
