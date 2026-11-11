const assert = require('node:assert/strict'),
  guard = require('../src/runtime/connection.js');
let stopped = 0,
  cancelled = 0,
  notifications = [],
  requests = 0,
  sent = 0,
  broken = false;
global.clearTimeout = () => cancelled++;
global.clearInterval = () => cancelled++;
global.PSS_EQUIPMENT = {
  setOnline(value) {
    this.online = value;
  }
};
const store = { IS_ONLINE: false, IS_GAMING: true };
const client = {
  connected: false,
  subscribe() {
    if (broken) throw Error('modem gone');
    requests++;
  },
  publish() {
    if (broken) throw Error('modem gone');
    sent++;
  }
};
const host = {
  online: false,
  mqtt_client: client,
  clientid: 'test',
  timer_dev_huju: 1,
  timer_dev_toukui: 2,
  stopTimer() {
    stopped++;
  },
  online_cb: (value) => notifications.push(value),
  MqttRequestDeviceList() {
    this.mqtt_client.publish('DevQuery', 'DevQuery');
  },
  stop_devices() {
    this.mqtt_client.publish('body', 'StopWork');
  },
  sendMessage() {
    this.mqtt_client.publish('body', 'StartWork');
  },
  onAuthClientMessage() {
    throw Error('Truncated packet');
  }
};
guard.attach(host, store);
host.onClientState(false);
assert.equal(host.online, false);
assert.equal(stopped, 0);
assert.equal(cancelled, 0);
client.connected = true;
host.onClientState(true);
assert.equal(host.online, true);
assert.equal(store.IS_ONLINE, true);
assert.equal(global.PSS_EQUIPMENT.online, true);
assert.equal(requests, 3);
assert.equal(sent, 1);
host.sendMessage();
assert.equal(sent, 2);
client.connected = false;
broken = true;
host.onClientState(false);
assert.equal(store.IS_GAMING, false);
assert.equal(host.online, false);
assert.doesNotThrow(() => host.stop_devices());
assert.doesNotThrow(() => host.sendMessage());
assert.equal(sent, 2);
host.onClientState(false);
assert.deepEqual(notifications, [true, false]);
assert.doesNotThrow(() => host.onAuthClientMessage());
client.connected = true;
broken = false;
host.onClientState(true);
assert.equal(host.online, true);
assert.equal(requests, 6);
assert.deepEqual(notifications, [true, false, true]);
broken = true;
assert.doesNotThrow(() => host.sendMessage());
assert.equal(host.online, false);
assert.equal(store.IS_ONLINE, false);
const view = {
  $parent: host,
  handleOnlineState() {},
  handleDevData() {},
  handleDevState() {},
  handleVkSpace() {}
};
host.online_cb = view.handleOnlineState;
host.devdata_cb = view.handleDevData;
guard.detachController(view);
assert.equal(host.online_cb, null);
assert.equal(host.devdata_cb, null);
console.log(
  'Connection checks passed: truthful status, offline send suppression, safe transport failures, timer cancellation, reconnect and stale callback cleanup.'
);
const courtView = { ...view, gvi: { game_state: 2, game: [] }, time: 17.25, SendGameData() {} };
guard.attachController(courtView);
const stopsBeforeOfflineStart = stopped;
host.onClientState(false);
assert.equal(courtView.gvi.game_state, 2);
assert.equal(stopped, stopsBeforeOfflineStart);
client.connected = true;
broken = false;
host.onClientState(true);
client.connected = false;
host.onClientState(false);
assert.equal(courtView.gvi.game_state, 3);
assert.equal(courtView.time, 17.25);
