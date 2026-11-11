const assert = require('node:assert/strict');
const audio = require('../src/runtime/audio.js');
const config = require('../src/audio.json');
assert.equal(new Set(Object.values(config.events).map(JSON.stringify)).size, 3);
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
assert.deepEqual(config.events.roundStart, [[200, 1, 'sawtooth', 0, 0]]);
// A 200 Hz sawtooth at 16 kHz repeats every 80 samples and holds its level to the end.
function peak(start, end) {
  let result = 0;
  for (let i = start; i < end; i++)
    result = Math.max(result, Math.abs(wav.readInt16LE(44 + i * 2)));
  return result;
}
assert(wav.readInt16LE(44 + 160 * 2) < 0);
assert(wav.readInt16LE(44 + 239 * 2) > 0);
assert(wav.readInt16LE(44 + 240 * 2) < 0);
assert.equal(wav.readUInt32LE(40) / 2 / 16000, 1);
assert(peak(12800, 13600) >= peak(100, 1200) * 0.99);
assert(peak(14800, 15200) >= peak(100, 1200) * 0.99);
assert(peak(15840, 16000) >= peak(100, 1200) * 0.99);
const scheduled = [],
  oscillators = [];
function parameter() {
  return {
    value: 0,
    setValueAtTime() {},
    exponentialRampToValueAtTime() {},
    linearRampToValueAtTime() {}
  };
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
    const oscillator = {
      frequency: {
        ...parameter(),
        setValueAtTime(value) {
          oscillator.hz = value;
        }
      },
      connect() {},
      disconnect() {},
      start(t) {
        scheduled.push(t);
      },
      stop() {}
    };
    oscillators.push(oscillator);
    return oscillator;
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
assert.equal(scheduled.length, 1);
assert.equal(oscillators[0].type, 'sawtooth');
assert.equal(oscillators[0].hz, 200);
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
assert.deepEqual(cues, ['roundStart', 'roundEnd', 'breakEnd', 'roundStart', 'roundEnd']);
let played = 0;
const fallback = audio.createAudio({
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  Audio: class {
    constructor(src) {
      assert.equal(src, 'score5.wav');
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
    new Set(
      Array.from(
        { length: count },
        (_, i) => audio.hitClip(i + 1) + ':' + audio.hitRate(kind, i + 1)
      )
    ).size,
    Math.min(count, 6)
  );
}
assert.deepEqual(
  Array.from({ length: 7 }, (_, i) => audio.hitClip(i + 1)),
  ['score1.wav', 'score2.wav', 'score3.wav', 'score4.wav', 'score5.wav', 'score6.wav', 'score1.wav']
);
const nativeCalls = [];
const native = audio.createAudio({ HostPlaySound: (name) => nativeCalls.push(name) });
assert(native.event('roundStart'));
assert(native.hit('court', 4));
native.setVolume(0.3);
assert(native.hit('person', 27));
for (const name of ['addpoints', 'gamjeom', 'deduct']) assert(native.event(name));
native.setEnabled(false);
assert.equal(native.event('pause'), false);
assert.deepEqual(nativeCalls, [
  'pss_roundStart_v6.wav',
  'pss_court_4_v6.wav',
  'pss_person_27_v3.wav',
  'pss_addpoints_v3.wav',
  'pss_gamjeom_v3.wav',
  'pss_deduct_v3.wav'
]);
assert.equal(native.status().backend, 'native');
const fs = require('node:fs');
const path = require('node:path');
const originalScore = fs.readFileSync(path.join(__dirname, '../src/audio/score3.wav')).subarray(44);
const restartBytes = ((16000 * require('../src/audio.json').hitRestartMs) / 1000) * 2;
for (let id = 1; id <= 6; id++) {
  const source = fs.readFileSync(path.join(__dirname, '../src/audio/score' + id + '.wav'));
  if (id === 3 || id === 6) {
    const restarts = id === 6 ? 1 : 0;
    assert.equal(source.length, 44 + originalScore.length + restarts * restartBytes);
    for (let restart = 0; restart < restarts; restart++) {
      assert.deepEqual(
        source.subarray(44 + restart * restartBytes, 44 + (restart + 1) * restartBytes),
        originalScore.subarray(0, restartBytes)
      );
    }
    assert.deepEqual(source.subarray(44 + restarts * restartBytes), originalScore);
  }
  for (const kind of ['court', 'person']) {
    const built = fs.readFileSync(
      path.join(__dirname, '../UoBTKD Training Suite/res/pss_' + kind + '_' + id + '_v10.wav')
    );
    assert.deepEqual(
      built.subarray(44),
      source.subarray(44),
      'Native score clip must match its supplied recording'
    );
  }
}
for (const filename of nativeCalls) {
  const bytes = fs.readFileSync(path.join(__dirname, '../UoBTKD Training Suite/res', filename));
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.readUInt32LE(40), bytes.length - 44);
}
console.log(
  'Audio checks passed: three lifecycle cues, distinct identities, WAV fallback, playback scheduling, mute, saved volume, and round transitions.'
);

const recordings = [];
const clipAudio = audio.createAudio({
  Audio: class {
    constructor(source) {
      this.source = source;
    }
    play() {
      recordings.push({ source: this.source, volume: this.volume });
    }
    pause() {}
  }
});
clipAudio.setVolume(0.4);
for (const name of ['addpoints', 'gamjeom', 'deduct']) assert(clipAudio.event(name));
assert.deepEqual(
  recordings,
  ['addpoints', 'gamjeom', 'deduct'].map((name) => ({ source: name + '.mp3', volume: 0.4 }))
);
clipAudio.setEnabled(false);
assert.equal(clipAudio.event('addpoints'), false);
assert.equal(recordings.length, 3);
for (const name of ['addpoints', 'gamjeom', 'deduct']) {
  const source = fs.readFileSync(path.join(__dirname, '../src/audio', name + '.wav'));
  const full = fs.readFileSync(
    path.join(__dirname, '../UoBTKD Training Suite/res', 'pss_' + name + '_v10.wav')
  );
  assert.deepEqual(full, source, 'Native clip must use the supplied recording');
}

assert.equal(api.event('pause'), false);
assert.equal(api.event('resume'), false);
for (const name of ['pause', 'resume'])
  assert(
    !fs.existsSync(path.join(__dirname, '../UoBTKD Training Suite/res', 'pss_' + name + '_v6.wav'))
  );

const endWav = Buffer.from(
  audio
    .wavData(config.events.roundEnd, (s) => Buffer.from(s, 'binary').toString('base64'))
    .split(',')[1],
  'base64'
);
assert.equal(endWav.readUInt32LE(40) / 32000, 1.8);
for (const [first, last] of [
  [3200, 6400],
  [9600, 12800]
]) {
  assert(
    endWav.subarray(44 + first * 2, 44 + last * 2).every((value) => value === 0),
    'Round-end silence must be exact'
  );
}
for (const [first, last] of [
  [80, 3200],
  [6480, 9600],
  [12880, 28800]
]) {
  assert(
    endWav.subarray(44 + first * 2, 44 + last * 2).some((value) => value !== 0),
    'Each round-end pulse must sound'
  );
}
const timing = scheduled.length;
assert(api.event('roundEnd'));
assert.deepEqual(scheduled.slice(timing), [0, 0.4, 0.8]);
assert(
  oscillators
    .slice(-3)
    .every((oscillator) => oscillator.type === 'sawtooth' && oscillator.hz === 200)
);
assert(Math.abs(endWav.readInt16LE(endWav.length - 2)) > 10000, 'Final tone must have no fade');
