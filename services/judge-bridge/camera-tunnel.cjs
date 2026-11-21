const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const release = {
  version: '2026.11.1',
  sha256: '341deda3db5ec498a0482254d6c38c0b7cf01a30c37bb5dd95d2216d08955e35'
};
function httpsText(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, options, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (part) => {
        text += part;
        if (text.length > 65536) response.destroy(new Error('Unexpected HTTPS setup response.'));
      });
      response.on('end', () => resolve({ status: response.statusCode, text }));
      response.on('error', reject);
    });
    request.on('error', reject);
  });
}
async function verifyPublic(origin, signal) {
  // Check publication without creating an early NXDOMAIN entry in the user's DNS cache.
  const hostname = new URL(origin).hostname;
  for (let attempt = 0; attempt < 10; attempt++) {
    signal.throwIfAborted();
    try {
      const dns = await httpsText(
        'https://cloudflare-dns.com/dns-query?name=' + hostname + '&type=A',
        {
          headers: { Accept: 'application/dns-json' },
          signal: AbortSignal.any([signal, AbortSignal.timeout(4000)])
        }
      );
      const answer =
        dns.status === 200 &&
        JSON.parse(dns.text).Answer?.find(
          (item) => item.type === 1 && /^\d+\.\d+\.\d+\.\d+$/.test(item.data)
        );
      if (answer) {
        const page = await httpsText(origin + '/camera', {
          family: 4,
          lookup: (_host, _options, callback) => callback(null, answer.data, 4),
          signal: AbortSignal.any([signal, AbortSignal.timeout(5000)])
        });
        if (page.status === 200 && page.text.includes('id="pair-browser"')) return;
      }
    } catch (problem) {
      if (signal.aborted) throw problem;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    'The camera link connected, but its public page is not reachable yet. Try enabling it again.'
  );
}

async function helper(root, signal) {
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error('The automatic browser-camera link currently requires 64-bit Windows.');
  const directory = path.join(root, 'camera-tools');
  const target = path.join(directory, 'cloudflared-' + release.version + '.exe');
  const valid = async () => {
    try {
      return (
        crypto
          .createHash('sha256')
          .update(await fs.readFile(target))
          .digest('hex') === release.sha256
      );
    } catch {
      return false;
    }
  };
  if (await valid()) return target;
  await fs.mkdir(directory, { recursive: true });
  const response = await fetch(
    'https://github.com/cloudflare/cloudflared/releases/download/' +
      release.version +
      '/cloudflared-windows-amd64.exe',
    { signal: AbortSignal.any([AbortSignal.timeout(120000), ...(signal ? [signal] : [])]) }
  );
  if (!response.ok)
    throw new Error(
      'Could not download the HTTPS helper. Check the internet connection and try again.'
    );
  let size = 0;
  const parts = [];
  for await (const part of response.body) {
    size += part.length;
    if (size > 80 * 1024 * 1024) throw new Error('Unexpected HTTPS helper download size.');
    parts.push(part);
  }
  const data = Buffer.concat(parts);
  signal?.throwIfAborted();
  if (crypto.createHash('sha256').update(data).digest('hex') !== release.sha256)
    throw new Error('HTTPS helper verification failed. Nothing was run.');
  const temporary = target + '.' + crypto.randomUUID() + '.tmp';
  try {
    await fs.writeFile(temporary, data);
    await fs.rename(temporary, target);
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
  return target;
}

// This is a separate, camera-only origin. Never tunnel the judge/desktop service directly.
function createCameraProxy(target, publicOrigin) {
  const assets = new Set([
    '/camera',
    '/camera.js',
    '/camera-mp4.js',
    '/browser-camera.js',
    '/replay.css'
  ]);
  const methods = new Map([
    ['/api/camera/pair', 'POST'],
    ['/api/camera/state', 'GET'],
    ['/api/camera/start', 'POST'],
    ['/api/camera/chunk', 'POST'],
    ['/api/camera/stop', 'POST']
  ]);
  const server = http.createServer((req, res) => {
    const reject = (status, message) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: message }));
    };
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return reject(400, 'Invalid camera request.');
    }
    if (!req.url.startsWith('/') || req.url.startsWith('//') || url.origin !== 'http://localhost')
      return reject(400, 'Invalid camera request.');
    if (!(
      (req.method === 'GET' && assets.has(url.pathname)) ||
      methods.get(url.pathname) === req.method
    ))
      return reject(403, 'This link only accepts replay-camera connections.');
    const origin = publicOrigin();
    if (!origin) return reject(503, 'The browser-camera link is starting.');
    if (req.headers.origin && req.headers.origin !== origin)
      return reject(403, 'Cross-site camera requests are not permitted.');
    if (Number(req.headers['content-length'] || 0) > 8 * 1024 * 1024)
      return reject(413, 'Camera upload is too large.');
    const upstream = http.request(
      new URL(req.url, target),
      {
        method: req.method,
        headers: {
          Host: new URL(target).host,
          Origin: target,
          ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
          ...(req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] } : {}),
          ...(req.headers['content-length']
            ? { 'Content-Length': req.headers['content-length'] }
            : {})
        },
        timeout: 15000
      },
      (response) => {
        res.writeHead(response.statusCode, {
          ...response.headers,
          'Cache-Control': 'no-store',
          'Permissions-Policy': 'camera=(self), microphone=()',
          'Referrer-Policy': 'no-referrer'
        });
        response.pipe(res);
      }
    );
    let received = 0;
    req.on('data', (part) => {
      received += part.length;
      if (received > 8 * 1024 * 1024) {
        upstream.destroy();
        if (!res.headersSent) reject(413, 'Camera upload is too large.');
      }
    });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => upstream.destroy());
    upstream.on('timeout', () => upstream.destroy(new Error('Camera upload timed out.')));
    upstream.on('error', () => {
      if (!res.headersSent) reject(502, 'The desktop camera service is unavailable.');
      else res.end();
    });
    req.pipe(upstream);
  });
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  return server;
}

