const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const mp4 = require('./mp4.cjs');
function createReplay(options = {}) {
  const now = options.now || Date.now;
  const directory = options.directory || path.join(process.cwd(), 'recordings');
  let archive = null,
    recordingPath = '',
    archiveBytes = 0;
  async function close() {
    if (archive) {
      const old = archive;
      archive = null;
      await old.close();
    }
  }
  async function writeArchive(data) {
    if (!archive) return;
    if (archiveBytes + data.length > 4 * 1024 * 1024 * 1024)
      throw new Error('Recording reached 4 GB. Start a new recording.');
    let at = 0;
    while (at < data.length) {
      const result = await archive.write(data, at, data.length - at, archiveBytes + at);
      if (!result.bytesWritten) throw new Error('Could not save recording');
      at += result.bytesWritten;
    }
    archiveBytes += data.length;
  }
  let code = '',
    expires = 0,
    camera = null,
    generation = '',
    init = null,
    format = null,
    chunks = [],
    bytes = 0,
    lastIndex = 0,
    lastSeen = 0,
    error = '',
    recording = false;
  const attempts = new Map();
  function rotate() {
    let next;
    do {
      next = String(crypto.randomInt(100000, 1000000));
    } while (next === code);
    code = next;
    expires = now() + 300000;
  }
  rotate();
  function state() {
    return {
      code,
      codeExpires: expires,
      recording,
      recordingPath,
      archiveBytes,
      camera: camera
        ? { name: camera.name, approved: camera.approved, connected: now() - lastSeen < 5000 }
        : null,
      generation,
      codec: format && format.codec,
      bytes,
      error,
      segments: chunks.map(({ data, ...item }) => item),
      start: chunks.length ? chunks[0].start : 0,
      end: chunks.length ? chunks[chunks.length - 1].end : 0
    };
  }
  function reset() {
    generation = crypto.randomBytes(12).toString('hex');
    init = null;
    format = null;
    chunks = [];
    bytes = 0;
    lastIndex = 0;
    error = '';
    recording = false;
    recordingPath = '';
    archiveBytes = 0;
  }
  async function read(req, limit) {
    let size = 0,
      list = [];
    for await (const part of req) {
      size += part.length;
      if (size > limit) throw new Error('Upload too large');
      list.push(part);
    }
    return Buffer.concat(list);
  }
  function json(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  }
  async function handle(req, res, url, desktop) {
    if (
      !url.pathname.startsWith('/api/replay/') &&
      !url.pathname.startsWith('/api/camera/') &&
      !url.pathname.startsWith('/api/desktop/replay/')
    )
      return false;
    try {
      const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
      const cameraRoute = url.pathname.startsWith('/api/camera/');
      const pair = url.pathname === '/api/camera/pair';
      if (!desktop && !pair && (!cameraRoute || !camera || camera.token !== token)) {
        json(res, 401, { error: 'Pair the camera again.' });
        return true;
      }
      if (cameraRoute && !pair) lastSeen = now();
      if (pair && req.method === 'POST') {
        const ip = req.socket.remoteAddress,
          old = attempts.get(ip);
        if (old && now() - old.at < 60000 && old.count >= 10) {
          json(res, 429, { error: 'Wait one minute before pairing again.' });
          return true;
        }
        const input = JSON.parse((await read(req, 4096)).toString());
        if (String(input.code) !== code || now() > expires) {
          attempts.set(ip, {
            at: old && now() - old.at < 60000 ? old.at : now(),
            count: old && now() - old.at < 60000 ? old.count + 1 : 1
          });
          json(res, 403, { error: 'Invalid or expired camera code.' });
          return true;
        }
        if (camera) {
          json(res, 409, { error: 'Remove the existing camera on the desktop first.' });
          return true;
        }
        camera = {
          token: crypto.randomBytes(24).toString('hex'),
          name: String(input.name || 'Phone camera')
            .replace(/[<>\x00-\x1f]/g, '')
            .slice(0, 50),
          approved: false
        };
        lastSeen = now();
        json(res, 200, { token: camera.token, approved: false });
        return true;
      }
      if (url.pathname === '/api/camera/state') {
        json(res, 200, { approved: camera.approved, generation });
        return true;
      }
      if (url.pathname === '/api/camera/start' && req.method === 'POST') {
        if (!camera.approved) {
          json(res, 403, { error: 'Wait for desktop approval.' });
          return true;
        }
        await close();
        reset();
        await fs.mkdir(directory, { recursive: true });
        const disk = await fs.statfs(directory);
        if (disk.bavail * disk.bsize < 512 * 1024 * 1024)
          throw new Error('At least 512 MB of free disk space is required.');
        recordingPath = path.join(
          directory,
          'UoBTKD_' +
            new Date(now()).toISOString().replace(/[:.]/g, '-') +
            '_' +
            generation.slice(0, 6) +
            '.mp4'
        );
        archive = await fs.open(recordingPath, 'wx');
        recording = true;
        json(res, 200, { generation });
        return true;
      }
      if (url.pathname === '/api/camera/stop' && req.method === 'POST') {
        if (url.searchParams.get('generation') === generation) {
          recording = false;
          await close();
        }
        json(res, 200, {});
        return true;
      }
      if (url.pathname === '/api/camera/chunk' && req.method === 'POST') {
        if (!camera.approved || !recording || url.searchParams.get('generation') !== generation) {
          json(res, 409, { error: 'Recording session changed.' });
          return true;
        }
        const index = Number(url.searchParams.get('index'));
        if (!Number.isInteger(index) || index < 0 || index !== (init ? lastIndex + 1 : 0)) {
          json(res, 409, { error: 'Missing or out-of-order video fragment. Restart recording.' });
          return true;
        }
        const uploadGeneration = generation;
        let data = await read(req, 8 * 1024 * 1024);
        if (
          !camera ||
          camera.token !== token ||
          generation !== uploadGeneration ||
          !recording ||
          index !== (init ? lastIndex + 1 : 0)
        ) {
          json(res, 409, { error: 'Recording changed while uploading. Restart recording.' });
          return true;
        }
        if (!init) {
          if (data.length > 524288) throw new Error('Initialization is too large');
          format = mp4.initialization(data);
          init = data;
        } else {
          data = mp4.normalize(
            data,
            chunks.length ? Math.round(chunks[chunks.length - 1].end * format.timescale) : 0
          );
          const info = mp4.fragment(data, format);
          if (info.end - info.start > 10 || info.end - info.start < 0)
            throw new Error('Invalid fragment duration');
          if (chunks.length && info.start < chunks[chunks.length - 1].end - 0.05)
            throw new Error('Video timestamps went backwards');
          chunks.push({ index, ...info, data });
          bytes += data.length;
          lastIndex = index;
          while (
            chunks.length > 1 &&
            (info.end - chunks[0].start > 120 || bytes > 128 * 1024 * 1024)
          ) {
            bytes -= chunks.shift().data.length;
          }
        }
        await writeArchive(data);
        json(res, 200, { accepted: index });
        return true;
      }
      if (!desktop) {
        json(res, 404, { error: 'Not found' });
        return true;
      }
      if (url.pathname === '/api/desktop/replay/state') {
        json(res, 200, state());
        return true;
      }
      if (url.pathname === '/api/desktop/replay/approve' && req.method === 'POST') {
        if (camera) camera.approved = true;
        json(res, 200, state());
        return true;
      }
      if (url.pathname === '/api/desktop/replay/remove' && req.method === 'POST') {
        camera = null;
        await close();
        reset();
        rotate();
        json(res, 200, state());
        return true;
      }
      if (url.pathname === '/api/desktop/replay/rotate' && req.method === 'POST') {
        rotate();
        json(res, 200, state());
        return true;
      }
      if (url.pathname === '/api/desktop/replay/media') {
        if (url.searchParams.get('generation') !== generation) {
          json(res, 409, { error: 'Recording changed.' });
          return true;
        }
        const key = url.searchParams.get('index');
        const data = key === 'init' ? init : chunks.find((x) => x.index === Number(key))?.data;
        if (!data) {
          json(res, 410, { error: 'This fragment is no longer buffered.' });
          return true;
        }
        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Content-Length': data.length,
          'Cache-Control': 'no-store'
        });
        res.end(data);
        return true;
      }
      if (url.pathname === '/api/desktop/replay/clip') {
        if (url.searchParams.get('generation') !== generation) {
          json(res, 409, { error: 'Recording changed. Select the clip again.' });
          return true;
        }
        const from = Number(url.searchParams.get('from')),
          to = Number(url.searchParams.get('to'));
        if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 120)
          throw new Error('Choose a clip between 0 and 120 seconds');
        const selected = chunks.filter((x) => x.end > from && x.start < to);
        if (!init || !selected.length) throw new Error('No video in that interval');
        const data = Buffer.concat([
          init,
          ...selected.map((x) => mp4.rebase(x.data, selected[0].decode))
        ]);
        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Content-Length': data.length,
          'Content-Disposition': 'attachment; filename="UoBTKD-replay.mp4"',
          'Cache-Control': 'no-store'
        });
        res.end(data);
        return true;
      }
      if (url.pathname === '/api/desktop/replay/open' && req.method === 'POST') {
        if (options.open) await options.open();
        json(res, 200, { opened: true });
        return true;
      }
      json(res, 404, { error: 'Not found' });
      return true;
    } catch (e) {
      error = e.message;
      json(res, 400, { error: e.message });
      return true;
    }
  }
  return { handle, state, close };
}
module.exports = { createReplay };
