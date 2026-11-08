const assert = require('node:assert/strict');
const core = require('../src/runtime/core.js');

assert.equal(core.MAX_LEVEL, 71);
assert.equal(core.rawThreshold(71), 2840);
assert.deepEqual(core.parseImpact('ABCDEF123456,value:2865'), {
  id: 'abcdef123456',
  value: 2865
});
for (const value of ['', null, undefined, 'NaN', -1, 72, 1.5]) {
  assert.equal(core.parseLevel(value), null);
}
assert.equal(core.parseLevel(0), 0);
assert.equal(core.parseLevel('71'), 71);
assert.equal(core.savedLevel(90, 8), 71);
assert.equal(core.savedLevel('', 8), 8);
const games = [{ left: core.emptyAthlete(), right: core.emptyAthlete() }];
games[0].right.huju = 'ABCDEF123456';
assert.equal(core.findEquipment(games, 'abcdef123456').side, 'right');
assert.equal(core.findEquipment(games, ''), null);
console.log('Shared protocol checks passed.');