function createCameraTunnel(options = {}) {
  let phase = 'off',
    url = '',
    error = '',
    pending = null,
    child = null,
    proxy = null,
    revision = 0;
  let startupTimer = null,
    cancelStartup = null,
    download = null,
    probe = null;
  const state = () => ({ phase, url: phase === 'ready' ? url : '', error });
  async function dispose() {
    download?.abort();
    download = null;
    probe?.abort();
    probe = null;
    if (startupTimer) clearTimeout(startupTimer);
    startupTimer = null;
    if (cancelStartup) cancelStartup(new Error('Browser-camera link stopped.'));
    cancelStartup = null;
    const oldChild = child;
    child = null;
    if (oldChild) oldChild.kill();
    const oldProxy = proxy;
    proxy = null;
    if (oldProxy) {
      oldProxy.closeAllConnections();
      await new Promise((resolve) => oldProxy.close(resolve));
    }
  }
  function start(target) {
    if (phase === 'ready') return Promise.resolve(state());
    if (pending) return pending;
    const current = ++revision;
    phase = 'starting';
    error = '';
    url = '';
    pending = (async () => {
      try {
        download = new AbortController();
        const executable = await (options.helper || helper)(options.root, download.signal);
        download = null;
        if (current !== revision) return state();
        const startedProxy = (proxy = createCameraProxy(target, () => url));
        await new Promise((resolve, reject) => {
          startedProxy.once('error', reject);
          startedProxy.listen(0, '127.0.0.1', resolve);
        });
        if (current !== revision) {
          startedProxy.closeAllConnections();
          startedProxy.close();
          return state();
        }
        const port = startedProxy.address().port;
        await new Promise((resolve, reject) => {
          cancelStartup = reject;
          let tail = '';
          let candidate = '',
            connected = false,
            probing = false;
          startupTimer = setTimeout(
            () =>
              reject(
                new Error('The HTTPS link could not connect. Check the internet connection or VPN.')
              ),
            options.timeout || 45000
          );
          const process = (child = (options.spawn || spawn)(
            executable,
            [
              'tunnel',
              '--no-autoupdate',
              '--protocol',
              'http2',
              '--edge-ip-version',
              '4',
              '--metrics',
              '127.0.0.1:0',
              '--url',
              'http://127.0.0.1:' + port
            ],
            { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
          ));
          function output(data) {
            if (current !== revision) return;
            tail = (tail + data.toString()).slice(-12000);
            const match = tail.match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com\b/);
            if (match) candidate = match[0];
            if (/Registered tunnel connection/.test(tail)) connected = true;
            if (candidate && connected && phase === 'starting' && !probing) {
              url = candidate;
              probing = true;
              probe = new AbortController();
              void (options.verifyPublic || verifyPublic)(url, probe.signal)
                .then(() => {
                  if (current !== revision || phase !== 'starting') return;
                  phase = 'ready';
                  error = '';
                  clearTimeout(startupTimer);
                  startupTimer = null;
                  cancelStartup = null;
                  probe = null;
                  resolve();
                })
                .catch(reject);
            }
          }
          process.stdout.on('data', output);
          process.stderr.on('data', output);
          process.once('error', reject);
          process.once('exit', () => {
            if (current !== revision) return;
            const problem = new Error(
              'The browser-camera link disconnected. Enable it again to reconnect.'
            );
            if (phase === 'starting') {
              if (/7844|connectivity|dial tcp|handshake|firewall/i.test(tail))
                problem.message =
                  'Cloudflare could not connect. Check that the network or VPN allows outbound TCP port 7844.';
              reject(problem);
            } else {
              phase = 'error';
              url = '';
              error = problem.message;
              void dispose();
            }
          });
        });
      } catch (problem) {
        if (current === revision) {
          ++revision;
          phase = 'error';
          error = problem.message;
          url = '';
          await dispose();
        }
      }
      return state();
    })().finally(() => {
      pending = null;
    });
    return pending;
  }
  async function stop() {
    ++revision;
    phase = 'off';
    url = '';
    error = '';
    await dispose();
    return state();
  }
  function terminate() {
    if (child) child.kill();
  }
  return { start, stop, state, terminate };
}

module.exports = { createCameraTunnel, createCameraProxy, release };
