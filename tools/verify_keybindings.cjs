const assert = require('node:assert/strict');
const events = {},
  saved = new Map(),
  calls = [];
let editing = false,
  competition = true;
global.document = { addEventListener: (name, fn) => (events[name] = fn) };
global.addEventListener = (name, fn) => (events[name] = fn);
global.localStorage = {
  getItem: (key) => saved.get(key),
  setItem: (key, value) => saved.set(key, value)
};
global.UOBTKD_CONTROLLER_FIXES = { ignoreSpaceShortcut: () => editing };
global.PSS_NAV = { back: () => calls.push('back'), equipment: () => calls.push('equipment') };
global.PSS_MODES = { isCompetition: () => competition };
const view = {
  gvi: {},
  gameControl: () => calls.push('toggle'),
  adjustCompetitionScore: (side, points) => calls.push([side, points]),
  adjustCompetitionGamJeom: (side, delta) => calls.push([side, 'penalty', delta]),
  skipCompetitionBreak: () => calls.push('skip')
};
const keys = require('../src/runtime/keybindings.js');
keys.attach({ $children: [view] });
function press(key, extra = {}) {
  const event = {
    key,
    preventDefault() {
      this.prevented = true;
    },
    stopImmediatePropagation() {},
    ...extra
  };
  events.keydown(event);
  return event;
}
assert.equal(keys.get().toggle, 'Space');
press(' ');
assert.equal(calls.pop(), 'toggle');
events.keyup({ key: ' ', preventDefault() {}, stopImmediatePropagation() {} });
keys.set('toggle', 'K');
press(' ');
assert.equal(calls.length, 0);
press('k');
assert.equal(calls.pop(), 'toggle');
assert.throws(() => keys.set('equipment', 'K'), /already assigned/);
keys.set('bluePoints2', 'Ctrl+B');
press('b', { ctrlKey: true });
assert.deepEqual(calls.pop(), ['left', 2]);
press('b', { ctrlKey: true, repeat: true });
assert.equal(calls.length, 0);
editing = true;
assert.equal(press('k').prevented, undefined);
press('b', { ctrlKey: true });
assert.equal(calls.length, 0);
press('Escape');
assert.equal(calls.pop(), 'back');
editing = false;
competition = false;
press('b', { ctrlKey: true });
assert.equal(calls.length, 0);
competition = true;
let captured;
keys.capture('equipment', (error) => (captured = error));
press('e');
assert.equal(captured, '');
assert.equal(keys.get().equipment, 'E');
keys.capture('back', (error) => (captured = error));
keys.nativeKey('Escape');
assert.match(captured, /cancelled/);
events.keyup({ key: 'Escape' });
keys.reset();
keys.nativeKey('Escape');
keys.nativeKey('Escape');
assert.deepEqual(calls, ['back', 'back'], 'Native Escape must work after a missing key-up');
calls.length = 0;
keys.nativeKey('Space');
keys.nativeKey('Space');
assert.equal(press(' ').prevented, true);
assert.deepEqual(calls, ['toggle']);
events.keyup({ key: ' ', preventDefault() {}, stopImmediatePropagation() {} });
press(' ');
keys.nativeKey('Space');
assert.deepEqual(calls, ['toggle', 'toggle']);
const release = {
  key: ' ',
  preventDefault() {
    this.prevented = true;
  },
  stopImmediatePropagation() {}
};
events.keyup(release);
assert.equal(release.prevented, true, 'Handled Space must not click a focused button on release');
keys.nativeKey('Space');
assert.deepEqual(calls, ['toggle', 'toggle', 'toggle']);
events.blur();
calls.length = 0;
keys.reset();
press(' ');
press(' ', { repeat: true });
assert.deepEqual(calls, ['toggle']);
press(' '); // A fresh press after a missed key-up must recover.
assert.deepEqual(calls, ['toggle', 'toggle']);
events.keyup({ key: ' ', preventDefault() {}, stopImmediatePropagation() {} });
keys.set('toggle', 'K');
delete require.cache[require.resolve('../src/runtime/keybindings.js')];
const reopened = require('../src/runtime/keybindings.js');
assert.equal(reopened.get().toggle, 'K');
assert.equal(keys.keyOf({ keyCode: 75 }), 'K');
assert.throws(() => keys.set('back', 'Tab'));
assert.throws(() => keys.set('back', 'Alt+F4'));
console.log(
  'Keybindings passed: persistence, remapping, duplicates, capture/cancel, context checks, typing safety and native held-key protection.'
);
