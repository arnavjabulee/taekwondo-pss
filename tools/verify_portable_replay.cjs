const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const version = require('../package.json').version;
const archive = path.resolve(
  process.argv[2] || 'dist/UoBTKD-Training-Suite-Windows-v' + version + '.zip'
);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'uobtkd-release-check-'));
try {
  execFileSync(
    'python',
    [
      '-c',
      [
        'import sys,zipfile',
        'prefix="UoBTKD Training Suite/resources/suite/judge-bridge/"',
        'with zipfile.ZipFile(sys.argv[1]) as archive:',
        '    for name in archive.namelist():',
        '        if name.startswith(prefix): archive.extract(name,sys.argv[2])'
      ].join('\n'),
      archive,
      temporary
    ],
    { windowsHide: true }
  );
  const root = path.join(temporary, 'UoBTKD Training Suite/resources/suite/judge-bridge');
  // This child has no access to the development directory's ancestor node_modules.
  const test = String.raw`
    const assert = require('node:assert/strict'), fs = require('node:fs');
    const { createBridge } = require('./services/judge-bridge/server.cjs');
    const bridge = createBridge();
    bridge.server.listen(0, '127.0.0.1', async () => {
      const qr = 'apps/replay/qrcode.js', dependency = 'node_modules/qrcode-generator';
      try {
        const base = 'http://127.0.0.1:' + bridge.server.address().port;
        async function read(route, expected = 200) {
          const response = await fetch(base + route), text = await response.text();
          assert.equal(response.status, expected, route + ': ' + text.slice(0, 300));
          return text;
        }
        for (const route of ['/replay', '/replay.js', '/replay.css', '/qr.js', '/camera', '/browser-camera.js', '/camera-mp4.js']) await read(route);
        assert.match(await read('/replay'), /id="camera-link"/);
        fs.renameSync(qr, qr + '.held');
        await read('/replay'); assert.match(await read('/qr.js'), /qrcode/);
        fs.renameSync(dependency, dependency + '.held');
        assert.match(await read('/replay'), /Video Replay/);
        await read('/camera');
        assert.match(await read('/qr.js', 503), /QR-code helper is missing/);
        const headers = { Origin: 'http://127.0.0.1:11818' };
        const auth = await (await fetch(base + '/api/desktop/bootstrap', { headers })).json();
        headers.Authorization = 'Bearer ' + auth.key;
        assert.equal((await fetch(base + '/api/desktop/replay/state', { headers })).status, 200);
        console.log('Portable ZIP replay passed outside the project: all assets load, packaged QR fallback works, and missing QR dependencies cannot break the replay or camera page.');
      } catch (error) { console.error(error); process.exitCode = 1; }
      finally {
        if (fs.existsSync(qr + '.held')) fs.renameSync(qr + '.held', qr);
        if (fs.existsSync(dependency + '.held')) fs.renameSync(dependency + '.held', dependency);
        await bridge.close();
      }
    });
  `;
  process.stdout.write(
    execFileSync(path.join(root, 'node.exe'), ['-e', test], {
      cwd: root,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 30000
    })
  );
} finally {
  const resolved = path.resolve(temporary),
    allowed = path.resolve(os.tmpdir()) + path.sep;
  if (!resolved.startsWith(allowed) || !path.basename(resolved).startsWith('uobtkd-release-check-'))
    throw new Error('Invalid temporary cleanup target');
  fs.rmSync(resolved, { recursive: true, force: true });
}
