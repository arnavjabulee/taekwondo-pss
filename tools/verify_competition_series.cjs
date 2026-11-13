const assert = require('node:assert/strict');
const core = require('../src/runtime/core.js');
const fixes = require('../src/runtime/controller.js');
const engine = require('../src/runtime/competition.js');
global.PSS_MODES = { isCompetition: () => true };
global.PSS_COMPETITION = engine;
global.UOBTKD_CONTROLLER_FIXES = fixes;
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
// A stale connection discovered while sending StartWork must not cancel Start.
const staleReceiver = setup({ game_time: 120 });
staleReceiver.c.$parent.startGame = function () {
  staleReceiver.c.handleOnlineState(false);
};
staleReceiver.c.gameControl();
assert.equal(staleReceiver.s().phase, 'running');
staleReceiver.c.timer_callback();
assert.equal(staleReceiver.s().remaining, 119);
staleReceiver.c.handleOnlineState(false);
assert.equal(staleReceiver.s().phase, 'running', 'Repeated offline updates must not pause');
staleReceiver.c.handleOnlineState(true);
staleReceiver.c.handleOnlineState(false);
assert.equal(staleReceiver.s().phase, 'paused', 'A real mid-match disconnect must pause');
staleReceiver.c.gameControl();
assert.equal(staleReceiver.s().phase, 'running', 'Resume must also work offline');
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
c.timer_callback();
c.timer_callback(); // Penalties are now entered during the round break.
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
assert.equal(fixes.adjustScore(c, store, 'right', 3), true);
assert.equal(s().results[2].red, 4);
assert.equal(fixes.adjustScore(c, store, 'right', -3), true);
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
assert.equal(correction.s().breakRemaining, 9, 'Reopening a result must not restart the break');
correction.c.gameControl();
assert.equal(correction.s().phase, 'break-paused');
correction.s().decisionMethod = 'WDR';
engine.amend(correction.c, correction.store);
correction.s().decisionMethod = 'SUP';
engine.amend(correction.c, correction.store);
assert.equal(correction.s().phase, 'break-paused');
assert.equal(correction.s().breakRemaining, 9);
correction.c.gameControl();
for (let i = 0; i < 9; i++) correction.c.timer_callback();
assert.equal(correction.s().phase, 'ready');
correction.s().decisionMethod = 'WDR';
engine.amend(correction.c, correction.store);
correction.s().decisionMethod = 'SUP';
engine.amend(correction.c, correction.store);
assert.equal(correction.s().phase, 'ready', 'An expired break must stay expired');
assert.equal(correction.s().breakRemaining, 0);
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
    !sounds.includes('pause') &&
    !sounds.includes('resume')
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

const offline = setup({ game_time: 30 });
offline.c.gvi.online = false;
offline.c.gameControl();
assert.equal(offline.s().phase, 'running');
fixes.adjustScore(offline.c, offline.store, 'left', 1);
assert.equal(offline.c.gvi.game[0].left.score, 1);
offline.c.timer_callback();
assert.equal(offline.s().remaining, 29);
offline.c.gameControl();
assert.equal(offline.s().phase, 'paused');
offline.c.gameControl();
assert.equal(offline.s().phase, 'running');

const skip = setup({ rest_time: 30 });
skip.c.gameControl();
fixes.adjustScore(skip.c, skip.store, 'left', 2);
fixes.adjustScore(skip.c, skip.store, 'left', 2);
assert.equal(skip.s().phase, 'break');
global.confirm = () => false;
assert.equal(engine.skipBreak(skip.c, skip.store), false);
assert.equal(skip.s().breakRemaining, 30);
global.confirm = () => true;
assert.equal(engine.skipBreak(skip.c, skip.store), true);
assert.equal(skip.s().phase, 'ready');
assert.equal(skip.s().remaining, 2);
assert.equal(skip.s().results.length, 1);
assert.equal(engine.skipBreak(skip.c, skip.store), false);
const undecided = setup({ rest_time: 30 });
undecided.c.gameControl();
undecided.c.timer_callback();
undecided.c.timer_callback();
assert.equal(undecided.s().pendingDecision, true);
assert.equal(engine.skipBreak(undecided.c, undecided.store), true);
assert.equal(undecided.s().phase, 'decision');
assert.equal(undecided.s().pendingDecision, true);
delete global.confirm;
const complete = setup();
complete.s().phase = 'finished';
complete.s().winner = 'left';
let destination;
complete.c.$router = { push: (value) => (destination = value) };
complete.c.gameControl();
assert.equal(destination.name, 'CompetitionJudges');

