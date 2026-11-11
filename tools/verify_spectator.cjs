const assert = require('node:assert/strict');
const core = require('../src/runtime/core.js'),
  engine = require('../src/runtime/competition.js');
const listeners = {},
  storage = new Map(),
  messages = [];
let cleared = false,
  interval = null,
  opens = 0;
global.location = { protocol: 'http:', host: 'localhost:12800' };
global.screen = { width: 2560, height: 1440, availLeft: 1920, availTop: 0 };
global.HostGetShellVer = function () {
  return '2.02';
};
global.localStorage = { setItem: (k, v) => storage.set(k, v) };
global.addEventListener = (key, fn) => (listeners[key] = fn);
const realSet = global.setInterval,
  realClear = global.clearInterval;
global.setInterval = (fn) => {
  interval = fn;
  return 1;
};
global.clearInterval = () => {
  cleared = true;
};
const popup = {
  closed: false,
  postMessage: (data, origin) => messages.push({ data, origin }),
  focus() {}
};
global.open = (url, name, features) => {
  assert.match(url, /fullscreen=1&native=1/);
  assert.match(features, /fullscreen=yes/);
  assert.match(features, /left=1920,top=0,width=2560,height=1440/);
  opens++;
  return popup;
};
try {
  const api = require('../src/runtime/spectator.js');
  const court = {
    matchName: 'Quarter final',
    left: {
      ...core.emptyParticipant(),
      gamer: 'Blue name',
      score: 13,
      warning: 2,
      huju: 'private ID'
    },
    right: { ...core.emptyParticipant(), gamer: 'Red name', score: 4, warning: 0 },
    competition: engine.fresh({ game_rounds: 5 })
  };
  court.competition.phase = 'paused';
  court.competition.remaining = 82;
  const c = {
    gvi: { game: [court], current_round: 2 },
    gameinfo: { game_name: 'Practice match', MQTT_PASSWORD: 'never expose' },
    $set: (o, k, v) => (o[k] = v)
  };
  api.attach(c);
  assert.equal(c.gvi.competitionTab, 'panel');
  assert.equal(storage.size, 1);
  api.open();
  api.open();
  assert.equal(opens, 1);
  const snap = messages.at(-1).data;
  assert.equal(snap.seconds, 82);
  assert.equal(snap.title, 'Quarter final');
  assert.equal(snap.blue.score, 13);
  assert.equal(snap.blue.gamJeoms, 2);
  assert(!JSON.stringify(snap).includes('private ID'));
  assert(!JSON.stringify(snap).includes('never expose'));
  const initial = messages.length;
  listeners.message({
    origin: 'https://different.invalid',
    source: popup,
    data: { type: 'uobtkd-spectator-ready', channel: snap.channel }
  });
  assert.equal(messages.length, initial);
  listeners.message({
    origin: 'http://localhost:12800',
    source: popup,
    data: { type: 'uobtkd-spectator-ready', channel: 'wrong' }
  });
  assert.equal(messages.length, initial);
  listeners.message({
    origin: 'http://localhost:12800',
    source: popup,
    data: { type: 'uobtkd-spectator-ready', channel: snap.channel }
  });
  assert.equal(messages.length, initial + 1);
  court.right.score = 6;
  api.publish(c);
  assert.equal(messages.at(-1).data.red.score, 6);
  interval();
  assert.equal(messages.at(-1).data.connected, true);
  api.detach(c);
  assert(cleared);
  assert.equal(messages.at(-1).data.connected, false);
  const testView = {
    blue: { name: 'Blue tester', bodyId: 'private ID', helmetId: '' },
    red: { name: 'Red tester', bodyId: '', helmetId: '' },
    online: true,
    testing: true,
    checks: {
      blue: { bodyId: { count: 2, raw: 320, at: Date.now() }, helmetId: { count: 0, raw: null } },
      red: { bodyId: { count: 0, raw: null }, helmetId: { count: 0, raw: null } }
    }
  };
  const testData = api.snapshot(testView, true);
  assert.equal(testData.mode, 'test');
  assert.equal(testData.blue.body.count, 2);
  assert.equal(testData.blue.body.raw, 320);
  assert(!JSON.stringify(testData).includes('private ID'));
  assert.equal(snap.blue.leading, true, 'Paused leader remains lit');
  const training = {
    ...c,
    view_mode: 3,
    gvi: {
      game: Array.from({ length: 16 }, () => ({ left: court.left, right: court.right })),
      time_str: '01:30',
      game_msg: 'Paused'
    }
  };
  const courts = api.snapshot(training, true);
  assert.equal(courts.mode, 'court');
  assert.equal(courts.courts.length, 16);
  assert.equal(courts.courts[0].blue.score, 13);
  assert(!JSON.stringify(courts).includes('private ID'));
  const free = api.snapshot(
    {
      session: {
        participants: [
          { name: 'Riley', score: 2, bodyHits: 2, helmetHits: 0, bodyId: 'private ID' }
        ],
        groupScore: () => 2
      },
      active: true
    },
    true
  );
  assert.equal(free.mode, 'free');
  assert.equal(free.total, 2);
  assert.equal(free.people[0].body, 2);
  assert(!JSON.stringify(free).includes('private ID'));
  console.log(
    'Spectator transport passed: scoped channels, read-only snapshots, live updates, popup reuse, heartbeat, origin checks, private data exclusion and disconnect cleanup.'
  );
} finally {
  global.setInterval = realSet;
  global.clearInterval = realClear;
}
