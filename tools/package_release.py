"""Create a clean portable Windows release without local data or recordings."""
from pathlib import Path
import argparse
import hashlib
import json
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'UoBTKD Training Suite'
EXCLUDED = {'LocalStorage', 'data', 'recordings', 'logs', 'temp', 'tmp', 'bin', '__pycache__', 'docs', 'contrib', 'import table template'}
EXCLUDED_SUFFIXES = {'.log', '.pid', '.tmp', '.localstorage', '.db', '.sqlite', '.sqlite3', '.pyc'}

def build(destination):
    required = ['Start.cmd', 'Prepare-Portable.ps1', 'UoBTKD Training Suite.exe', 'UoBTKD Training Suite.dll', 'native-update/UoBTKD Training Suite.exe', 'judge-bridge/node.exe', 'judge-bridge/apps/replay/camera.apk', 'nginx/nginx.exe']
    for relative in required:
        if not (APP / relative).is_file():
            raise FileNotFoundError('Build the application first: ' + relative)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for file in sorted(APP.rglob('*')):
            if not file.is_file():
                continue
            relative = file.relative_to(APP)
            if any(part in EXCLUDED for part in relative.parts) or file.suffix.lower() in EXCLUDED_SUFFIXES:
                continue
            if relative.as_posix() in {'Athletes-English.csv', 'config', 'judge-bridge/firewall-setup.log'}:
                continue
            content = file.read_bytes()
            if relative.as_posix() == 'nginx/php7.4.3nts/php.ini':
                settings = content.decode('utf-8')
                for key, value in {'extension_dir':'ext', 'error_log':'php.log', 'session.save_path':'tmp', 'opcache.blacklist_filename':'blacklist', 'opcache.file_cache':'bin'}.items():
                    settings = re.sub(r'^' + re.escape(key) + r'=.*$', lambda m: key+'='+value, settings, flags=re.M)
                content = settings.encode('utf-8')
            archive.writestr('UoBTKD Training Suite/' + relative.as_posix(), content)
        archive.writestr('UoBTKD Training Suite/config', '[LEDA]\r\nLANGUAGE=0000000000\r\nSERVER=http://beiot.imwork.net:81\r\nUSERID=\r\nTOKEN=\r\n')
        archive.writestr('UoBTKD Training Suite/README.txt', 'UoBTKD Training Suite\r\n\r\nExtract the entire folder, then open Start.cmd.\r\nFor phones, use the QR code shown by this laptop. Enable phone connections once if prompted.\r\nVideo replay: install the Android camera app from the replay QR page.\r\n')
        for directory in ['LocalStorage', 'data', 'nginx/logs', 'nginx/temp', 'nginx/php7.4.3nts/tmp', 'nginx/php7.4.3nts/bin']:
            archive.writestr('UoBTKD Training Suite/' + directory + '/', b'')
    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    destination.with_suffix('.zip.sha256').write_text(digest + '  ' + destination.name + '\n', encoding='ascii')
    print(json.dumps({'file':str(destination),'bytes':destination.stat().st_size,'sha256':digest}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'dist/UoBTKD-Training-Suite-Windows-v1.1.0.zip')
    build(parser.parse_args().output.resolve())
