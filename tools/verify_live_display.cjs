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
court.left.technical_head = 1;
court.left.first_pss_score = 1;
court.right.first_pss_score = 2;
assert.deepEqual(engine.leaders(court), { left: true, right: false });
assert.equal(engine.tieBreak(court).side, 'left', 'Lights and round decisions use arrival order');
court.left.first_score = 2;
court.right.first_score = 1;
assert.deepEqual(
  engine.leaders(court),
  { left: false, right: true },
  'Manual first scores participate in the same hierarchy as PSS scores'
);
court.left.first_score = court.right.first_score = 0;
court.left.first_pss_score = court.right.first_pss_score = 0;
court.right.weak_head = 1;
assert.deepEqual(engine.leaders(court), { left: false, right: true });
court.left.weak_body = 1;
court.left.first_pss_hit = 2;
court.right.first_pss_hit = 1;
assert.deepEqual(engine.leaders(court), { left: false, right: true });
court.left.first_pss_hit = court.right.first_pss_hit = 0;
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
  'Live display checks passed: leader lights use the round tie-break hierarchy, including manual/PSS first scores and first hits; both light for unresolved ties.'
);
