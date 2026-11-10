const assert = require('node:assert/strict');
const audio = require('../src/runtime/audio.js');
const config = require('../src/audio.json');
assert.equal(new Set(Object.values(config.events).map(JSON.stringify)).size, 5);
for (const [kind, count] of [
  ['court', 16],
  ['person', 100]
]) {
  assert.equal(
    new Set(Array.from({ length: count }, (_, i) => JSON.stringify(audio.hitPattern(kind, i + 1))))
      .size,
    count
  );
}
const wav = Buffer.from(
  audio
    .wavData(config.events.roundStart, (s) => Buffer.from(s, 'binary').toString('base64'))
    .split(',')[1],
  'base64'
);
assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
assert.equal(wav.readUInt32LE(40), wav.length - 44);
assert(wav.subarray(44).some((x) => x !== 0));
const scheduled = [];
function parameter() {
  return { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} };
}
class Context {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
  }
  createGain() {
    return { gain: parameter(), connect() {}, disconnect() {} };
  }
  createDynamicsCompressor() {
    return { connect() {} };
  }
  createOscillator() {
    return {
      frequency: parameter(),
      connect() {},
      disconnect() {},
      start(t) {
        scheduled.push(t);
      },
      stop() {}
    };
  }
}
let saved;
const api = audio.createAudio({
  AudioContext: Context,
  localStorage: {
    getItem() {
      return saved;
    },
    setItem(k, v) {
      saved = v;
    }
  }
});
assert(api.event('roundStart'));
assert.equal(scheduled.length, 3);
api.setEnabled(false);
assert.equal(api.hit('court', 1), false);
api.setEnabled(true);
api.setVolume(0.3);
assert.equal(
  audio.createAudio({
    localStorage: {
      getItem() {
        return saved;
      }
    }
  }).state.volume,
  0.3
);
const cues = [];
api.subscribe((c) => {
  if (c.type === 'event') cues.push(c.name);
});
const controller = {
  gvi: { game_state: 1 },
  gameControl() {
    this.gvi.game_state = this.gvi.game_state === 2 ? 3 : 2;
  },
  auto_rest() {
    this.gvi.game_state = 5;
  },
  WaitRoundOver() {
    this.gvi.game_state = 1;
  },
  SetGameOver() {
    this.gvi.game_state = 1;
  },
  wait_next_round() {
    this.SetGameOver();
  }
};
api.attachCourt(controller);
controller.gameControl();
controller.gameControl();
controller.gameControl();
controller.auto_rest();
controller.WaitRoundOver();
controller.gameControl();
controller.wait_next_round();
assert.deepEqual(cues, [
  'roundStart',
  'pause',
  'resume',
  'roundEnd',
  'breakEnd',
  'roundStart',
  'roundEnd'
]);
let played = 0;
const fallback = audio.createAudio({
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  Audio: class {
    constructor(src) {
      assert.equal(src, 'hit.mp3');
    }
    play() {
      played++;
    }
  }
});
assert(fallback.hit('person', 5));
assert.equal(played, 1);
for (const [kind, count] of [
  ['court', 16],
  ['person', 256]
]) {
  assert.equal(
    new Set(Array.from({ length: count }, (_, i) => audio.hitRate(kind, i + 1))).size,
    count
  );
}
const nativeCalls = [];
const native = audio.createAudio({ HostPlaySound: (name) => nativeCalls.push(name) });
assert(native.event('roundStart'));
assert(native.hit('court', 4));
native.setVolume(0.3);
assert(native.hit('person', 27));
native.setEnabled(false);
assert.equal(native.event('pause'), false);
assert.deepEqual(nativeCalls, [
  'pss_roundStart_v6.wav',
  'pss_court_4_v6.wav',
  'pss_person_27_v3.wav'
]);
assert.equal(native.status().backend, 'native');
const fs = require('node:fs');
const path = require('node:path');
for (const filename of nativeCalls) {
  const bytes = fs.readFileSync(path.join(__dirname, '../UoBTKD Training Suite/res', filename));
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.readUInt32LE(40), bytes.length - 44);
}
console.log(
  'Audio checks passed: five lifecycle cues, distinct identities, WAV fallback, playback scheduling, mute, saved volume, and round transitions.'
);
