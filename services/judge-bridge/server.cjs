/* Local Wi-Fi bridge. Only the authenticated desktop can approve judges or award points. */
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createNetworkSetup } = require('./network.cjs');
const { attachLive } = require('./live.cjs');
const { createReplay } = require('./replay.cjs');
const { execFile } = require('node:child_process');
const protocol = require('../../packages/judge-protocol/index.js');
const root = path.resolve(__dirname, '../..');
const buildHash = crypto.createHash('sha256');
for (const name of fs
  .readdirSync(__dirname)
  .filter((name) => name.endsWith('.cjs'))
  .sort()) {
  buildHash.update(name).update(fs.readFileSync(path.join(__dirname, name)));
}
buildHash.update(fs.readFileSync(path.join(root, 'packages/judge-protocol/index.js')));
buildHash.update(require('ws/package.json').version);
const buildId = buildHash.digest('hex').slice(0, 16);
function createBridge(options = {}) {
  const replay = createReplay({
    directory: options.replayDirectory || path.join(root, 'recordings'),
    now: options.now,
    open:
      options.openReplay ||
      (() =>
        new Promise((resolve, reject) => {
          const target = 'http://127.0.0.1:' + server.address().port + '/replay';
          execFile(
            'powershell.exe',
            [
              '-NoProfile',
              '-Command',
              'Start-Process -FilePath "msedge.exe" -ArgumentList "' + target + '"'
            ],
            { windowsHide: true },
            (error) =>
              error
                ? reject(new Error('Could not open Microsoft Edge. Open ' + target + ' manually.'))
                : resolve()
          );
        }))
  });
  const networkInterfaces = options.networkInterfaces || os.networkInterfaces;
  const networkSetup = options.networkSetup || createNetworkSetup(root);
  const now = options.now || Date.now;
  const desktopKey = crypto.randomBytes(32).toString('hex');
  const origins =
    options.desktopOrigins ||
    [10808, 11818, 12828].flatMap((port) => [
      'http://127.0.0.1:' + port,
      'http://localhost:' + port
    ]);
  let session = null,
    lastCode = '',
    liveDesktop = null;
  const failures = new Map();
  let broadcast = () => {};
  const token = () => crypto.randomBytes(24).toString('hex');
  function rotate() {
    do {
      session.code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    } while (session.code === lastCode);
    lastCode = session.code;
    session.codeExpires = now() + 120000;
  }
  function addresses() {
    const port = server.address() && server.address().port;
    return [
      ...new Set(
        Object.entries(networkInterfaces())
          .sort(([a], [b]) => {
            const rank = (name) =>
              /wi-?fi|wlan|wireless/i.test(name)
                ? 0
                : /vpn|nord|tun|virtual|vethernet/i.test(name)
                  ? 2
                  : 1;
            return rank(a) - rank(b);
          })
          .map(([, addresses]) => addresses)
          .flat()
          .filter(
            (x) =>
              x &&
              (x.family === 'IPv4' || x.family === 4) &&
              !x.internal &&
              !x.address.startsWith('169.254.')
          )
          .map((x) => 'http://' + x.address + ':' + port)
      )
    ];
  }
  function online() {
    return session && now() - session.seen < 1200;
  }
  function roster() {
    return session
      ? [...session.judges.values()].map((j) => ({
          id: j.id,
          name: j.name,
          seat: j.seat,
          approved: j.approved,
          connected: now() - j.seen < 3500
        }))
      : [];
  }
  function desktopState() {
    return {
      version: protocol.version,
      sessionId: session.id,
      code: session.code,
      codeExpires: session.codeExpires,
      urls: addresses(),
      judges: roster(),
      judgeCount: session.count,
      policyRevision: session.policyRevision,
      revision: session.state.revision
    };
  }
  function publicState(judge) {
    const s = session.state;
    return {
      version: protocol.version,
      sessionId: session.id,
      judgeId: judge.id,
      seat: judge.seat,
      approved: judge.approved,
      desktopOnline: !!online(),
      title: s.title,
      blue: s.blue,
      red: s.red,
      round: s.round,
      phase: online() ? s.phase : 'offline',
      revision: s.revision,
      count: session.count,
      policyRevision: session.policyRevision,
      required: protocol.requiredVotes(session.count),
      windowMs: protocol.windowMs,
      feedback: judge.feedback || null
    };
  }
  function judgeFor(req) {
    if (!session) return null;
    const auth = String(req.headers.authorization || '').replace(/^Bearer /, '');
    return [...session.judges.values()].find((j) => j.token === auth) || null;
  }
  function feedback(ids, value) {
    for (const id of ids) {
      const j = session.judges.get(id);
      if (j) j.feedback = { ...value, at: now() };
    }
  }
  function rejectPending() {
    for (const award of session.awards.values())
      feedback(award.judges, {
        status: 'not-awarded',
        side: award.side,
        message: 'Play stopped before the panel accepted this input.'
      });
    session.awards.clear();
    session.groups = {};
  }
  function isDesktop(req) {
    const remote = req.socket.remoteAddress;
    return (
      ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote) &&
      (origins.includes(req.headers.origin) ||
        req.headers.origin === 'http://' + req.headers.host ||
        (!req.headers.origin && req.headers['sec-fetch-site'] === 'same-origin')) &&
      /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '')
    );
  }
  function reply(res, status, data) {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(JSON.stringify(data));
    queueMicrotask(broadcast);
  }
  async function body(req) {
    let data = '';
    for await (const part of req) {
      data += part;
      if (data.length > 16384) throw Object.assign(new Error('Request too large'), { status: 413 });
    }
    try {
      return JSON.parse(data || '{}');
    } catch {
      throw Object.assign(new Error('Invalid JSON'), { status: 400 });
    }
  }
  function vote(judge, input) {
    const state = session.state;
    if (
      !judge.approved ||
      !online() ||
      state.phase !== 'running' ||
      input.revision !== state.revision ||
      input.round !== state.round ||
      input.sessionId !== session.id ||
      (input.policyRevision || 0) !== session.policyRevision
    )
      return { error: 'This match is not accepting punches.', status: 409 };
    if (
      !protocol.validSide(input.side) ||
      typeof input.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{8,100}$/.test(input.id)
    )
      return { error: 'Invalid punch input.', status: 400 };
    if (judge.seenInputs.has(input.id)) return { duplicate: true, state: publicState(judge) };
    if (judge.seenInputs.size >= 10000)
      return { error: 'Input limit reached for this match.', status: 429 };
    judge.seenInputs.add(input.id);
    const side = input.side;
    let group = session.groups[side];
    if (session.count === 1 || !group || now() - group.at > protocol.windowMs) {
      group = { at: now(), judges: new Set(), award: null };
      session.groups[side] = group;
    }
    group.judges.add(judge.id);
    if (group.award) {
      judge.feedback = {
        status: 'combined',
        side,
        at: now(),
        message: 'Combined with the same punch within three seconds.'
      };
      return { state: publicState(judge) };
    }
    feedback([judge.id], { status: 'waiting', side, message: 'Waiting for another judge.' });
    if (group.judges.size >= protocol.requiredVotes(session.count)) {
      const award = {
        id: token(),
        side,
        round: state.round,
        revision: state.revision,
        sessionId: session.id,
        policyRevision: session.policyRevision,
        judges: [...group.judges],
        at: now()
      };
      group.award = award.id;
      session.awards.set(award.id, award);
      feedback(award.judges, {
        status: 'pending',
        side,
        message: 'Waiting for the desktop to confirm the point.'
      });
    }
    return { state: publicState(judge) };
  }
  const handle = async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const desktopRoute = url.pathname.startsWith('/api/desktop/');
      if (desktopRoute) {
        if (!isDesktop(req)) return reply(res, 403, { error: 'Desktop access is local only.' });
        if (req.headers.origin) res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        if (req.method === 'OPTIONS') return reply(res, 200, {});
        if (url.pathname === '/api/desktop/bootstrap' && req.method === 'GET')
          return reply(res, 200, { key: desktopKey, version: protocol.version });
        if (req.headers.authorization !== 'Bearer ' + desktopKey)
          return reply(res, 401, { error: 'Invalid desktop connection.' });
      } else if (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host) {
        return reply(res, 403, { error: 'Cross-site requests are not permitted.' });
      }
      if (url.pathname === '/health' && req.method === 'GET')
        return reply(res, 200, { service: 'uobtkd-judge-bridge', version: 3, buildId });
      if (url.pathname === '/api/desktop/replay/addresses')
        return reply(res, 200, { urls: addresses() });
      if (await replay.handle(req, res, url, desktopRoute)) return;
      if (
        url.pathname === '/api/desktop/network' &&
        (req.method === 'GET' || req.method === 'POST')
      ) {
        try {
          const result =
            req.method === 'POST' ? await networkSetup.enable() : await networkSetup.status();
          return reply(res, 200, result);
        } catch (error) {
          return reply(res, 503, { error: error.message || 'Network setup is unavailable.' });
        }
      }
      if (desktopRoute && req.method === 'POST') {
        const input = await body(req);
        if (url.pathname === '/api/desktop/session') {
          if (typeof input.matchKey !== 'string' || input.matchKey.length > 100 || !input.matchKey)
            return reply(res, 400, { error: 'Invalid match key.' });
          if (!session || input.matchKey !== session.matchKey) {
            session = {
              id: token(),
              matchKey: input.matchKey,
              count: protocol.judgeCount(input.judgeCount),
              policyRevision: 0,
              judges: new Map(),
              awards: new Map(),
              groups: {},
              seen: now(),
              state: { phase: 'ready', revision: 0, round: 1, title: '', blue: 'Blue', red: 'Red' }
            };
            rotate();
          }
          return reply(res, 200, desktopState());
        }
        if (!session || input.sessionId !== session.id)
          return reply(res, 409, { error: 'The judge match has changed.' });
        if (url.pathname === '/api/desktop/judge-count') {
          if (![1, 2, 3].includes(input.judgeCount))
            return reply(res, 400, { error: 'Choose one, two or three corner judges.' });
          if (input.judgeCount !== session.count) {
            rejectPending();
            session.count = input.judgeCount;
            session.policyRevision++;
            const judges = [...session.judges.values()].sort((a, b) => a.seat - b.seat);
            judges.forEach((judge, index) => {
              if (index >= session.count) session.judges.delete(judge.id);
              else judge.seat = index + 1;
            });
          }
          return reply(res, 200, desktopState());
        }
        if (url.pathname === '/api/desktop/sync') {
          if (
            ![
              'ready',
              'running',
              'paused',
              'break',
              'break-paused',
              'decision',
              'finished',
              'round-over'
            ].includes(input.phase) ||
            !Number.isSafeInteger(input.revision) ||
            !Number.isSafeInteger(input.round)
          )
            return reply(res, 400, { error: 'Invalid match state.' });
          if (input.revision < session.state.revision)
            return reply(res, 409, { error: 'Stale match state.' });
          for (const ack of Array.isArray(input.acks) ? input.acks.slice(0, 100) : []) {
            const award = session.awards.get(ack.id);
            if (award) {
              feedback(award.judges, {
                status: ack.accepted ? 'awarded' : 'not-awarded',
                side: award.side,
                message: ack.accepted
                  ? 'Point confirmed by the desktop.'
                  : 'Point not accepted by the desktop.'
              });
              session.awards.delete(ack.id);
            }
          }
          if (
            !online() ||
            input.revision !== session.state.revision ||
            input.phase !== session.state.phase ||
            input.round !== session.state.round
          )
            rejectPending();
          session.seen = now();
          session.state = {
            phase: input.phase,
            revision: input.revision,
            round: input.round,
            title: protocol.name(input.title, 'Competition'),
            blue: protocol.name(input.blue, 'Blue'),
            red: protocol.name(input.red, 'Red')
          };
          return reply(res, 200, {
            ...desktopState(),
            awards: [...session.awards.values()].map(({ judges, at, ...item }) => item)
          });
        }
        if (url.pathname === '/api/desktop/rotate') {
          rotate();
          return reply(res, 200, desktopState());
        }
        if (url.pathname === '/api/desktop/judge') {
          const judge = session.judges.get(input.judgeId);
          if (!judge) return reply(res, 404, { error: 'Judge not found.' });
          if (input.action === 'approve') judge.approved = true;
          else if (input.action === 'remove') {
            rejectPending();
            session.judges.delete(judge.id);
          } else return reply(res, 400, { error: 'Invalid judge action.' });
          return reply(res, 200, desktopState());
        }
        if (url.pathname === '/api/desktop/end') {
          rejectPending();
          session = null;
          return reply(res, 200, {});
        }
      }
      if (url.pathname === '/api/pair' && req.method === 'POST') {
        const ip = req.socket.remoteAddress;
        const attempts = failures.get(ip);
        if (attempts && now() - attempts.at < 60000 && attempts.count >= 10)
          return reply(res, 429, { error: 'Too many attempts. Wait one minute.' });
        const input = await body(req);
        if (
          !session ||
          !online() ||
          session.state.phase === 'finished' ||
          now() > session.codeExpires ||
          String(input.code) !== session.code
        ) {
          if (!attempts || now() - attempts.at >= 60000) failures.set(ip, { at: now(), count: 1 });
          else attempts.count++;
          return reply(res, 403, { error: 'Invalid or expired match code.' });
        }
        const seat = [1, 2, 3].find(
          (value) =>
            value <= session.count && ![...session.judges.values()].some((j) => j.seat === value)
        );
        if (!seat)
          return reply(res, 409, {
            error:
              'All judge slots are occupied. Ask the desktop operator to remove an old connection.'
          });
        const judge = {
          id: token(),
          token: token(),
          name: protocol.name(input.name, 'Judge ' + seat),
          seat,
          approved: false,
          seen: now(),
          seenInputs: new Set()
        };
        session.judges.set(judge.id, judge);
        return reply(res, 200, { token: judge.token, state: publicState(judge) });
      }
      if (url.pathname.startsWith('/api/judge/')) {
        const judge = judgeFor(req);
        if (!judge) return reply(res, 401, { error: 'Pair with this match again.' });
        judge.seen = now();
        if (url.pathname === '/api/judge/state' && req.method === 'GET')
          return reply(res, 200, publicState(judge));
        if (url.pathname === '/api/judge/punch' && req.method === 'POST') {
          const input = await body(req);
          judge.rate =
            judge.rate && now() - judge.rate.at < 1000 ? judge.rate : { at: now(), count: 0 };
          if (++judge.rate.count > 20) return reply(res, 429, { error: 'Too many inputs.' });
          const result = vote(judge, input);
          return reply(res, result.status || 200, result);
        }
        if (url.pathname === '/api/judge/leave' && req.method === 'POST') {
          rejectPending();
          session.judges.delete(judge.id);
          return reply(res, 200, {});
        }
      }
      const files = {
        '/replay': ['apps/replay/index.html', 'text/html'],
        '/replay.js': ['apps/replay/replay.js', 'text/javascript'],
        '/replay.css': ['apps/replay/replay.css', 'text/css'],
        '/camera': ['apps/replay/camera.html', 'text/html'],
        '/camera.js': ['apps/replay/camera.js', 'text/javascript'],
        '/qr.js': [
          fs.existsSync(path.join(root, 'apps/replay/qrcode.js'))
            ? 'apps/replay/qrcode.js'
            : path.relative(root, require.resolve('qrcode-generator')),
          'text/javascript'
        ],
        '/camera.apk': [
          fs.existsSync(path.join(root, 'apps/replay/camera.apk'))
            ? 'apps/replay/camera.apk'
            : 'apps/camera-android/app/build/outputs/apk/debug/app-debug.apk',
          'application/vnd.android.package-archive'
        ],
        '/': ['apps/judge/index.html', 'text/html'],
        '/app.js': ['apps/judge/app.js', 'text/javascript'],
        '/style.css': ['apps/judge/style.css', 'text/css'],
        '/protocol.js': ['packages/judge-protocol/index.js', 'text/javascript']
      };
      if (req.method === 'GET' && files[url.pathname]) {
        const [filename, type] = files[url.pathname];
        if (!fs.existsSync(path.join(root, filename)))
          return reply(res, 404, {
            error:
              'This asset is not packaged. Build the Android camera app, then rebuild the desktop app.'
          });
        res.writeHead(200, {
          'Content-Type': type + '; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy':
            "default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self' blob:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'"
        });
        return res.end(fs.readFileSync(path.join(root, filename)));
      }
      reply(res, 404, { error: 'Not found.' });
    } catch (error) {
      if (!res.headersSent)
        reply(res, error.status || 500, {
          error: error.status ? error.message : 'Bridge request failed.'
        });
      else res.end();
    }
  };
  const server = http.createServer(handle);
  const live = attachLive(server, {
    handle,
    isDesktop,
    heartbeat(identity) {
      const judge = session && session.judges.get(identity.judgeId);
      if (judge) judge.seen = now();
    },
    authenticate(role, message) {
      if (!session) return null;
      if (role === 'desktop') {
        if (message.token !== desktopKey || message.sessionId !== session.id) return null;
        liveDesktop = { role, token: desktopKey, sessionId: session.id };
        return liveDesktop;
      }
      const judge = judgeFor({ headers: { authorization: 'Bearer ' + message.token } });
      if (!judge) return null;
      judge.liveIdentity = { role, token: judge.token, sessionId: session.id, judgeId: judge.id };
      return judge.liveIdentity;
    },
    snapshot(identity) {
      if (!session || session.id !== identity.sessionId) return null;
      if (identity.role === 'desktop')
        return liveDesktop === identity
          ? {
              ...desktopState(),
              awards: [...session.awards.values()].map(({ judges, at, ...item }) => item)
            }
          : null;
      const judge = session.judges.get(identity.judgeId);
      return judge && judge.liveIdentity === identity ? publicState(judge) : null;
    },
    disconnected(identity) {
      if (!identity || !session || identity.sessionId !== session.id) return;
      if (identity.role === 'desktop' && liveDesktop === identity) {
        liveDesktop = null;
        session.seen = -Infinity;
        rejectPending();
      } else {
        const judge = session.judges.get(identity.judgeId);
        if (judge && judge.liveIdentity === identity) judge.seen = -Infinity;
      }
    }
  });
  broadcast = live.broadcast;
  return {
    server,
    addresses,
    close: () => {
      live.close();
      return replay.close().then(() => new Promise((resolve) => server.close(resolve)));
    }
  };
}
if (require.main === module) {
  const bridge = createBridge();
  bridge.server.listen(Number(process.env.JUDGE_PORT || 8976), '0.0.0.0', () =>
    console.log('Judge controller: ' + bridge.addresses().join(', '))
  );
  bridge.server.on('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
module.exports = { createBridge, buildId };
