const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const fixes = require('../src/runtime/controller.js');
const slot = (index) => ({ index, toukui: '', huju: '' });
const games = [
  { left: slot(0), right: slot(1) },
  { left: slot(0), right: slot('') }
];
assert.equal(fixes.conflicts(games).length, 1);
games[1].left.index = 2;
games[0].left.huju = 'ABC';
games[1].left.huju = 'abc';
assert.equal(fixes.conflicts(games).length, 1);
games[1].left.huju = 'def';
assert.equal(fixes.conflicts(games).length, 0);
let reads = 0,
  refreshes = 0,
  sends = 0;
const ctx = {
  gvi: { game: games },
  $parent: { query_battery_info() {} },
  handleDevState() {
    refreshes++;
  },
  SendGameData() {
    sends++;
  }
};
games[0].left.index = '';
games[0].left.toukui = 'old';
fixes.changeAthlete(
  ctx,
  {
    ReadGameData() {
      reads++;
    }
  },
  0,
  'left'
);
assert.equal(reads, 0);
assert.equal(games[0].left.huju, '');
assert.equal(games[0].left.toukui, '');
games[0].left.index = 99;
fixes.changeAthlete(
  ctx,
  {
    ReadGameData() {
      return null;
    }
  },
  0,
  'left'
);
assert.equal(games[0].left.index, '');
games[0].left.index = 0;
fixes.changeAthlete(
  ctx,
  {
    ReadGameData() {
      return { huju: 'newbody', toukui: 'newhelmet' };
    }
  },
  0,
  'left'
);
assert.equal(games[0].left.huju, 'newbody');
assert.equal(games[0].left.toukui, 'newhelmet');
assert.equal(refreshes, 3);
assert.equal(sends, 3);
const source = fs.readFileSync(
  path.join(__dirname, '../LedaSport-English/nginx/html/train/45.index.js'),
  'utf8'
);
let guardCalls = 0;
const control = vm.runInNewContext(
  '(' + source.split('gameControl:')[1].split(',gameSpeedup:')[0] + ')',
  {
    window: {
      LEDA_CONTROLLER_FIXES: {
        canStart() {
          guardCalls++;
          return false;
        }
      }
    }
  }
);
control.call({ gvi: { game_state: 1 } }); // no side effects or hardware calls past the guard
assert.equal(guardCalls, 1);
console.log(
  'Controller checks passed: duplicate athlete/device detection, safe clearing, missing records, equipment refresh, and Start guard.'
);
const rows = [
  { index: 1, name: 'One', court: 2, huju: '000000000002', toukui: '' },
  { index: 2, name: 'Two', court: 2, huju: '000000000001', toukui: '' },
  { index: 3, name: 'Three', court: 1, huju: '000000000003', toukui: '' }
];
assert.equal(fixes.courtLabel(rows, rows[0]), 'Blue');
assert.equal(fixes.courtLabel(rows, rows[1]), 'Red');
let saved = {};
const store = {
  ReadGameData(i) {
    return rows[i];
  },
  SaveChangdiData(i, v) {
    saved[i] = v;
  },
  PlaySound() {}
};
fixes.prepareCourts(store, { changci_begin: 0, changci_end: 3 });
assert.equal(store.game_list[1].left.index, 0);
assert.equal(store.game_list[1].right.index, 1);
assert.equal(store.game_list[0].left.index, 2);
assert.equal(store.game_list[0].right.index, '');
assert.equal(store.court_view_mode, 1);
assert.equal(Object.keys(saved).length, 16);
const courtCtx = {
  gvi: { game_state: 2, game: store.game_list },
  gameinfo: { toukui_gate: 1 },
  lidu_to_value: (x) => x * 40,
  SendGameData() {}
};
fixes.scoreHit(courtCtx, store, '000000000002,value:320');
assert.equal(store.game_list[1].right.score, 2); // even ID on BLUE scores for RED
assert.equal(store.game_list[1].left.score, 0);
fixes.scoreHit(courtCtx, store, '000000000001,value:320');
assert.equal(store.game_list[1].left.score, 2); // odd ID on RED scores for BLUE
rows[2].court = 2;
assert.throws(
  () => fixes.prepareCourts(store, { changci_begin: 0, changci_end: 3 }),
  /more than two/
);
rows[2].court = '';
rows[1].huju = rows[0].huju;
assert.throws(
  () => fixes.prepareCourts(store, { changci_begin: 0, changci_end: 3 }),
  /already assigned/
);
let alerts = [];
global.alert = (message) => alerts.push(message);
rows[1].huju = '000000000001';
rows[2].court = 1;
const page = {
  data: rows,
  settings: { changci_begin: 0 },
  $set(obj, key, val) {
    obj[key] = val;
  },
  $forceUpdate() {}
};
assert.equal(
  fixes.assignCourt(page, 2, 2, {
    SaveGameData() {
      throw Error('Must not save');
    }
  }),
  false
);
assert.equal(rows[2].court, 1);
assert.equal(alerts.length, 1);
console.log(
  'Court checks passed: two-athlete capacity, deterministic colours, persistence, empty opponents, duplicate devices, and scoring independent of ID parity.'
);
