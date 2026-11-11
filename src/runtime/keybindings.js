/* Shared keyboard routing for the native key bridge and browser input. */
(function (root) {
  'use strict';
  var actions = [
    { id: 'toggle', label: 'Start / pause / resume', key: 'Space' },
    { id: 'back', label: 'Back / close dialog', key: 'Escape' },
    { id: 'equipment', label: 'Open equipment', key: '' },
    { id: 'spectator', label: 'Open spectator window', key: '' },
    { id: 'skipBreak', label: 'Skip competition break', key: '' },
    { id: 'resetStopwatch', label: 'Reset Free Training stopwatch', key: '' }
  ];
  ['blue', 'red'].forEach(function (side) {
    var label = side === 'blue' ? 'Blue' : 'Red';
    [1, 2, 3, -1, -2, -3].forEach(function (points) {
      actions.push({
        id: side + 'Points' + points,
        label: label + ' ' + (points > 0 ? '+' : '') + points + ' points',
        key: '',
        side: side,
        points: points
      });
    });
    ['body', 'head'].forEach(function (type) {
      actions.push({
        id: side + 'Technical' + type,
        label: label + ' technical ' + type,
        key: '',
        side: side,
        technical: type
      });
    });
    actions.push({
      id: side + 'Penalty',
      label: 'Add ' + label + ' gam-jeom',
      key: '',
      side: side,
      penalty: true
    });
  });
  var defaults = {},
    bindings = {},
    host = null,
    capture = null,
    nativeHeld = {},
    nativeSpace = false;
  var storageKey = 'uobtkd_keybindings_v1';
  actions.forEach(function (action) {
    defaults[action.id] = action.key;
    bindings[action.id] = action.key;
  });
  function valid(key) {
    return (
      key === '' ||
      /^(?:Ctrl\+)?(?:Alt\+)?(?:Shift\+)?(?:Meta\+)?(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Space|Escape|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Backspace|Delete|Home|End|PageUp|PageDown)$/.test(
        key
      )
    );
  }
  function get() {
    return JSON.parse(JSON.stringify(bindings));
  }
  function persist() {
    if (root.localStorage) root.localStorage.setItem(storageKey, JSON.stringify(bindings));
  }
  function set(id, key) {
    if (!Object.prototype.hasOwnProperty.call(defaults, id) || !valid(key))
      throw new Error('Choose a letter, number, arrow, F1–F12 or modifier combination.');
    if (/^(Meta\+|Alt\+F4$|Alt\+Space$)/.test(key) || /\+(Space|Escape)$/.test(key))
      throw new Error('That combination is reserved. Use Space or Escape without modifiers.');
    actions.forEach(function (action) {
      if (key && action.id !== id && bindings[action.id] === key)
        throw new Error(key + ' is already assigned to ' + action.label + '.');
    });
    bindings[id] = key;
    persist();
  }
  try {
    var saved = JSON.parse(root.localStorage && root.localStorage.getItem(storageKey));
    if (saved)
      actions.forEach(function (action) {
        if (typeof saved[action.id] === 'string' && valid(saved[action.id]))
          bindings[action.id] = saved[action.id];
      });
    var seen = {};
    actions.forEach(function (action) {
      var key = bindings[action.id];
      if (key && seen[key]) bindings[action.id] = '';
      else if (key) seen[key] = true;
    });
  } catch (error) {
    /* Defaults work without saved preferences. */
  }
  function keyOf(event) {
    var key =
      event.key ||
      {
        8: 'Backspace',
        27: 'Escape',
        32: 'Space',
        33: 'PageUp',
        34: 'PageDown',
        35: 'End',
        36: 'Home',
        37: 'ArrowLeft',
        38: 'ArrowUp',
        39: 'ArrowRight',
        40: 'ArrowDown',
        46: 'Delete'
      }[event.keyCode];
    if (!key && event.keyCode >= 48 && event.keyCode <= 90)
      key = String.fromCharCode(event.keyCode);
    if (!key && event.keyCode >= 112 && event.keyCode <= 123) key = 'F' + (event.keyCode - 111);
    if (key === ' ' || key === 'Spacebar') key = 'Space';
    if (key === 'Esc') key = 'Escape';
    if (!key || /^(Control|Alt|Shift|Meta)$/.test(key)) return '';
    if (key.length === 1) key = key.toUpperCase();
    return (
      (event.ctrlKey ? 'Ctrl+' : '') +
      (event.altKey ? 'Alt+' : '') +
      (event.shiftKey ? 'Shift+' : '') +
      (event.metaKey ? 'Meta+' : '') +
      key
    );
  }
  function currentView() {
    var found = null;
    function visit(view) {
      if (!view || view._isDestroyed || view._isBeingDestroyed) return;
      if (
        (view.gvi && typeof view.gameControl === 'function') ||
        (view.session && typeof view.toggleTracking === 'function')
      )
        found = view;
      (view.$children || []).forEach(visit);
    }
    visit(host);
    return found;
  }
  function blocked() {
    return root.UOBTKD_CONTROLLER_FIXES && root.UOBTKD_CONTROLLER_FIXES.ignoreSpaceShortcut();
  }
  function dispatch(action) {
    if (action.id === 'back') {
      if (!root.PSS_NAV) return false;
      root.PSS_NAV.back();
      return true;
    }
    if (blocked()) return false;
    var view = currentView();
    if (action.id === 'toggle' && view) {
      if (view.session) view.toggleTracking();
      else view.gameControl();
    } else if (action.id === 'equipment' && root.PSS_NAV) root.PSS_NAV.equipment();
    else if (action.id === 'spectator' && view && root.PSS_SPECTATOR) root.PSS_SPECTATOR.open();
    else if (action.id === 'resetStopwatch' && view && view.session) view.resetStopwatch();
    else if (view && view.gvi && root.PSS_MODES.isCompetition()) {
      var side = action.side === 'blue' ? 'left' : 'right';
      if (action.id === 'skipBreak') view.skipCompetitionBreak();
      else if (action.points) view.adjustCompetitionScore(side, action.points);
      else if (action.technical) view.adjustCompetitionTechnical(side, action.technical, 1);
      else if (action.penalty) view.adjustCompetitionGamJeom(side, 1);
      else return false;
    } else return false;
    return true;
  }
  function cancelCapture(notify) {
    var previous = capture;
    capture = null;
    if (previous && notify !== false) previous.done('Shortcut recording cancelled.');
  }
  function process(key) {
    if (!key) return false;
    if (capture) {
      if (key === 'Escape') {
        cancelCapture();
        return true;
      }
      var recording = capture;
      capture = null;
      try {
        set(recording.id, key);
        recording.done('');
      } catch (error) {
        recording.done(error.message);
      }
      return true;
    }
    for (var i = 0; i < actions.length; i++)
      if (bindings[actions[i].id] === key) {
        if (blocked() && !(actions[i].id === 'back' && key === 'Escape')) return false;
        return dispatch(actions[i]);
      }
    return false;
  }
  if (root.document && root.document.addEventListener)
    root.document.addEventListener(
      'keydown',
      function (event) {
        var key = keyOf(event);
        // The Windows bridge and the web view can both deliver the same Space
        // press. Share its held state so it toggles once, whichever arrives first.
        if (key === 'Space' && nativeHeld.Space && nativeSpace) {
          nativeSpace = false;
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if (
          key === 'Space' &&
          root.document.querySelector &&
          root.document.querySelector('[data-ivr-dialog]')
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if (event.repeat) {
          if (
            capture ||
            (!blocked() &&
              actions.some(function (action) {
                return bindings[action.id] === key;
              }))
          )
            event.preventDefault();
          return;
        }
        if (key === 'Space') delete nativeHeld.Space;
        if (process(key)) {
          if (key === 'Space') nativeHeld.Space = true;
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true
    );
  if (root.document && root.document.addEventListener)
    root.document.addEventListener(
      'keyup',
      function (event) {
        var key = keyOf(event);
        if (key === 'Space' && nativeHeld.Space) {
          // Avoid a second activation from Space releasing on a focused button.
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        if (key === 'Space') nativeSpace = false;
        delete nativeHeld[key];
        if (key === 'Space' || /\+Space$/.test(key)) delete nativeHeld.Space;
        if (key === 'Escape' || /\+Escape$/.test(key)) delete nativeHeld.Escape;
      },
      true
    );
  if (root.addEventListener)
    root.addEventListener('blur', function () {
      nativeHeld = {};
      nativeSpace = false;
    });
  var api = {
    actions: actions,
    get: get,
    set: set,
    keyOf: keyOf,
    nativeKey: function (key) {
      // Escape repeat filtering is already done by the native message handler.
      // Its key-up may be lost when a dialog/window closes or focus changes.
      if (key === 'Escape') return process(key);
      if (nativeHeld[key]) return true;
      var handled = process(key);
      if (handled) {
        nativeHeld[key] = true;
        if (key === 'Space') nativeSpace = true;
      }
      return handled;
    },
    attach: function (view) {
      host = view;
    },
    capture: function (id, done) {
      cancelCapture(false);
      capture = { id: id, done: done };
    },
    cancelCapture: cancelCapture,
    reset: function () {
      bindings = JSON.parse(JSON.stringify(defaults));
      persist();
      return get();
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PSS_KEYS = api;
})(typeof window !== 'undefined' ? window : globalThis);
