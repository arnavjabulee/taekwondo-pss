const assert = require('node:assert/strict');
const core = require('../src/runtime/core.js');
const fixes = require('../src/runtime/controller.js');
const engine = require('../src/runtime/competition.js');
global.PSS_MODES = { isCompetition: () => true };
global.PSS_COMPETITION = engine;
global.LEDA_CONTROLLER_FIXES = fixes;
const sounds = [];
global.PSS_AUDIO = { event: (n) => sounds.push(n), hit() {} };
function setup(options = {}) {
  const info = {
    game_rounds: 3,
    game_time: 2,
    rest_time: 1,
    competition_max_gam_jeom: 2,
    competition_point_gap: 4,
    ...options
  };
  const games = Array.from({ length: 16 }, () => ({
    lidu: 8,
    left: core.emptyParticipant(),
    right: core.emptyParticipant()
  }));
  games[0].left.gamer = 'Alex';
  games[0].right.gamer = 'Sam';
  games[0].left.huju = '000000000001';
  games[0].right.huju = '000000000002';
  const saved = [];
  const store = {
    GAMEINFO: info,
    ReadGameInfo: () => info,
    SaveChangdiData: (i, v) => {
      saved[i] = JSON.parse(JSON.stringify(v));
    },
    ReadChangdiData: (i) => saved[i]
  };
  const calls = [];
  const host = {
    startGame() {
      calls.push('start');
    },
    stopGame() {
      calls.push('stop');
    },
    startTimer() {
      calls.push('break');
    },
    stopTimer() {
      calls.push('stopTimer');
    }
  };
  const c = {
    gvi: { game: games, online: true, game_state: 1 },
    gameinfo: { ...info, toukui_gate: 1 },
    $parent: host,
    $set: (o, k, v) => (o[k] = v),
    SendGameData() {},
    handleDevState() {},
    gameSetup() {},
    handleOnlineState(v) {
      this.gvi.online = v;
    }
  };
  engine.attach(c, store);
  return { c, store, s: () => engine.state(c), calls, saved, info };
}
const x = setup();
const { c, store, s } = x;
c.gameControl();
assert.equal(s().phase, 'running');
fixes.adjustScore(c, store, 'left', 2);
fixes.adjustScore(c, store, 'left', 2);
assert.equal(s().results[0].method, 'PTG');
assert.equal(s().results[0].name, 'Alex');
assert.equal(s().wins.left, 1);
assert.equal(s().winner, '');
assert.equal(fixes.adjustScore(c, store, 'right', 1), false);
fixes.scoreHit(c, store, '000000000001,value:320');
assert.equal(s().results.length, 1);
assert.equal(s().phase, 'break');
c.gameControl();
assert.equal(s().phase, 'break-paused');
c.timer_callback();
assert.equal(s().breakRemaining, 1);
c.gameControl();
c.timer_callback();
assert.equal(s().phase, 'ready');
assert.equal(c.gvi.game[0].left.score, 0);
assert.equal(c.gvi.current_round, 2);
c.gameControl();
fixes.adjustGamJeom(c, store, 'left', 1);
fixes.adjustGamJeom(c, store, 'left', 1);
assert.equal(s().results[1].method, 'PUN');
assert.equal(s().results[1].winner, 'right');
c.timer_callback();
assert.equal(c.gvi.game[0].left.warning, 0);
c.gameControl();
fixes.adjustScore(c, store, 'right', 1);
c.timer_callback();
c.timer_callback();
assert.equal(s().results[2].method, 'PTF');
assert.equal(s().winner, 'right');
assert.deepEqual(s().wins, { left: 1, right: 2 });
assert.equal(c.gvi.current_round, 3);
assert.equal(fixes.adjustScore(c, store, 'right', 3), false);
assert.equal(engine.undo(c, store), true);
assert.equal(s().winner, '');
assert.equal(s().phase, 'decision');
fixes.adjustScore(c, store, 'left', 1);
s().decisionSide = 'left';
s().decisionMethod = 'SUP';
engine.record(c, store);
assert.equal(s().winner, 'left');
assert.equal(s().results[2].method, 'SUP');
engine.reset(c, store);
assert.equal(s().results.length, 0);
assert.equal(s().phase, 'ready');
assert.equal(c.gvi.game[0].right.score, 0);
// Stop and settings pause preserve the clock and do not erase results.
c.gameControl();
c.timer_callback();
c.gameStop();
assert.equal(s().remaining, 1);
assert.equal(s().phase, 'paused');
c.gameControl();
c.gameSetup();
assert.equal(s().phase, 'paused');
c.timer_callback();
assert.equal(s().remaining, 1);
c.gameControl();
c.handleOnlineState(false);
assert.equal(s().phase, 'paused');
// A disabled point gap never creates a PTG result, even with very large scores.
const off = setup({ competition_point_gap: 0 });
off.c.gameControl();
for (let i = 0; i < 100; i++) fixes.adjustScore(off.c, off.store, 'right', 3);
assert.equal(off.s().results.length, 0);
assert.equal(off.c.gvi.game[0].right.score, 300);
// Ties stop the clock and wait; referee-only outcomes never guess a winner.
const tie = setup();
tie.c.gameControl();
tie.c.timer_callback();
tie.c.timer_callback();
assert.equal(tie.s().phase, 'break');
assert.equal(tie.s().pendingDecision, true);
tie.c.timer_callback();
assert.equal(tie.s().phase, 'decision');
assert.equal(tie.s().results.length, 0);
tie.s().decisionMethod = 'PTF';
assert.equal(engine.record(tie.c, tie.store), false);
tie.s().decisionMethod = 'SUP';
tie.s().decisionSide = 'right';
engine.record(tie.c, tie.store);
assert.equal(tie.s().results[0].method, 'SUP');
// Referee stoppages terminate the entire contest, including before the first start.
for (const method of ['KO', 'RSC', 'DSQ', 'WDR', 'DQB']) {
  const t = setup({ game_rounds: 5 });
  t.s().decisionMethod = method;
  t.s().decisionSide = 'right';
  assert.equal(engine.record(t.c, t.store), true);
  assert.equal(t.s().winner, 'right');
  assert.equal(t.s().method, method);
  assert.equal(t.s().results.length, 1);
}
// Any configured series length is supported. Even series use a final referee decision if tied.
const even = setup({ game_rounds: 2, rest_time: 0 });
for (const side of ['left', 'right']) {
  even.c.gameControl();
  even.s().decisionSide = side;
  even.s().decisionMethod = 'SUP';
  engine.record(even.c, even.store);
}
assert.equal(even.s().phase, 'decision');
assert.equal(even.s().winner, '');
even.s().decisionSide = 'right';
engine.record(even.c, even.store);
assert.equal(even.s().winner, 'right');
assert.equal(even.s().results.length, 2);
const five = setup({ game_rounds: 5, rest_time: 0 });
for (let i = 0; i < 3; i++) {
  five.c.gameControl();
  five.s().decisionMethod = 'SUP';
  engine.record(five.c, five.store);
}
assert.equal(five.s().wins.left, 3);
assert.equal(five.s().winner, 'left');
// Correcting the previous result during a running break preserves its clock.
const correction = setup({ rest_time: 10 });
correction.c.gameControl();
fixes.adjustScore(correction.c, correction.store, 'left', 3);
fixes.adjustScore(correction.c, correction.store, 'left', 1);
assert.equal(correction.s().phase, 'break');
correction.c.timer_callback();
correction.s().decisionSide = 'right';
correction.s().decisionMethod = 'SUP';
assert.equal(engine.amend(correction.c, correction.store), true);
assert.equal(correction.s().breakRemaining, 9);
assert.deepEqual(correction.s().wins, { left: 0, right: 1 });
assert.equal(correction.s().results[0].name, 'Sam');
correction.s().decisionMethod = 'WDR';
engine.amend(correction.c, correction.store);
assert.equal(correction.s().winner, 'right');
correction.s().decisionMethod = 'SUP';
engine.amend(correction.c, correction.store);
assert.equal(correction.s().winner, '');
assert.equal(correction.s().phase, 'break');
// Recreated controllers keep the full series and remaining time, then return paused.
const resume = setup();
resume.c.gameControl();
resume.c.timer_callback();
const copied = JSON.parse(JSON.stringify(resume.saved));
resume.c.gvi.game = copied;
engine.attach(resume.c, resume.store);
assert.equal(resume.s().phase, 'paused');
assert.equal(resume.s().remaining, 1);
// New matches adopt changed settings; an ongoing match keeps its initial rules.
resume.info.competition_point_gap = 0;
assert.equal(resume.s().rules.pointGap, 4);
engine.reset(resume.c, resume.store);
assert.equal(resume.s().rules.pointGap, 0);
assert.equal(engine.rules({ competition_max_gam_jeom: 0 }).gamJeoms, 5);
assert(
  sounds.includes('roundEnd') &&
    sounds.includes('breakEnd') &&
    sounds.includes('pause') &&
    sounds.includes('resume')
);
console.log(
  'Competition series passed: PTG/PUN/PTF/SUP, best-of-3/5, even ties, zero gap, terminal referee outcomes, undo/reset, breaks, offline/settings pause and restored state.'
);
const interruptedBreak = setup({ rest_time: 5 });
interruptedBreak.c.gameControl();
interruptedBreak.s().decisionMethod = 'SUP';
engine.record(interruptedBreak.c, interruptedBreak.store);
assert.equal(interruptedBreak.s().phase, 'break');
interruptedBreak.c.handleOnlineState(false);
assert.equal(interruptedBreak.s().phase, 'break-paused');
assert.equal(interruptedBreak.s().breakRemaining, 5);
