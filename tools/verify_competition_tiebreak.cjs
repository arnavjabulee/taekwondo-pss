const assert = require('node:assert/strict'),
  core = require('../src/runtime/core.js'),
  fixes = require('../src/runtime/controller.js'),
  engine = require('../src/runtime/competition.js');
global.PSS_MODES = { isCompetition: () => true };
global.PSS_COMPETITION = engine;
global.UOBTKD_CONTROLLER_FIXES = fixes;
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

function decided(x, side, basis) {
  x.c.timer_callback();
  assert.equal(x.s().results[0].winner, side);
  assert.equal(x.s().results[0].method, 'PTF');
  assert.equal(x.s().results[0].basis, basis);
  assert.equal(x.s().phase, 'break');
}
// Arrange penalty-derived totals for tie-break fixtures; break-only API gating is tested separately.
function fixturePenalty(c, store, side, delta) {
  c.gvi.game[0][side].warning += delta;
  c.gvi.game[0][side === 'left' ? 'right' : 'left'].score += delta;
}
// Technical points, not counts: one head technical (3) beats one body technical (2).
const technical = match();
fixes.adjustTechnical(technical.c, technical.store, 'left', 'body', 1);
fixes.adjustTechnical(technical.c, technical.store, 'right', 'head', 1);
fixturePenalty(technical.c, technical.store, 'right', 1);
decided(technical, 'right', 'Technical points');
// Earliest actual PSS score beats more weak hits and ignores manual/penalty points.
const firstScore = match();
fixturePenalty(firstScore.c, firstScore.store, 'left', 1);
fixturePenalty(firstScore.c, firstScore.store, 'right', 1);
assert.equal(firstScore.court.left.first_pss_score, 0);
assert.equal(firstScore.court.right.first_pss_score, 0);
firstScore.hit('000000000002', 320);
firstScore.hit('000000000001', 320);
for (let i = 0; i < 3; i++) firstScore.hit('000000000001', 100);
assert.equal(firstScore.court.left.first_pss_score, 1);
assert.equal(firstScore.court.right.first_pss_score, 2);
decided(firstScore, 'left', 'First scoring technique');
// No Date.now precision dependency: both messages can arrive in one millisecond.
const realNow = Date.now;
const legacyCourt = { left: core.emptyParticipant(), right: core.emptyParticipant() };
legacyCourt.left.hjhits = 1;
legacyCourt.right.weak_body = 3;
assert.equal(
  engine.tieBreak(legacyCourt),
  null,
  'Saved rounds without PSS score order require officials'
);
Date.now = () => 1000;
const sameMillisecond = match();
sameMillisecond.hit('000000000001', 320);
sameMillisecond.hit('000000000002', 320);
Date.now = realNow;
decided(sameMillisecond, 'right', 'First scoring technique');
// Only one contestant scores through PSS; penalties equalize the scoreboard.
const soleScorer = match();
soleScorer.hit('000000000002', 320);
fixturePenalty(soleScorer.c, soleScorer.store, 'left', 1);
fixturePenalty(soleScorer.c, soleScorer.store, 'left', 1);
decided(soleScorer, 'left', 'First scoring technique');
// With no PSS scores, more non-scoring registrations beats the earlier hit.
const weak = match();
weak.hit('000000000001', 100);
weak.hit('000000000002', 319);
weak.hit('000000000012', 39);
assert.equal(weak.court.left.weak_body, 1);
assert.equal(weak.court.left.weak_head, 1);
decided(weak, 'left', 'Below-threshold registrations');
// Equal non-scoring counts: first registered PSS hit wins.
const firstHit = match();
firstHit.hit('000000000001', 100);
firstHit.hit('000000000012', 39);
firstHit.hit('000000000002', 100);
firstHit.hit('000000000011', 39);
decided(firstHit, 'right', 'First PSS hit');
// Manually awarded techniques participate in the same scoring order.
const manual = match();
fixes.adjustScore(manual.c, manual.store, 'left', 3);
for (let i = 0; i < 3; i++) fixes.adjustScore(manual.c, manual.store, 'right', 1);
decided(manual, 'left', 'First scoring technique');
assert.equal(manual.court.right.punches, 3);
const mixed = match();
fixes.adjustScore(mixed.c, mixed.store, 'left', 2);
mixed.hit('000000000001', 320);
decided(mixed, 'left', 'First scoring technique');
const sensorFirst = match();
sensorFirst.hit('000000000001', 320);
fixes.adjustScore(sensorFirst.c, sensorFirst.store, 'left', 2);
decided(sensorFirst, 'right', 'First scoring technique');
const manualTechnical = match();
fixes.adjustTechnical(manualTechnical.c, manualTechnical.store, 'left', 'body', 1);
fixes.adjustTechnical(manualTechnical.c, manualTechnical.store, 'right', 'body', 1);
decided(manualTechnical, 'left', 'First scoring technique');
// Fully tied, including no PSS hits: break starts while the officials decide SUP.
const sup = match({ game_rounds: 1 });
sup.c.timer_callback();
assert.equal(sup.s().pendingDecision, true);
assert.equal(sup.s().phase, 'break');
for (let i = 0; i < 5; i++) sup.c.timer_callback();
assert.equal(sup.s().phase, 'decision');
sup.s().decisionSide = 'right';
sup.s().decisionMethod = 'SUP';
engine.record(sup.c, sup.store);
assert.equal(sup.s().winner, 'right');
assert.equal(sup.s().results[0].method, 'SUP');
// Saved rounds and undo preserve event order; next rounds reset it.
assert.equal(engine.undo(firstScore.c, firstScore.store), true);
assert.equal(firstScore.court.left.first_pss_score, 1);
assert.equal(firstScore.court.right.first_pss_score, 2);
assert.equal(firstScore.store.ReadChangdiData(0).left.first_pss_hit, 1);
for (let i = 0; i < 5; i++) technical.c.timer_callback();
for (const key of core.PARTICIPANT_COUNTERS) assert.equal(technical.court.left[key], 0, key);
firstHit.c.gameControl();
engine.reset(firstHit.c, firstHit.store);
assert.equal(firstHit.court.right.first_pss_hit, 0);
console.log(
  'Tie-break checks passed: technical points, first PSS score, non-scoring count, first hit, manual SUP, event order persistence and round resets.'
);

