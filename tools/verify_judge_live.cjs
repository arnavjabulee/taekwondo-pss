const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const { createBridge } = require('../services/judge-bridge/server.cjs');
async function main() {
  const origin = 'http://127.0.0.1:10808';
  const bridge = createBridge({ now: () => 10000, desktopOrigins: [origin] });
  await new Promise((resolve) => bridge.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + bridge.server.address().port;
  const clients = [];
  async function http(path, data, key) {
    const response = await fetch(base + path, {
      method: data === null ? 'GET' : 'POST',
      headers: {
        Origin: key === undefined ? base : origin,
        ...(key ? { Authorization: 'Bearer ' + key } : {}),
        'Content-Type': 'application/json'
      },
      ...(data === null ? {} : { body: JSON.stringify(data) })
    });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  }
  async function connect(role, token, sessionId, customOrigin) {
    const ws = new WebSocket(base.replace('http', 'ws') + '/live/' + role, {
      origin: customOrigin || (role === 'desktop' ? origin : base)
    });
    clients.push(ws);
    const inbox = [],
      waiters = [];
    ws.on('message', (raw) => {
      const message = JSON.parse(raw);
      const index = waiters.findIndex((w) => w.match(message));
      if (index >= 0) {
        const waiter = waiters.splice(index, 1)[0];
        clearTimeout(waiter.timeout);
        waiter.resolve(message);
      } else inbox.push(message);
    });
    const next = (match) =>
      new Promise((resolve, reject) => {
        const index = inbox.findIndex(match);
        if (index >= 0) return resolve(inbox.splice(index, 1)[0]);
        const waiter = {
          match,
          resolve,
          timeout: setTimeout(() => reject(new Error('Expected socket event not received')), 2000)
        };
        waiters.push(waiter);
      });
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    ws.send(JSON.stringify({ type: 'auth', token, sessionId }));
    let id = 0;
    return {
      ws,
      next,
      async rpc(path, data) {
        const requestId = 'test-' + ++id;
        const response = next((m) => m.type === 'response' && m.id === requestId);
        ws.send(JSON.stringify({ type: 'request', id: requestId, path, data }));
        return response;
      }
    };
  }
  try {
    const key = (await http('/api/desktop/bootstrap', null, '')).key;
    const session = await http(
      '/api/desktop/session',
      { matchKey: 'live-test', judgeCount: 1 },
      key
    );
    const desktop = await connect('desktop', key, session.sessionId);
    await desktop.next((m) => m.type === 'state');
    const sync = {
      sessionId: session.sessionId,
      revision: 1,
      round: 1,
      phase: 'running',
      blue: 'Blue',
      red: 'Red'
    };
    assert.equal((await desktop.rpc('/api/desktop/sync', sync)).status, 200);
    const pairing = await http('/api/pair', { code: session.code, name: 'Live judge' });
    const phone = await connect('judge', pairing.token);
    await phone.next((m) => m.type === 'state' && !m.data.approved);
    await http(
      '/api/desktop/judge',
      { sessionId: session.sessionId, judgeId: pairing.state.judgeId, action: 'approve' },
      key
    );
    await phone.next((m) => m.type === 'state' && m.data.approved);
    const vote = {
      sessionId: session.sessionId,
      revision: 1,
      round: 1,
      side: 'left',
      id: 'live-punch-1'
    };
    assert.equal((await phone.rpc('/api/judge/punch', vote)).status, 200);
    const pushed = await desktop.next((m) => m.type === 'state' && m.data.awards.length === 1);
    assert.equal(
      pushed.data.awards[0].side,
      'left',
      'Point pushes to desktop without another sync request'
    );
    await desktop.rpc('/api/desktop/sync', {
      ...sync,
      acks: [{ id: pushed.data.awards[0].id, accepted: true }]
    });
    await phone.next((m) => m.type === 'state' && m.data.feedback?.status === 'awarded');
    await phone.rpc('/api/judge/punch', vote);
    assert.equal(
      (await desktop.rpc('/api/desktop/sync', sync)).data.awards.length,
      0,
      'Retries do not duplicate points'
    );
    await desktop.rpc('/api/desktop/sync', { ...sync, phase: 'paused', revision: 2 });
    await phone.next((m) => m.type === 'state' && m.data.phase === 'paused');
    assert.equal(
      (await phone.rpc('/api/judge/punch', { ...vote, id: 'paused-punch' })).status,
      409
    );
    await desktop.rpc('/api/desktop/sync', { ...sync, revision: 3 });
    await phone.next(
      (m) => m.type === 'state' && m.data.revision === 3 && m.data.phase === 'running'
    );
    desktop.ws.terminate();
    await phone.next((m) => m.type === 'state' && !m.data.desktopOnline);
    assert.equal(
      (await phone.rpc('/api/judge/punch', { ...vote, revision: 3, id: 'offline-punch' })).status,
      409
    );
    const restored = await connect('desktop', key, session.sessionId);
    assert.equal(
      (await restored.rpc('/api/desktop/sync', { ...sync, revision: 4 })).data.awards.length,
      0
    );
    const revoked = new Promise((resolve) => phone.ws.once('close', resolve));
    await http('/api/desktop/session', { matchKey: 'fresh-match', judgeCount: 1 }, key);
    assert.equal(await revoked, 1008);
    await assert.rejects(connect('desktop', key, session.sessionId, 'http://evil.example'), /403/);
    const invalid = await connect('judge', 'invalid-token');
    assert.equal(await new Promise((resolve) => invalid.ws.once('close', resolve)), 1008);
    console.log(
      'Live judging passed: immediate push/ack, duplicate rejection, pause, desktop disconnect/reconnect, match revocation and socket authentication.'
    );
  } finally {
    for (const ws of clients) ws.terminate();
    await bridge.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
