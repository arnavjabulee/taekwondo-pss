const assert = require('node:assert/strict'),
  core = require('../src/runtime/core.js'),
  fixes = require('../src/runtime/controller.js'),
  engine = require('../src/runtime/competition.js');
global.PSS_MODES = { isCompetition: () => true };
global.PSS_COMPETITION = engine;
global.LEDA_CONTROLLER_FIXES = fixes;
global.PSS_AUDIO = { event() {}, hit() {} };
function match(options = {}) {
  const info = {
    game_rounds: 3,
    game_time: 1,
    rest_time: 5,
    competition_max_gam_jeom: 99,
    competition_point_gap: 0,
    toukui_gate: 1,
    ...options
  };
  const games = Array.from({ length: 16 }, () => ({
    lidu: 8,
    left: core.emptyParticipant(),
    right: core.emptyParticipant()
  }));
  Object.assign(games[0].left, { gamer: 'Blue', huju: '000000000001', toukui: '000000000011' });
  Object.assign(games[0].right, { gamer: 'Red', huju: '000000000002', toukui: '000000000012' });
  const saved = [];
  const store = {
    ReadGameInfo: () => info,
    GAMEINFO: info,
    ReadChangdiData: (i) => saved[i],
    SaveChangdiData: (i, v) => {
      saved[i] = JSON.parse(JSON.stringify(v));
    }
  };
  const c = {
    gvi: { game: games, game_state: 1, online: true },
    gameinfo: info,
    $parent: { startGame() {}, stopGame() {}, startTimer() {}, stopTimer() {} },
    $set: (o, k, v) => (o[k] = v),
    SendGameData() {},
    handleDevState() {}
  };
  engine.attach(c, store);
  c.gameControl();
  return {
    c,
    store,
    court: games[0],
    s: () => engine.state(c),
    hit: (id, value) => fixes.scoreHit(c, store, id + ',value:' + value)
  };
}
// Tier 1: more technical kicks beats more nontechnical kick points and weak hits.
const technical = match();
fixes.adjustTechnical(technical.c, technical.store, 'left', 'body', 1);
fixes.adjustScore(technical.c, technical.store, 'right', 3);
fixes.adjustGamJeom(technical.c, technical.store, 'right', 1);
for (let i = 0; i < 3; i++) technical.hit('000000000001', 100);
assert.equal(technical.court.left.score, 3);
assert.equal(technical.court.right.score, 3);
technical.c.timer_callback();
assert.equal(technical.s().results[0].winner, 'left');
assert.equal(technical.s().results[0].method, 'PTF');
assert.equal(technical.s().results[0].basis, 'Technical kicks');
assert.equal(technical.s().phase, 'break');
// Tier 2: head/body points exclude penalty points and are evaluated after equal technical counts.
const kickPoints = match();
kickPoints.hit('000000000012', 40);
kickPoints.hit('000000000001', 320);
fixes.adjustGamJeom(kickPoints.c, kickPoints.store, 'left', 1);
assert.equal(kickPoints.court.left.score, 3);
assert.equal(kickPoints.court.right.score, 3);
kickPoints.c.timer_callback();
assert.equal(kickPoints.s().results[0].winner, 'left');
assert.equal(kickPoints.s().results[0].basis, 'Head and body points');
// Tier 3: both head and body weak messages count, against the attacker, with no points.
const weak = match();
weak.hit('000000000002', 320);
weak.hit('000000000001', 320);
weak.hit('000000000002', 319);
weak.hit('000000000012', 39);
weak.hit('000000000001', 100);
assert.equal(weak.court.left.weak_body, 1);
assert.equal(weak.court.left.weak_head, 1);
assert.equal(weak.court.left.valid, 2);
assert.equal(weak.court.right.valid, 1);
assert.equal(weak.court.left.last_weak.type, 'head');
assert.equal(weak.court.left.last_weak.level, 0.975);
assert.equal(weak.court.left.last_weak.threshold, 1);
assert.equal(weak.court.left.score, 2);
assert.equal(weak.court.right.score, 2);
weak.c.timer_callback();
assert.equal(weak.s().results[0].winner, 'left');
assert.equal(weak.s().results[0].basis, 'Below-threshold registrations');
const before = weak.court.right.valid;
weak.hit('000000000001', 200);
assert.equal(weak.court.right.valid, before); // Break hits cannot change tie-break counters.
// Tier 1 counts kicks, rather than adding their point weights.
const equalTechnical = match();
fixes.adjustTechnical(equalTechnical.c, equalTechnical.store, 'left', 'body', 1);
fixes.adjustTechnical(equalTechnical.c, equalTechnical.store, 'right', 'head', 1);
fixes.adjustScore(equalTechnical.c, equalTechnical.store, 'left', 1);
equalTechnical.c.timer_callback();
assert.equal(equalTechnical.s().results[0].winner, 'right');
assert.equal(equalTechnical.s().results[0].basis, 'Head and body points');
// All equal: no guessed winner, including a final-round tie. Break ends but no match can resume until SUP.
const sup = match({ game_rounds: 1 });
sup.c.timer_callback();
assert.equal(sup.s().pendingDecision, true);
assert.equal(sup.s().phase, 'break');
assert.equal(sup.s().breakRemaining, 5);
assert.equal(sup.s().results.length, 0);
for (let i = 0; i < 5; i++) sup.c.timer_callback();
assert.equal(sup.s().phase, 'decision');
sup.c.gameControl();
assert.equal(sup.s().phase, 'decision');
sup.s().decisionSide = 'right';
sup.s().decisionMethod = 'SUP';
engine.record(sup.c, sup.store);
assert.equal(sup.s().winner, 'right');
assert.equal(sup.s().results[0].method, 'SUP');
// Technical undo, invalid undo, reset and saved-stat restoration.
const undo = match();
assert.equal(fixes.adjustTechnical(undo.c, undo.store, 'left', 'head', -1), false);
fixes.adjustTechnical(undo.c, undo.store, 'left', 'head', 1);
assert.equal(undo.court.left.score, 3);
assert.equal(undo.court.left.technical_head, 1);
assert.equal(undo.court.left.head_points, 3);
assert.equal(undo.court.left.tkhits, 0);
fixes.adjustTechnical(undo.c, undo.store, 'left', 'head', -1);
assert.equal(undo.court.left.score, 0);
assert.equal(undo.court.left.technical_head, 0);
assert.equal(undo.court.left.head_points, 0);
for (let i = 0; i < 5; i++) technical.c.timer_callback();
for (const key of core.PARTICIPANT_COUNTERS) assert.equal(technical.court.left[key], 0, key);
assert.equal(engine.undo(weak.c, weak.store), true);
assert.equal(weak.court.left.weak_head, 1);
assert.equal(weak.court.left.weak_body, 1);
assert.equal(weak.court.left.last_weak, null);
console.log(
  'Competition tie-break checks passed: technical kick count, kick points, weak head/body registrations, SUP with automatic final-round break, attacker attribution, typed undo and round resets.'
);
