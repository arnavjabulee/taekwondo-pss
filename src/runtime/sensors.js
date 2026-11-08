/* Live impact diagnostics and threshold controls for the embedded browser. */
(function (root) {
  'use strict';

  var core =
    typeof module !== 'undefined' && module.exports ? require('./core.js') : root.LEDA_CORE;
  var MAX_READINGS = 40;
  var controller = null;
  var store = null;
  var events = [];
  var panel = null;
  var button = null;
  var listening = false;
  var previousFocus = null;

  function notify(message) {
    if (root.LEDA_UI) root.LEDA_UI.notify(message);
    else root.alert(message);
  }

  function locate(id) {
    if (!controller) return null;
    var equipment = core.findEquipment(controller.gvi.game, id);
    if (!equipment) return null;
    return {
      court: equipment.court + 1,
      side: equipment.side === 'left' ? 'Blue' : 'Red',
      type: equipment.type === 'helmet' ? 'Helmet' : 'Body',
      threshold: core.rawThreshold(
        equipment.type === 'helmet'
          ? controller.gameinfo.toukui_gate
          : controller.gvi.game[equipment.court].lidu
      )
    };
  }

  function timeLabel(date) {
    function pad(value) {
      return value < 10 ? '0' + value : String(value);
    }
    return [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join(':');
  }

  function receive(payload) {
    var hit = core.parseImpact(payload);
    if (!hit) return;
    hit.time = timeLabel(new Date());
    hit.assignment = locate(hit.id);
    if (hit.assignment && controller) {
      var assignment = hit.assignment;
      var slot =
        controller.gvi.game[assignment.court - 1][assignment.side === 'Blue' ? 'left' : 'right'];
      var reading = {
        raw: hit.value,
        level: hit.value / core.RAW_PER_LEVEL,
        type: assignment.type,
        time: hit.time
      };
      if (controller.$set) controller.$set(slot, 'last_hit', reading);
      else slot.last_hit = reading;
      controller.SendGameData();
    }
    events.unshift(hit);
    if (events.length > MAX_READINGS) events.pop();
    if (panel && !panel.hidden) renderEvents();
  }

  function formatHit(slot) {
    var hit = slot && slot.last_hit;
    return hit ? hit.type + ': ' + hit.raw + ' raw (L' + hit.level.toFixed(2) + ')' : 'Impact: --';
  }

  function setThreshold(ctx, data, court, value) {
    var parsed = core.parseLevel(value);
    if (parsed === null) return false;
    ctx.gvi.game[court].lidu = parsed;
    data.SaveChangdiData(court, ctx.gvi.game[court]);
    ctx.SendGameData();
    return true;
  }

  function clamp(ctx, data) {
    ctx.gvi.game.forEach(function (court, index) {
      var value = core.savedLevel(court.lidu, 8);
      if (court.lidu !== value) {
        court.lidu = value;
        data.SaveChangdiData(index, court);
      }
    });
    var helmet = core.savedLevel(ctx.gameinfo.toukui_gate, 1);
    if (ctx.gameinfo.toukui_gate !== helmet) {
      ctx.gameinfo.toukui_gate = helmet;
      data.GAMEINFO.toukui_gate = helmet;
      data.SaveGameInfo(ctx.gameinfo);
    }
  }

  function step(ctx, data, court, delta) {
    var next = core.savedLevel(ctx.gvi.game[court].lidu, 8) + delta;
    return setThreshold(ctx, data, court, Math.max(0, Math.min(core.MAX_LEVEL, next)));
  }

  function element(tag, text, parent, className) {
    var node = root.document.createElement(tag);
    if (text !== null) node.textContent = text;
    if (className) node.className = className;
    if (parent) parent.appendChild(node);
    return node;
  }

  function action(text, parent, callback, primary) {
    var node = element(
      'button',
      text,
      parent,
      'leda-button' + (primary ? ' leda-button-primary' : '')
    );
    node.type = 'button';
    node.onclick = callback;
    return node;
  }

  function stopListening() {
    // Training owns the receiver once Start has been pressed.
    if (listening && controller && store && !store.IS_GAMING) {
      core.DEVICE_TOPICS.forEach(function (topic) {
        controller.$parent.stop_devices(topic);
      });
    }
    listening = false;
  }

  function listen() {
    if (!store.IS_ONLINE) {
      notify('Receiver offline. Connect it before listening for hits.');
      return;
    }
    if (controller.gvi.game_state === 2) {
      notify('Training is running. Impact readings are already live.');
      return;
    }
    if (listening) stopListening();
    else {
      core.DEVICE_TOPICS.forEach(function (topic) {
        controller.$parent.start_devices(topic);
      });
      listening = true;
    }
    render();
  }

  function renderEvents() {
    var container = panel.querySelector('[data-events]');
    container.textContent = '';
    if (!events.length) {
      var empty = element('div', null, container, 'leda-empty-state');
      element('strong', 'Ready for the next impact', empty);
      element(
        'p',
        'Connect the receiver and listen for hits. Received impacts will appear here.',
        empty
      );
      return;
    }
    var table = element('table', null, container, 'leda-readings');
    var head = element('thead', null, table);
    var heading = element('tr', null, head);
    ['Time / device', 'Court / sensor', 'Raw impact', 'Level', 'Threshold', 'Result'].forEach(
      function (text) {
        element('th', text, heading);
      }
    );
    var body = element('tbody', null, table);
    events.forEach(function (hit) {
      var assignment = hit.assignment;
      var row = element('tr', null, body);
      var device = element('td', null, row);
      element('span', hit.time, device, 'leda-reading-time');
      element('code', hit.id, device);
      element(
        'td',
        assignment
          ? 'Court ' + assignment.court + ' / ' + assignment.side + ' / ' + assignment.type
          : 'Unassigned',
        row
      );
      element('td', String(hit.value), row, 'leda-number');
      element('td', (hit.value / core.RAW_PER_LEVEL).toFixed(2), row, 'leda-number');
      element('td', assignment ? String(assignment.threshold) : '--', row, 'leda-number');
      var result = element('td', null, row);
      var passes = assignment && hit.value >= assignment.threshold;
      element(
        'span',
        assignment ? (passes ? 'Meets threshold' : 'Below threshold') : 'Not assigned',
        result,
        'leda-badge ' + (passes ? 'leda-badge-success' : 'leda-badge-muted')
      );
    });
  }

  function thresholdInput(parent, title, value, commit) {
    var label = element('label', null, parent, 'leda-threshold-field');
    element('span', title, label);
    var input = element('input', null, label);
    input.type = 'number';
    input.min = '0';
    input.max = String(core.MAX_LEVEL);
    input.step = '1';
    input.value = value;
    var detail = element('small', core.rawThreshold(value) + ' raw units', label);
    input.onchange = function () {
      var parsed = core.parseLevel(input.value);
      if (parsed === null) {
        notify('Enter a whole level from 0 to ' + core.MAX_LEVEL + '.');
        input.value = value;
        return;
      }
      if (commit(parsed) === false) return;
      value = parsed;
      detail.textContent = core.rawThreshold(parsed) + ' raw units';
    };
  }

  function supportDetails() {
    notify(
      'Pressure-only mode is unverified for this hardware. The app accepts received impacts without a sock check. Compare hits with and without socks using Listen for hits. No bypass command is sent.'
    );
  }

  function close() {
    stopListening();
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (previousFocus && previousFocus.focus) previousFocus.focus();
  }

  function render() {
    panel.textContent = '';
    var dialog = element('div', null, panel, 'leda-sensor-dialog');
    var header = element('header', null, dialog, 'leda-dialog-header');
    var title = element('div', null, header);
    element('span', 'LIVE DIAGNOSTICS', title, 'leda-eyebrow');
    var heading = element('h2', 'Sensor levels', title);
    heading.id = 'leda-sensor-title';
    action('Close', header, close).setAttribute('aria-label', 'Close sensor levels');
    var content = element('div', null, dialog, 'leda-dialog-body');
    var toolbar = element('div', null, content, 'leda-sensor-toolbar');
    var status = listening
      ? 'Listening'
      : controller.gvi.game_state === 2
        ? 'Training live'
        : store.IS_ONLINE
          ? 'Receiver connected'
          : 'Receiver offline';
    element(
      'span',
      status,
      toolbar,
      'leda-badge ' + (store.IS_ONLINE ? 'leda-badge-success' : 'leda-badge-muted')
    );
    action(listening ? 'Stop listening' : 'Listen for hits', toolbar, listen, true);
    action('Clear readings', toolbar, function () {
      events = [];
      renderEvents();
    });
    var settings = element('section', null, content, 'leda-threshold-section');
    element('h3', 'Impact thresholds', settings);
    element(
      'p',
      'Higher levels require stronger contact. Range 0–71. One level equals 40 raw units.',
      settings,
      'leda-muted'
    );
    var fields = element('div', null, settings, 'leda-threshold-grid');
    controller.gvi.game.forEach(function (court, index) {
      if (
        !root.LEDA_CONTROLLER_FIXES.assigned(court.left) &&
        !root.LEDA_CONTROLLER_FIXES.assigned(court.right)
      )
        return;
      thresholdInput(fields, 'Court ' + (index + 1) + ' / body', court.lidu, function (value) {
        return setThreshold(controller, store, index, value);
      });
    });
    thresholdInput(
      fields,
      'All courts / helmet',
      controller.gameinfo.toukui_gate,
      function (value) {
        controller.gameinfo.toukui_gate = value;
        store.GAMEINFO.toukui_gate = value;
        store.SaveGameInfo(controller.gameinfo);
      }
    );
    var readings = element('section', null, content);
    element('h3', 'Recent impacts', readings);
    element(
      'p',
      'Latest 40 messages. Readings are uncapped; thresholds are saved at the time of each hit.',
      readings,
      'leda-muted'
    );
    element('div', null, readings, 'leda-readings-scroll').setAttribute('data-events', '');
    var footer = element('footer', null, content, 'leda-sensor-footer');
    element(
      'p',
      'Listen without starting the scoring timer. Values are sensor readings, not calibrated force measurements.',
      footer
    );
    action('Pressure-only support', footer, supportDetails);
    renderEvents();
  }

  function keydown(event) {
    if (!panel || panel.hidden) return;
    if (event.key === 'Escape' || event.keyCode === 27) {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab' && event.keyCode !== 9) return;
    var items = panel.querySelectorAll('button, input');
    if (!items.length) return;
    var first = items[0],
      last = items[items.length - 1];
    if (event.shiftKey && root.document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && root.document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function attach(ctx, data) {
    if (controller) detach();
    controller = ctx;
    store = data;
    if (!root.document) return;
    button = element(
      'button',
      'Sensor levels',
      root.document.body,
      'leda-sensor-launcher leda-button'
    );
    button.type = 'button';
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'leda-sensor-panel');
    panel = element('section', null, root.document.body, 'leda-sensor-overlay');
    panel.id = 'leda-sensor-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'leda-sensor-title');
    button.onclick = function () {
      previousFocus = root.document.activeElement;
      panel.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      render();
      var first = panel.querySelector('button');
      if (first && first.focus) first.focus();
    };
    if (root.document.addEventListener) root.document.addEventListener('keydown', keydown);
  }

  function detach() {
    stopListening();
    if (root.document && root.document.removeEventListener)
      root.document.removeEventListener('keydown', keydown);
    if (button && button.parentNode) button.parentNode.removeChild(button);
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    button = null;
    panel = null;
    controller = null;
    store = null;
    previousFocus = null;
  }

  var api = {
    isOpen: function () {
      return !!panel && !panel.hidden;
    },
    parse: core.parseImpact,
    receive: receive,
    attach: attach,
    detach: detach,
    level: core.parseLevel,
    setThreshold: setThreshold,
    step: step,
    clamp: clamp,
    formatHit: formatHit,
    readings: function () {
      return events.slice();
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LEDA_SENSOR_MONITOR = api;
})(typeof window !== 'undefined' ? window : globalThis);
