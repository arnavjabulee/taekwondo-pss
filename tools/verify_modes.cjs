const assert = require('node:assert/strict');
const modes = require('../src/runtime/modes.js');
const core = require('../src/runtime/core.js');
const data = Array.from({ length: 16 }, (_, i) => ({
  lidu: i + 8,
  left: { ...core.emptyAthlete(), gamer: 'Saved ' + i },
  right: core.emptyAthlete()
}));
const original = JSON.stringify(data);
const games = [{ saved: true }],
  left = [],
  right = [];
const store = {
  game_list: games,
  left_gamer_list: left,
  right_gamer_list: right,
  court_view_mode: 2,
  ReadGameData() {
    throw Error('Roster must not be consulted');
  },
  ReadChangdiData: (i) => data[i],
  SaveChangdiData(i, value) {
    data[i] = JSON.parse(JSON.stringify(value));
  }
};
const blue = { name: 'Alex', bodyId: '000000000001', helmetId: '000000000011' },
  red = { name: 'Sam', bodyId: '000000000002', helmetId: '000000000012' };
assert.throws(() => modes.enterCompetition(store, 0, 1));
assert.throws(() => modes.enterCompetition(store, blue, { ...red, bodyId: blue.bodyId }));
modes.enterCompetition(store, blue, red);
assert.equal(modes.isCompetition(), true);
assert.equal(store.court_view_mode, 0);
assert.equal(data[0].left.gamer, 'Alex');
assert.equal(data[0].right.gamer, 'Sam');
assert(data.slice(1).every((c) => !c.left.huju && !c.right.huju));
modes.leaveCompetition(store);
assert.equal(JSON.stringify(data), original);
assert.equal(store.game_list, games);
assert.equal(store.court_view_mode, 2);
const memory = new Map();
global.localStorage = {
  getItem: (key) => memory.get(key) || null,
  setItem: (key, value) => memory.set(key, value),
  removeItem: (key) => memory.delete(key)
};
modes.enterCompetition(store, blue, red);
delete require.cache[require.resolve('../src/runtime/modes.js')];
const restarted = require('../src/runtime/modes.js');
const component = restarted.createComponent(store);
assert.equal(JSON.stringify(data), original);
assert.equal(memory.has('uobtkd_competition_backup_v1'), false);
const setup = component.data();
assert.equal(setup.blue.name, 'Alex');
assert.equal(setup.blue.bodyId, '000000000001');
restarted.rewriteEquipment('000000000001', '000000000003', 'body');
assert.equal(component.data().blue.bodyId, '000000000003');
delete global.localStorage;
console.log(
  'Competition checks passed: no roster, direct names/equipment, one court, equipment conflicts, restored training setup, interrupted-match recovery, and saved setup updates.'
);
