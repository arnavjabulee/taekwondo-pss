const assert = require('node:assert/strict');
const core = require('../src/runtime/core.js'),
  engine = require('../src/runtime/competition.js'),
  fixes = require('../src/runtime/controller.js');
global.PSS_MODES = { isCompetition: () => true };
global.PSS_COMPETITION = engine;
global.UOBTKD_CONTROLLER_FIXES = fixes;
let sounds = [];
global.PSS_AUDIO = {
  event: (name) => sounds.push(name),
  hit: (kind, id) => sounds.push(kind + ':' + id)
};
function setup() {
  const info = {
    game_rounds: 3,
    game_time: 60,
    rest_time: 10,
    competition_point_gap: 15,
    competition_max_gam_jeom: 2
  };
  const court = { lidu: 8, left: core.emptyParticipant(), right: core.emptyParticipant() };
  court.left.huju = '000000000001';
  court.right.huju = '000000000002';
  const store = { ReadGameInfo: () => info, SaveChangdiData() {}, GAMEINFO: info };
  const controller = {
    gvi: { game: [court], online: true, game_state: 1 },
    gameinfo: { ...info, toukui_gate: 1 },
    $parent: { startGame() {}, stopGame() {}, startTimer() {}, stopTimer() {} },
    $set: (object, key, value) => (object[key] = value),
    SendGameData() {},
    handleDevState() {},
    gameSetup() {},
    handleOnlineState() {}
  };
  engine.attach(controller, store);
  controller.gameControl();
  sounds = [];
  return { controller, store, court };
}
for (const kind of ['manual', 'sensor', 'technical', 'gamjeom']) {
  const { controller: c, store, court } = setup();
  if (kind === 'manual') {
    court.left.score = 14;
    fixes.adjustScore(c, store, 'left', 1);
  }
  if (kind === 'sensor') {
    court.left.score = 13;
    fixes.scoreHit(c, store, '000000000002,value:320');
  }
  if (kind === 'technical') {
    court.left.score = 13;
    fixes.adjustTechnical(c, store, 'left', 'body', 1);
  }
  if (kind === 'gamjeom') {
    c.gameControl();
    court.left.warning = 1;
    sounds = [];
    fixes.adjustGamJeom(c, store, 'left', 1);
  }
  assert.deepEqual(sounds, ['roundEnd'], kind + ' round-ending action must only play the horn');
  assert.equal(engine.state(c).phase, 'break');
}
const out = setup();
out.court.left.score = 1;
engine.tick(out.controller, out.store, 60);
sounds = [];
assert(fixes.adjustScore(out.controller, out.store, 'left', 1));
assert.deepEqual(sounds, ['addpoints'], 'Break adjustments use the technical-point sound');
const { controller: c, store } = setup();
fixes.adjustScore(c, store, 'left', 1);
assert.deepEqual(sounds, ['court:1']);
console.log(
  'Scoring sounds passed: manual/sensor/technical/penalty round endings only play the horn; break adjustments use technical audio and active scores retain court sounds.'
);
