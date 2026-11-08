/* Small, auditable fixes around the vendor controller. ES5 for its embedded browser. */
(function (root) {
  'use strict';
  function assigned(slot) {
    return slot && slot.index !== '' && slot.index !== null &&
      typeof slot.index !== 'undefined' && Number(slot.index) >= 0;
  }
  function conflicts(games) {
    var athletes = {}, devices = {}, errors = [], i, j, k, slot, where, id;
    var sides = ['left', 'right'], types = ['toukui', 'huju'];
    for (i = 0; i < games.length; i++) {
      for (j = 0; j < sides.length; j++) {
        slot = games[i][sides[j]];
        if (!assigned(slot)) continue;
        where = 'Area ' + (i + 1) + (j === 0 ? ' blue' : ' red');
        id = String(slot.index);
        if (athletes[id]) errors.push(where + ': athlete already assigned to ' + athletes[id]);
        else athletes[id] = where;
        for (k = 0; k < types.length; k++) {
          id = String(slot[types[k]] || '').toLowerCase();
          if (!id) continue;
          if (devices[id]) errors.push(where + ': device ' + id + ' already assigned to ' + devices[id]);
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
      slot.index = ''; slot.toukui = ''; slot.huju = '';
    } else {
      slot.toukui = record.toukui || ''; slot.huju = record.huju || '';
      if (slot.toukui) controller.$parent.query_battery_info(slot.toukui);
      if (slot.huju) controller.$parent.query_battery_info(slot.huju);
    }
    controller.handleDevState();
    controller.SendGameData();
  }
  function canStart(controller) {
    var errors = conflicts(controller.gvi.game);
    if (!errors.length) return true;
    root.alert('Training has not started. Choose a different athlete, or None, using the name dropdowns.\n\n' + errors.join('\n'));
    return false;
  }
  function courtNumber(record) {
    var n = Number(record.court);
    return n >= 1 && n <= 16 && Math.floor(n) === n ? n : 0;
  }
  function courtLabel(data, record) {
    var court = courtNumber(record), count = 0, i;
    if (!court) return 'Unassigned';
    for (i = 0; i < data.length; i++) {
      if (courtNumber(data[i]) === court) count++;
      if (data[i] === record) return count === 1 ? 'Blue' : count === 2 ? 'Red' : 'Court full';
    }
    return 'Unassigned';
  }
  function assignCourt(page, row, value, store) {
    var court = Number(value), count = 0, i;
    for (i = 0; i < page.data.length; i++)
      if (i !== row && court && courtNumber(page.data[i]) === court) count++;
    if (count >= 2) { root.alert('Court ' + court + ' already has two athletes. Choose another court.'); page.$forceUpdate(); return false; }
    page.$set(page.data[row], 'court', court || '');
    // Roster display numbers are distinct from zero-based storage keys.
    store.SaveGameData(Number(page.settings.changci_begin) + row, page.data[row]);
    return true;
  }
  function prepareCourts(store, settings) {
    var games = [], roster = [], i, record, court, side, count = {}, max = 0;
    function empty() { return {index:'',gamer:0,toukui:'',huju:'',score:0,tkhits:0,hjhits:0,valid:0,warning:0}; }
    for (i = 0; i < 16; i++) {
      var saved = store.ReadChangdiData ? store.ReadChangdiData(i) : null;
      var threshold = saved && saved.lidu !== null && saved.lidu !== '' ? Number(saved.lidu) : NaN;
      games.push({lidu:isFinite(threshold)&&threshold>=0?Math.min(71,threshold):8,left:empty(),right:empty()});
    }
    for (i = Number(settings.changci_begin); i < Number(settings.changci_end); i++) {
      record = store.ReadGameData(i);
      if (!record) continue;
      court = courtNumber(record);
      if (!court) continue;
      count[court] = (count[court] || 0) + 1;
      if (count[court] > 2) throw new Error('Court ' + court + ' has more than two athletes.');
      side = count[court] === 1 ? 'left' : 'right';
      games[court - 1][side] = {index:i,gamer:record.name,toukui:record.toukui || '',huju:record.huju || '',score:0,tkhits:0,hjhits:0,valid:0,warning:0};
      roster.push({index:i,name:record.name,toukui:record.toukui || '',huju:record.huju || ''});
      max = Math.max(max, court);
    }
    if (!max) throw new Error('Assign athletes to courts before opening training.');
    var errors = conflicts(games);
    if (errors.length) throw new Error(errors.join('\n'));
    store.game_list = games;
    store.left_gamer_list = roster; store.right_gamer_list = roster;
    for (i = 0; i < 16; i++) store.SaveChangdiData(i, games[i]);
    store.court_view_mode = max === 1 ? 0 : max <= 4 ? 1 : max <= 8 ? 2 : 3;
  }
  function scoreHit(controller, store, payload) {
    if (controller.gvi.game_state !== 2) return;
    var fields = String(payload).split(','), id = fields[0], raw = fields[1], value, i, j, slot, type, target;
    if (!/^[a-f0-9]{12}$/i.test(id) || !raw || raw.indexOf(':') < 0) return;
    raw = raw.slice(raw.indexOf(':') + 1).trim();
    if (!raw) return;
    value = Number(raw);
    if (!isFinite(value) || value < 0) return;
    for (i = 0; i < controller.gvi.game.length; i++) {
      for (j = 0; j < 2; j++) {
        slot = controller.gvi.game[i][j === 0 ? 'left' : 'right'];
        type = String(slot.toukui).toLowerCase() === id.toLowerCase() ? 'helmet' : String(slot.huju).toLowerCase() === id.toLowerCase() ? 'body' : '';
        if (!type) continue;
        target = controller.gvi.game[i][j === 0 ? 'right' : 'left'];
        if (type === 'helmet') {
          if (value >= controller.lidu_to_value(controller.gameinfo.toukui_gate)) { target.score += 3; target.tkhits++; store.PlaySound('score_3.wav'); }
        } else if (value >= controller.lidu_to_value(controller.gvi.game[i].lidu)) { target.score += 2; target.hjhits++; store.PlaySound('score_2.wav'); }
        else target.valid++;
        controller.SendGameData(); return;
      }
    }
  }
  var api = {assigned: assigned, conflicts: conflicts, changeAthlete: changeAthlete, canStart: canStart,
    courtNumber:courtNumber,courtLabel:courtLabel,assignCourt:assignCourt,prepareCourts:prepareCourts,scoreHit:scoreHit};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LEDA_CONTROLLER_FIXES = api;
}(typeof window !== 'undefined' ? window : globalThis));
