# Build

Requires Python, Node.js and the original package in `vendor-source`.

```sh
python -m pip install -r requirements-build.txt
npm install
python tools/build_english.py
```

Launch `UoBTKD Training Suite/Start.cmd`.

Checks: `npm test`, `npm run test:native` and `npm run test:ui` (requires Microsoft Edge).
