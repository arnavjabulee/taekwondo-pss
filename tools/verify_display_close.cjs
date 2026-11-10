const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm');
const source = fs.readFileSync('src/spectator/spectator-display.js', 'utf8');
function setup(query, bridge = true) {
  const events = {},
    documentEvents = {},
    nodes = new Map(),
    counts = { focus: 0, nativeClose: 0, browserClose: 0 };
  function node(id) {
    if (!nodes.has(id))
      nodes.set(id, {
        style: {},
        classList: { toggle() {} },
        addEventListener: (name, fn) => (events[id + ':' + name] = fn)
      });
    return nodes.get(id);
  }
  const root = {
    location: { search: query, protocol: 'http:', host: 'localhost:12800' },
    innerWidth: 1920,
    innerHeight: 1080,
    screen: { width: 1920, height: 1080 },
    moveTo() {},
    resizeTo() {},
    opener: { postMessage() {} },
    localStorage: {
      getItem() {
        return null;
      }
    },
    setInterval() {},
    addEventListener: (name, fn) => (events[name] = fn),
    close() {
      counts.browserClose++;
    },
    document: {
      documentElement: {},
      getElementById: node,
      querySelector: () => node('stage'),
      addEventListener: (name, fn) => (documentEvents[name] = fn)
    }
  };
  root.parent = root;
  if (bridge) {
    root.HostFocusDisplay = () => {
      counts.focus++;
      return 1;
    };
    root.HostCloseDisplay = () => {
      counts.nativeClose++;
      return 1;
    };
  }
  vm.runInNewContext(source, { window: root, Date, Math });
  return { events, documentEvents, counts, node };
}
const app = setup('?channel=test&fullscreen=1&native=1');
assert.equal(app.counts.focus, 1);
app.events['close-display:click']();
assert.equal(app.counts.nativeClose, 1);
assert.equal(app.counts.browserClose, 0);
for (const key of [{ key: 'Escape' }, { key: 'Esc' }, { keyCode: 27 }, { key: 'F4', altKey: true }])
  app.documentEvents.keydown({ ...key, preventDefault() {}, stopImmediatePropagation() {} });
assert.equal(app.counts.nativeClose, 5);
app.events.message({
  origin: 'http://localhost:12800',
  data: { type: 'uobtkd-spectator-close', channel: 'test' }
});
assert.equal(app.counts.nativeClose, 6);
app.events.message({
  origin: 'https://other.invalid',
  data: { type: 'uobtkd-spectator-close', channel: 'test' }
});
assert.equal(app.counts.nativeClose, 6);
const browser = setup('?channel=test&fullscreen=1', false);
browser.events['close-display:click']();
assert.equal(browser.counts.browserClose, 1);
const preview = setup('?channel=test');
preview.events['close-display:click']();
assert.equal(preview.counts.nativeClose, 0);
assert.equal(preview.node('close-display').style.display, 'none');
console.log(
  'Display close checks passed: native focus, native close button/Escape/Alt+F4, panel close requests, browser fallback and preview isolation.'
);
