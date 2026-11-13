const assert = require('node:assert/strict');
const { createBridge } = require('../services/judge-bridge/server.cjs');
const mp4 = require('../services/judge-bridge/mp4.cjs');
function box(type, ...parts) {
  const data = Buffer.concat(parts),
    header = Buffer.alloc(8);
  header.writeUInt32BE(data.length + 8);
  header.write(type, 4);
  return Buffer.concat([header, data]);
}
function u32(value) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(value);
  return b;
}
function fixture() {
  const mdhd = Buffer.alloc(24);
  mdhd.writeUInt32BE(1000, 12);
  const trex = Buffer.alloc(24);
  trex.writeUInt32BE(100, 12);
  const entry = box('avc1', Buffer.alloc(78), box('avcC', Buffer.from([1, 66, 0, 31])));
  const samples = box('stbl', box('stsd', u32(0), u32(1), entry));
  const media = box('mdia', box('mdhd', mdhd), box('minf', samples));
  return Buffer.concat([
    box('ftyp', Buffer.from('isom0000')),
    box('moov', box('trak', media), box('mvex', box('trex', trex)))
  ]);
}
function fragment(index) {
  return Buffer.concat([
    box(
      'moof',
      box(
        'traf',
        box('tfhd', u32(8), u32(1), u32(100)),
        box('tfdt', u32(0), u32(index * 1000)),
        box('trun', u32(1), u32(10), u32(0))
      )
    ),
    box('mdat', Buffer.alloc(32))
  ]);
}
async function main() {
  let time = 10000;
  const origin = 'http://127.0.0.1:10808';
  const bridge = createBridge({
    now: () => time,
    desktopOrigins: [origin],
    openReplay: async () => {}
  });
  await new Promise((r) => bridge.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + bridge.server.address().port;
  let key = '',
    token = '';
  async function request(route, data, auth, expected = 200) {
    const response = await fetch(base + route, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {
        Origin: route.startsWith('/api/desktop/') ? origin : base,
        ...(auth ? { Authorization: 'Bearer ' + auth } : {}),
        'Content-Type': Buffer.isBuffer(data) ? 'video/mp4' : 'application/json'
      },
      ...(data === undefined ? {} : { body: Buffer.isBuffer(data) ? data : JSON.stringify(data) })
    });
    assert.equal(response.status, expected, await response.clone().text());
    return response;
  }
  async function desktop(route, data) {
    return (await request('/api/desktop/replay/' + route, data, key)).json();
  }
  try {
    key = (await (await request('/api/desktop/bootstrap', undefined)).json()).key;
    await request('/api/desktop/replay/state', undefined, null, 401);
    let state = await desktop('state');
    await request('/api/camera/pair', { code: 'invalid' }, null, 403);
    const pair = await (
      await request('/api/camera/pair', { code: state.code, name: 'Test camera' })
    ).json();
    token = pair.token;
    await request('/api/camera/start', {}, token, 403);
    await desktop('approve', {});
    const start = await (await request('/api/camera/start', {}, token)).json();
    const gen = start.generation;
    const init = fixture();
    assert.equal(mp4.initialization(init).codec, 'avc1.42001F');
    async function chunk(index, data, expected = 200, generation = gen) {
      return request(
        '/api/camera/chunk?generation=' + generation + '&index=' + index,
        data,
        token,
        expected
      );
    }
    await chunk(0, init);
    await chunk(2, fragment(1), 409);
    await chunk(1, fragment(0));
    await chunk(1, fragment(0), 409);
    await chunk(2, Buffer.from('invalid data'), 400);
    await chunk(2, fragment(1));
    for (let i = 2; i < 130; i++) {
      time += 1000;
      await chunk(i + 1, fragment(i));
    }
    state = await desktop('state');
    assert(state.end - state.start <= 120);
    assert.equal(state.codec, 'avc1.42001F');
    assert(state.bytes < 128 * 1024 * 1024);
    await request('/api/desktop/replay/media?generation=' + gen + '&index=1', undefined, key, 410);
    await request('/api/desktop/replay/media?generation=stale&index=init', undefined, key, 409);
    const exported = await request(
      '/api/desktop/replay/clip?generation=' + gen + '&from=110&to=113',
      undefined,
      key
    );
    const clip = Buffer.from(await exported.arrayBuffer());
    const boxes = mp4.boxes(clip),
      first = boxes.find((b) => b.type === 'moof'),
      next = boxes.find((b) => b.type === 'moof' && b.at > first.at);
    const firstPart = clip.subarray(first.at, next.at);
    assert.equal(
      mp4.fragment(firstPart, mp4.initialization(init)).start,
      0,
      'Export timestamps start at zero'
    );
    await request('/api/desktop/replay/clip?generation=stale&from=110&to=113', undefined, key, 409);
    await request('/api/camera/stop?generation=' + gen, {}, token);
    assert.equal((await desktop('state')).recording, false);
    const original = state.code;
    await desktop('rotate', {});
    assert.notEqual((await desktop('state')).code, original);
    assert((await (await request('/api/camera/state', undefined, token)).json()).approved);
    await desktop('remove', {});
    await request('/api/camera/state', undefined, token, 401);
    assert.equal((await desktop('state')).segments.length, 0);
    console.log(
      'Replay backend passed: camera pairing/approval, fMP4 parsing, upload ordering, bounded ring, zero-based clip export and recording/token isolation.'
    );
  } finally {
    await bridge.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
