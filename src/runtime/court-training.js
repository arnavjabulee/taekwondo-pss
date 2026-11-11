/* Continuous training intervals, independent of competition rounds/results. */
(function (root) {
  'use strict';
  var core =
    typeof module !== 'undefined' && module.exports ? require('./core.js') : root.UOBTKD_CORE;
  function timings(info) {
    function valid(key, fallback, min, max) {
      var value = Number(info && info[key]);
      return isFinite(value) && value === Math.floor(value) && value >= min && value <= max
        ? value
        : fallback;
    }
    return { duration: valid('game_time', 120, 1, 36000), rest: valid('rest_time', 60, 0, 3600) };
  }
  function clock(value) {
    value = Math.ceil(Math.max(0, value));
    var minutes = String(Math.floor(value / 60));
    return (minutes.length < 2 ? '0' + minutes : minutes) + ':' + ('0' + (value % 60)).slice(-2);
  }
  function attach(view, store) {
    if (root.PSS_MODES.isCompetition() || view._courtTraining) return;
    var host = view.$parent;
    function read() {
      return timings((store.ReadGameInfo && store.ReadGameInfo()) || store.GAMEINFO);
    }
    var session = (view._courtTraining = { phase: 'ready', rules: read(), remaining: 0 });
    session.remaining = session.rules.duration;
    function publish() {
      var phase = session.phase;
      view.time = session.remaining;
      view.gvi.rest_time = phase === 'break' || phase === 'break-paused' ? session.remaining : 0;
      view.gvi.time_str = clock(session.remaining);
      view.gvi.time_show = true;
      view.gvi.winner = '';
      view.gvi.current_round = 1; // Compatibility field; no round count or series is used.
      view.gvi.game_state =
        phase === 'running'
          ? 2
          : phase === 'break'
            ? 5
            : phase === 'paused' || phase === 'break-paused'
              ? 3
              : 1;
      view.gvi.game_msg = {
        ready: 'Ready',
        running: 'Training',
        break: 'Break',
        paused: 'Paused',
        'break-paused': 'Break paused'
      }[phase];
      view.control_str =
        phase === 'running' || phase === 'break' ? 'Pause' : phase === 'ready' ? 'Start' : 'Resume';
      view.SendGameData();
      if (root.PSS_SPECTATOR) root.PSS_SPECTATOR.publish(view);
    }
    function cue(name) {
      if (root.PSS_AUDIO) root.PSS_AUDIO.event(name);
    }
    function transport() {
      view._courtTickAt = Date.now();
      if (session.phase === 'running') host.startGame(view._courtTick);
      else host.startTimer(view._courtTick);
    }
    function begin() {
      view.gvi.game.forEach(function (court, index) {
        ['left', 'right'].forEach(function (side) {
          core.PARTICIPANT_COUNTERS.forEach(function (key) {
            court[side][key] = 0;
          });
          court[side].last_hit = null;
          court[side].last_weak = null;
        });
        if (store.SaveChangdiData) store.SaveChangdiData(index, court);
      });
      session.rules = read();
      session.remaining = session.rules.duration;
      session.phase = 'running';
      transport();
      cue('roundStart');
    }
    function pause() {
      if (session.phase !== 'running' && session.phase !== 'break') return;
      host.stopGame();
      session.phase = session.phase === 'running' ? 'paused' : 'break-paused';
      publish();
    }
    function tick(elapsed) {
      if (session.phase !== 'running' && session.phase !== 'break') return;
      session.remaining = Math.max(0, session.remaining - elapsed);
      if (!session.remaining) {
        if (session.phase === 'running') {
          host.stopGame();
          cue('roundEnd');
          if (session.rules.rest) {
            session.phase = 'break';
            session.remaining = session.rules.rest;
            transport();
          } else begin();
        } else {
          host.stopTimer();
          cue('breakEnd');
          begin();
        }
      }
      publish();
    }
    view._courtTick = function () {
      var now = Date.now(),
        elapsed = Math.max(0, now - view._courtTickAt) / 1000;
      view._courtTickAt = now;
      tick(elapsed);
    };
    view.timer_callback = function () {
      tick(1);
    };
    view.gameControl = function () {
      if (session.phase === 'running' || session.phase === 'break') return pause();
      if (!root.UOBTKD_CONTROLLER_FIXES.canStart(view)) return;
      if (session.phase === 'ready') begin();
      else {
        session.phase = session.phase === 'paused' ? 'running' : 'break';
        transport();
      }
      publish();
    };
    view.gameStop = pause;
    view.CheckRoundOver = function () {
      return false;
    };
    view.handleVkSpace = function () {
      if (!root.UOBTKD_CONTROLLER_FIXES.ignoreSpaceShortcut()) view.gameControl();
    };
    host.vkspace_cb = view.handleVkSpace;
    var online = view.handleOnlineState;
    view.handleOnlineState = function (value) {
      if (online) online.call(view, value);
      if (!view.gvi.online) pause();
    };
    host.online_cb = view.handleOnlineState;
    var setup = view.gameSetup,
      confirmSetup = view.SetupConfirm;
    view.gameSetup = function () {
      if (setup) setup.call(view);
      publish(); // The settings dialog does not interrupt the current interval.
    };
    view.SetupConfirm = function () {
      var rounds = view.gameinfo.game_rounds;
      if (confirmSetup) confirmSetup.call(view);
      if (view.gameinfo.game_rounds !== rounds) {
        view.gameinfo.game_rounds = rounds;
        if (view.SaveGameInfo) view.SaveGameInfo();
      }
      if (session.phase === 'ready') {
        session.rules = read();
        session.remaining = session.rules.duration;
      }
      publish(); // Saved durations are sampled only when the next interval begins.
    };
    publish();
  }
  function renderSettings(view, h) {
    function field(key, label, min, max) {
      return h('label', { staticClass: 'pss-settings-field' }, [
        h('span', [view._v(label)]),
        h('input', {
          attrs: {
            type: key === 'game_name' ? 'text' : 'number',
            'aria-label': label,
            min: min,
            max: max,
            step: 1,
            maxlength: 80
          },
          domProps: { value: view.gameinfo[key] },
          on: {
            input: function (event) {
              if (key === 'game_name') view.$set(view.gameinfo, key, event.target.value);
            },
            change: function (event) {
              var value = key === 'game_name' ? event.target.value : Number(event.target.value);
              if (
                key !== 'game_name' &&
                (!event.target.value.trim() ||
                  !isFinite(value) ||
                  value !== Math.floor(value) ||
                  value < min ||
                  value > max)
              ) {
                event.target.value = view.gameinfo[key];
                root.UOBTKD_UI.notify('Enter a whole number between ' + min + ' and ' + max + '.');
                return;
              }
              view.$set(view.gameinfo, key, value);
            }
          }
        })
      ]);
    }
    return h('section', [
      h('h2', [view._v('Court Training settings')]),
      field('game_name', 'Team Name'),
      field('game_time', 'Training duration in seconds (1–36000)', 1, 36000),
      field('rest_time', 'Break duration in seconds (0–3600)', 0, 3600),
      h('p', [
        view._v(
          'Training and breaks repeat continuously. Saved times apply from the next training interval; the current interval and break keep their existing times.'
        )
      ]),
      h('div', [
        h(
          'button',
          {
            attrs: { type: 'button' },
            on: {
              click: function () {
                view.ConfirmCancel();
              }
            }
          },
          [view._v('Cancel')]
        ),
        h(
          'button',
          {
            attrs: { type: 'button' },
            on: {
              click: function () {
                view.SetupConfirm();
              }
            }
          },
          [view._v('Save Settings')]
        )
      ])
    ]);
  }
  var api = { attach: attach, timings: timings, renderSettings: renderSettings };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PSS_COURT_TRAINING = api;
})(typeof window !== 'undefined' ? window : globalThis);
