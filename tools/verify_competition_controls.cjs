const assert = require('node:assert/strict');
const core = require('../src/runtime/core.js');
const modes = require('../src/runtime/modes.js');
const fixes = require('../src/runtime/controller.js');
global.PSS_MODES = modes;
global.PSS_COMPETITION = require('../src/runtime/competition.js');
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
const controlState = global.PSS_COMPETITION.fresh({
  game_time: 59,
  competition_point_gap: 0,
  competition_max_gam_jeom: 99
});
controlState.started = true;
controlState.phase = 'paused';
c.gvi.game[0].competition = controlState;
function penalty(side, delta) {
  controlState.phase = 'break-paused';
  const result = fixes.adjustGamJeom(c, store, side, delta);
  controlState.phase = 'paused';
  return result;
}
assert(fixes.adjustGamJeom(c, store, 'left', 1));
assert(fixes.adjustGamJeom(c, store, 'left', -1));
for (const side of ['left', 'right']) {
  for (const delta of [1, 2, 3]) {
    fixes.adjustScore(c, store, side, delta);
    assert.equal(c.gvi.game[0][side].score, delta);
    fixes.adjustScore(c, store, side, -delta);
  }
  fixes.adjustScore(c, store, side, -3);
  assert.equal(c.gvi.game[0][side].score, 0);
  penalty(side, 1);
  assert.equal(c.gvi.game[0][side].warning, 1);
  assert.equal(c.gvi.game[0][side === 'left' ? 'right' : 'left'].score, 1);
  penalty(side, -1);
  assert.equal(penalty(side, -1), false);
}
assert.equal(c.time, 59);
assert.equal(c.gvi.game_state, 3);
assert.equal(c.gvi.game[0].left.hjhits, 0);
const soundEvents = [];
global.PSS_AUDIO = {
  event: (name) => soundEvents.push(name),
  hit: (kind, key) => soundEvents.push(kind + ':' + key)
};
assert(fixes.adjustScore(c, store, 'left', 2));
assert(fixes.adjustScore(c, store, 'left', -2));
fixes.adjustScore(c, store, 'left', -2); // Zero score: no audible deduction.
assert(fixes.adjustTechnical(c, store, 'left', 'body', 1));
assert(fixes.adjustTechnical(c, store, 'left', 'body', -1));
assert.equal(fixes.adjustTechnical(c, store, 'left', 'body', -1), false);
assert(fixes.adjustTechnical(c, store, 'left', 'head', 1));
assert(fixes.adjustTechnical(c, store, 'left', 'head', -1));
assert(penalty('left', 1));
assert(penalty('left', -1));
assert.equal(penalty('left', -1), false);
assert.deepEqual(soundEvents, [
  'court:1',
  'deduct',
  'addpoints',
  'deduct',
  'addpoints',
  'deduct',
  'gamjeom',
  'deduct'
]);
delete global.PSS_AUDIO;
c.gvi.game_state = 2;
c.gameinfo = { toukui_gate: 4 };
c.gvi.game[0].lidu = 25;
c.gvi.game[0].left.toukui = '000000000011';
global.PSS_AUDIO = { hit() {} };
fixes.scoreHit(c, store, '000000000001,value:999');
assert.equal(c.gvi.game[0].right.score, 0);
fixes.scoreHit(c, store, '000000000001,value:1000');
assert.equal(c.gvi.game[0].right.score, 2);
fixes.scoreHit(c, store, '000000000011,value:159');
assert.equal(c.gvi.game[0].right.score, 2);
fixes.scoreHit(c, store, '000000000011,value:160');
assert.equal(c.gvi.game[0].right.score, 5);
delete global.PSS_AUDIO;

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