const corrections = setup({ game_time: 1, rest_time: 30, competition_point_gap: 0 });
corrections.c.gameControl();
fixes.adjustScore(corrections.c, corrections.store, 'left', 1);
corrections.c.timer_callback();
corrections.s().breakRemaining = 17;
assert.equal(fixes.adjustScore(corrections.c, corrections.store, 'right', 2), true);
assert.equal(corrections.s().results.length, 1);
assert.equal(corrections.s().results[0].winner, 'right');
assert.equal(corrections.s().results[0].red, 2);
assert.equal(corrections.s().breakRemaining, 17);
assert.deepEqual(corrections.s().wins, { left: 0, right: 1 });
fixes.adjustGamJeom(corrections.c, corrections.store, 'right', 1);
fixes.adjustGamJeom(corrections.c, corrections.store, 'right', 1);
assert.equal(corrections.s().results[0].method, 'PUN');
assert.equal(corrections.s().results[0].winner, 'left');
fixes.adjustGamJeom(corrections.c, corrections.store, 'right', -1);
assert.equal(corrections.s().results[0].winner, 'left');
assert.equal(corrections.s().results[0].method, 'PTF');
corrections.c.gameControl();
assert.equal(corrections.s().phase, 'break-paused');
fixes.adjustTechnical(corrections.c, corrections.store, 'left', 'head', 1);
assert.equal(corrections.s().results[0].winner, 'left');
assert.equal(corrections.s().results[0].snapshot.left.technical_head, 1);
assert.equal(corrections.s().phase, 'break-paused');
assert.equal(corrections.s().breakRemaining, 17);
const retie = setup({ game_time: 1, rest_time: 30, competition_point_gap: 0 });
retie.c.gameControl();
fixes.adjustScore(retie.c, retie.store, 'left', 1);
retie.c.timer_callback();
retie.s().breakRemaining = 12;
fixes.adjustScore(retie.c, retie.store, 'right', 1);
assert.equal(retie.s().pendingDecision, false);
assert.equal(retie.s().results.length, 1);
assert.equal(retie.s().results[0].winner, 'left');
assert.equal(retie.s().results[0].basis, 'First scoring technique');
assert.equal(retie.s().breakRemaining, 12);
fixes.adjustGamJeom(retie.c, retie.store, 'left', 1);
assert.equal(retie.s().results.length, 1);
assert.equal(retie.s().results[0].winner, 'right');
assert.equal(retie.s().breakRemaining, 12);
const finalEdit = setup({ game_rounds: 1, game_time: 1, competition_point_gap: 0 });
finalEdit.c.gameControl();
fixes.adjustScore(finalEdit.c, finalEdit.store, 'left', 1);
finalEdit.c.timer_callback();
assert.equal(finalEdit.s().phase, 'finished');
fixes.adjustScore(finalEdit.c, finalEdit.store, 'right', 2);
assert.equal(finalEdit.s().winner, 'right');
assert.equal(finalEdit.s().results.length, 1);
assert.equal(finalEdit.s().results[0].snapshot.right.score, 2);

const voted = setup({ game_time: 1, rest_time: 30, competition_point_gap: 0 });
voted.c.gameControl();
voted.c.timer_callback();
voted.s().decisionSide = 'left';
voted.s().decisionMethod = 'SUP';
engine.record(voted.c, voted.store);
fixes.adjustScore(voted.c, voted.store, 'right', -1);
assert.equal(voted.s().results.length, 1);
assert.equal(voted.s().results[0].method, 'SUP');
assert.equal(voted.s().pendingDecision, false);

const matchThreshold = setup();
matchThreshold.c.gvi.game[0].helmetLevel = 4;
matchThreshold.c.gameinfo.toukui_gate = 1;
engine.attach(matchThreshold.c, matchThreshold.store);
assert.equal(matchThreshold.c.gameinfo.toukui_gate, 4);
assert.equal(
  matchThreshold.info.toukui_gate,
  undefined,
  'Match helmet threshold must not silently overwrite defaults'
);

const pausedVote = setup({ game_time: 1, rest_time: 10 });
pausedVote.c.gameControl();
pausedVote.c.timer_callback();
pausedVote.c.gameControl();
assert.equal(pausedVote.s().phase, 'break-paused');
pausedVote.s().decisionSide = 'left';
pausedVote.s().decisionMethod = 'SUP';
engine.record(pausedVote.c, pausedVote.store);
assert.equal(pausedVote.s().phase, 'break-paused');
assert.equal(pausedVote.s().breakRemaining, 10);
