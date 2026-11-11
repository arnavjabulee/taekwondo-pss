const assert = require('node:assert/strict');
const core = require('../src/runtime/core.js');
const fixes = require('../src/runtime/controller.js');
const engine = require('../src/runtime/competition.js');
global.PSS_MODES = { isCompetition: () => true };
global.PSS_COMPETITION = engine;
global.UOBTKD_CONTROLLER_FIXES = fixes;
global.PSS_AUDIO = { event() {}, hit() {} };
function setup(overrides = {}) {
  const info = {
    game_time: 120,
    rest_time: 3,
    game_rounds: 3,
    competition_max_gam_jeom: 99,
    competition_point_gap: 0,
    ...overrides
  };
  const court = { lidu: 8, left: core.emptyParticipant(), right: core.emptyParticipant() };
  let saved;
  const store = {
    GAMEINFO: info,
    ReadGameInfo: () => info,
    SaveChangdiData: (i, value) => {
      saved = JSON.parse(JSON.stringify(value));
    }
  };
  const c = {
    gameinfo: info,
    gvi: { game: [court], game_state: 1, online: false },
    $set: (o, k, v) => (o[k] = v),
    $parent: { startGame() {}, stopGame() {}, startTimer() {}, stopTimer() {} },
    SendGameData() {}
  };
  engine.attach(c, store);
  c.gameControl();
  return { c, store, court, s: () => engine.state(c), saved: () => saved };
}

function breakFor(x, remaining = 30, winner = 'left') {
  x.s().remaining = remaining;
  x.s().decisionSide = winner;
  x.s().decisionMethod = 'SUP';
  engine.record(x.c, x.store);
  assert.equal(x.s().phase, 'break');
}
const gate = setup();
assert.equal(gate.c.raiseIVR('left'), false);
assert.equal(fixes.adjustGamJeom(gate.c, gate.store, 'left', 1), false);
gate.c.gameStop();
assert(gate.c.raiseIVR('left'), 'Paused play permits IVR');
gate.c.cancelIVR();
assert(fixes.adjustGamJeom(gate.c, gate.store, 'left', 1));
assert(fixes.adjustGamJeom(gate.c, gate.store, 'left', -1));
gate.c.gameControl();
breakFor(gate);
assert(fixes.adjustGamJeom(gate.c, gate.store, 'left', 1));
assert.equal(gate.court.right.score, 1);
assert(fixes.adjustGamJeom(gate.c, gate.store, 'left', -1));
assert.equal(gate.court.right.score, 0);
const x = setup();
breakFor(x);
assert(x.c.raiseIVR('left'));
assert.equal(x.s().phase, 'break-paused');
assert.equal(x.s().ivrPending.points, 1);
x.c.gameControl();
x.c.timer_callback();
assert.equal(x.s().breakRemaining, 3);
assert.equal(fixes.adjustGamJeom(x.c, x.store, 'left', 1), false);
assert(x.c.resolveIVR(true));
assert.equal(x.s().ivrCards.left, true);
assert(x.c.undoIVR('left'));
assert.equal(x.s().ivrHistory.length, 0);
assert.equal(x.s().ivrCards.left, true);
assert(x.c.raiseIVR('left'));
assert(x.c.resolveIVR(false));
assert.equal(x.s().ivrCards.left, false);
assert.equal(x.court.left.warning, 1);
assert.equal(x.court.left.ivr_warnings, 1);
assert.equal(x.court.right.score, 1);
assert.equal(x.court.right.first_score, 0);
assert.equal(fixes.adjustGamJeom(x.c, x.store, 'left', -1), false);
assert(x.c.undoIVR('left'));
assert.equal(x.court.right.score, 0);
assert.equal(x.court.left.warning, 0);
assert.equal(x.s().results[0].method, 'SUP', 'Undo restores the prior manual decision');
assert.equal(x.s().breakRemaining, 3);
assert.equal(x.s().phase, 'break-paused');
assert.equal(x.c.undoIVR('left'), false);
x.c.raiseIVR('left');
x.c.resolveIVR(false);
x.c.gameControl();
for (let i = 0; i < 3; i++) x.c.timer_callback();
assert.equal(x.s().phase, 'ready');
assert.equal(x.s().ivrCards.left, false);
assert.equal(x.c.undoIVR('left'), false, 'Cannot undo a prior-round decision after its break');
x.c.gameControl();
breakFor(x, 10);
x.c.raiseIVR('right');
x.c.resolveIVR(false);
assert.equal(x.court.left.score, 2);
assert.equal(x.court.right.warning, 1);
assert.equal(x.s().ivrCards.right, false);
const cancel = setup();
breakFor(cancel);
cancel.c.raiseIVR('left');
cancel.c.cancelIVR();
assert.equal(cancel.s().ivrCards.left, true);
assert.equal(cancel.s().ivrPending, null);
const restore = setup();
breakFor(restore);
restore.c.raiseIVR('right');
restore.c.gvi.game = [JSON.parse(JSON.stringify(restore.saved()))];
engine.attach(restore.c, restore.store);
assert.equal(restore.s().ivrPending.side, 'right');
assert(restore.c.resolveIVR(true));
assert(restore.c.undoIVR('right'));
const terminal = setup();
breakFor(terminal, 30, 'right');
for (let i = 0; i < 3; i++) terminal.c.timer_callback();
terminal.c.gameControl();
breakFor(terminal, 9, 'left');
terminal.c.raiseIVR('left');
terminal.c.resolveIVR(false);
assert.equal(terminal.s().phase, 'finished');
assert.equal(terminal.s().winner, 'right');
assert(terminal.c.undoIVR('left'));
assert.equal(terminal.s().winner, '');
assert.deepEqual(terminal.s().wins, { left: 1, right: 1 });
assert.equal(terminal.s().phase, 'break-paused');
assert.equal(terminal.court.right.score, 0);
assert.equal(terminal.s().ivrCards.left, true);
const edited = setup();
breakFor(edited, 0);
edited.c.raiseIVR('left');
edited.c.resolveIVR(false);
fixes.adjustScore(edited.c, edited.store, 'left', 3);
assert(edited.c.undoIVR('left'));
assert.equal(edited.court.left.score, 3, 'Intervening score corrections survive IVR undo');
assert.equal(edited.court.right.score, 0);
assert.equal(edited.s().results[0].winner, 'left');
console.log(
  'IVR passed: paused/break gating, quota state, typed penalties, undo, corrected match results, persistence and preservation of other edits.'
);

