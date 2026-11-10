// Execute the actual packaged scoring handler, rather than a reimplementation.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
let checks = 0;
for (const packageName of ['vendor-source', 'UoBTKD Training Suite']) {
  const web = path.join(root, packageName, 'nginx/html/train');
  for (const file of fs.readdirSync(web).filter((f) => f.endsWith('.js'))) {
    new vm.Script(fs.readFileSync(path.join(web, file), 'utf8'), { filename: file });
  }
  const source = fs.readFileSync(path.join(web, '45.index.js'), 'utf8');
  const handler = source.split('handleDevData:')[1].split(',handleVkSpace:')[0];
  const sideSource = fs
    .readFileSync(path.join(web, 'index.js'), 'utf8')
    .split('left_or_right:')[1]
    .split(',fix:')[0];
  const left_or_right = vm.runInNewContext('(' + sideSource + ')');
  const device = (suffix) => '00000000000' + suffix;
  const state = { toukui_devices: [device('3'), device('4')], left_or_right, PlaySound() {} };
  const score = vm.runInNewContext('(' + handler + ')', {
    s: { Z: state },
    h: 16,
    window: { UOBTKD_CONTROLLER_FIXES: require('../src/runtime/controller.js') },
    console: { log() {} }
  });
  const athlete = () => ({ huju: '', toukui: '', score: 0, tkhits: 0, hjhits: 0, valid: 0 });
  const ctx = {
    gvi: {
      game_state: 2,
      game: Array.from({ length: 16 }, () => ({ lidu: 8, left: athlete(), right: athlete() }))
    },
    gameinfo: { toukui_gate: 1 },
    lidu_to_value: (x) => Math.round(x * 40),
    SendGameData() {}
  };
  ctx.gvi.game[0].left.huju = device('1');
  ctx.gvi.game[1].right.huju = device('2');
  ctx.gvi.game[0].left.toukui = device('3');
  ctx.gvi.game[1].right.toukui = device('4');
  const hit = (id, value) => score.call(ctx, id + ',value:' + value);
  assert.equal(left_or_right(device('A')), 'left');
  assert.equal(left_or_right(device('B')), 'right');
  hit(device('1'), 319);
  assert.equal(ctx.gvi.game[0].right.valid, 1);
  assert.equal(ctx.gvi.game[0].right.score, 0);
  hit(device('1'), 320);
  assert.equal(ctx.gvi.game[0].right.score, 2);
  hit(device('2'), 320);
  assert.equal(ctx.gvi.game[1].left.score, 2);
  hit(device('3'), 39);
  assert.equal(ctx.gvi.game[0].right.score, 2);
  hit(device('3'), 40);
  assert.equal(ctx.gvi.game[0].right.score, 5);
  hit(device('4'), 40);
  assert.equal(ctx.gvi.game[1].left.score, 5);
  ctx.gvi.game[2].left.huju = device('1');
  hit(device('1'), 320);
  assert.equal(ctx.gvi.game[2].right.score, 0);
  assert.equal(ctx.gvi.game[0].right.score, 7);
  hit(device('9'), 999);
  assert.equal(ctx.gvi.game[0].right.score, 7);
  ctx.gvi.game_state = 3;
  hit(device('1'), 999);
  assert.equal(ctx.gvi.game[0].right.score, 7);
  ctx.gvi.game_state = 2;
  hit(device('1'), 320);
  hit(device('1'), 320);
  assert.equal(ctx.gvi.game[0].right.score, 11); // no application deduplication
  checks += 14;
  console.log(packageName + ': bundle syntax and 14 scoring assertions passed');
}
console.log(checks + ' scoring assertions passed in total.');
