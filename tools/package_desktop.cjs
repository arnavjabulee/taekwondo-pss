const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
(async () => {
  const { packager } = await import('@electron/packager');
  const root = path.resolve(__dirname, '..'),
    built = path.join(root, 'UoBTKD Training Suite');
  const staging = path.join(root, 'dist', 'electron-stage-' + randomUUID());
  fs.mkdirSync(staging, { recursive: true });
  fs.cpSync(path.join(root, 'apps/desktop'), path.join(staging, 'desktop'), {
    recursive: true,
    filter: (source) => path.basename(source) !== 'live-preview.json'
  });
  const version = require('../package.json').version;
  fs.writeFileSync(
    path.join(staging, 'package.json'),
    JSON.stringify({
      name: 'uobtkd-training-suite',
      productName: 'UoBTKD Training Suite',
      version,
      main: 'desktop/main.cjs'
    })
  );
  const suite = path.join(staging, 'suite');
  fs.mkdirSync(suite);
  fs.cpSync(path.join(built, 'nginx/html/train'), path.join(suite, 'web'), { recursive: true });
  fs.cpSync(path.join(root, 'src/assets/app.ico'), path.join(suite, 'app.ico'));
  fs.cpSync(path.join(built, 'judge-bridge'), path.join(suite, 'judge-bridge'), {
    recursive: true,
    filter: (source) =>
      !['recordings', '.git', 'test-results'].includes(path.basename(source)) &&
      !/\.(log|pid)$/.test(source)
  });
  const defaultOutput = path.join(root, 'dist/electron');
  const destination =
    process.env.UOBTKD_PACKAGE_OUTPUT ||
    (fs.existsSync(path.join(defaultOutput, 'UoBTKD Training Suite-win32-x64'))
      ? path.join(root, 'dist/electron-builds', randomUUID())
      : defaultOutput);
  const output = await packager({
    dir: staging,
    name: 'UoBTKD Training Suite',
    platform: 'win32',
    arch: 'x64',
    electronVersion: require('electron/package.json').version,
    out: destination,
    overwrite: false,
    prune: false,
    asar: false,
    icon: path.join(root, 'src/assets/app.ico'),
    extraResource: [suite],
    ignore: [/^\/suite(?:\/|$)/],
    win32metadata: {
      CompanyName: 'UoBTKD',
      FileDescription: 'UoBTKD Training Suite',
      ProductName: 'UoBTKD Training Suite'
    }
  });
  for (const directory of output) {
    fs.writeFileSync(
      path.join(directory, 'Start.cmd'),
      '@echo off\r\ncd /d "%~dp0"\r\nstart "" "UoBTKD Training Suite.exe"\r\n'
    );
    fs.writeFileSync(
      path.join(directory, 'README.txt'),
      'UoBTKD Training Suite\r\n\r\nExtract the entire folder and open Start.cmd.\r\n'
    );
  }
  console.log('Electron desktop:', output.join('\n'));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
