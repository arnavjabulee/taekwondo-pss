const assert = require('node:assert/strict');
const core = require('../src/runtime/core.js');
const fixes = require('../src/runtime/controller.js');
const slots = Array.from({ length: 16 }, () => ({
  lidu: 8,
  left: core.emptyAthlete(),
  right: core.emptyAthlete()
}));
slots[0].left = {
  ...core.emptyAthlete(),
  index: 8,
  gamer: 'First',
  huju: '000000000001',
  score: 5
};
slots[0].right = {
  ...core.emptyAthlete(),
  index: 8,
  gamer: 'First',
  huju: '000000000002',
  score: 9
};
slots[1].left = { ...core.emptyAthlete(), gamer: 'Third', huju: '000000000003', score: 2 };
const store = {
  ReadGameData() {
    throw Error('Roster must not be consulted');
  },
  ReadChangdiData: (i) => slots[i],
  SaveChangdiData(i, value) {
    slots[i] = JSON.parse(JSON.stringify(value));
  },
  PlaySound() {}
};
fixes.prepareCourts(store);
assert.equal(store.game_list[0].left.gamer, 'First');
assert.equal(store.game_list[0].left.score, 5);
assert.equal(fixes.conflicts(store.game_list).length, 0);
let sends = 0;
const controller = {
  gvi: { game: store.game_list, game_state: 2 },
  gameinfo: { toukui_gate: 1 },
  time: 57,
  handleDevState() {},
  SendGameData() {
    sends++;
  },
  $parent: { query_battery_info() {} }
};
fixes.renameParticipant(controller, store, 0, 'left', 'Alex Morgan');
assert.equal(controller.gvi.game[0].left.gamer, 'Alex Morgan');
fixes.changeEquipment(controller, store, 0, 'left', 'huju', '000000000002');
assert.equal(controller.gvi.game[0].left.huju, '000000000002');
assert.equal(controller.gvi.game[0].right.huju, '000000000001');
assert.equal(controller.gvi.game[0].left.score, 5);
assert.equal(controller.gvi.game[0].right.score, 9);
assert.equal(controller.time, 57);
assert.equal(controller.gvi.game_state, 2);
fixes.scoreHit(controller, store, '000000000002,value:320');
assert.equal(controller.gvi.game[0].right.score, 11);
fixes.scoreHit(controller, store, '000000000001,value:320');
assert.equal(controller.gvi.game[0].left.score, 7);
fixes.changeEquipment(controller, store, 0, 'left', 'huju', '000000000003');
assert.equal(controller.gvi.game[1].left.huju, '000000000002');
assert.equal(controller.gvi.game[1].left.score, 2);
assert.equal(controller.gvi.game[0].left.gamer, 'Alex Morgan');
assert.equal(fixes.conflicts(controller.gvi.game).length, 0);
fixes.changeEquipment(controller, store, 0, 'left', 'huju', '');
assert.equal(controller.gvi.game[0].left.huju, '');
assert.throws(() => fixes.changeEquipment(controller, store, 0, 'left', 'huju', 'invalid'));
controller.gvi.game[0].left.huju = controller.gvi.game[0].right.huju;
controller.gvi.game[0].left.index = '';
assert(fixes.conflicts(controller.gvi.game).length > 0);
let alert = '';
global.alert = (value) => (alert = value);
assert.equal(fixes.canStart(controller), false);
assert(alert.includes('one participant'));
console.log(
  'Court checks passed: no roster, editable names, independent scores, same-court/cross-court guard swaps, immediate hit routing, stable timer/state, and duplicate-device rejection.'
);
