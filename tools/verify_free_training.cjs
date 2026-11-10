const assert = require('node:assert/strict');
const free = require('../src/runtime/free-training.js');

const model = free.createModel();
const swaps = free.createModel();
const first = swaps.add({ name: 'Alex', bodyId: '000000000001', helmetId: '000000000011' });
const second = swaps.add({ name: 'Sam', bodyId: '000000000002', helmetId: '000000000012' });
swaps.record('000000000001,value:320', true);
swaps.record('000000000002,value:320', true);
swaps.swapEquipment(first.id, 'bodyId', '000000000002');
assert.equal(first.name, 'Alex');
assert.equal(second.name, 'Sam');
assert.equal(first.score, 1);
assert.equal(second.score, 1);
assert.equal(first.bodyId, '000000000002');
assert.equal(second.bodyId, '000000000001');
swaps.record('000000000002,value:320', true);
swaps.record('000000000001,value:320', true);
assert.equal(first.score, 2);
assert.equal(second.score, 2);
swaps.swapEquipment(first.id, 'helmetId', '000000000012');
assert.equal(second.helmetId, '000000000011');
assert.equal(first.score, 2);
assert.equal(first.bodyLevel, 8);
assert.throws(() => swaps.swapEquipment(first.id, 'bodyId', '000000000011'));
const savedSwaps = free.createModel(swaps.snapshot());
assert.equal(savedSwaps.find(first.id).name, 'Alex');
assert.equal(savedSwaps.find(first.id).bodyId, '000000000002');
assert.equal(savedSwaps.find(first.id).score, 2);
const alex = model.add({ name: 'Alex', bodyId: 'ABCDEF123456', helmetId: '000000000002' });
const sam = model.add({ name: 'Sam', bodyId: '000000000003' });
assert.equal(model.record('abcdef123456,value:319', true), true);
assert.equal(alex.score, 0);
assert.equal(alex.belowThreshold, 1);
model.record('abcdef123456,value:320', true);
model.record('000000000002,value:40', true);
assert.equal(alex.score, 2); // one point each, including helmet impacts
assert.equal(sam.score, 0);
model.record('000000000003,value:320', true);
assert.equal(model.groupScore(), 3);
model.record('000000000003,value:2865', false);
assert.equal(sam.score, 1); // paused readings do not count
assert.equal(sam.lastHit.raw, 2865);
assert.equal(model.record('000000000099,value:999', true), false);
assert.equal(model.record('invalid', true), false);
model.update(alex.id, 'name', 'Alex Morgan');
assert.equal(alex.score, 2);
assert.throws(() => model.update(sam.id, 'helmetId', 'ABCDEF123456'), /already assigned/);
assert.throws(() => model.update(sam.id, 'bodyLevel', 72), /whole levels/);
assert.throws(() => model.update(sam.id, 'bodyId', 'invalid'), /12 letters/);
assert.equal(sam.bodyId, '000000000003');
model.reset(alex.id);
assert.equal(alex.score, 0);
assert.equal(sam.score, 1);
model.record('abcdef123456,value:320', true);
const saved = model.snapshot();
const loaded = free.createModel(JSON.parse(JSON.stringify(saved)));
assert.equal(loaded.groupScore(), 2);
assert.equal(loaded.participants[0].name, 'Alex Morgan');
assert.equal(loaded.participants[0].bodyId, 'abcdef123456');
model.remove(sam.id);
assert.equal(model.groupScore(), 1);
model.resetGroup();
assert.equal(model.groupScore(), 0);
assert.equal(alex.lastHit, null);
const large = free.createModel();
for (let i = 1; i <= 40; i++)
  large.add({ name: 'Person ' + i, bodyId: i.toString(16).padStart(12, '0') });
assert.equal(large.participants.length, 40); // no court or pair capacity

// Test transport lifetime with fake intervals: no round/game timer is ever used.
const stored = new Map(),
  notifications = [],
  commands = [],
  intervals = new Map();
global.localStorage = {
  getItem: (key) => stored.get(key) || null,
  setItem: (key, value) => stored.set(key, value)
};
global.UOBTKD_UI = { notify: (message) => notifications.push(message) };
global.UOBTKD_CONTROLLER_FIXES = { ignoreSpaceShortcut: () => false };
const actualInterval = global.setInterval,
  actualClear = global.clearInterval;
global.setInterval = (callback, delay) => {
  assert.equal(delay, 30000);
  intervals.set(1, callback);
  return 1;
};
global.clearInterval = (id) => intervals.delete(id);
const previous = () => {};
const parent = {
  devdata_cb: previous,
  online_cb: null,
  devstate_cb: null,
  vkspace_cb: null,
  sendMessage: (topic, payload) => commands.push({ topic, payload }),
  MqttRequestDeviceList() {},
  startTimer() {
    throw Error('Free training must not start a round timer');
  },
  startGame() {
    throw Error('Free training must not start a timed game');
  }
};
const store = {
  IS_ONLINE: false,
  IS_GAMING: false,
  huju_devices: [],
  toukui_devices: [],
  MQTT_OPTION: { qos: 1 },
  ReadSettings: () => ({ changci_begin: 0, changci_end: 0 })
};
try {
  const component = free.createComponent(store);
  const view = {
    ...component.data(),
    $parent: parent,
    $el: {
      querySelector() {
        return null;
      }
    },
    $nextTick: (fn) => fn()
  };
  for (const [key, fn] of Object.entries(component.methods)) view[key] = fn.bind(view);
  component.mounted.call(view);
  view.addPerson({ name: 'Person', bodyId: '000000000001' });
  view.start();
  assert.equal(view.active, false);
  assert.equal(commands.length, 0);
  view.onOnline(true);
  view.start();
  assert.equal(view.active, true);
  assert.equal(commands.length, 4);
  assert.equal(intervals.size, 1);
  assert.ok(commands.every((item) => item.payload === free.WORK_COMMAND));
  intervals.get(1)();
  assert.equal(commands.length, 8);
  parent.devdata_cb('000000000001,value:320');
  assert.equal(view.session.groupScore(), 1);
  view.onOnline(false);
  parent.devdata_cb('000000000001,value:320');
  assert.equal(view.session.groupScore(), 1);
  intervals.get(1)();
  assert.equal(commands.length, 8);
  view.onOnline(true);
  assert.equal(commands.length, 12);
  view.pause();
  assert.equal(intervals.size, 0);
  assert.equal(view.active, false);
  assert.ok(commands.slice(-4).every((item) => item.payload === 'StopWork'));
  const reopened = component.data();
  assert.equal(reopened.active, false);
  assert.equal(reopened.session.groupScore(), 1);
  view.start();
  component.beforeDestroy.call(view);
  assert.equal(intervals.size, 0);
  assert.equal(parent.devdata_cb, previous);
  assert.equal(parent.online_cb, null);
  assert.equal(store.IS_GAMING, false);
} finally {
  global.setInterval = actualInterval;
  global.clearInterval = actualClear;
}
console.log(
  'Free training checks passed: individual one-hit scoring, thresholds, unlimited roster, resets, persistence, and untimed transport lifecycle.'
);
