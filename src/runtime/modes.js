/* One timed competition court with names and equipment independent of any roster. */
(function (root) {
  'use strict';
  var core =
    typeof module !== 'undefined' && module.exports ? require('./core.js') : root.LEDA_CORE;
  var backup = null,
    BACKUP_KEY = 'uobtkd_competition_backup_v1',
    SETUP_KEY = 'uobtkd_competition_setup_v1';
  var selection = {
    blue: { name: 'Blue', bodyId: '', helmetId: '' },
    red: { name: 'Red', bodyId: '', helmetId: '' }
  };
  function testChecks() {
    return {
      blue: { bodyId: { count: 0, raw: null }, helmetId: { count: 0, raw: null } },
      red: { bodyId: { count: 0, raw: null }, helmetId: { count: 0, raw: null } }
    };
  }
  function participant(value, fallback) {
    value = value || {};
    return {
      name: typeof value.name === 'string' ? value.name.slice(0, 80) : fallback,
      bodyId: core.normalizeId(value.bodyId),
      helmetId: core.normalizeId(value.helmetId)
    };
  }
  function readSetup() {
    try {
      var saved = root.localStorage && JSON.parse(root.localStorage.getItem(SETUP_KEY));
      if (saved)
        selection = { blue: participant(saved.blue, 'Blue'), red: participant(saved.red, 'Red') };
    } catch (error) {
      /* Keep editable defaults. */
    }
    return JSON.parse(JSON.stringify(selection));
  }
  function saveSetup(blue, red) {
    selection = { blue: participant(blue, 'Blue'), red: participant(red, 'Red') };
    if (root.localStorage) root.localStorage.setItem(SETUP_KEY, JSON.stringify(selection));
  }
  function validateDevice(id, type) {
    if (!id) return;
    if (!/^[a-f0-9]{12}$/.test(id)) throw new Error('Choose valid equipment.');
    if (root.PSS_EQUIPMENT) {
      var device = root.PSS_EQUIPMENT.registry.findDevice(id);
      if (!device || (device.detectedType || device.type) !== type)
        throw new Error('Choose the correct protector type.');
    }
  }
  function enterCompetition(store, blue, red) {
    if (backup) throw new Error('A competition is already open.');
    if (!blue || !red || typeof blue !== 'object' || typeof red !== 'object')
      throw new Error('Enter competitor details.');
    var chosen = [participant(blue, 'Blue'), participant(red, 'Red')],
      used = {};
    chosen.forEach(function (person) {
      ['bodyId', 'helmetId'].forEach(function (key) {
        var id = person[key];
        validateDevice(id, key === 'bodyId' ? 'body' : 'helmet');
        if (id && used[id]) throw new Error('The competitors cannot share equipment.');
        if (id) used[id] = true;
      });
    });
    var saved = [],
      games = [];
    for (var i = 0; i < core.COURT_COUNT; i++) {
      var previous = store.ReadChangdiData(i);
      saved.push(previous ? JSON.parse(JSON.stringify(previous)) : null);
      games.push({
        lidu: core.savedLevel(previous && previous.lidu, 8),
        left: core.emptyParticipant(),
        right: core.emptyParticipant()
      });
    }
    chosen.forEach(function (person, index) {
      var slot = core.emptyParticipant();
      slot.index = index;
      slot.gamer = person.name;
      slot.huju = person.bodyId;
      slot.toukui = person.helmetId;
      games[0][index === 0 ? 'left' : 'right'] = slot;
    });
    backup = {
      saved: saved,
      games: store.game_list,
      left: store.left_gamer_list,
      right: store.right_gamer_list,
      view: store.court_view_mode
    };
    try {
      if (root.localStorage) root.localStorage.setItem(BACKUP_KEY, JSON.stringify(backup));
      for (i = 0; i < games.length; i++) store.SaveChangdiData(i, games[i]);
      store.game_list = games;
      store.left_gamer_list = [];
      store.right_gamer_list = [];
      store.court_view_mode = 0;
      saveSetup(chosen[0], chosen[1]);
    } catch (error) {
      leaveCompetition(store);
      throw error;
    }
  }
  function leaveCompetition(store) {
    if (!backup) return;
    var previous = backup,
      current = store.ReadChangdiData(0);
    if (current && current.left && current.right)
      saveSetup(
        { name: current.left.gamer, bodyId: current.left.huju, helmetId: current.left.toukui },
        { name: current.right.gamer, bodyId: current.right.huju, helmetId: current.right.toukui }
      );
    for (var i = 0; i < previous.saved.length; i++)
      store.SaveChangdiData(
        i,
        previous.saved[i] || {
          lidu: 8,
          left: core.emptyParticipant(),
          right: core.emptyParticipant()
        }
      );
    store.game_list = previous.games;
    store.left_gamer_list = previous.left;
    store.right_gamer_list = previous.right;
    store.court_view_mode = previous.view;
    backup = null;
    if (root.localStorage) root.localStorage.removeItem(BACKUP_KEY);
  }
  function recover(store) {
    if (root.localStorage && !backup) {
      var saved = root.localStorage.getItem(BACKUP_KEY);
      if (saved) {
        backup = JSON.parse(saved);
        leaveCompetition(store);
      }
    }
  }
  function rewriteEquipment(oldId, newId, type) {
    var setup = readSetup();
    ['blue', 'red'].forEach(function (side) {
      var person = setup[side];
      if (person.bodyId === oldId) person.bodyId = type === 'body' ? newId : '';
      if (person.helmetId === oldId) person.helmetId = type === 'helmet' ? newId : '';
    });
    saveSetup(setup.blue, setup.red);
  }
  function createComponent(store) {
    recover(store);
    return {
      name: 'CompetitionSetup',
      data: function () {
        var setup = readSetup();
        setup.online = !!store.IS_ONLINE;
        setup.testing = false;
        setup.testEnabled = true;
        setup.checks = testChecks();
        return setup;
      },
      methods: {
        home: function () {
          this.$router.push({ name: 'Index' });
        },
        save: function () {
          saveSetup(this.blue, this.red);
          if (root.PSS_SPECTATOR) root.PSS_SPECTATOR.publish(this);
        },
        start: function () {
          try {
            enterCompetition(store, this.blue, this.red);
            this.stopTest();
            this.$router.push({ name: 'GameCtrl', query: { mode: 'competition' } });
          } catch (error) {
            root.LEDA_UI.notify(error.message);
          }
        },
        renewTest: function () {
          if (!this.testing || !this.online) return;
          var host = this.$parent;
          core.DEVICE_TOPICS.forEach(function (topic) {
            host.sendMessage(topic, 'StartWork,time:60,gate:1,level:1', store.MQTT_OPTION);
          });
        },
        stopTest: function () {
          if (this._testRenewal) root.clearInterval(this._testRenewal);
          this._testRenewal = null;
          var wasTesting = this.testing;
          this.testing = false;
          if (wasTesting && this.online) {
            var host = this.$parent;
            core.DEVICE_TOPICS.forEach(function (topic) {
              host.sendMessage(topic, 'StopWork', store.MQTT_OPTION);
            });
          }
        },
        syncTest: function () {
          var assigned =
            this.blue.bodyId || this.blue.helmetId || this.red.bodyId || this.red.helmetId;
          if (!this.testEnabled || !this.online || !assigned) {
            this.stopTest();
            return;
          }
          this.testing = true;
          this.renewTest();
          if (!this._testRenewal) this._testRenewal = root.setInterval(this.renewTest, 30000);
        },
        toggleTest: function () {
          this.testEnabled = !this.testEnabled;
          this.syncTest();
        },
        resetTest: function () {
          this.checks = testChecks();
        },
        onTestOnline: function (online) {
          this.online = !!online;
          this.syncTest();
        },
        onTestDevices: function () {
          this.syncTest();
        },
        onTestImpact: function (payload) {
          if (!this.testing || !this.online) return;
          var hit = core.parseImpact(payload);
          if (!hit) return;
          for (var i = 0; i < 2; i++) {
            var side = i === 0 ? 'blue' : 'red';
            for (var j = 0; j < 2; j++) {
              var key = j === 0 ? 'bodyId' : 'helmetId';
              if (this[side][key] === hit.id) {
                var check = this.checks[side][key];
                check.count++;
                check.raw = hit.value;
                check.at = Date.now();
                if (root.PSS_SPECTATOR) root.PSS_SPECTATOR.publish(this);
                if (hit.value > 0 && root.PSS_AUDIO) root.PSS_AUDIO.hit('court', 1);
                return;
              }
            }
          }
        },
        assign: function (side, key, event) {
          var person = this[side],
            other = this[side === 'blue' ? 'red' : 'blue'],
            value = core.normalizeId(event.target.value),
            old = person[key];
          try {
            validateDevice(value, key === 'bodyId' ? 'body' : 'helmet');
            if (
              value &&
              (other[key === 'bodyId' ? 'helmetId' : 'bodyId'] === value ||
                person[key === 'bodyId' ? 'helmetId' : 'bodyId'] === value)
            )
              throw new Error('Choose the correct protector type.');
            if (value && other[key] === value) {
              other[key] = old;
              this.checks[side === 'blue' ? 'red' : 'blue'][key] = { count: 0, raw: null };
            }
            person[key] = value;
            this.checks[side][key] = { count: 0, raw: null };
            this.save();
            this.syncTest();
          } catch (error) {
            event.target.value = old;
            root.LEDA_UI.notify(error.message);
          }
        }
      },
      mounted: function () {
        var host = this.$parent;
        this._testCallbacks = {
          devdata_cb: host.devdata_cb,
          online_cb: host.online_cb,
          devstate_cb: host.devstate_cb,
          vkspace_cb: host.vkspace_cb
        };
        host.devdata_cb = this.onTestImpact;
        host.online_cb = this.onTestOnline;
        host.devstate_cb = this.onTestDevices;
        host.vkspace_cb = null;
        host.MqttRequestDeviceList();
        this.syncTest();
        if (root.PSS_SPECTATOR) root.PSS_SPECTATOR.attachTesting(this);
      },
      beforeDestroy: function () {
        if (root.PSS_SPECTATOR) root.PSS_SPECTATOR.detach(this);
        this.stopTest();
        var host = this.$parent,
          previous = this._testCallbacks;
        if (previous)
          Object.keys(previous).forEach(function (key) {
            host[key] = previous[key];
          });
      },
      render: function () {
        var view = this,
          h = view._self._c,
          equipment = root.PSS_EQUIPMENT;
        function button(text, action) {
          return h('button', { attrs: { type: 'button' }, on: { click: action } }, [view._v(text)]);
        }
        return h('main', { staticClass: 'pss-competition-setup' }, [
          h('header', { staticClass: 'pss-free-header' }, [
            h('h1', [view._v('Competition · Protector test')]),
            button('Home', view.home),
            button('Open spectator window', function () {
              root.PSS_SPECTATOR.open();
            })
          ]),
          h('p', [
            view._v(
              'Test the assigned protectors before entering match mode. Received signals appear below; test hits never score and no match clock runs. Names are locked in match mode.'
            )
          ]),
          h('div', { staticClass: 'pss-protector-test-toolbar' }, [
            h('strong', { attrs: { role: 'status' } }, [
              view._v(
                !view.online
                  ? 'Receiver offline'
                  : view.testing
                    ? 'Listening for test hits'
                    : view.testEnabled
                      ? 'Assign equipment to test'
                      : 'Testing paused'
              )
            ]),
            button(
              view.testEnabled ? 'Pause protector test' : 'Resume protector test',
              view.toggleTest
            ),
            button('Reset test readings', view.resetTest)
          ]),
          h(
            'div',
            { staticClass: 'pss-competition-pair' },
            view._l(['blue', 'red'], function (side) {
              var person = view[side],
                title = side === 'blue' ? 'Blue' : 'Red',
                other = view[side === 'blue' ? 'red' : 'blue'];
              return h('section', { class: 'pss-competition-' + side }, [
                h('h2', [view._v(title)]),
                h('label', [
                  view._v('Name '),
                  h('input', {
                    attrs: {
                      type: 'text',
                      maxlength: 80,
                      'aria-label': title + ' competitor name',
                      placeholder: 'Name'
                    },
                    domProps: { value: person.name },
                    on: {
                      input: function (event) {
                        person.name = event.target.value;
                        view.save();
                      }
                    }
                  })
                ]),
                h(
                  'div',
                  view._l(
                    [
                      { key: 'bodyId', type: 'body', label: 'Body protector' },
                      { key: 'helmetId', type: 'helmet', label: 'Head protector' }
                    ],
                    function (spec) {
                      return h('div', { staticClass: 'pss-equipment-picker' }, [
                        h('label', [
                          view._v(spec.label + ' '),
                          h(
                            'select',
                            {
                              attrs: { 'aria-label': title + ' ' + spec.label },
                              domProps: { value: person[spec.key] },
                              on: {
                                change: function (event) {
                                  view.assign(side, spec.key, event);
                                }
                              }
                            },
                            [
                              h('option', { attrs: { value: '' } }, [view._v('None')]),
                              view._l(equipment.ids(spec.type, person[spec.key]), function (id) {
                                return h('option', { attrs: { value: id } }, [
                                  view._v(
                                    equipment.option(id, spec.type) +
                                      (id === other[spec.key]
                                        ? ' (swap with ' + (other.name || 'other side') + ')'
                                        : '')
                                  )
                                ]);
                              })
                            ],
                            2
                          )
                        ]),
                        h(
                          'p',
                          {
                            staticClass: 'pss-protector-test-reading',
                            attrs: { 'data-test-side': side, 'data-test-kind': spec.key }
                          },
                          [
                            view._v(
                              !person[spec.key]
                                ? 'Not assigned'
                                : view.checks[side][spec.key].count
                                  ? 'Received ' +
                                    view.checks[side][spec.key].count +
                                    ' signals · raw ' +
                                    view.checks[side][spec.key].raw +
                                    ' · level ' +
                                    (view.checks[side][spec.key].raw / core.RAW_PER_LEVEL).toFixed(
                                      2
                                    )
                                  : 'Waiting for hit'
                            )
                          ]
                        ),
                        button('More information', function () {
                          equipment.open(person[spec.key]);
                        })
                      ]);
                    }
                  ),
                  0
                )
              ]);
            }),
            0
          ),
          button('Enter match mode', view.start)
        ]);
      }
    };
  }
  var api = {
    recover: recover,
    isCompetition: function () {
      return !!backup;
    },
    enterCompetition: enterCompetition,
    leaveCompetition: leaveCompetition,
    rewriteEquipment: rewriteEquipment,
    createComponent: createComponent
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PSS_MODES = api;
})(typeof window !== 'undefined' ? window : globalThis);
