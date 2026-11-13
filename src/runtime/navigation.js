/* Shared back navigation for web Escape and the native Escape bridge. */
(function (root) {
  'use strict';
  var host = null,
    store = null,
    history = [],
    backPending = false,
    competitionReturn = null;
  function route(value) {
    return { name: value.name, params: value.params || {}, query: value.query || {} };
  }
  function activeController() {
    var found = null;
    function visit(view) {
      if (!view || view._isDestroyed) return;
      if (view.gvi && view.gvi.game && typeof view.exit_to_data === 'function') found = view;
      (view.$children || []).forEach(visit);
    }
    visit(host);
    return found;
  }
  function attach(view, data) {
    if (host) return;
    host = view;
    if (root.PSS_KEYS) root.PSS_KEYS.attach(view);
    store = data;
    history = [route(host.$route)];
    host.$router.beforeEach(function (to, from, next) {
      var controller = activeController();
      if (from.name === 'GameCtrl' && to.name !== 'GameCtrl') host.vkspace_cb = null;
      if (
        from.name === 'GameCtrl' &&
        (to.name === 'GameData' ||
          (to.name === 'CompetitionJudges' && to.query.returnToMatch === '1')) &&
        controller &&
        root.PSS_MODES.isCompetition()
      ) {
        if (to.name === 'CompetitionJudges') {
          var phase = controller.gvi.game[0].competition.phase;
          if (phase === 'running' || phase === 'break') controller.gameControl();
          if (root.PSS_JUDGES) root.PSS_JUDGES.prepareMatchReturn(controller);
        }
        competitionReturn = JSON.parse(JSON.stringify(controller.gvi.game));
      }
      if (
        to.name === 'GameCtrl' &&
        to.query.mode === 'competition' &&
        !root.PSS_MODES.isCompetition()
      ) {
        if (!competitionReturn) {
          backPending = false;
          next({ name: 'CompetitionSetup' });
          return;
        }
        root.PSS_MODES.enterCompetition(
          store,
          {
            name: competitionReturn[0].left.gamer,
            club: competitionReturn[0].left.club,
            bodyId: competitionReturn[0].left.huju,
            helmetId: competitionReturn[0].left.toukui
          },
          {
            name: competitionReturn[0].right.gamer,
            club: competitionReturn[0].right.club,
            bodyId: competitionReturn[0].right.huju,
            helmetId: competitionReturn[0].right.toukui
          }
        );
        competitionReturn.forEach(function (court, index) {
          store.SaveChangdiData(index, court);
        });
        store.game_list = competitionReturn;
        competitionReturn = null;
      }
      if (
        from.name === 'GameCtrl' &&
        to.name !== 'GameCtrl' &&
        controller &&
        !root.PSS_MODES.isCompetition()
      )
        controller.gvi.game.forEach(function (court, index) {
          store.SaveChangdiData(index, court);
        });
      next();
    });
    host.$router.afterEach(function (to) {
      if (to.name === 'Index') {
        if (root.PSS_JUDGES) root.PSS_JUDGES.cancelSetup();
        competitionReturn = null;
        history = [route(to)];
        backPending = false;
        return;
      }
      if (backPending) {
        backPending = false;
        return;
      }
      history.push(route(to));
    });
  }
  function back() {
    if (root.PSS_EQUIPMENT && root.PSS_EQUIPMENT.isOpen()) {
      root.PSS_EQUIPMENT.close();
      return;
    }
    if (root.UOBTKD_SENSOR_MONITOR && root.UOBTKD_SENSOR_MONITOR.isOpen()) {
      root.UOBTKD_SENSOR_MONITOR.close();
      return;
    }
    var controller = activeController();
    if (
      controller &&
      controller.gvi.game[0].competition &&
      controller.gvi.game[0].competition.ivrPending
    ) {
      controller.cancelIVR();
      return;
    }
    var modal = root.document.querySelector('.modal.in');
    if (modal && root.jQuery) {
      root.jQuery(modal).modal('hide');
      return;
    }
    if (!host || host.$route.name === 'Index' || backPending) return;
    var previousHistory = history.slice(),
      current = route(host.$route),
      target;
    if (history.length > 1) history.pop();
    while (
      history.length &&
      JSON.stringify(history[history.length - 1]) === JSON.stringify(current)
    )
      history.pop();
    target = history.length
      ? history[history.length - 1]
      : {
          name:
            host.$route.name === 'GameCtrl' && root.PSS_MODES.isCompetition()
              ? 'CompetitionSetup'
              : 'Index'
        };
    backPending = true;
    function completed() {
      backPending = false;
    }
    function failed() {
      backPending = false;
      if (JSON.stringify(route(host.$route)) === JSON.stringify(current)) history = previousHistory;
    }
    try {
      var pending = host.$router.push(target, completed, failed);
      if (pending && pending.then) pending.then(completed, failed);
    } catch (error) {
      failed();
    }
  }

  function equipment() {
    if (host && host.$route.name !== 'GameData') host.$router.push({ name: 'GameData' });
  }
  root.document.addEventListener(
    'keydown',
    function (event) {
      if (root.PSS_KEYS) return;
      if (event.key === 'Escape' || event.keyCode === 27) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) back();
      }
    },
    true
  );
  root.OnVkEscape = function () {
    if (root.PSS_KEYS) root.PSS_KEYS.nativeKey('Escape');
    else back();
  };
  root.PSS_NAV = {
    attach: attach,
    back: back,
    equipment: equipment,
    quit: function () {
      if (root.PSS_SPECTATOR) root.PSS_SPECTATOR.close();
      if (host && host.stopGame) host.stopGame();
      if (typeof root.HostQuit === 'function') root.HostQuit();
      else root.close();
    },
    rewriteEquipment: function (oldId, newId, type) {
      (competitionReturn || []).forEach(function (court) {
        ['left', 'right'].forEach(function (side) {
          var slot = court[side];
          if (slot.huju === oldId) slot.huju = type === 'body' ? newId : '';
          if (slot.toukui === oldId) slot.toukui = type === 'helmet' ? newId : '';
        });
      });
    }
  };
})(window);
