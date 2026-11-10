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
    store = data;
    history = [route(host.$route)];
    host.$router.beforeEach(function (to, from, next) {
      var controller = activeController();
      if (from.name === 'GameCtrl' && to.name !== 'GameCtrl') host.vkspace_cb = null;
      if (
        from.name === 'GameCtrl' &&
        to.name === 'GameData' &&
        controller &&
        root.PSS_MODES.isCompetition()
      ) {
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
            bodyId: competitionReturn[0].left.huju,
            helmetId: competitionReturn[0].left.toukui
          },
          {
            name: competitionReturn[0].right.gamer,
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
    var modal = root.document.querySelector('.modal.in');
    if (modal && root.jQuery) {
      root.jQuery(modal).modal('hide');
      return;
    }
    if (!host || host.$route.name === 'Index' || backPending) return;
    var target;
    if (history.length > 1) {
      history.pop();
      target = history[history.length - 1];
    } else
      target = {
        name:
          host.$route.name === 'GameCtrl' && root.PSS_MODES.isCompetition()
            ? 'CompetitionSetup'
            : 'Index'
      };
    backPending = true;
    host.$router.push(target);
  }
  function equipment() {
    if (host && host.$route.name !== 'GameData') host.$router.push({ name: 'GameData' });
  }
  root.document.addEventListener(
    'keydown',
    function (event) {
      if (event.key === 'Escape' || event.keyCode === 27) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) back();
      }
    },
    true
  );
  root.OnVkEscape = back;
  root.PSS_NAV = {
    attach: attach,
    back: back,
    equipment: equipment,
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
