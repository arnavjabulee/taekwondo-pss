/* ES5 desktop adapter. The competition controller remains the scoring authority. */
(function (root) {
  'use strict';
  var endpoint = 'http://127.0.0.1:8976',
    key = '',
    controller = null,
    store = null;
  var timer = null,
    busy = false,
    generation = 0,
    observedState = null,
    signature = '',
    acks = [],
    applying = false;
  var socket = null,
    calls = {},
    callId = 0;
  var matchHandoff = null;
  function stopLive() {
    var old = socket;
    socket = null;
    if (old) old.close();
    Object.keys(calls).forEach(function (id) {
      calls[id]({ status: 0, message: 'Live judge connection interrupted.' });
    });
  }
  function connectLive(s, ui) {
    if (socket) return;
    var current = generation,
      ws = new root.WebSocket(endpoint.replace(/^http/, 'ws') + '/live/desktop');
    socket = ws;
    ws.onopen = function () {
      if (socket !== ws) return;
      ws.send(JSON.stringify({ type: 'auth', token: key, sessionId: ui.sessionId }));
      pump();
    };
    ws.onmessage = function (event) {
      if (socket !== ws || current !== generation || state() !== s) return;
      var message;
      try {
        message = JSON.parse(event.data);
      } catch (error) {
        ws.close();
        return;
      }
      if (message.type === 'response' && calls[message.id])
        calls[message.id](
          message.status === 200 ? null : { status: message.status, message: message.data.error },
          message.data
        );
      else if (message.type === 'state') {
        receive(s, ui, message.data);
        if (acks.length) pump();
      }
    };
    ws.onerror = function () {
      ws.close();
    };
    ws.onclose = function () {
      if (socket !== ws) return;
      stopLive();
      ui.status = 'Disconnected';
      ui.error = 'Live judge connection lost. Reconnecting; disconnected inputs are not queued.';
    };
  }
  function state() {
    return controller && (controller.judgeSetupState || root.PSS_COMPETITION.state(controller));
  }
  function makeKey() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }
  function ensure(s, previous) {
    if (!s.judgeLink)
      controller.$set(s, 'judgeLink', {
        enabled: !!(previous && previous.enabled),
        open: false,
        count: previous ? previous.count : 3,
        matchKey: '',
        sessionId: '',
        code: '',
        expires: 0,
        seconds: 0,
        urls: [],
        judges: [],
        status: 'Not connected',
        error: '',
        revision: 0
      });
    if (!s.judgeAwardIds) controller.$set(s, 'judgeAwardIds', []);
    if (!s.judgeLink.network)
      controller.$set(s.judgeLink, 'network', { state: 'unchecked', busy: false, message: '' });
    if (s.judgeLink.qrAddress === undefined) controller.$set(s.judgeLink, 'qrAddress', '');
    if (s.judgeLink.policyRevision === undefined) controller.$set(s.judgeLink, 'policyRevision', 0);
    if (s.judgeLink.changingCount === undefined)
      controller.$set(s.judgeLink, 'changingCount', false);
    return s.judgeLink;
  }
  function request(path, data, callback) {
    if (path === '/api/desktop/sync' && socket && socket.readyState === 1) {
      var id = 'desktop-' + ++callId,
        timeout;
      calls[id] = function (error, value) {
        if (!calls[id]) return;
        delete calls[id];
        root.clearTimeout(timeout);
        callback(error, value);
      };
      timeout = root.setTimeout(function () {
        if (calls[id]) calls[id]({ status: 0, message: 'Live judge connection timed out.' });
        if (socket) socket.close();
      }, 1500);
      socket.send(JSON.stringify({ type: 'request', id: id, path: path, data: data }));
      return;
    }
    var xhr = new root.XMLHttpRequest();
    xhr.open(data === null ? 'GET' : 'POST', endpoint + path, true);
    xhr.timeout =
      path === '/api/desktop/network'
        ? data === null
          ? 18000
          : 130000
        : path === '/api/desktop/replay/open'
          ? 15000
          : 1500;
    if (key) xhr.setRequestHeader('Authorization', 'Bearer ' + key);
    if (data !== null) xhr.setRequestHeader('Content-Type', 'application/json');
    var completed = false;
    function done(error, value) {
      if (!completed) {
        completed = true;
        callback(error, value);
      }
    }
    xhr.onload = function () {
      var result;
      try {
        result = JSON.parse(xhr.responseText);
      } catch (error) {
        done({ status: xhr.status, message: 'Invalid judge bridge response.' });
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300)
        done({ status: xhr.status, message: result.error || 'Judge bridge request failed.' });
      else done(null, result);
    };
    xhr.onerror = xhr.ontimeout = function () {
      done({ status: 0, message: 'Judge bridge unavailable. Open the app using Start.cmd.' });
    };
    xhr.send(data === null ? null : JSON.stringify(data));
  }
  function update(ui, data) {
    if (ui.sessionId === data.sessionId && (data.policyRevision || 0) < ui.policyRevision)
      return false;
    ui.sessionId = data.sessionId;
    ui.code = data.code;
    ui.expires = data.codeExpires;
    ui.seconds = Math.max(0, Math.ceil((data.codeExpires - Date.now()) / 1000));
    ui.urls = data.urls || [];
    ui.judges = data.judges || [];
    ui.count = data.judgeCount;
    ui.policyRevision = data.policyRevision || 0;
    ui.status = 'Connected';
    ui.error = '';
    return true;
  }
  function network(ui, enable) {
    if (ui.network.busy) return;
    ui.network.busy = true;
    ui.network.message = enable
      ? 'Approve the Windows permission prompt to enable phone connections.'
      : 'Checking network permissions…';
    request('/api/desktop/network', enable ? {} : null, function (error, result) {
      ui.network.busy = false;
      ui.network.state = error ? 'error' : result.state;
      ui.network.message = error ? error.message : result.message;
    });
  }
  function observe(s, ui) {
    var next = s.phase + ':' + controller.gvi.current_round + ':' + !!s.ivrPending;
    if (next !== signature) {
      signature = next;
      ui.revision++;
      return true;
    }
    return false;
  }
  function begin() {
    var s = state();
    if (!s) return;
    var ui = ensure(s),
      current = ++generation;
    stopLive();
    ui.enabled = true;
    ui.changingCount = false;
    ui.status = 'Connecting';
    ui.error = '';
    ui.sessionId = '';
    if (!ui.matchKey) ui.matchKey = makeKey();
    busy = true;
    acks = [];
    signature = '';
    function create(error, data) {
      if (current !== generation || !controller) return;
      if (error) {
        busy = false;
        ui.status = 'Unavailable';
        ui.error = error.message;
        return;
      }
      if (data && data.key) key = data.key;
      request(
        '/api/desktop/session',
        { matchKey: ui.matchKey, judgeCount: ui.count },
        function (err, result) {
          if (current !== generation || !controller) return;
          busy = false;
          if (err) {
            ui.status = 'Unavailable';
            ui.error = err.message;
            if (err.status === 401) key = '';
            return;
          }
          update(ui, result);
          network(ui, false);
          ui.revision = Math.max(ui.revision || 0, result.revision || 0) + 1;
          pump();
        }
      );
    }
    if (key) create(null, null);
    else request('/api/desktop/bootstrap', null, create);
  }
  function payload(s, ui, sentAcks) {
    var court = controller.gvi.game[0];
    return {
      sessionId: ui.sessionId,
      phase: s.ivrPending ? 'paused' : s.phase,
      revision: ui.revision,
      round: controller.gvi.current_round,
      title: court.matchName || 'Competition',
      blue: court.left.gamer || 'Blue',
      red: court.right.gamer || 'Red',
      acks: sentAcks
    };
  }
  function pump() {
    var s = state();
    if (!s) return;
    if (observedState !== s) {
      var previous = observedState && observedState.judgeLink;
      observedState = s;
      ensure(s, previous);
      generation++;
      busy = false;
      signature = '';
      acks = [];
      if (s.judgeLink.enabled) {
        begin();
        return;
      }
    }
    var ui = ensure(s);
    observe(s, ui);
    if (applying || busy || !ui.enabled || !ui.sessionId) return;
    if (!socket || socket.readyState !== 1) {
      connectLive(s, ui);
      return;
    }
    busy = true;
    var current = generation,
      sentAcks = acks.splice(0, 100);
    request('/api/desktop/sync', payload(s, ui, sentAcks), function (error, result) {
      if (current !== generation || !controller || state() !== s) return;
      busy = false;
      if (error) {
        acks = sentAcks.concat(acks);
        ui.status = 'Disconnected';
        ui.error = error.message;
        if (error.status === 401) {
          key = '';
          begin();
        }
        if (error.status === 409) {
          ui.sessionId = '';
          ui.error = 'The bridge is serving a different match. Reconnect judges from this panel.';
        }
        return;
      }
      update(ui, result);
      receive(s, ui, result);
      if (acks.length) pump();
    });
  }
  function receive(s, ui, result) {
    if (!update(ui, result)) return;
    (result.awards || []).forEach(function (award) {
      observe(s, ui);
      var duplicate = s.judgeAwardIds.indexOf(award.id) >= 0;
      var valid =
        s.phase === 'running' &&
        !ui.changingCount &&
        (award.policyRevision || 0) === ui.policyRevision &&
        !s.ivrPending &&
        (award.side === 'left' || award.side === 'right') &&
        award.sessionId === ui.sessionId &&
        award.revision === ui.revision &&
        award.round === controller.gvi.current_round;
      var accepted = duplicate;
      if (!duplicate && valid) {
        s.judgeAwardIds.push(award.id);
        if (s.judgeAwardIds.length > 2048) s.judgeAwardIds.shift();
        applying = true;
        try {
          accepted = controller.adjustCompetitionScore(award.side, 1) !== false;
        } catch (error) {
          accepted = false;
          ui.error = 'Judge point could not be applied.';
        } finally {
          applying = false;
        }
        if (!accepted) s.judgeAwardIds.splice(s.judgeAwardIds.indexOf(award.id), 1);
      }
      acks.push({ id: award.id, accepted: accepted });
    });
  }
  function publish(view) {
    if (controller !== view) return;
    if (observedState !== state()) {
      pump();
      return;
    }
    var s = state(),
      ui = ensure(s);
    var changed = observe(s, ui);
    if (observedState !== s || changed) pump();
  }
  function detach(view) {
    if (controller !== view) return;
    var s = state(),
      ui = s && s.judgeLink;
    generation++;
    busy = false;
    stopLive();
    if (timer) root.clearInterval(timer);
    timer = null;
    if (ui && ui.enabled && ui.sessionId) {
      ui.revision++;
      var data = payload(s, ui, acks);
      data.phase = 'paused';
      request('/api/desktop/sync', data, function () {});
    }
    controller = null;
    store = null;
    observedState = null;
    signature = '';
    acks = [];
  }
  function attach(view, data) {
    var carried = controller && controller.judgeSetupState && state().judgeLink;
    if (controller && controller !== view) detach(controller);
    controller = view;
    store = data;
    observedState = state();
    if (carried && !controller.judgeSetupState)
      controller.$set(observedState, 'judgeLink', carried);
    signature = '';
    var ui = ensure(observedState);
    timer = root.setInterval(pump, 500);
    if (ui.enabled) begin();
  }
  function action(path, extra) {
    var s = state();
    if (!s) return;
    var ui = ensure(s),
      current = generation;
    request(
      path,
      Object.assign
        ? Object.assign({ sessionId: ui.sessionId }, extra || {})
        : {
            sessionId: ui.sessionId,
            judgeId: extra && extra.judgeId,
            action: extra && extra.action
          },
      function (error, result) {
        if (current !== generation || !controller) return;
        if (error) ui.error = error.message;
        else update(ui, result);
      }
    );
  }
  function disconnect() {
    var s = state();
    if (!s) return;
    var ui = ensure(s);
    if (ui.sessionId) request('/api/desktop/end', { sessionId: ui.sessionId }, function () {});
    generation++;
    busy = false;
    stopLive();
    ui.enabled = false;
    ui.sessionId = '';
    ui.matchKey = '';
    ui.code = '';
    ui.judges = [];
    ui.status = 'Not connected';
    ui.error = '';
  }
  function changeCount(count) {
    var s = state();
    if (!s) return;
    var ui = ensure(s),
      current = generation;
    if (count === ui.count || ui.changingCount) return;
    if (!ui.enabled) {
      ui.count = count;
      return;
    }
    if (!ui.sessionId) return;
    var removed = ui.judges
      .slice()
      .sort(function (a, b) {
        return a.seat - b.seat;
      })
      .slice(count);
    if (
      removed.length &&
      !root.confirm(
        'Changing to ' +
          count +
          ' corner judge' +
          (count === 1 ? '' : 's') +
          ' will disconnect ' +
          removed
            .map(function (j) {
              return j.name;
            })
            .join(', ') +
          '. Continue?'
      )
    ) {
      controller.$forceUpdate && controller.$forceUpdate();
      return;
    }
    ui.changingCount = true;
    request(
      '/api/desktop/judge-count',
      { sessionId: ui.sessionId, judgeCount: count },
      function (error, result) {
        if (generation !== current || !controller) return;
        ui.changingCount = false;
        if (error) ui.error = error.message;
        else update(ui, result);
      }
    );
  }
  function controls(view, h, host) {
    if (host !== controller || !state()) return view._e();
    var s = state(),
      ui = ensure(s);
    function text(value) {
      return view._v(String(value));
    }
    function button(label, fn, disabled) {
      return h('button', { attrs: { type: 'button', disabled: !!disabled }, on: { click: fn } }, [
        text(label)
      ]);
    }
    var ready = ui.enabled && !!ui.sessionId;
    return h('details', { staticClass: 'pss-judge-panel', attrs: { open: true } }, [
      h('summary', [text('Mobile judges · ' + ui.status)]),
      h('div', { staticClass: 'pss-judge-toolbar' }, [
        h('label', [
          text('Corner judges '),
          h(
            'select',
            {
              attrs: {
                'aria-label': 'Number of mobile judges',
                disabled: ui.changingCount || (ui.enabled && !ui.sessionId)
              },
              domProps: { value: ui.count },
              on: {
                change: function (event) {
                  var selected = Number(event.target.value);
                  event.target.value = String(ui.count);
                  changeCount(selected);
                }
              }
            },
            [1, 2, 3].map(function (n) {
              return h('option', { attrs: { value: n } }, [text(n)]);
            })
          )
        ]),
        button(ready ? 'Reconnect judges' : 'Connect mobile judges', begin),
        ready
          ? button('Refresh pairing code', function () {
              action('/api/desktop/rotate');
            })
          : view._e(),
        ui.enabled ? button('Disconnect all judges', disconnect) : view._e()
      ]),
      h('p', [
        text(
          ui.count === 1
            ? 'Every press awards one punch point.'
            : ui.count === 2
              ? 'Either judge scores. Same-side inputs within 3 seconds are combined.'
              : 'Two different judges must agree within 3 seconds.'
        )
      ]),
      ready
        ? h('div', { staticClass: 'pss-judge-network' }, [
            h('p', { attrs: { role: 'status', 'data-judge-network': '' } }, [
              text(ui.network.message)
            ]),
            ui.network.state !== 'ready'
              ? button(
                  ui.network.busy ? 'Setting up network…' : 'Enable phone connections',
                  function () {
                    network(ui, true);
                  },
                  ui.network.busy || s.phase === 'running'
                )
              : view._e(),
            button(
              'Check network access',
              function () {
                network(ui, false);
              },
              ui.network.busy
            ),
            ui.network.state !== 'ready'
              ? h('small', [
                  text(
                    'Windows approval is needed once. This permits only the judge service on your local network.'
                  )
                ])
              : view._e()
          ])
        : view._e(),
      ready
        ? h('div', { staticClass: 'pss-judge-pairing' }, [
            renderQr(view, h, ui),
            h('strong', { attrs: { 'data-judge-code': '' } }, [
              text(
                s.phase === 'finished' ? 'Match complete' : ui.seconds ? ui.code : 'Code expired'
              )
            ]),
            h('span', [
              text(
                'Enter this code on each phone. Approval is required. ' +
                  (ui.seconds
                    ? ui.seconds + 's remaining.'
                    : 'Refresh the code to pair another phone.')
              )
            ]),
            h(
              'div',
              ui.urls.length
                ? ui.urls.map(function (url) {
                    return h('input', {
                      attrs: { readonly: true, 'aria-label': 'Phone controller address' },
                      domProps: { value: url },
                      on: {
                        click: function (event) {
                          event.target.select();
                        }
                      }
                    });
                  })
                : [text('No LAN address detected. Connect the PC and phones to the same Wi-Fi.')]
            )
          ])
        : view._e(),
      ui.error
        ? h('p', { staticClass: 'pss-judge-error', attrs: { role: 'status' } }, [text(ui.error)])
        : view._e(),
      h(
        'div',
        ui.judges.map(function (judge) {
          return h('div', { staticClass: 'pss-judge-row' }, [
            h('span', [
              text(
                'Judge ' +
                  judge.seat +
                  ' · ' +
                  judge.name +
                  ' · ' +
                  (!judge.approved
                    ? 'Awaiting approval'
                    : judge.connected
                      ? 'Connected'
                      : 'Disconnected')
              )
            ]),
            !judge.approved
              ? button('Approve ' + judge.name, function () {
                  action('/api/desktop/judge', { judgeId: judge.id, action: 'approve' });
                })
              : view._e(),
            button('Remove ' + judge.name, function () {
              action('/api/desktop/judge', { judgeId: judge.id, action: 'remove' });
            })
          ]);
        })
      )
    ]);
  }
  var qrKey = '',
    qrMarkup = '';
  function renderQr(view, h, ui) {
    if (!root.qrcode || !ui.seconds || !ui.urls.length) return view._e();
    var address = ui.urls.indexOf(ui.qrAddress) >= 0 ? ui.qrAddress : ui.urls[0];
    var url =
      address +
      '/#code=' +
      encodeURIComponent(ui.code) +
      '&match=' +
      encodeURIComponent(ui.sessionId);
    if (url !== qrKey) {
      var qr = root.qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      qrMarkup = qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true });
      qrKey = url;
    }
    return h('div', { staticClass: 'pss-judge-qr' }, [
      h('div', {
        attrs: {
          role: 'img',
          'aria-label': 'Scan to connect a corner referee',
          'data-judge-qr-url': url
        },
        domProps: { innerHTML: qrMarkup }
      }),
      h('div', [
        h('strong', [view._v('Scan to connect')]),
        h('p', [
          view._v(
            'Open your phone camera, scan the QR code, enter your name and pair. The match code is filled in for you.'
          )
        ]),
        h('label', [
          view._v('Phone network address '),
          h(
            'select',
            {
              attrs: { 'aria-label': 'Phone network address' },
              domProps: { value: address },
              on: {
                change: function (event) {
                  ui.qrAddress = event.target.value;
                }
              }
            },
            ui.urls.map(function (value) {
              return h('option', { attrs: { value: value } }, [view._v(value)]);
            })
          )
        ])
      ])
    ]);
  }
  function cancelSetup() {
    if (controller && controller.judgeSetupState) {
      var host = controller;
      disconnect();
      detach(host);
    }
  }
  function openReplay() {
    request('/api/desktop/bootstrap', null, function (error, result) {
      if (error) {
        root.UOBTKD_UI.notify(error.message);
        return;
      }
      key = result.key;
      request('/api/desktop/replay/open', {}, function (problem) {
        if (problem) root.UOBTKD_UI.notify(problem.message);
      });
    });
  }
  function createSetupComponent(data) {
    return {
      name: 'CornerRefereeSetup',
      data: function () {
        return { judgeHost: null, returnToMatch: this.$route.query.returnToMatch === '1' };
      },
      mounted: function () {
        var view = this;
        var host =
          controller && controller.judgeSetupState
            ? controller
            : {
                judgeSetupState: { phase: 'ready', ivrPending: false },
                gvi: {
                  current_round: 1,
                  game: [
                    { matchName: 'Competition', left: { gamer: 'Blue' }, right: { gamer: 'Red' } }
                  ]
                },
                $set: function (target, key, value) {
                  view.$set(target, key, value);
                }
              };
        if (matchHandoff && this.returnToMatch) {
          host.judgeSetupState.judgeLink = matchHandoff.link;
          host.judgeSetupState.phase = 'paused';
          host.gvi.current_round = matchHandoff.round;
          host.gvi.game[0] = matchHandoff.court;
          matchHandoff = null;
        }
        this.judgeHost = host;
        if (controller !== host) attach(host, data);
      },
      beforeDestroy: function () {
        if (
          !this._continueToTest &&
          this.$route.name !== 'CompetitionSetup' &&
          this.$route.name !== 'GameCtrl' &&
          this.$route.name !== 'GameData'
        )
          cancelSetup();
      },
      render: function () {
        var view = this,
          h = view._self._c;
        return h('main', { staticClass: 'pss-referee-setup' }, [
          h('header', { staticClass: 'pss-free-header' }, [
            h('h1', [view._v('Competition · Corner referees')]),
            h('button', { attrs: { type: 'button' }, on: { click: openReplay } }, [
              view._v('Video replay')
            ]),
            h(
              'button',
              {
                attrs: { type: 'button' },
                on: {
                  click: function () {
                    view.$router.push({ name: 'Index' });
                  }
                }
              },
              [view._v('Home')]
            )
          ]),
          h('p', [
            view._v(
              view.returnToMatch
                ? 'Manage corner referees, then return to the match. Existing scores and pairings are preserved.'
                : 'Step 1 of 3 · Connect and approve corner referees, or continue without mobile judges.'
            )
          ]),
          view.judgeHost ? controls(view, h, view.judgeHost) : view._e(),
          h(
            'button',
            {
              staticClass: 'pss-referee-continue',
              attrs: { type: 'button' },
              on: {
                click: function () {
                  view._continueToTest = true;
                  view.$router.push(
                    view.returnToMatch
                      ? { name: 'GameCtrl', query: { mode: 'competition' } }
                      : { name: 'CompetitionSetup' }
                  );
                }
              }
            },
            [view._v(view.returnToMatch ? 'Return to match' : 'Continue to protector test')]
          )
        ]);
      }
    };
  }
  root.PSS_JUDGES = {
    openReplay: openReplay,
    renderReplayButton: function (view, h) {
      if (!root.PSS_MODES.isCompetition()) return view._e();
      return h(
        'button',
        {
          staticClass: 'btn btn-md ctrl_btn',
          style: { float: 'right', fontSize: '2vh', marginTop: '2.5vh' },
          attrs: { type: 'button' },
          on: { click: openReplay }
        },
        [view._v('Video replay')]
      );
    },
    prepareMatchReturn: function (view) {
      var s = root.PSS_COMPETITION.state(view);
      matchHandoff = {
        link: ensure(s),
        round: view.gvi.current_round,
        court: JSON.parse(JSON.stringify(view.gvi.game[0]))
      };
    },
    renderMatchButton: function (view, h) {
      if (!root.PSS_MODES.isCompetition()) return view._e();
      return h(
        'button',
        {
          staticClass: 'btn btn-md ctrl_btn',
          style: { float: 'right', fontSize: '2vh', marginTop: '2.5vh' },
          attrs: { type: 'button' },
          on: {
            click: function () {
              view.$router.push({ name: 'CompetitionJudges', query: { returnToMatch: '1' } });
            }
          }
        },
        [view._v('Corner referees')]
      );
    },
    createSetupComponent: createSetupComponent,
    cancelSetup: cancelSetup,
    attach: attach,
    detach: detach,
    publish: publish,
    controls: controls,
    setEndpoint: function (value) {
      if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(value) || busy)
        throw new Error('Use a local judge bridge address.');
      endpoint = value;
      key = '';
    }
  };
})(window);
