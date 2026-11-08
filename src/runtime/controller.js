/* Small, auditable fixes around the vendor controller. ES5 for its embedded browser. */
(function (root) {
  'use strict';
  var core =
    typeof module !== 'undefined' && module.exports ? require('./core.js') : root.LEDA_CORE;
  function notify(message) {
    if (root.LEDA_UI) root.LEDA_UI.notify(message);
    else root.alert(message);
  }
  function assigned(slot) {
    return (
      slot &&
      slot.index !== '' &&
      slot.index !== null &&
      typeof slot.index !== 'undefined' &&
      Number(slot.index) >= 0
    );
  }
  function ignoreSpaceShortcut() {
    if (root.LEDA_SENSOR_MONITOR && root.LEDA_SENSOR_MONITOR.isOpen()) return true;
    if (!root.document) return false;
    var focused = root.document.activeElement;
    if (
      focused &&
      (/^(INPUT|TEXTAREA|SELECT)$/.test(focused.tagName) || focused.isContentEditable)
    ) {
      return true;
    }
    return !!root.document.querySelector('.modal.in');
  }
  function conflicts(games) {
    var athletes = {},
      devices = {},
      errors = [],
      i,
      j,
      k,
      slot,
      where,
      id;
    var sides = ['left', 'right'],
      types = ['toukui', 'huju'];
    for (i = 0; i < games.length; i++) {
      for (j = 0; j < sides.length; j++) {
        slot = games[i][sides[j]];
        if (!assigned(slot)) continue;
        where = 'Court ' + (i + 1) + (j === 0 ? ' blue' : ' red');
        id = String(slot.index);
        if (athletes[id]) errors.push(where + ': athlete already assigned to ' + athletes[id]);
        else athletes[id] = where;
        for (k = 0; k < types.length; k++) {
          id = String(slot[types[k]] || '').toLowerCase();
          if (!id) continue;
          if (devices[id])
            errors.push(where + ': device ' + id + ' already assigned to ' + devices[id]);
          else devices[id] = where;
        }
      }
    }
    return errors;
  }
  function changeAthlete(controller, store, area, side) {
    var slot = controller.gvi.game[area][side];
    slot.last_hit = null;
    var record = assigned(slot) ? store.ReadGameData(slot.index) : null;
    if (!record) {
      slot.index = '';
      slot.toukui = '';
      slot.huju = '';
    } else {
      slot.toukui = record.toukui || '';
      slot.huju = record.huju || '';
      if (slot.toukui) controller.$parent.query_battery_info(slot.toukui);
      if (slot.huju) controller.$parent.query_battery_info(slot.huju);
    }
    controller.handleDevState();
    controller.SendGameData();
  }
  function canStart(controller) {
    var errors = conflicts(controller.gvi.game);
    if (!errors.length) return true;
    notify(
      'Training has not started. Choose a different athlete, or None, using the name dropdowns.\n\n' +
        errors.join('\n')
    );
    return false;
  }
  function courtNumber(record) {
    var n = Number(record.court);
    return n >= 1 && n <= 16 && Math.floor(n) === n ? n : 0;
  }
  function courtLabel(data, record) {
    var court = courtNumber(record),
      count = 0,
      i;
    if (!court) return 'Unassigned';
    for (i = 0; i < data.length; i++) {
      if (courtNumber(data[i]) === court) count++;
      if (data[i] === record) return count === 1 ? 'Blue' : count === 2 ? 'Red' : 'Court full';
    }
    return 'Unassigned';
  }
  function assignCourt(page, row, value, store) {
    var court = Number(value),
      count = 0,
      i;
    if (value !== '' && (court < 1 || court > core.COURT_COUNT || Math.floor(court) !== court))
      return false;
    for (i = 0; i < page.data.length; i++)
      if (i !== row && court && courtNumber(page.data[i]) === court) count++;
    if (count >= 2) {
      notify('Court ' + court + ' already has two athletes. Choose another court.');
      page.$forceUpdate();
      return false;
    }
    page.$set(page.data[row], 'court', court || '');
    // Roster display numbers are distinct from zero-based storage keys.
    store.SaveGameData(
      typeof page.data[row]._storageIndex === 'number'
        ? page.data[row]._storageIndex
        : Number(page.settings.changci_begin) + row,
      page.data[row]
    );
    return true;
  }
  function prepareCourts(store, settings) {
    var games = [],
      roster = [],
      i,
      record,
      court,
      side,
      count = {},
      max = 0;
    function empty() {
      return core.emptyAthlete();
    }
    for (i = 0; i < core.COURT_COUNT; i++) {
      var saved = store.ReadChangdiData ? store.ReadChangdiData(i) : null;
      var threshold = saved && saved.lidu !== null && saved.lidu !== '' ? Number(saved.lidu) : NaN;
      games.push({
        lidu: isFinite(threshold) && threshold >= 0 ? core.savedLevel(threshold, 8) : 8,
        left: empty(),
        right: empty()
      });
    }
    for (i = Number(settings.changci_begin); i < Number(settings.changci_end); i++) {
      record = store.ReadGameData(i);
      if (!record) continue;
      court = courtNumber(record);
      if (!court) continue;
      count[court] = (count[court] || 0) + 1;
      if (count[court] > 2) throw new Error('Court ' + court + ' has more than two athletes.');
      side = count[court] === 1 ? 'left' : 'right';
      games[court - 1][side] = {
        index: i,
        gamer: record.name,
        toukui: record.toukui || '',
        huju: record.huju || '',
        score: 0,
        tkhits: 0,
        hjhits: 0,
        valid: 0,
        warning: 0
      };
      roster.push({
        index: i,
        name: record.name,
        toukui: record.toukui || '',
        huju: record.huju || ''
      });
      max = Math.max(max, court);
    }
    if (!max) throw new Error('Assign athletes to courts before opening training.');
    var errors = conflicts(games);
    if (errors.length) throw new Error(errors.join('\n'));
    store.game_list = games;
    store.left_gamer_list = roster;
    store.right_gamer_list = roster;
    for (i = 0; i < core.COURT_COUNT; i++) store.SaveChangdiData(i, games[i]);
    store.court_view_mode = max === 1 ? 0 : max <= 4 ? 1 : max <= 8 ? 2 : 3;
  }
  function scoreHit(controller, store, payload) {
    if (controller.gvi.game_state !== 2) return;
    var hit = core.parseImpact(payload);
    if (!hit) return;
    var equipment = core.findEquipment(controller.gvi.game, hit.id);
    if (!equipment) return;

    var court = controller.gvi.game[equipment.court];
    var opponent = court[equipment.side === 'left' ? 'right' : 'left'];
    var helmet = equipment.type === 'helmet';
    var threshold = core.rawThreshold(helmet ? controller.gameinfo.toukui_gate : court.lidu);
    if (hit.value >= threshold) {
      opponent.score += helmet ? 3 : 2;
      if (helmet) opponent.tkhits++;
      else opponent.hjhits++;
      store.PlaySound(helmet ? 'score_3.wav' : 'score_2.wav');
    } else if (!helmet) {
      opponent.valid++;
    }
    controller.SendGameData();
  }
  var api = {
    ignoreSpaceShortcut: ignoreSpaceShortcut,
    assigned: assigned,
    conflicts: conflicts,
    changeAthlete: changeAthlete,
    canStart: canStart,
    courtNumber: courtNumber,
    courtLabel: courtLabel,
    assignCourt: assignCourt,
    prepareCourts: prepareCourts,
    scoreHit: scoreHit
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LEDA_CONTROLLER_FIXES = api;
})(typeof window !== 'undefined' ? window : globalThis);