const pausedRound = setup();
pausedRound.s().remaining = 9;
pausedRound.c.gameStop();
assert(pausedRound.c.raiseIVR('left'));
assert.equal(pausedRound.s().ivrPending.round, 1);
assert(pausedRound.c.resolveIVR(false));
assert.equal(pausedRound.court.right.score, 2);
assert.equal(pausedRound.s().phase, 'paused');
assert(pausedRound.c.undoIVR('left'));
assert.equal(pausedRound.court.right.score, 0);
assert.equal(pausedRound.s().phase, 'paused');
assert.equal(pausedRound.s().remaining, 9);
pausedRound.c.raiseIVR('left');
pausedRound.c.resolveIVR(true);
pausedRound.c.gameControl();
pausedRound.c.timer_callback();
pausedRound.c.gameStop();
assert(pausedRound.c.undoIVR('left'));
assert.equal(pausedRound.s().remaining, 8, 'Undo does not reset elapsed match time');
const pausedLimit = setup({ competition_max_gam_jeom: 1 });
pausedLimit.s().remaining = 9;
pausedLimit.c.gameStop();
pausedLimit.c.raiseIVR('left');
pausedLimit.c.resolveIVR(false);
assert.equal(pausedLimit.s().results[0].method, 'PUN');
assert(pausedLimit.c.undoIVR('left'));
assert.equal(pausedLimit.s().results.length, 0);
assert.equal(pausedLimit.s().phase, 'paused');
assert.equal(pausedLimit.s().remaining, 9);
console.log(
  'Paused-round controls passed: IVR and penalties enabled while paused, disabled during active play, with clock-preserving undo.'
);
