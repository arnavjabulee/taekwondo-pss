/* Generate native PCM cues from the same patterns used by browser playback. */
const fs = require('node:fs');
const path = require('node:path');
const audio = require('../src/runtime/audio.js');
const config = require('../src/audio.json');
const destination = process.argv[2];
if (!destination) throw new Error('A destination res directory is required.');
fs.mkdirSync(destination, { recursive: true });
const cues = { ...config.events };
const hitFile = fs.readFileSync(path.join(__dirname, '../src/audio/hit.wav'));
let hitSamples;
for (let cursor = 12; cursor + 8 <= hitFile.length;) {
  const size = hitFile.readUInt32LE(cursor + 4);
  if (hitFile.toString('ascii', cursor, cursor + 4) === 'data')
    hitSamples = hitFile.subarray(cursor + 8, cursor + 8 + size);
  cursor += 8 + size + (size % 2);
}
if (!hitSamples || hitSamples.length % 2) throw new Error('Invalid converted hit WAV');
function sampledHit(rate) {
  const count = Math.floor(hitSamples.length / 2 / rate);
  const wav = Buffer.from(
    audio
      .wavData([[440, count / 16000]], (s) => Buffer.from(s, 'binary').toString('base64'))
      .split(',')[1],
    'base64'
  );
  const result = Buffer.alloc(44 + count * 2);
  wav.copy(result, 0, 0, 44);
  result.writeUInt32LE(result.length - 8, 4);
  result.writeUInt32LE(count * 2, 40);
  for (let index = 0; index < count; index++) {
    const position = index * rate,
      left = Math.floor(position),
      fraction = position - left;
    const first = hitSamples.readInt16LE(left * 2);
    const second = hitSamples.readInt16LE(Math.min(left + 1, hitSamples.length / 2 - 1) * 2);
    result.writeInt16LE(Math.round(first + (second - first) * fraction), 44 + index * 2);
  }
  return result;
}
for (const [kind, count] of [
  ['court', 16],
  ['person', 256]
]) {
  for (let id = 1; id <= count; id++) cues[kind + '_' + id] = sampledHit(audio.hitRate(kind, id));
}
for (const [name, notes] of Object.entries(cues)) {
  const source = Buffer.isBuffer(notes)
    ? notes
    : Buffer.from(
        audio.wavData(notes, (s) => Buffer.from(s, 'binary').toString('base64')).split(',')[1],
        'base64'
      );
  for (let volume = 1; volume <= 10; volume++) {
    const wav = Buffer.from(source);
    for (let offset = 44; offset < wav.length; offset += 2)
      wav.writeInt16LE(Math.round((source.readInt16LE(offset) * volume) / 10), offset);
    fs.writeFileSync(path.join(destination, 'pss_' + name + '_v' + volume + '.wav'), wav);
  }
}
console.log('Generated native WAV cues at ten volume levels.');
