/* Standalone, read-only display: no receiver connection, timer or scoring commands. */
(function (root) {
  'use strict';
  var match = root.location.search.match(/[?&]channel=([^&]+)/),
    channel = match ? decodeURIComponent(match[1]) : '',
    latest = null,
    lastReceived = 0,
    renderKey = null;
  var weakTimers = { blue: null, red: null };
  var origin = root.location.protocol + '//' + root.location.host;
  var detached = /[?&]fullscreen=1(?:&|$)/.test(root.location.search),
    nativeWindow = /[?&]native=1(?:&|$)/.test(root.location.search);
  function fit() {
    var width = root.innerWidth || root.document.documentElement.clientWidth,
      height = root.innerHeight || root.document.documentElement.clientHeight,
      scale = Math.min(width / 1920, height / 1080),
      stage = root.document.querySelector('.scoreboard');
    stage.style.left = (width - 1920 * scale) / 2 + 'px';
    stage.style.top = (height - 1080 * scale) / 2 + 'px';
    stage.style.transform = 'scale(' + scale + ')';
  }
  function element(id) {
    return root.document.getElementById(id);
  }
  function text(id, value) {
    element(id).textContent = String(value);
  }
  function clock(value, phase) {
    value = Math.max(0, Number(value) || 0);
    if ((phase === 'running' || phase === 'paused') && value > 0 && value < 10) {
      var ms = Math.floor(value * 1000);
      return ('0' + Math.floor(ms / 1000)).slice(-2) + ':' + ('00' + (ms % 1000)).slice(-3);
    }
    value = Math.ceil(value);
    var minutes = String(Math.floor(value / 60));
    return (minutes.length < 2 ? '0' + minutes : minutes) + ':' + ('0' + (value % 60)).slice(-2);
  }
  function accept(data) {
    if (
      !data ||
      data.type !== 'uobtkd-scoreboard' ||
      data.version !== 1 ||
      data.channel !== channel ||
      ((!data.blue || !data.red) && data.mode !== 'court' && data.mode !== 'free') ||
      !isFinite(data.sentAt)
    )
      return;
    if (latest && data.sentAt < latest.sentAt) return;
    latest = data;
    lastReceived = data.sentAt;
    var content = {};
    Object.keys(data).forEach(function (key) {
      if (key !== 'seconds' && key !== 'sentAt') content[key] = data[key];
    });
    var key = JSON.stringify(content);
    if (key !== renderKey) {
      render(data);
      renderKey = key;
    }
    paintClock();
    connection();
  }
  function connection() {
    var live = latest && latest.connected && Date.now() - lastReceived < 4000;
    root.document.querySelector('.scoreboard').classList.toggle('running', !!live);
    if (latest && !live && latest.phase !== 'finished') text('phase', 'Panel offline');
    if (latest && latest.mode === 'test' && !live)
      text('test-mode-status', 'Panel disconnected — last readings shown');
    text(
      'connection',
      !channel
        ? 'Open this display using Open spectator window in Competition.'
        : live
          ? 'Live spectator display'
          : latest
            ? 'Panel disconnected — showing the last received score'
            : 'Waiting for the competition panel…'
    );
  }
  function render(data) {
    var stage = root.document.querySelector('.scoreboard');
    stage.classList.toggle('testing', data.mode === 'test');
    stage.classList.toggle('training', data.mode === 'court' || data.mode === 'free');
    stage.classList.toggle('court-training', data.mode === 'court');
    if (data.mode === 'court' || data.mode === 'free') {
      renderTraining(data);
      return;
    }
    if (data.mode === 'test') {
      renderTest(data);
      return;
    }
    text('event-title', data.title);
    text('clock', clock(data.seconds, data.phase));
    element('clock').classList.toggle(
      'subseconds',
      (data.phase === 'running' || data.phase === 'paused') && data.seconds > 0 && data.seconds < 10
    );
    text('round', data.round);
    text('best-of', 'Best of ' + data.bestOf);
    var phases = {
      ready: 'Ready',
      running: 'Match',
      paused: 'Time out',
      break: 'Break',
      'break-paused': 'Break paused',
      decision: 'Decision',
      'round-over': 'Round over',
      finished: 'Match over'
    };
    text('phase', phases[data.phase] || 'Ready');
    ['blue', 'red'].forEach(function (side) {
      var person = data[side];
      text(side + '-name', person.name);
      text(side + '-club', person.club || '');
      text(side + '-score', person.score);
      text(side + '-gam-jeoms', person.gamJeoms);
      text(side + '-punches', person.punches || 0);
      text(
        side + '-ivr',
        person.ivrPending
          ? 'IVR IN REVIEW'
          : person.ivrCard === false
            ? 'IVR UNAVAILABLE'
            : 'IVR AVAILABLE'
      );
      text(side + '-wins', person.wins);
      element(side + '-leading').classList.toggle('lit', !!person.leading);
      element(side + '-leading').style.visibility = 'visible';
      text(side + '-weak-head', person.weakHead || 0);
      text(side + '-weak-body', person.weakBody || 0);
      renderWeak(side, person.lastWeak);
      element(side + '-score').classList.toggle('compact', String(person.score).length > 2);
      root.document
        .querySelector('.' + side)
        .classList.toggle('winner', data.winner === (side === 'blue' ? 'left' : 'right'));
    });
    text(
      'outcome',
      data.winner
        ? (data.winner === 'left' ? 'Blue' : 'Red') + ' wins · ' + data.method
        : data.pendingDecision || data.phase === 'decision'
          ? 'SUP — Undecided. Referee vote required.'
          : data.lastRound &&
              ['break', 'break-paused', 'ready', 'round-over'].indexOf(data.phase) >= 0
            ? 'Round ' +
              data.lastRound.round +
              ': ' +
              (data.lastRound.winner === 'left' ? 'Blue' : 'Red') +
              ' wins · ' +
              data.lastRound.method
            : ''
    );
    var results = element('results');
    while (results.firstChild) results.removeChild(results.firstChild);
    (data.results || []).forEach(function (result) {
      var item = root.document.createElement('span');
      item.className = result.winner === 'left' ? 'blue-result' : 'red-result';
      item.textContent =
        'R' +
        result.round +
        ' · ' +
        (result.winner === 'left' ? 'Blue' : 'Red') +
        ' · ' +
        result.blue +
        '–' +
        result.red +
        ' · ' +
        result.method;
      results.appendChild(item);
    });
  }
  function renderWeak(side, hit) {
    var meter = element(side + '-weak-meter');
    if (weakTimers[side]) root.clearTimeout(weakTimers[side]);
    weakTimers[side] = null;
    var remaining = hit ? hit.at + 3000 - Date.now() : 0;
    if (remaining <= 0) {
      meter.style.display = 'none';
      return;
    }
    meter.style.display = 'block';
    meter.classList.toggle('labels-close', Math.abs(hit.threshold - hit.level) < 6);
    ['threshold', 'measured'].forEach(function (kind) {
      var value = Number(kind === 'threshold' ? hit.threshold : hit.level) || 0;
      var mark = meter.querySelector('.' + kind + '-mark');
      mark.style.left = Math.max(0, Math.min(100, (value / 72) * 100)) + '%';
      var label = meter.querySelector('.' + kind + '-value');
      label.style.left = mark.style.left;
      label.textContent = Math.round(value);
    });
    weakTimers[side] = root.setTimeout(function () {
      meter.style.display = 'none';
    }, remaining);
  }
  function paintClock() {
    if (!latest || latest.mode === 'court' || latest.mode === 'free' || latest.mode === 'test')
      return;
    var elapsed = Math.max(0, Date.now() - latest.sentAt) / 1000;
    var remaining = latest.seconds;
    if (
      latest.connected &&
      elapsed < 1.5 &&
      (latest.phase === 'running' || latest.phase === 'break')
    )
      remaining = Math.max(0, remaining - elapsed);
    text('clock', clock(remaining, latest.phase));
    element('clock').classList.toggle(
      'subseconds',
      (latest.phase === 'running' || latest.phase === 'paused') && remaining > 0 && remaining < 10
    );
  }
  function animate() {
    paintClock();
    if (root.requestAnimationFrame) root.requestAnimationFrame(animate);
  }
  function renderTraining(data) {
    text('event-title', data.title);
    text('training-phase', data.phase || 'Ready');
    text('training-clock', data.time || '00:00');
    text('training-total', data.mode === 'free' ? 'Group score: ' + data.total : '');
    var cards = element('training-cards');
    while (cards.firstChild) cards.removeChild(cards.firstChild);
    var entries = data.mode === 'free' ? data.people : data.courts;
    var columns =
      data.mode === 'free'
        ? entries.length <= 4
          ? 2
          : 4
        : entries.length <= 1
          ? 1
          : entries.length <= 4
            ? 2
            : 4;
    var rows = Math.max(1, Math.ceil(entries.length / columns));
    function person(slot, colour) {
      var node = root.document.createElement('div');
      node.className = 'training-person ' + colour;
      var name = root.document.createElement('h2');
      name.textContent =
        slot.name || (colour === 'blue' ? 'Blue' : colour === 'red' ? 'Red' : 'Participant');
      var score = root.document.createElement('strong');
      score.textContent = slot.score;
      var hits = root.document.createElement('small');
      hits.textContent = 'Head ' + slot.head + ' · Body ' + slot.body;
      node.appendChild(name);
      node.appendChild(score);
      node.appendChild(hits);
      return node;
    }
    entries.forEach(function (entry, index) {
      var card = root.document.createElement('article');
      card.className = 'training-card';
      var column = index % columns;
      var courtColumns = entries.length <= 4 ? 2 : 4;
      if (data.mode === 'free' || (data.mode === 'court' && entries.length > 1)) {
        columns = courtColumns;
        rows = Math.ceil(entries.length / columns);
        column = index % columns;
        card.style.left =
          (column < columns / 2
            ? (column * 80) / columns
            : 60 + ((column - columns / 2) * 80) / columns) + '%';
      } else card.style.left = (column * 100) / columns + '%';
      card.style.top = (Math.floor(index / columns) * 100) / rows + '%';
      card.style.width =
        (data.mode === 'free' || (data.mode === 'court' && entries.length > 1)
          ? 80 / columns
          : 100 / columns) + '%';
      card.style.height = 100 / rows + '%';
      card.style.fontSize = Math.min(110, 220 / rows) + 'px';
      if (data.mode === 'court') {
        var title = root.document.createElement('div');
        title.className = 'training-court-title';
        title.textContent = 'Court ' + entry.number;
        card.appendChild(title);
        if (entries.length === 1) card.className += ' single-court';
        card.appendChild(person(entry.blue, 'blue'));
        card.appendChild(person(entry.red, 'red'));
      } else {
        card.className += ' individual';
        card.appendChild(person(entry, entry.colour === 'red' ? 'red' : 'blue'));
      }
      cards.appendChild(card);
    });
    text(
      'connection',
      entries.length ? 'Live training display' : 'Add participants in the control panel'
    );
  }
  function renderTest(data) {
    text('event-title', data.title || 'Competition');
    text(
      'test-mode-status',
      !data.receiverOnline
        ? 'Receiver offline'
        : data.testing
          ? 'Test the head and body protectors'
          : 'Protector testing paused'
    );
    ['blue', 'red'].forEach(function (side) {
      text('test-' + side + '-name', data[side].name);
      text('test-' + side + '-club', data[side].club || '');
      ['head', 'body'].forEach(function (kind) {
        var device = data[side][kind],
          node = element('test-' + side + '-' + kind);
        node.classList.toggle('unassigned', !device.assigned);
        node.classList.toggle('hit', !!device.at && Date.now() - device.at < 1000);
        node.querySelector('.test-reading').textContent =
          device.raw === null ? '—' : (Number(device.raw) / 40).toFixed(2);
        node.querySelector('.test-status').textContent = !device.assigned
          ? 'Not assigned'
          : device.count
            ? 'Hits: ' + device.count + ' · Raw: ' + device.raw
            : device.online
              ? 'Connected · Waiting for hit'
              : 'Waiting for protector';
      });
    });
  }
  function request() {
    var message = { type: 'uobtkd-spectator-ready', channel: channel };
    try {
      if (root.opener) root.opener.postMessage(message, origin);
      if (root.parent !== root) root.parent.postMessage(message, origin);
    } catch (error) {
      /* Storage remains available for same-origin windows. */
    }
    try {
      var saved = root.localStorage.getItem('uobtkd_spectator_' + channel);
      if (saved) accept(JSON.parse(saved));
    } catch (error) {
      /* Keep the connection notice visible. */
    }
    connection();
  }
  root.addEventListener('message', function (event) {
    if (event.origin !== origin) return;
    if (
      event.data &&
      event.data.type === 'uobtkd-spectator-close' &&
      event.data.channel === channel
    ) {
      closeDisplay();
      return;
    }
    if (
      event.data &&
      event.data.type === 'uobtkd-spectator-fullscreen' &&
      event.data.channel === channel
    ) {
      fullscreen();
      return;
    }
    accept(event.data);
  });
  root.addEventListener('storage', function (event) {
    if (event.key === 'uobtkd_spectator_' + channel && event.newValue) {
      try {
        accept(JSON.parse(event.newValue));
      } catch (error) {
        /* Ignore incomplete data. */
      }
    }
  });
  function fullscreen() {
    if (nativeWindow) {
      try {
        root.moveTo(root.screen.availLeft || 0, root.screen.availTop || 0);
        root.resizeTo(root.screen.width, root.screen.height);
      } catch (error) {
        /* The native constructor already uses the full screen rectangle. */
      }
      fit();
      if (typeof root.HostFocusDisplay === 'function') root.HostFocusDisplay();
      return;
    }
    var target = root.document.documentElement,
      fn = target.requestFullscreen || target.webkitRequestFullscreen;
    if (fn) {
      var result = fn.call(target);
      if (result && result.catch)
        result.catch(function () {
          element('fullscreen').style.opacity = 1;
        });
    } else text('connection', 'Use F11 for full screen in your browser.');
  }
  element('fullscreen').addEventListener('click', fullscreen);
  function closeDisplay() {
    if (!detached || root.parent !== root) return;
    try {
      if (root.opener)
        root.opener.postMessage({ type: 'uobtkd-spectator-closed', channel: channel }, origin);
    } catch (error) {
      /* Closing the native window does not depend on its opener. */
    }
    if (typeof root.HostCloseDisplay === 'function' && root.HostCloseDisplay()) return;
    root.close();
  }
  element('close-display').style.display = detached ? '' : 'none';
  element('close-display').addEventListener('click', closeDisplay);
  root.document.addEventListener(
    'mousedown',
    function () {
      if (nativeWindow && typeof root.HostFocusDisplay === 'function') root.HostFocusDisplay();
    },
    true
  );
  root.document.addEventListener(
    'keydown',
    function (event) {
      if (
        (event.key === 'Escape' ||
          event.key === 'Esc' ||
          event.keyCode === 27 ||
          (event.altKey && (event.key === 'F4' || event.keyCode === 115))) &&
        detached &&
        root.parent === root
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeDisplay();
        return;
      }
      if (
        (event.key === 'f' || event.key === 'F') &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        fullscreen();
      }
    },
    true
  );
  root.OnVkEscape = function () {
    closeDisplay();
  };
  root.addEventListener('resize', fit);
  root.document.addEventListener('fullscreenchange', fit);
  root.document.addEventListener('webkitfullscreenchange', fit);
  fit();
  if (detached && root.parent === root) fullscreen();
  request();
  if (root.requestAnimationFrame) root.requestAnimationFrame(animate);
  root.setInterval(request, 1000);
})(window);
