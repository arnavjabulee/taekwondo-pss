const assert = require('node:assert/strict');
const { createRegistry, colourFromId } = require('../src/runtime/equipment.js');
for (const tail of '13579ace') assert.equal(colourFromId('00000000000' + tail), 'Blue');
for (const tail of '02468bdf') assert.equal(colourFromId('00000000000' + tail), 'Red');
assert.equal(colourFromId('not-an-id'), '');
const registry = createRegistry();
registry.discover('000000000001:huju,000000000002:xlhuju,000000000003:huju,000000000011:xltoukui');
registry.setOnline(true);
assert.equal(registry.all().length, 0);
assert.deepEqual(
  registry.available('body', 'Blue', '').map((d) => d.id),
  ['000000000001', '000000000003']
);
assert.deepEqual(
  registry.available('helmet', 'Blue', '').map((d) => d.id),
  ['000000000011']
);
registry.claim('000000000001', 'body', 'Blue', '2');
registry.claim('000000000002', 'body', 'Red', '3');
assert.equal(registry.find('000000000001').colour, 'Blue');
assert.equal(registry.find('000000000001').type, 'body');
assert.deepEqual(
  registry.available('body', 'Blue', '000000000001').map((d) => d.id),
  ['000000000001', '000000000003']
);
registry.edit('000000000001', 'colour', 'Red');
assert(
  !registry.available('body', 'Red', '000000000001').some((device) => device.id === '000000000001')
);
registry.edit('000000000001', 'colour', 'Blue');
registry.claim('000000000003', 'body', 'Blue', '2');
assert.deepEqual(
  registry.available('body', 'Blue', '000000000001').map((d) => d.id),
  ['000000000001']
);
assert.throws(() => registry.assign('000000000001', '000000000003'));
registry.remove('000000000003');
registry.discover('000000000001:huju,000000000003:xlhuju,000000000011:toukui');
registry.label('000000000003', 'body');
registry.battery({ from: '000000000003', batt_id: 2 });
assert.equal(registry.find('000000000003'), null);
const replacement = registry.assign('000000000001', '000000000003');
assert.equal(replacement.size, '2');
assert.equal(replacement.colour, 'Blue');
assert.equal(registry.find('000000000001'), null);
assert.throws(() => registry.assign('000000000003', '000000000011'));
assert.throws(() => registry.claim('000000000011', 'body', 'Blue', '2'));
assert.throws(() => registry.claim('000000000011', 'helmet', 'Red', '2'));
const restored = createRegistry(registry.snapshot());
assert.equal(restored.find('000000000001'), null);
assert(restored.available('body', 'Blue', '000000000003').some((d) => d.id === '000000000001'));
registry.battery({ from: '000000000099', batt_id: 1 });
assert.equal(
  registry.available('body', 'Blue', '').some((d) => d.id === '000000000099'),
  false
);
console.log(
  'Equipment binding checks passed: automatic colour/type, category/colour filters, exclusive claims, replacement, deletion, no resurrection, and saved state.'
);
