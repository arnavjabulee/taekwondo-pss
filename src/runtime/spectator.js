/* Read-only scoreboard transport. Only the competition panel owns a timer or receiver. */
(function (root) {
  'use strict';
  var channel = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2),
    controller = null,
    popup = null,
    heartbeat = null,
    viewers = [],
    last = null;
  function url() {
    return 'spectator.html?v=8&channel=' + encodeURIComponent(channel);
  }
  function origin() {
    return root.location.protocol + '//' + root.location.host;
  }
  function snapshot(view, connected) {
    if (view.session || (view.gvi && !view.gvi.game[0].competition))
      return trainingSnapshot(view, connected);
    if (!view.gvi) return testSnapshot(view, connected);
    var court = view.gvi.game[0],
      s = court.competition;
    if (!s) return null;
    var leading = root.PSS_COMPETITION
      ? root.PSS_COMPETITION.leaders(court)
      : {
          left: court.left.score >= court.right.score,
          right: court.right.score >= court.left.score
        };
    function side(key) {
      var slot = court[key];
      return {
        name: slot.gamer || (key === 'left' ? 'Blue' : 'Red'),
        score: slot.score,
        gamJeoms: slot.warning,
        wins: s.wins[key],
        leading: leading[key],
        weakHead: slot.weak_head || 0,
        weakBody: slot.weak_body || 0,
        lastWeak: slot.last_weak || null
      };
    }
    return {
      type: 'uobtkd-scoreboard',
      version: 1,
      channel: channel,
      sentAt: Date.now(),
      connected: connected,
      title: view.gameinfo.game_name || 'Competition',
      phase: s.phase,
      round: Math.min(s.rules.rounds, view.gvi.current_round),
      bestOf: s.rules.rounds,
      seconds: s.phase === 'break' || s.phase === 'break-paused' ? s.breakRemaining : s.remaining,
      blue: side('left'),
      red: side('right'),
      winner: s.winner,
      method: s.method,
      pendingDecision: !!s.pendingDecision,
      lastRound: s.results.length
        ? {
            round: s.results[s.results.length - 1].round,
            name: s.results[s.results.length - 1].name,
            winner: s.results[s.results.length - 1].winner,
            method: s.results[s.results.length - 1].method
          }
        : null,
      results: s.results.slice(-5).map(function (r) {
        return { round: r.round, winner: r.winner, method: r.method, blue: r.blue, red: r.red };
      })
    };
  }
  function trainingSnapshot(view, connected) {
    function person(slot) {
      return {
        name: slot.gamer || slot.name || '',
        score: slot.score || 0,
        head: slot.tkhits || slot.helmetHits || 0,
        body: slot.hjhits || slot.bodyHits || 0
      };
    }
    var free = !!view.session;
    return {
      type: 'uobtkd-scoreboard',
      version: 1,
      channel: channel,
      sentAt: Date.now(),
      connected: connected,
      mode: free ? 'free' : 'court',
      title: free ? 'Free Training' : 'Court Training',
      phase: free ? (view.active ? 'Tracking' : 'Paused') : view.gvi.game_msg,
      time: free ? '' : view.gvi.time_str,
      total: free ? view.session.groupScore() : 0,
      people: free ? view.session.participants.map(person) : [],
      courts: free
        ? []
        : view.gvi.game.slice(0, [1, 4, 8, 16][view.view_mode] || 1).map(function (court, index) {
            return { number: index + 1, blue: person(court.left), red: person(court.right) };
          })
    };
  }
  function testSnapshot(view, connected) {
    function person(side) {
      function device(key) {
        var check = view.checks[side][key],
          id = view[side][key];
        return {
          assigned: !!id,
          online: !!(id && root.PSS_EQUIPMENT && root.PSS_EQUIPMENT.registry.connected(id)),
          count: check.count,
          raw: check.raw,
          at: check.at || 0
        };
      }
      return { name: view[side].name || side, head: device('helmetId'), body: device('bodyId') };
    }
    return {
      type: 'uobtkd-scoreboard',
      version: 1,
      channel: channel,
      sentAt: Date.now(),
      connected: connected,
      mode: 'test',
      phase: 'testing',
      title: 'TEST MODE',
      testing: view.testing,
      receiverOnline: view.online,
      blue: person('blue'),
      red: person('red')
    };
  }
  function broadcast(data) {
    if (!data) return;
    last = data;
    try {
      root.localStorage.setItem('uobtkd_spectator_' + channel, JSON.stringify(data));
    } catch (error) {
      /* postMessage remains available if storage is unavailable. */
    }
    viewers = viewers.filter(function (view) {
      try {
        if (view.closed) return false;
        view.postMessage(data, origin());
        return true;
      } catch (error) {
        return false;
      }
    });
  }
  function publish(view) {
    if (controller === view) broadcast(snapshot(view, true));
  }
  function attach(view) {
    if (heartbeat) root.clearInterval(heartbeat);
    if (controller && controller._spectatorUnwatch) controller._spectatorUnwatch();
    controller = view;
    if (view.gvi && view.gvi.competitionTab === undefined)
      view.$set(view.gvi, 'competitionTab', 'panel');
    if (view.$watch && (view.session || (view.gvi && !view.gvi.game[0].competition)))
      view._spectatorUnwatch = view.$watch(
        function () {
          var data = snapshot(view, true);
          delete data.sentAt;
          return JSON.stringify(data);
        },
        function () {
          publish(view);
        }
      );
    publish(view);
    heartbeat = root.setInterval(function () {
      publish(view);
    }, 1000);
  }
  function detach(view) {
    if (controller !== view) return;
    if (heartbeat) root.clearInterval(heartbeat);
    if (view._spectatorUnwatch) view._spectatorUnwatch();
    view._spectatorUnwatch = null;
    heartbeat = null;
    broadcast(snapshot(view, false));
    controller = null;
  }
  function open(focus) {
    if (popup && !popup.closed) {
      if (focus === false) {
        if (controller) publish(controller);
        return;
      }
      popup.focus();
      popup.postMessage({ type: 'uobtkd-spectator-fullscreen', channel: channel }, origin());
      if (controller) publish(controller);
      return;
    }
    var screen = root.screen || {},
      width = screen.width || 1280,
      height = screen.height || 720;
    var native = typeof root.HostGetShellVer === 'function';
    popup = root.open(
      url() + '&fullscreen=1' + (native ? '&native=1' : ''),
      'uobtkd_spectator_' + channel,
      'popup=yes,fullscreen=yes,left=' +
        (screen.availLeft || 0) +
        ',top=' +
        (screen.availTop || 0) +
        ',width=' +
        width +
        ',height=' +
        height +
        ',resizable=yes,scrollbars=no'
    );
    if (popup) {
      viewers.push(popup);
      if (controller) publish(controller);
    } else if (root.UOBTKD_UI)
      root.UOBTKD_UI.notify(
        'The spectator window could not open. Allow pop-ups for this app, then try Open spectator window again.'
      );
  }
  function attachTesting(view) {
    attach(view);
    open(false);
  }
  function controls(view, h) {
    return h('div', { staticClass: 'pss-training-display-controls' }, [
      h('button', { attrs: { type: 'button' }, on: { click: open } }, [
        view._v('Open spectator window')
      ]),
      h('button', { attrs: { type: 'button' }, on: { click: close } }, [
        view._v('Close spectator window')
      ])
    ]);
  }
  function tabs(view, h, parent) {
    function tab(label, value) {
      return h(
        'button',
        {
          attrs: {
            type: 'button',
            role: 'tab',
            'aria-selected': parent.gvi.competitionTab === value
          },
          on: {
            click: function () {
              parent.gvi.competitionTab = value;
            }
          }
        },
        [view._v(label)]
      );
    }
    return h('div', { staticClass: 'pss-competition-display-tabs' }, [
      h('div', { attrs: { role: 'tablist', 'aria-label': 'Competition views' } }, [
        tab('Control panel', 'panel'),
        tab('Spectator display', 'spectator')
      ]),
      h('button', { attrs: { type: 'button' }, on: { click: open } }, [
        view._v('Open spectator window')
      ]),
      h('button', { attrs: { type: 'button' }, on: { click: close } }, [
        view._v('Close spectator window')
      ])
    ]);
  }
  function preview(view, h, parent) {
    return h('article', { staticClass: 'pss-spectator-preview' }, [
      tabs(view, h, parent),
      h('p', [
        view._v(
          'Open spectator window starts the display full screen. Use Windows + Shift + Left/Right to move it to the TV. Escape closes the detached display; the control panel stays open.'
        )
      ]),
      h('iframe', {
        attrs: {
          src: url(),
          title: 'Competition spectator scoreboard',
          'data-spectator-frame': '',
          allow: 'fullscreen',
          allowfullscreen: 'allowfullscreen'
        },
        staticClass: 'pss-spectator-frame'
      })
    ]);
  }
  if (root.addEventListener) {
    root.addEventListener('message', function (event) {
      if (
        event.origin === origin() &&
        event.data &&
        event.data.channel === channel &&
        event.data.type === 'uobtkd-spectator-closed' &&
        event.source === popup
      ) {
        viewers = viewers.filter(function (view) {
          return view !== popup;
        });
        popup = null;
        return;
      }
      if (
        event.origin !== origin() ||
        !event.source ||
        !event.data ||
        event.data.type !== 'uobtkd-spectator-ready' ||
        event.data.channel !== channel
      )
        return;
      if (viewers.indexOf(event.source) < 0) viewers.push(event.source);
      if (last) event.source.postMessage(last, origin());
    });
    root.addEventListener('beforeunload', function () {
      if (controller) detach(controller);
    });
  }
  function close() {
    if (!popup || popup.closed) return;
    popup.postMessage({ type: 'uobtkd-spectator-close', channel: channel }, origin());
  }
  var api = {
    attach: attach,
    detach: detach,
    publish: publish,
    open: open,
    close: close,
    url: url,
    tabs: tabs,
    controls: controls,
    preview: preview,
    snapshot: snapshot,
    attachTesting: attachTesting
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PSS_SPECTATOR = api;
})(typeof window !== 'undefined' ? window : globalThis);