// Passive penalties are a separate two-point award in the final ten seconds.
const passive = match({ game_time: 120 });
passive.s().remaining = 10.001;
engine.record(passive.c, passive.store);
assert.equal(fixes.adjustGamJeom(passive.c, passive.store, 'left', 1, true), false);
passive.s().remaining = 10;
passive.c.gameStop();
assert.equal(fixes.adjustGamJeom(passive.c, passive.store, 'left', 1, true), true);
assert.equal(passive.court.left.warning, 1);
assert.equal(passive.court.left.passive_warnings, 1);
assert.equal(passive.court.right.score, 2);
assert.equal(passive.court.right.first_score, 0);
assert.equal(fixes.adjustGamJeom(passive.c, passive.store, 'left', -1), false);
fixes.adjustGamJeom(passive.c, passive.store, 'left', 1);
assert.equal(passive.court.right.score, 3);
assert.equal(passive.court.left.warning, 2);
fixes.adjustGamJeom(passive.c, passive.store, 'left', -1, true);
assert.equal(passive.court.right.score, 1);
assert.equal(passive.court.left.warning, 1);
assert.equal(passive.court.left.passive_warnings, 0);
assert.equal(fixes.adjustGamJeom(passive.c, passive.store, 'left', -1, true), false);
fixes.adjustGamJeom(passive.c, passive.store, 'left', -1);
assert.equal(passive.court.right.score, 0);
const passiveLimit = match({ game_time: 10, competition_max_gam_jeom: 1 });
engine.record(passiveLimit.c, passiveLimit.store);
passiveLimit.c.gameControl();
fixes.adjustGamJeom(passiveLimit.c, passiveLimit.store, 'left', 1, true);
assert.equal(passiveLimit.s().results[0].method, 'PUN');
assert.equal(passiveLimit.s().results[0].snapshot.left.warning, 1);
assert.equal(passiveLimit.s().results[0].snapshot.left.passive_warnings, 1);
assert.equal(fixes.canUndoPassive(passiveLimit.c, 'left'), true);
fixes.adjustGamJeom(passiveLimit.c, passiveLimit.store, 'left', -1, true);
assert.equal(passiveLimit.court.left.passive_warnings, 0);
assert.equal(passiveLimit.s().results.length, 0);
assert.equal(passiveLimit.s().phase, 'break-paused');
const passiveCorrection = match();
fixes.adjustScore(passiveCorrection.c, passiveCorrection.store, 'left', 1);
passiveCorrection.c.timer_callback();
fixes.adjustGamJeom(passiveCorrection.c, passiveCorrection.store, 'left', 1, true);
assert.equal(passiveCorrection.s().results[0].winner, 'right');
assert.equal(passiveCorrection.s().results[0].red, 2);
fixes.adjustGamJeom(passiveCorrection.c, passiveCorrection.store, 'left', -1, true);
assert.equal(passiveCorrection.s().results[0].winner, 'left');
assert.equal(passiveCorrection.court.left.warning, 0);
console.log(
  'Passive gam-jeom checks passed: ten-second boundary, two-point awards, one-penalty count, separate undo, penalty limit and post-round correction.'
);
