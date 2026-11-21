const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
(async () => {
  let now = 10000;
  const writes = [];
  const values = new Map();
  const window = { UOBTKD_DESKTOP_CONFIG: {}, UOBTKD_DESKTOP: { quit() {} } };
  const context = {
    window,
    localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value)
    },
    Date: { now: () => now },
    fetch: async (url, options) => {
      if (url.endsWith('/bootstrap')) return { json: async () => ({ key: 'test-key' }) };
      writes.push(JSON.parse(options.body));
      return { ok: true };
    }
  };
  vm.runInNewContext(fs.readFileSync('apps/desktop/renderer.js', 'utf8'), context);
  window.PSS_DESKTOP.matchState('ready');
  now = 11000;
  window.PSS_DESKTOP.matchState('running');
  now = 12000;
  window.PSS_DESKTOP.matchState('paused');
  now = 15000;
  window.PSS_DESKTOP.matchState('paused');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(writes, [
    { phase: 'ready', at: 10000 },
    { phase: 'running', at: 11000 },
    { phase: 'paused', at: 12000 }
  ]);
  console.log(
    'Replay phase bridge passed: ordered transitions, original pause timestamp, no duplicate pause and no corner-judge dependency.'
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
