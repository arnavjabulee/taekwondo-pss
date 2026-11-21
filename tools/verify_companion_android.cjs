const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { WebSocket } = require('ws');
const { createBridge } = require('../services/judge-bridge/server.cjs');
const adb =
  process.env.ADB_PATH || 'C:/Users/arnav/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const pkg = 'uk.ac.bristol.uobtkd.camera';
const cmd = (...args) =>
  execFileSync(adb, ['-s', 'emulator-5554', ...args], { encoding: 'utf8', timeout: 30000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function tap(text) {
  cmd('shell', 'uiautomator', 'dump', '/sdcard/companion.xml');
  const xml = cmd('shell', 'cat', '/sdcard/companion.xml');
  const node = xml.match(new RegExp('<node[^>]*text="' + text + '"[^>]*>', 'i'));
  assert(node, 'Missing ' + text);
  const b = node[0]
    .match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
    .slice(1)
    .map(Number);
  cmd('shell', 'input', 'tap', String((b[0] + b[2]) >> 1), String((b[1] + b[3]) >> 1));
}
(async () => {
  const bridge = createBridge({ desktopOrigins: ['http://127.0.0.1:10808'] });
  await new Promise((r) => bridge.server.listen(0, '0.0.0.0', r));
  const port = bridge.server.address().port,
    base = 'http://127.0.0.1:' + port;
  let key = '',
    browser,
    forward,
    timer;
  async function api(route, data) {
    const response = await fetch(base + '/api/desktop/' + route, {
      method: data ? 'POST' : 'GET',
      headers: {
        Origin: 'http://127.0.0.1:10808',
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json'
      },
      ...(data ? { body: JSON.stringify(data) } : {})
    });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  }
  try {
    key = (await api('bootstrap')).key;
    const session = await api('session', { matchKey: 'companion-test', judgeCount: 1 });
    const sync = {
      sessionId: session.sessionId,
      revision: 1,
      round: 1,
      phase: 'running',
      blue: 'Blue',
      red: 'Red'
    };
    await api('sync', sync);
    timer = setInterval(() => api('sync', sync).catch(() => {}), 500);
    cmd('shell', 'am', 'force-stop', pkg);
    cmd('shell', 'am', 'start', '-W', '-n', pkg + '/.MenuActivity');
    await sleep(1500);
    await tap('Corner Judge');
    await sleep(1500);
    cmd('shell', 'uiautomator', 'dump', '/sdcard/companion.xml');
    let xml = cmd('shell', 'cat', '/sdcard/companion.xml');
    let node = xml.match(/<node[^>]*class="android.widget.EditText"[^>]*>/)[0];
    let b = node
      .match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
      .slice(1)
      .map(Number);
    cmd('shell', 'input', 'tap', String((b[0] + b[2]) >> 1), String((b[1] + b[3]) >> 1));
    cmd('shell', 'input', 'keyevent', 'KEYCODE_MOVE_END');
    cmd('shell', 'input', 'keyevent', ...Array(100).fill('KEYCODE_DEL'));
    cmd('shell', 'input', 'text', 'http://10.0.2.2:' + port);
    cmd('shell', 'input', 'keyevent', 'KEYCODE_BACK');
    await tap('Connect');
    await sleep(2000);
    cmd('shell', 'uiautomator', 'dump', '/sdcard/companion.xml');
    const pid = cmd('shell', 'pidof', pkg).trim();
    forward = cmd('forward', 'tcp:0', 'localabstract:webview_devtools_remote_' + pid).trim();
    const pages = await (await fetch('http://127.0.0.1:' + forward + '/json')).json();
    browser = new WebSocket(pages[0].webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      browser.once('open', resolve);
      browser.once('error', reject);
    });
    let sequence = 0;
    const evaluate = (expression) =>
      new Promise((resolve, reject) => {
        const id = ++sequence;
        const timeout = setTimeout(() => reject(new Error('WebView evaluation timed out')), 5000);
        const receive = (raw) => {
          const message = JSON.parse(raw);
          if (message.id !== id) return;
          clearTimeout(timeout);
          browser.off('message', receive);
          if (message.error || message.result.exceptionDetails)
            reject(new Error(JSON.stringify(message)));
          else resolve(message.result.result.value);
        };
        browser.on('message', receive);
        browser.send(
          JSON.stringify({
            id,
            method: 'Runtime.evaluate',
            params: { expression, returnByValue: true }
          })
        );
      });
    await evaluate('document.querySelector("#match-code").value=' + JSON.stringify(session.code));
    await evaluate('document.querySelector("#judge-name").value="Companion judge"');
    await evaluate('document.querySelector("#pair-form").requestSubmit()');
    await sleep(1000);
    const state = await api('sync', sync);
    assert.equal(state.judges.length, 1);
    await api('judge', {
      sessionId: session.sessionId,
      judgeId: state.judges[0].id,
      action: 'approve'
    });
    await sleep(1000);
    assert.equal(await evaluate('document.querySelector("#blue").disabled'), false);
    await evaluate(
      'document.querySelector("#blue").dispatchEvent(new PointerEvent("pointerdown", {button:0,isPrimary:true,bubbles:true}))'
    );
    await sleep(500);
    const awarded = await api('sync', sync);
    assert.equal(awarded.awards.length, 1);
    assert.equal(awarded.awards[0].side, 'left');
    console.log('Companion menu, embedded judge pairing, approval and blue punch award passed.');
    browser.close();
    browser = null;
    await tap('Home');
    await sleep(500);
    await tap('IVR Camera');
    await sleep(1500);
    cmd('shell', 'uiautomator', 'dump', '/sdcard/companion.xml');
    xml = cmd('shell', 'cat', '/sdcard/companion.xml');
    node = xml.match(/<node[^>]*class="android.view.TextureView"[^>]*>/)[0];
    b = node
      .match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
      .slice(1)
      .map(Number);
    assert(Math.abs((b[2] - b[0]) / (b[3] - b[1]) - 16 / 9) < 0.01);
    console.log('Camera preview is 16:9 within its available space.');
    await tap('Home');
    await sleep(500);
    cmd('shell', 'uiautomator', 'dump', '/sdcard/companion.xml');
    assert(cmd('shell', 'cat', '/sdcard/companion.xml').includes('IVR CAMERA'));
  } finally {
    clearInterval(timer);
    if (browser) browser.close();
    if (forward) cmd('forward', '--remove', 'tcp:' + forward);
    cmd('shell', 'am', 'force-stop', pkg);
    await bridge.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
