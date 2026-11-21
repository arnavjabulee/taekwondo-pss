"""Zip a clean Electron Windows build, retaining bundled runtime licenses."""
from pathlib import Path
import argparse
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
EXCLUDED = {'recordings', 'camera-tools', 'LocalStorage', 'data', 'logs', 'temp', 'test-results', '__pycache__'}
EXCLUDED_SUFFIXES = {'.log', '.pid', '.localstorage', '.db', '.sqlite', '.sqlite3', '.pyc'}


def build(app, destination):
    required = ['Start.cmd', 'UoBTKD Training Suite.exe', 'resources/app/package.json',
                'resources/app/desktop/main.cjs', 'resources/suite/web/index.html',
                'resources/suite/judge-bridge/node.exe',
                'resources/suite/judge-bridge/apps/replay/camera.apk',
                'resources/suite/judge-bridge/apps/replay/qrcode.js',
                'resources/suite/judge-bridge/node_modules/qrcode-generator/package.json',
                'resources/suite/judge-bridge/apps/replay/browser-camera.js',
                'resources/suite/judge-bridge/apps/replay/camera-mp4.js',
                'resources/suite/judge-bridge/services/judge-bridge/camera-tunnel.cjs']
    for name in required:
        if not (app / name).is_file():
            raise FileNotFoundError('Missing Electron runtime file: ' + name)
    metadata = json.loads((app / 'resources/app/package.json').read_text(encoding='utf-8'))
    if metadata['version'] != VERSION:
        raise ValueError('Rebuild the Electron app for version ' + VERSION)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for file in sorted(app.rglob('*')):
            if not file.is_file():
                continue
            relative = file.relative_to(app)
            if any(part in EXCLUDED for part in relative.parts) or file.suffix.lower() in EXCLUDED_SUFFIXES:
                continue
            if file.name == 'live-preview.json':
                continue
            archive.writestr('UoBTKD Training Suite/' + relative.as_posix(), file.read_bytes())
    with zipfile.ZipFile(destination) as archive:
        if archive.testzip() is not None:
            raise ValueError('ZIP integrity check failed')
        assert 'UoBTKD Training Suite/Start.cmd' in archive.namelist()
        assert not any(name.endswith('live-preview.json') or '/recordings/' in name for name in archive.namelist())
    digest = hashlib.file_digest(destination.open('rb'), 'sha256').hexdigest() if hasattr(hashlib, 'file_digest') else hashlib.sha256(destination.read_bytes()).hexdigest()
    destination.with_suffix('.zip.sha256').write_text(digest + '  ' + destination.name + '\n', encoding='ascii')
    print(json.dumps({'file': str(destination), 'bytes': destination.stat().st_size, 'sha256': digest}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--app', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / ('dist/UoBTKD-Training-Suite-Windows-v' + VERSION + '.zip'))
    args = parser.parse_args()
    build(args.app.resolve(), args.output.resolve())
