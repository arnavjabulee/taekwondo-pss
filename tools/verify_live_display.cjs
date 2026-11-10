const assert = require('node:assert/strict'),
  core = require('../src/runtime/core.js'),
  engine = require('../src/runtime/competition.js');
const court = { left: core.emptyParticipant(), right: core.emptyParticipant() };
assert.deepEqual(engine.leaders(court), { left: true, right: true });
court.left.score = 2;
assert.deepEqual(engine.leaders(court), { left: true, right: false });
court.right.score = 2;
court.right.technical_head = 1;
assert.deepEqual(engine.leaders(court), { left: false, right: true });
court.left.technical_body = 1;
court.left.body_points = 4;
assert.equal(engine.leaders(court).left, true);
assert.equal(engine.leaders(court).right, false);
court.right.head_points = 4;
court.right.weak_head = 1;
assert.deepEqual(engine.leaders(court), { left: false, right: true });
court.left.weak_body = 1;
assert.deepEqual(engine.leaders(court), { left: true, right: true });
for (const [phase, remaining, expected] of [
  ['running', 10, '00:10'],
  ['running', 9.9999, '09:999'],
  ['running', 9.5, '09:500'],
  ['paused', 0.125, '00:125'],
  ['break', 9.5, '00:10'],
  ['break-paused', 5, '00:05'],
  ['running', 0, '00:00']
])
  assert.equal(engine.matchTimeText({ phase, remaining, breakRemaining: remaining }), expected);
console.log(
  'Live display checks passed: leader lights follow score/all tie-break tiers and both light on full ties; millisecond format is restricted to match time below 10 seconds.'
);
