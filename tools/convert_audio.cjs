/* Convert source MP3 clips to mono PCM16 WAV for the desktop sound backend. */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    for (const name of process.argv.slice(2)) {
      if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(name)) throw new Error('Invalid audio asset name');
      const base = path.resolve(__dirname, '../src/audio', name);
      const samples = await page.evaluate(
        async (encoded) => {
          const input = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
          const context = new OfflineAudioContext(1, 1, 16000);
          const decoded = await context.decodeAudioData(input.buffer);
          const renderer = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
          const source = renderer.createBufferSource();
          source.buffer = decoded;
          source.connect(renderer.destination);
          source.start();
          return Array.from((await renderer.startRendering()).getChannelData(0));
        },
        fs.readFileSync(base + '.mp3').toString('base64')
      );
      const wav = Buffer.alloc(44 + samples.length * 2);
      wav.write('RIFF');
      wav.writeUInt32LE(wav.length - 8, 4);
      wav.write('WAVEfmt ', 8);
      wav.writeUInt32LE(16, 16);
      wav.writeUInt16LE(1, 20);
      wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(16000, 24);
      wav.writeUInt32LE(32000, 28);
      wav.writeUInt16LE(2, 32);
      wav.writeUInt16LE(16, 34);
      wav.write('data', 36);
      wav.writeUInt32LE(samples.length * 2, 40);
      samples.forEach((value, index) =>
        wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), 44 + index * 2)
      );
      fs.writeFileSync(base + '.wav', wav);
      console.log('Converted ' + name + ' to mono 16 kHz PCM16 WAV');
    }
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
