/* Receiver state comes from MQTT, not the shell's network-address polling. */
(function (root) {
  'use strict';
  function attach(host, store) {
    if (host._receiverGuard) return;
    host._receiverGuard = true;
    function error(value) {
      host._receiverError = String((value && value.message) || 'Receiver connection unavailable');
    }
    function guardClient() {
      var client = host.mqtt_client;
      if (!client || client._pssGuarded) return;
      client._pssGuarded = true;
      ['publish', 'subscribe'].forEach(function (name) {
        var original = client[name];
        if (typeof original !== 'function') return;
        client[name] = function () {
          if (!store.IS_ONLINE || client.connected === false || client.disconnecting) return false;
          try {
            return original.apply(client, arguments);
          } catch (e) {
            error(e);
            state(false);
            return false;
          }
        };
      });
    }
    function state(value) {
      var online = !!value && (!host.mqtt_client || host.mqtt_client.connected !== false),
        changed = !!store.IS_ONLINE !== online;
      store.IS_ONLINE = online;
      host.online = online;
      if (root.PSS_EQUIPMENT) root.PSS_EQUIPMENT.setOnline(online);
      guardClient();
      if (!online) {
        host.stopTimer();
        store.IS_GAMING = false;
        ['timer_dev_huju', 'timer_dev_toukui'].forEach(function (key) {
          if (host[key]) {
            root.clearTimeout(host[key]);
            root.clearInterval(host[key]);
            host[key] = null;
          }
        });
      }
      if (online && changed && host.mqtt_client) {
        try {
          host.mqtt_client.subscribe(host.clientid);
          host.mqtt_client.subscribe('DevState');
          host.mqtt_client.subscribe('DevData', { qos: 1 });
          host.MqttRequestDeviceList();
        } catch (e) {
          error(e);
          state(false);
          return;
        }
      }
      if (online && !store.IS_ONLINE) return;
      if (changed && typeof host.online_cb === 'function') {
        try {
          host.online_cb(online);
        } catch (e) {
          error(e);
        }
      }
      var view = host._receiverController;
      if (
        !online &&
        view &&
        !view._isDestroyed &&
        !view._isBeingDestroyed &&
        view.gvi.game_state === 2
      ) {
        view.gvi.game_state = 3;
        view.gvi.game_msg = 'Pause — receiver disconnected';
        view.control_str = 'Resume';
        try {
          if (store.SaveChangdiData)
            view.gvi.game.forEach(function (court, i) {
              store.SaveChangdiData(i, court);
            });
          view.SendGameData();
        } catch (e) {
          error(e);
        }
      }
    }
    host.onClientState = state;
    host.onClose = function () {
      state(false);
    };
    [
      'sendMessage',
      'start_devices',
      'stop_devices',
      'query_battery_info_devices',
      'query_battery_info',
      'DevicePowerDown',
      'MqttRequestDeviceList'
    ].forEach(function (name) {
      var original = host[name];
      if (typeof original !== 'function') return;
      host[name] = function () {
        guardClient();
        if (!store.IS_ONLINE) return false;
        try {
          return original.apply(host, arguments);
        } catch (e) {
          error(e);
          state(false);
          return false;
        }
      };
    });
    var receive = host.onAuthClientMessage;
    if (receive)
      host.onAuthClientMessage = function () {
        try {
          return receive.apply(host, arguments);
        } catch (e) {
          error(e);
        }
      };
    // Old native shells may still invoke this while an update is staged.
    root.OnConnectEvent = function () {};
    host.online = !!store.IS_ONLINE;
    guardClient();
  }
  function detachController(view) {
    var host = view.$parent;
    if (host._receiverController === view) host._receiverController = null;
    [
      ['online_cb', 'handleOnlineState'],
      ['devdata_cb', 'handleDevData'],
      ['devstate_cb', 'handleDevState'],
      ['vkspace_cb', 'handleVkSpace']
    ].forEach(function (pair) {
      if (host[pair[0]] === view[pair[1]]) host[pair[0]] = null;
    });
  }
  var api = {
    attach: attach,
    attachController: function (view) {
      view.$parent._receiverController = view;
    },
    detachController: detachController
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PSS_CONNECTION = api;
})(typeof window !== 'undefined' ? window : globalThis);
