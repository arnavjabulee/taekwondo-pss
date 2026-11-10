/* Small, auditable fixes around the vendor controller. ES5 for its embedded browser. */
(function (root) {
  'use strict';
  var core =
    typeof module !== 'undefined' && module.exports ? require('./core.js') : root.UOBTKD_CORE;
  function notify(message) {
    if (root.UOBTKD_UI) root.UOBTKD_UI.notify(message);
    else root.alert(message);
  }
  function ignoreSpaceShortcut() {
    if (root.PSS_EQUIPMENT && root.PSS_EQUIPMENT.isOpen()) return true;
    if (root.UOBTKD_SENSOR_MONITOR && root.UOBTKD_SENSOR_MONITOR.isOpen()) return true;
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
    var devices = {},
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
        where = 'Court ' + (i + 1) + (j === 0 ? ' blue' : ' red');
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
  function canStart(controller) {
    var errors = conflicts(controller.gvi.game);
    if (!errors.length) return true;
    notify(
      'Training has not started. Assign each protector to only one participant.\n\n' +
        errors.join('\n')
    );
    return false;
  }
  function normalCourt(saved, index) {
    var court = {
      lidu: core.savedLevel(saved && saved.lidu, 8),
      left: core.emptyParticipant(),
      right: core.emptyParticipant()
    };
    if (saved && saved.competition && root.PSS_MODES && root.PSS_MODES.isCompetition())
      court.competition = JSON.parse(JSON.stringify(saved.competition));
    ['left', 'right'].forEach(function (side, offset) {
      var old = (saved && saved[side]) || {},
        slot = court[side];
      slot.index = index * 2 + offset;
      slot.gamer = String(old.gamer || '').slice(0, 80);
      slot.huju = core.normalizeId(old.huju);
      slot.toukui = core.normalizeId(old.toukui);
      core.PARTICIPANT_COUNTERS.forEach(function (key) {
        slot[key] = isFinite(Number(old[key])) && Number(old[key]) >= 0 ? Number(old[key]) : 0;
      });
      slot.last_hit = old.last_hit || null;
      slot.last_weak = null;
    });
    return court;
  }
  function prepareCourts(store) {
    var games = [],
      max = 0;
    for (var i = 0; i < core.COURT_COUNT; i++) {
      var court = normalCourt(store.ReadChangdiData(i), i);
      games.push(court);
      if (
        court.left.huju ||
        court.left.toukui ||
        court.right.huju ||
        court.right.toukui ||
        court.left.gamer ||
        court.right.gamer
      )
        max = i + 1;
      store.SaveChangdiData(i, court);
    }
    store.game_list = games;
    store.left_gamer_list = [];
    store.right_gamer_list = [];
    var view = store.court_view_mode;
    try {
      var saved = root.localStorage && root.localStorage.getItem('uobtkd_court_layout');
      if (saved !== null && saved !== undefined) view = Number(saved);
    } catch (error) {
      /* Layout preference is optional. */
    }
    store.court_view_mode =
      typeof view === 'number' && view >= 0 && view <= 3
        ? view
        : max === 1
          ? 0
          : max <= 4
            ? 1
            : max <= 8
              ? 2
              : 3;
  }
  function loadCourts(controller, store) {
    if (controller._slotsLoaded) return;
    for (var i = 0; i < core.COURT_COUNT; i++) {
      var court = normalCourt(store.ReadChangdiData(i), i);
      if (controller.$set) controller.$set(controller.gvi.game, i, court);
      else controller.gvi.game[i] = court;
    }
    controller._slotsLoaded = true;
    store.game_list = controller.gvi.game;
    controller.handleDevState();
  }
  function renameParticipant(controller, store, court, side, name) {
    if (root.PSS_MODES && root.PSS_MODES.isCompetition())
      throw new Error('Names are locked in match mode. Return to protector testing to edit them.');
    controller.gvi.game[court][side].gamer = String(name).slice(0, 80);
    store.SaveChangdiData(court, controller.gvi.game[court]);
    controller.SendGameData();
  }
  function changeEquipment(controller, store, court, side, key, value) {
    if (key !== 'huju' && key !== 'toukui') throw new Error('Unknown equipment type.');
    var id = core.normalizeId(value),
      slot = controller.gvi.game[court][side],
      old = slot[key];
    if (id && !/^[a-f0-9]{12}$/.test(id)) throw new Error('Choose valid equipment.');
    if (root.PSS_EQUIPMENT && id) {
      var device = root.PSS_EQUIPMENT.registry.findDevice(id);
      var expected = key === 'huju' ? 'body' : 'helmet';
      if (!device || (device.detectedType || device.type) !== expected)
        throw new Error('Choose the correct protector type.');
    }
    var owner = id ? core.findEquipment(controller.gvi.game, id) : null;
    if (owner && (owner.type === 'body' ? 'huju' : 'toukui') !== key)
      throw new Error('That equipment is assigned as a different protector type.');
    if (owner && (owner.court !== court || owner.side !== side)) {
      owner.slot[key] = old;
      owner.slot.last_hit = null;
      store.SaveChangdiData(owner.court, controller.gvi.game[owner.court]);
    }
    slot[key] = id;
    slot.last_hit = null;
    store.SaveChangdiData(court, controller.gvi.game[court]);
    if (id && controller.$parent.query_battery_info) controller.$parent.query_battery_info(id);
    controller.handleDevState();
    controller.SendGameData();
  }
  function equipmentOwner(controller, id) {
    var owner = core.findEquipment(controller.gvi.game, id);
    return owner
      ? 'Court ' +
          (owner.court + 1) +
          ' ' +
          (owner.side === 'left' ? 'Blue' : 'Red') +
          (owner.slot.gamer ? ' / ' + owner.slot.gamer : '')
      : '';
  }
  function canAdjustCompetition(controller) {
    return !!(
      root.PSS_MODES &&
      root.PSS_MODES.isCompetition() &&
      (root.PSS_COMPETITION
        ? root.PSS_COMPETITION.active(controller)
        : controller.gvi.game_state >= 2)
    );
  }
  function checkCompetition(controller, store) {
    if (root.PSS_MODES && root.PSS_MODES.isCompetition() && root.PSS_COMPETITION)
      root.PSS_COMPETITION.check(controller, store);
  }
  function adjustScore(controller, store, side, delta) {
    if (side !== 'left' && side !== 'right') throw new Error('Choose Blue or Red.');
    if ([1, 2, 3, -1, -2, -3].indexOf(delta) < 0)
      throw new Error('Choose a score adjustment from 1 to 3 points.');
    if (!canAdjustCompetition(controller)) return false;
    var slot = controller.gvi.game[0][side];
    slot.score = Math.max(0, slot.score + delta);
    var category =
      Math.abs(delta) === 2 ? 'body_points' : Math.abs(delta) === 3 ? 'head_points' : '';
    if (category) slot[category] = Math.max(0, (slot[category] || 0) + delta);
    checkCompetition(controller, store);
    store.SaveChangdiData(0, controller.gvi.game[0]);
    controller.SendGameData();
    return true;
  }
  function adjustGamJeom(controller, store, side, delta) {
    if (side !== 'left' && side !== 'right') throw new Error('Choose Blue or Red.');
    if (delta !== 1 && delta !== -1) throw new Error('Choose add or remove gam-jeom.');
    if (!canAdjustCompetition(controller)) return false;
    var court = controller.gvi.game[0],
      offender = court[side],
      opponent = court[side === 'left' ? 'right' : 'left'];
    if (delta < 0 && offender.warning <= 0) return false;
    offender.warning = Math.max(0, offender.warning + delta);
    opponent.score = Math.max(0, opponent.score + delta);
    checkCompetition(controller, store);
    store.SaveChangdiData(0, court);
    controller.SendGameData();
    return true;
  }
  function adjustTechnical(controller, store, side, type, delta) {
    if (
      (side !== 'left' && side !== 'right') ||
      (type !== 'body' && type !== 'head') ||
      (delta !== 1 && delta !== -1)
    )
      return false;
    if (!canAdjustCompetition(controller)) return false;
    var slot = controller.gvi.game[0][side],
      key = 'technical_' + type,
      points = type === 'head' ? 3 : 2;
    if (delta < 0 && !(slot[key] > 0)) return false;
    slot[key] = (slot[key] || 0) + delta;
    slot.score = Math.max(0, slot.score + delta * points);
    slot[type + '_points'] = Math.max(0, (slot[type + '_points'] || 0) + delta * points);
    checkCompetition(controller, store);
    store.SaveChangdiData(0, controller.gvi.game[0]);
    controller.SendGameData();
    return true;
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
    var competition = !!(root.PSS_MODES && root.PSS_MODES.isCompetition());
    if (hit.value >= threshold) {
      opponent.score += helmet ? 3 : 2;
      if (helmet) opponent.tkhits++;
      else opponent.hjhits++;
      if (competition) {
        var pointsKey = helmet ? 'head_points' : 'body_points';
        opponent[pointsKey] = (opponent[pointsKey] || 0) + (helmet ? 3 : 2);
      }
      if (root.PSS_AUDIO) root.PSS_AUDIO.hit('court', equipment.court + 1);
      else store.PlaySound(helmet ? 'score_3.wav' : 'score_2.wav');
    } else if (competition) {
      var weakKey = helmet ? 'weak_head' : 'weak_body';
      opponent[weakKey] = (opponent[weakKey] || 0) + 1;
      opponent.valid = (opponent.weak_head || 0) + (opponent.weak_body || 0);
      opponent.last_weak = {
        type: helmet ? 'head' : 'body',
        raw: hit.value,
        level: hit.value / core.RAW_PER_LEVEL,
        threshold: threshold / core.RAW_PER_LEVEL,
        at: Date.now()
      };
      if (root.document && root.setTimeout) {
        (function (slot, reading) {
          root.setTimeout(function () {
            if (slot.last_weak !== reading) return;
            slot.last_weak = null;
            if (!controller._isDestroyed) {
              controller.SendGameData();
              if (root.PSS_SPECTATOR) root.PSS_SPECTATOR.publish(controller);
            }
          }, 3000);
        })(opponent, opponent.last_weak);
      }
    } else if (!helmet) {
      opponent.valid++;
    }
    checkCompetition(controller, store);
    controller.SendGameData();
  }
  var api = {
    ignoreSpaceShortcut: ignoreSpaceShortcut,
    conflicts: conflicts,
    canStart: canStart,
    prepareCourts: prepareCourts,
    loadCourts: loadCourts,
    renameParticipant: renameParticipant,
    changeEquipment: changeEquipment,
    equipmentOwner: equipmentOwner,
    canAdjustCompetition: canAdjustCompetition,
    adjustScore: adjustScore,
    adjustGamJeom: adjustGamJeom,
    adjustTechnical: adjustTechnical,
    scoreHit: scoreHit
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.UOBTKD_CONTROLLER_FIXES = api;
})(typeof window !== 'undefined' ? window : globalThis);
