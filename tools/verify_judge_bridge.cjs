const assert = require('node:assert/strict');
const { createBridge, buildId } = require('../services/judge-bridge/server.cjs');
async function main() {
  let time = 10000;
  const origin = 'http://127.0.0.1:10808';
  const bridge = createBridge({
    now: () => time,
    desktopOrigins: [origin],
    networkInterfaces: () => ({
      NordLynx: [{ family: 'IPv4', internal: false, address: '10.5.0.2' }],
      'Wi-Fi': [{ family: 'IPv4', internal: false, address: '192.168.0.12' }]
    })
  });
  await new Promise((resolve) => bridge.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + bridge.server.address().port;
  let key,
    current,
    revision = 1,
    sequence = 0;
  async function request(route, data, auth, desktop = false, expected = 200) {
    const response = await fetch(base + route, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {
        ...(desktop ? { Origin: origin } : {}),
        ...(auth ? { Authorization: 'Bearer ' + auth } : {}),
        'Content-Type': 'application/json'
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) })
    });
    const body = await response.json();
    assert.equal(response.status, expected, JSON.stringify(body));
    return body;
  }
  async function sync(phase = 'running', acks = []) {
    return request(
      '/api/desktop/sync',
      {
        sessionId: current.sessionId,
        revision,
        round: 1,
        phase,
        title: 'Test match',
        blue: 'Blue',
        red: 'Red',
        acks
      },
      key,
      true
    );
  }
  async function start(count) {
    const prior = current;
    current = await request(
      '/api/desktop/session',
      { matchKey: 'match-' + ++sequence, judgeCount: count },
      key,
      true
    );
    if (prior) assert.notEqual(current.code, prior.code);
    revision = 1;
    await sync('ready');
    return current;
  }
  async function tick(ms) {
    while (ms > 0) {
      const step = Math.min(ms, 500);
      time += step;
      ms -= step;
      await sync();
    }
  }
  async function pair(name) {
    return request('/api/pair', { code: current.code, name });
  }
  async function approve(judge) {
    return request(
      '/api/desktop/judge',
      { sessionId: current.sessionId, judgeId: judge.state.judgeId, action: 'approve' },
      key,
      true
    );
  }
  async function vote(judge, side = 'left', id, expected = 200) {
    return request(
      '/api/judge/punch',
      {
        id: id || 'vote-input-' + ++sequence,
        sessionId: current.sessionId,
        round: 1,
        revision,
        policyRevision: current.policyRevision || 0,
        side
      },
      judge.token,
      false,
      expected
    );
  }
  try {
    assert.equal(
      (await fetch(base + '/api/desktop/bootstrap', { headers: { Origin: 'http://evil.example' } }))
        .status,
      403
    );
    key = (await request('/api/desktop/bootstrap', undefined, null, true)).key;
    assert(key.length >= 48);
    await request('/api/desktop/session', { matchKey: 'unauthorized' }, null, true, 401);
    await request('/api/desktop/network', {}, null, true, 401);
    await request('/api/desktop/network', {}, key, false, 403);
    await start(1);
    assert.equal(
      (await request('/health', undefined)).buildId,
      buildId,
      'The running service identifies its loaded build'
    );
    assert.match(
      current.urls[0],
      /^http:\/\/192\.168\.0\.12:/,
      'QR defaults to Wi-Fi even when NordVPN is enumerated first'
    );
    const one = await pair('One');
    await vote(one, 'left', undefined, 409);
    await approve(one);
    await vote(one, 'left', undefined, 409);
    await sync();
    await vote(one, 'left', 'one-first');
    await vote(one, 'left', 'one-second');
    await vote(one, 'left', 'one-first');
    let snapshot = await sync();
    assert.equal(snapshot.awards.length, 2, 'One judge awards each press, but not network retries');
    const acknowledgements = snapshot.awards.map((a) => ({ id: a.id, accepted: true }));
    revision++;
    await sync('paused', acknowledgements);
    const own = await request('/api/judge/state', undefined, one.token);
    assert.equal(
      own.feedback.status,
      'awarded',
      'A point that ended play must still be acknowledged'
    );
    await vote(one, 'left', undefined, 409);
    await start(2);
    await request('/api/judge/state', undefined, one.token, false, 401);
    const twoA = await pair('Two A'),
      twoB = await pair('Two B');
    await approve(twoA);
    await approve(twoB);
    await sync();
    await vote(twoA);
    await vote(twoB);
    await vote(twoA);
    snapshot = await sync();
    assert.equal(snapshot.awards.length, 1, 'Two judges combine same-side inputs');
    await vote(twoB, 'right');
    snapshot = await sync();
    assert.equal(snapshot.awards.length, 2, 'Blue/red windows are independent');
    await tick(3001);
    await vote(twoA);
    snapshot = await sync();
    assert.equal(snapshot.awards.length, 3, 'A fresh punch window opens after three seconds');
    await start(3);
    const three = [await pair('A'), await pair('B'), await pair('C')];
    for (const judge of three) await approve(judge);
    await sync();
    await vote(three[0]);
    await vote(three[0]);
    assert.equal((await sync()).awards.length, 0, 'The same judge cannot provide both votes');
    await tick(3000);
    await vote(three[1]);
    assert.equal(
      (await sync()).awards.length,
      1,
      'Two distinct judges qualify at the three-second boundary'
    );
    await vote(three[2]);
    assert.equal((await sync()).awards.length, 1);
    revision++;
    await sync('paused');
    assert.equal(
      (await sync('paused')).awards.length,
      0,
      'Unaccepted inputs are revoked when play pauses'
    );
    revision++;
    await sync();
    await vote(three[0]);
    await tick(3001);
    await vote(three[1]);
    assert.equal((await sync()).awards.length, 0, 'Votes outside the time window do not combine');
    await vote(three[2]);
    assert.equal((await sync()).awards.length, 1);
    await request(
      '/api/desktop/judge',
      { sessionId: current.sessionId, judgeId: three[1].state.judgeId, action: 'remove' },
      key,
      true
    );
    await request('/api/judge/state', undefined, three[1].token, false, 401);
    assert.equal(
      (await sync()).awards.length,
      0,
      'Removing a judge invalidates their pending votes'
    );
    await vote(three[0], 'right');
    await vote(three[2], 'right');
    assert.equal((await sync()).awards.length, 1);
    time += 2000;
    await vote(three[0], 'right', undefined, 409);
    assert.equal(
      (await sync()).awards.length,
      0,
      'Lost desktop heartbeat discards undelivered points'
    );
    await vote(three[0], 'left');
    revision++;
    await request(
      '/api/desktop/sync',
      { sessionId: current.sessionId, revision, round: 2, phase: 'running' },
      key,
      true
    );
    await vote(three[2], 'left', undefined, 409);
    assert.equal((await sync()).awards.length, 0, 'Votes cannot carry across rounds');
    time += 120000;
    await sync();
    await request('/api/pair', { code: current.code, name: 'Expired' }, null, false, 403);
    const oldCode = current.code;
    current = await request('/api/desktop/rotate', { sessionId: current.sessionId }, key, true);
    assert.notEqual(current.code, oldCode);
    await pair('Replacement');
    await start(3);
    const retained = await pair('Retained');
    await approve(retained);
    await sync();
    await vote(retained);
    const pairingCode = current.code;
    async function setCount(count) {
      current = await request(
        '/api/desktop/judge-count',
        { sessionId: current.sessionId, judgeCount: count },
        key,
        true
      );
      assert.equal(current.code, pairingCode, 'Changing judge count keeps the same match code');
    }
    await setCount(1);
    assert.equal((await sync()).awards.length, 0, 'Changing policy clears partial votes');
    assert.equal((await request('/api/judge/state', undefined, retained.token)).approved, true);
    await request(
      '/api/judge/punch',
      {
        id: 'stale-rule-vote',
        side: 'left',
        round: 1,
        revision,
        sessionId: current.sessionId,
        policyRevision: 0
      },
      retained.token,
      false,
      409
    );
    await vote(retained);
    assert.equal((await sync()).awards.length, 1, 'One-judge rule takes effect immediately');
    await setCount(2);
    const extra = await pair('Extra');
    await approve(extra);
    await vote(extra);
    await vote(retained);
    assert.equal((await sync()).awards.length, 1, 'Two-judge rule combines votes after expanding');
    await setCount(1);
    await request('/api/judge/state', undefined, extra.token, false, 401);
    assert.equal((await request('/api/judge/state', undefined, retained.token)).count, 1);
    await request(
      '/api/desktop/judge-count',
      { sessionId: current.sessionId, judgeCount: 0 },
      key,
      true,
      400
    );
    await start(3);
    const seats = [await pair('First'), await pair('Second'), await pair('Third')];
    await approve(seats[2]);
    for (const judge of seats.slice(0, 2))
      await request(
        '/api/desktop/judge',
        { sessionId: current.sessionId, judgeId: judge.state.judgeId, action: 'remove' },
        key,
        true
      );
    current = await request(
      '/api/desktop/judge-count',
      { sessionId: current.sessionId, judgeCount: 1 },
      key,
      true
    );
    const reseated = await request('/api/judge/state', undefined, seats[2].token);
    assert.equal(
      reseated.seat,
      1,
      'Reducing count keeps an existing judge even when their old seat was higher'
    );
    assert.equal(reseated.approved, true);
    console.log(
      'Judge bridge passed: local desktop authentication, operator approval, all 1/2/3-judge rules, three-second windows, idempotency, phase/round isolation, stale-input rejection, code expiry and match-specific pairing.'
    );
  } finally {
    await bridge.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
