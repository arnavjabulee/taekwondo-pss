const assert = require('node:assert/strict');
const { createRegistry } = require('../src/runtime/equipment.js');
const registry = createRegistry();
registry.discover('000000000001:huju,000000000002:huju,000000000003:toukui');
registry.setOnline(true);
assert.equal(registry.all().length, 0);
registry.claim('000000000001', 'body', 'Blue', '');
registry.claim('000000000002', 'body', 'Red', '');
registry.claim('000000000003', 'helmet', 'Blue', '');
assert.equal(registry.all().length, 3);
registry.rename('000000000001', 'Red', '2');
registry.rename('000000000002', 'Red', '2');
assert.equal(registry.label('000000000001'), 'Red 2');
assert.equal(registry.label('000000000002'), 'Red 2 (2)');
registry.discover('000000000002:huju,000000000001:huju');
assert.equal(registry.label('000000000001'), 'Red 2');
assert.equal(registry.label('000000000002'), 'Red 2 (2)');
assert.equal(registry.connected('000000000003'), false);
registry.battery({ from: '000000000001', batt_id: 3 });
assert.equal(registry.batteryText('000000000001'), 'High battery');
registry.battery({ from: '000000000002', batt_id: 1, percentage: 73 });
assert.equal(registry.batteryText('000000000002'), '73%');
registry.battery({ from: '000000000002', batt_id: 255, percentage: 110 });
assert.equal(registry.batteryText('000000000002'), 'Battery unavailable');
registry.battery({ from: '000000000002', batt_id: 0, percentage: 0 });
assert.equal(registry.batteryText('000000000002'), '0%');
registry.setOnline(false);
assert.equal(registry.connected('000000000001'), false);
const restored = createRegistry(registry.snapshot());
assert.equal(restored.label('000000000002'), 'Red 2 (2)');
restored.ensure('000000000004', 'body');
restored.rename('000000000004', 'red', '2');
assert.equal(restored.label('000000000004'), 'red 2 (3)');
assert.equal(restored.batteryText('000000000001'), 'Battery unknown');
assert.equal(restored.ensure('bad-id'), null);
assert.throws(() => restored.rename('000000000001', '', '2'));
restored.ensure('000000000005', 'body');
restored.edit('000000000005', 'colour', 'Green');
assert.equal(restored.find('000000000005').colour, 'Green');
assert.equal(restored.find('000000000005').size, '');
restored.edit('000000000005', 'size', '3');
assert.equal(restored.label('000000000005'), 'Green 3');
restored.edit('000000000005', 'size', '');
restored.edit('000000000005', 'size', '3');
assert.equal(restored.label('000000000005'), 'Green 3');
restored.edit('000000000005', 'type', 'helmet');
assert.equal(restored.find('000000000005').type, 'helmet');
console.log(
  'Equipment checks passed: discovery, stable duplicate labels, persistence, offline status, coarse batteries, explicit percentages, invalid data.'
);
const cycle = createRegistry(registry.snapshot());
cycle.discover('');
assert.deepEqual(cycle.snapshot().counters, {});
assert.equal(cycle.label('000000000001'), 'Red 2');
assert.equal(cycle.label('000000000002'), 'Red 2 (2)');
cycle.remove('000000000001');
assert.equal(cycle.label('000000000002'), 'Red 2');
cycle.claim('000000000006', 'body', 'Red', '2');
assert.equal(cycle.label('000000000006'), 'Red 2 (2)');
cycle.remove('000000000002');
assert.equal(cycle.label('000000000006'), 'Red 2');
cycle.rename('000000000006', 'Blue', '3');
cycle.rename('000000000006', 'Blue', '4');
cycle.rename('000000000006', 'Blue', '3');
assert.equal(cycle.label('000000000006'), 'Blue 3');
const historical = createRegistry({
  records: [{ id: '000000000009', type: 'body', colour: 'Blue', size: '3', ordinal: 3, order: 10 }],
  counters: { 'blue|3': 3 }
});
assert.equal(historical.label('000000000009'), 'Blue 3');
assert.equal(createRegistry(cycle.snapshot()).label('000000000006'), 'Blue 3');
console.log(
  'Suffixes reflect current table entries only; deletion, renaming, empty discovery and saved historical counters cannot leave stale suffixes.'
);
