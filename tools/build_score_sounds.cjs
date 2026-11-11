/* Regenerate the score3 source cue and its one-restart score6 variant. */
const fs = require('node:fs');
const path = require('node:path');
const config = require('../src/audio.json');
const source = fs.readFileSync(path.join(__dirname, '../src/audio/score3.wav'));
if (
  source.toString('ascii', 36, 40) !== 'data' ||
  source.readUInt16LE(20) !== 1 ||
  source.readUInt16LE(22) !== 1 ||
  source.readUInt32LE(24) !== 16000 ||
  source.readUInt16LE(34) !== 16
)
  throw new Error('Expected mono 16 kHz PCM16 score3 WAV');
const samples = source.subarray(44);
const prefixBytes = Math.round((16000 * config.hitRestartMs) / 1000) * 2;
if (samples.length < prefixBytes) throw new Error('score3 is shorter than the restart interval');
config.hitClips.forEach((filename, index) => {
  if (index !== 2 && index !== 5) return; // Other recordings stay unchanged.
  const restarts = index === 5 ? 1 : 0;
  const wav = Buffer.alloc(source.length + restarts * prefixBytes);
  source.copy(wav, 0, 0, 44);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.writeUInt32LE(wav.length - 44, 40);
  for (let restart = 0; restart < restarts; restart++)
    samples.copy(wav, 44 + restart * prefixBytes, 0, prefixBytes);
  samples.copy(wav, 44 + restarts * prefixBytes);
  fs.writeFileSync(path.join(__dirname, '../src/audio', filename), wav);
  console.log(filename + ': ' + restarts + ' restarts, then the full original clip');
});
