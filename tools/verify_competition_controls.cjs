const assert = require('node:assert/strict');
const core = require('../src/runtime/core.js');
const modes = require('../src/runtime/modes.js');
const fixes = require('../src/runtime/controller.js');
global.PSS_MODES = modes;
const data = Array.from({ length: 16 }, () => ({
  lidu: 8,
  left: core.emptyParticipant(),
  right: core.emptyParticipant()
}));
const store = {
  IS_ONLINE: true,
  IS_GAMING: false,
  game_list: data,
  ReadChangdiData: (i) => data[i],
  SaveChangdiData: (i, v) => {
    data[i] = v;
  }
};
modes.enterCompetition(
  store,
  { name: 'Alex', bodyId: '000000000001' },
  { name: 'Sam', bodyId: '000000000002' }
);
const c = { gvi: { game: store.game_list, game_state: 1 }, time: 59, SendGameData() {} };
assert.equal(fixes.adjustScore(c, store, 'left', 1), false);
assert.throws(() => fixes.renameParticipant(c, store, 0, 'left', 'Changed'), /locked/);
c.gvi.game_state = 3;
for (const side of ['left', 'right']) {
  for (const delta of [1, 2, 3]) {
    fixes.adjustScore(c, store, side, delta);
    assert.equal(c.gvi.game[0][side].score, delta);
    fixes.adjustScore(c, store, side, -delta);
  }
  fixes.adjustScore(c, store, side, -3);
  assert.equal(c.gvi.game[0][side].score, 0);
  fixes.adjustGamJeom(c, store, side, 1);
  assert.equal(c.gvi.game[0][side].warning, 1);
  assert.equal(c.gvi.game[0][side === 'left' ? 'right' : 'left'].score, 1);
  fixes.adjustGamJeom(c, store, side, -1);
  assert.equal(fixes.adjustGamJeom(c, store, side, -1), false);
}
assert.equal(c.time, 59);
assert.equal(c.gvi.game_state, 3);
assert.equal(c.gvi.game[0].left.hjhits, 0);
modes.leaveCompetition(store);
const component = modes.createComponent(store),
  sent = [];
const host = {
  sendMessage: (...args) => sent.push(args),
  MqttRequestDeviceList() {},
  devdata_cb: 'previous'
};
const ctx = { ...component.data(), $parent: host, $router: { push() {} } };
Object.entries(component.methods).forEach(([k, v]) => (ctx[k] = v.bind(ctx)));
component.mounted.call(ctx);
assert.equal(ctx.testing, true);
assert.equal(sent.filter((x) => x[1].startsWith('StartWork')).length, 4);
host.devdata_cb('000000000001,value:40');
assert.equal(ctx.checks.blue.bodyId.count, 1);
assert.equal(ctx.checks.blue.bodyId.raw, 40);
host.devdata_cb('000000000099,value:400');
assert.equal(ctx.checks.blue.bodyId.count, 1);
assert.equal(store.IS_GAMING, false);
assert.equal(host.timer, undefined);
ctx.toggleTest();
host.devdata_cb('000000000001,value:80');
assert.equal(ctx.checks.blue.bodyId.count, 1);
ctx.toggleTest();
ctx.resetTest();
assert.equal(ctx.checks.blue.bodyId.count, 0);
ctx.start();
assert.equal(ctx.testing, false);
assert.equal(store.game_list[0].left.score, 0);
component.beforeDestroy.call(ctx);
assert.equal(host.devdata_cb, 'previous');
assert.equal(ctx._testRenewal, null);
modes.leaveCompetition(store);
console.log(
  'Competition controls passed: isolated protector testing, cleanup, locked names, manual adjustments, penalty awards/undo and preserved clock/hit counts.'
);
