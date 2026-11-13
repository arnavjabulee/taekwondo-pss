# Build

Requires Python, Node.js and the original package in `vendor-source`.

```sh
python -m pip install -r requirements-build.txt
npm install
python tools/build_english.py
```

Launch `UoBTKD Training Suite/Start.cmd`.

Android camera: install Android SDK 36 and run `powershell -File tools/build_camera.ps1` before the desktop build. Replay tests: `npm run test:replay`; the Android integration test additionally needs a running emulator (`npm run test:replay-android`).

Checks: `npm test`, `npm run test:native` and `npm run test:ui` (requires Microsoft Edge).

Mobile judging: `npm run test:judges` and `npm run test:judge-ui`. The build bundles the local Wi-Fi bridge and Node runtime; no phone installation is required.
