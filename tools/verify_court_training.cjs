const assert = require('node:assert/strict');
const training = require('../src/runtime/court-training.js');
const core = require('../src/runtime/core.js');
global.PSS_MODES = { isCompetition: () => false };
global.UOBTKD_CONTROLLER_FIXES = { canStart: () => true, ignoreSpaceShortcut: () => false };
const cues = [];
global.PSS_AUDIO = { event: (name) => cues.push(name) };
let info = { game_time: 2, rest_time: 1, game_rounds: 5 };
const store = { ReadGameInfo: () => ({ ...info }) };
let starts = 0;
const host = {
  startGame() {
    starts++;
  },
  startTimer() {},
  stopGame() {},
  stopTimer() {}
};
const view = {
  $parent: host,
  gameinfo: { ...info },
  gvi: {
    game: [
      {
        left: { ...core.emptyParticipant(), gamer: 'Alex', score: 7 },
        right: core.emptyParticipant()
      }
    ],
    online: true
  },
  SendGameData() {},
  gameSetup() {
    this.gvi.game_state = 3;
  },
  SaveGameInfo() {
    info = { ...this.gameinfo };
  },
  SetupConfirm() {
    this.gameinfo.game_rounds = 3;
    this.SaveGameInfo();
    this.time = 999;
  },
  handleOnlineState(value) {
    this.gvi.online = value;
  }
};
training.attach(view, store);
assert.equal(view.gvi.game_state, 1);
view.gameControl();
assert.equal(view.gvi.game[0].left.score, 0);
view.gvi.game[0].left.score = 7;
view.timer_callback();
assert.equal(view.time, 1);
view.gameSetup();
assert.equal(view.gvi.game_state, 2, 'Settings must not pause the current interval');
view.gameinfo.game_time = 3;
view.gameinfo.rest_time = 2;
view.SetupConfirm();
assert.equal(info.game_rounds, 5, 'Training settings must not alter competition round count');
assert.equal(view.time, 1, 'Settings must not replace the current countdown');
view.timer_callback();
assert.equal(view.gvi.game_state, 5);
assert.equal(view.gvi.rest_time, 1, 'Current cycle keeps its original break');
view.timer_callback();
assert.equal(view.gvi.game_state, 2, 'Next training interval starts automatically');
assert.equal(view.time, 3);
assert.equal(view.gvi.game[0].left.score, 0);
for (let i = 0; i < 3; i++) view.timer_callback();
assert.equal(view.gvi.rest_time, 2, 'New break duration applies to the new cycle');
view.gameControl();
assert.equal(view.gvi.game_state, 3);
view.timer_callback();
assert.equal(view.time, 2);
view.gameControl();
assert.equal(view.gvi.game_state, 5);
view.handleOnlineState(false);
assert.equal(view.gvi.game_state, 3);
view.gameControl();
assert.equal(view.gvi.game_state, 5, 'Break can resume offline');
view.timer_callback();
view.timer_callback();
assert.equal(view.time, 3);
assert.equal(view.gvi.game_state, 2);
info = { ...info, game_time: 1, rest_time: 1, game_rounds: 1 };
for (let i = 0; i < 1000; i++) view.timer_callback();
assert(starts > 400, 'No round-count cap');
assert.equal(view.gvi.winner, '');
assert.equal(view.gvi.game[0].left.score, 0, 'Interval changes reset scores');
assert.equal(view.gvi.game[0].left.gamer, 'Alex');
info = { ...info, rest_time: 0 };
for (let i = 0; i < 4; i++) view.timer_callback();
assert.equal(view.gvi.game_state, 2, 'Zero break starts the next interval immediately');
assert(cues.includes('roundStart') && cues.includes('roundEnd') && cues.includes('breakEnd'));
global.PSS_MODES.isCompetition = () => true;
const competition = {};
training.attach(competition, store);
assert.equal(competition._courtTraining, undefined);
console.log(
  'Continuous court training passed: unlimited cycles, automatic restarts, deferred timings, score resets, settings, offline pause/resume and competition isolation.'
);
