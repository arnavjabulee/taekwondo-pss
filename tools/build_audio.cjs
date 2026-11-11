/* Generate native PCM cues from the same patterns used by browser playback. */
const fs = require('node:fs');
const path = require('node:path');
const audio = require('../src/runtime/audio.js');
const config = require('../src/audio.json');
const destination = process.argv[2];
if (!destination) throw new Error('A destination res directory is required.');
fs.mkdirSync(destination, { recursive: true });
for (const name of fs.readdirSync(destination)) {
  if (/^pss_(pause|resume)_v(?:[1-9]|10)\.wav$/.test(name))
    fs.unlinkSync(path.join(destination, name));
}
const cues = { ...config.events };
for (const [name, filename] of Object.entries(config.clips || {})) {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/audio', filename.replace(/\.mp3$/, '.wav'))
  );
  if (
    source.toString('ascii', 0, 4) !== 'RIFF' ||
    source.readUInt16LE(20) !== 1 ||
    source.readUInt16LE(22) !== 1 ||
    source.readUInt32LE(24) !== 16000 ||
    source.readUInt16LE(34) !== 16
  )
    throw new Error('Expected mono 16 kHz PCM16 clip: ' + name);
  cues[name] = source;
}
const hitSamplesByFile = new Map(
  config.hitClips.map((filename) => {
    const wav = fs.readFileSync(
      path.join(__dirname, '../src/audio', filename.replace(/\.mp3$/, '.wav'))
    );
    if (
      wav.readUInt16LE(20) !== 1 ||
      wav.readUInt16LE(22) !== 1 ||
      wav.readUInt32LE(24) !== 16000 ||
      wav.readUInt16LE(34) !== 16
    )
      throw new Error('Expected mono 16 kHz PCM16 score clip: ' + filename);
    const samples = wav.subarray(44);
    if (wav.toString('ascii', 36, 40) !== 'data' || !samples.length || samples.length % 2)
      throw new Error('Invalid score WAV: ' + filename);
    return [filename, samples];
  })
);
function sampledHit(filename) {
  const hitSamples = hitSamplesByFile.get(filename);
  const result = Buffer.alloc(44 + hitSamples.length);
  const header = fs.readFileSync(path.join(__dirname, '../src/audio', filename));
  header.copy(result, 0, 0, 44);
  hitSamples.copy(result, 44);
  return result;
}

for (const [kind, count] of [
  ['court', 16],
  ['person', 256]
]) {
  for (let id = 1; id <= count; id++) cues[kind + '_' + id] = sampledHit(audio.hitClip(id));
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
