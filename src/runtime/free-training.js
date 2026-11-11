/* Individual hit-received tracking with a stopwatch or repeating training intervals. */
(function (root) {
  'use strict';
  var core =
    typeof module !== 'undefined' && module.exports ? require('./core.js') : root.UOBTKD_CORE;
  var STORAGE_KEY = 'bristol_free_training_v1';
  // Reuse the documented vendor command and renew device work before it expires.
  // This is transport maintenance, never a session clock or scoring deadline.
  var WORK_COMMAND = 'StartWork,time:60,gate:1,level:1';
  var RENEW_INTERVAL = 30000;

  function timeText(milliseconds) {
    var seconds = Math.floor(Math.max(0, Number(milliseconds) || 0) / 1000);
    var minutes = Math.floor(seconds / 60);
    return (minutes < 10 ? '0' : '') + minutes + ':' + ('0' + (seconds % 60)).slice(-2);
  }
  function duration(value, fallback, minimum) {
    value = Number(value);
    return isFinite(value) && Math.floor(value) === value && value >= minimum && value <= 36000
      ? value
      : fallback;
  }
  function clockText(view) {
    return timeText(
      view.timerMode === 'rounds' ? Math.ceil(view.roundRemainingMs / 1000) * 1000 : view.elapsedMs
    );
  }
  function phaseText(view) {
    if (view.timerMode !== 'rounds') return view.active ? 'Tracking' : 'Paused';
    var label =
      view.roundPhase === 'break' ? 'Break' : view.roundPhase === 'ready' ? 'Ready' : 'Training';
    return !view.active && view.roundPhase !== 'ready' ? label + ' paused' : label;
  }
  function soundKey(session, person) {
    return (session.participants.indexOf(person) % 6) + 1;
  }
  function colour(person) {
    var registry = root.PSS_EQUIPMENT && root.PSS_EQUIPMENT.registry;
    var device =
      registry && (registry.findDevice(person.bodyId) || registry.findDevice(person.helmetId));
    var value = device && (device.detectedColour || device.colour);
    return value && /^(blue|red)$/i.test(value)
      ? value.toLowerCase()
      : person.id % 2
        ? 'blue'
        : 'red';
  }
  function createModel(saved) {
    var model = { participants: [], nextId: 1 };
    var editable = ['name', 'bodyId', 'helmetId', 'bodyLevel', 'helmetLevel'];

    function find(id) {
      for (var i = 0; i < model.participants.length; i++) {
        if (model.participants[i].id === id) return model.participants[i];
      }
      throw new Error('Participant not found.');
    }

    function validate(person, exclude) {
      ['bodyId', 'helmetId'].forEach(function (field) {
        var id = core.normalizeId(person[field]);
        if (id && !/^[a-f0-9]{12}$/.test(id))
          throw new Error('Equipment IDs must contain 12 letters A–F or digits.');
        person[field] = id;
        if (!id) return;
        if (person.bodyId === person.helmetId)
          throw new Error('Use a different ID for the helmet and body protector.');
        model.participants.forEach(function (other) {
          if (other.id !== exclude && (other.bodyId === id || other.helmetId === id)) {
            throw new Error('Device ' + id + ' is already assigned to ' + other.name + '.');
          }
        });
      });
      ['bodyLevel', 'helmetLevel'].forEach(function (field) {
        var level = core.parseLevel(person[field]);
        if (level === null)
          throw new Error('Thresholds must be whole levels from 0 to ' + core.MAX_LEVEL + '.');
        person[field] = level;
      });
    }

    function fresh(values) {
      values = values || {};
      return {
        id: model.nextId,
        name: typeof values.name === 'string' ? values.name.slice(0, 80) : 'Person ' + model.nextId,
        bodyId: core.normalizeId(values.bodyId),
        helmetId: core.normalizeId(values.helmetId),
        bodyLevel: values.bodyLevel === undefined ? 8 : values.bodyLevel,
        helmetLevel: values.helmetLevel === undefined ? 1 : values.helmetLevel,
        score: 0,
        bodyHits: 0,
        helmetHits: 0,
        belowThreshold: 0,
        lastHit: null
      };
    }

    model.add = function (values) {
      var person = fresh(values);
      validate(person, null);
      model.nextId++;
      model.participants.push(person);
      return person;
    };
    model.find = find;
    model.swapEquipment = function (id, field, value) {
      if (field !== 'bodyId' && field !== 'helmetId') throw new Error('Choose a protector field.');
      value = core.normalizeId(value);
      if (value && !/^[a-f0-9]{12}$/.test(value)) throw new Error('Choose valid equipment.');
      var person = find(id),
        other = null,
        old = person[field];
      model.participants.forEach(function (candidate) {
        if (
          candidate !== person &&
          (candidate.bodyId === value || candidate.helmetId === value) &&
          value
        )
          other = candidate;
      });
      if (other && other[field] !== value)
        throw new Error('That device is used as a different protector type.');
      if (value && person[field === 'bodyId' ? 'helmetId' : 'bodyId'] === value)
        throw new Error('Use different body and head protectors.');
      if (other) {
        other[field] = old;
        other.lastHit = null;
      }
      person[field] = value;
      person.lastHit = null;
    };
    model.update = function (id, field, value) {
      if (editable.indexOf(field) < 0) throw new Error('This field cannot be edited.');
      var person = find(id),
        candidate = {};
      editable.forEach(function (key) {
        candidate[key] = person[key];
      });
      candidate[field] = field === 'name' ? String(value).slice(0, 80) : value;
      validate(candidate, id);
      editable.forEach(function (key) {
        person[key] = candidate[key];
      });
      if (field === 'bodyId' || field === 'helmetId') person.lastHit = null;
    };
    model.remove = function (id) {
      var person = find(id);
      model.participants.splice(model.participants.indexOf(person), 1);
    };
    model.reset = function (id) {
      var person = find(id);
      person.score = 0;
      person.bodyHits = 0;
      person.helmetHits = 0;
      person.belowThreshold = 0;
      person.lastHit = null;
    };
    model.resetGroup = function () {
      model.participants.forEach(function (person) {
        model.reset(person.id);
      });
    };
    model.groupScore = function () {
      return model.participants.reduce(function (total, person) {
        return total + person.score;
      }, 0);
    };
    model.hasEquipment = function () {
      return model.participants.some(function (person) {
        return !!(person.bodyId || person.helmetId);
      });
    };
    model.record = function (payload, count, onScore) {
      var hit = core.parseImpact(payload);
      if (!hit) return false;
      for (var i = 0; i < model.participants.length; i++) {
        var person = model.participants[i];
        var type = person.helmetId === hit.id ? 'helmet' : person.bodyId === hit.id ? 'body' : '';
        if (!type) continue;
        var valid =
          hit.value >= core.rawThreshold(type === 'helmet' ? person.helmetLevel : person.bodyLevel);
        person.lastHit = {
          raw: hit.value,
          level: hit.value / core.RAW_PER_LEVEL,
          type: type,
          valid: valid
        };
        if (count) {
          if (valid) {
            person.score++;
            if (type === 'helmet') person.helmetHits++;
            else person.bodyHits++;
            if (onScore) onScore(person);
          } else person.belowThreshold++;
        }
        return true;
      }
      return false;
    };
    model.snapshot = function () {
      return {
        version: 1,
        nextId: model.nextId,
        participants: model.participants.map(function (person) {
          var copy = {};
          Object.keys(person).forEach(function (key) {
            copy[key] = person[key];
          });
          return copy;
        })
      };
    };
    if (saved && saved.version === 1 && Array.isArray(saved.participants)) {
      var restoredIds = {};
      saved.participants.forEach(function (record) {
        var person = model.add(record);
        var savedId = Number(record.id);
        if (
          isFinite(savedId) &&
          savedId > 0 &&
          Math.floor(savedId) === savedId &&
          !restoredIds[savedId]
        ) {
          person.id = savedId;
        }
        restoredIds[person.id] = true;
        model.nextId = Math.max(model.nextId, person.id + 1);
        ['score', 'bodyHits', 'helmetHits', 'belowThreshold'].forEach(function (field) {
          var value = Number(record[field]);
          person[field] = isFinite(value) && value >= 0 ? Math.floor(value) : 0;
        });
      });
      if (isFinite(saved.nextId) && saved.nextId > model.nextId)
        model.nextId = Math.floor(saved.nextId);
    }
    return model;
  }

  function createComponent(store) {
    function notify(message) {
      root.UOBTKD_UI.notify(message);
    }
    return {
      name: 'FreeTraining',
      data: function () {
        var saved = null;
        try {
          saved = JSON.parse(root.localStorage.getItem(STORAGE_KEY));
        } catch (error) {
          notify('Saved free-training data could not be read.');
        }
        var session;
        try {
          session = createModel(saved);
        } catch (error) {
          session = createModel();
          notify('Saved participants could not be loaded: ' + error.message);
        }
        var info = store.GAMEINFO || {};
        var timing = (saved && saved.timing) || {};
        var trainingSeconds = duration(timing.trainingSeconds, duration(info.game_time, 120, 1), 1);
        var breakSeconds = duration(timing.breakSeconds, duration(info.rest_time, 60, 0), 0);
        return {
          timerMode: timing.mode === 'rounds' ? 'rounds' : 'stopwatch',
          trainingSeconds: trainingSeconds,
          breakSeconds: breakSeconds,
          roundPhase: /^(training|break)$/.test(timing.phase) ? timing.phase : 'ready',
          roundRemainingMs:
            isFinite(timing.remainingMs) &&
            timing.remainingMs >= 0 &&
            timing.remainingMs <= 36000000
              ? Number(timing.remainingMs)
              : trainingSeconds * 1000,
          roundRules: {
            training: trainingSeconds * 1000,
            rest: duration(timing.restMs / 1000, breakSeconds, 0) * 1000
          },
          session: session,
          active: false,
          elapsedMs:
            saved && isFinite(saved.elapsedMs) && saved.elapsedMs >= 0
              ? Number(saved.elapsedMs)
              : 0,
          columns: 1,
          rows: 1,
          cardScale: 1,
          online: !!store.IS_ONLINE,
          availableBody: store.huju_devices || [],
          availableHelmet: store.toukui_devices || []
        };
      },
      methods: {
        resizeLayout: function () {
          var container = this.$el && this.$el.querySelector('.pss-free-people');
          var area = container && container.getBoundingClientRect();
          var width = (area && area.width) || (root.innerWidth || 1600) - 28;
          var height = (area && area.height) || (root.innerHeight || 1000) - 150;
          var count = Math.max(1, this.session.participants.length);
          var best = { columns: 1, rows: count, scale: 0 };
          for (var columns = 1; columns <= count; columns++) {
            var rows = Math.ceil(count / columns);
            var scale = Math.min(1.6, (width / columns - 6) / 560, (height / rows - 6) / 330);
            if (scale > best.scale) best = { columns: columns, rows: rows, scale: scale };
          }
          this.columns = best.columns;
          this.rows = best.rows;
          this.cardScale = Math.max(0.01, best.scale);
        },
        changeTimerMode: function (event) {
          if (this.active) return;
          this.timerMode = event.target.value === 'rounds' ? 'rounds' : 'stopwatch';
          this.resetRoundTimer();
          this.$nextTick(this.resizeLayout);
        },
        setDuration: function (field, event) {
          var value = duration(event.target.value, null, field === 'trainingSeconds' ? 1 : 0);
          if (value === null) {
            event.target.value = this[field];
            return;
          }
          this[field] = value;
          if (this.roundPhase === 'ready') this.roundRemainingMs = this.trainingSeconds * 1000;
          this.save();
        },
        resetRoundTimer: function () {
          this.pause(true);
          this.roundPhase = 'ready';
          this.roundRemainingMs = this.trainingSeconds * 1000;
          this.save();
        },
        beginTrainingInterval: function () {
          this.roundRules = {
            training: this.trainingSeconds * 1000,
            rest: this.breakSeconds * 1000
          };
          this.roundPhase = 'training';
          this.roundRemainingMs = this.roundRules.training;
          this.session.resetGroup();
          store.IS_GAMING = true;
          if (root.PSS_AUDIO) root.PSS_AUDIO.event('roundStart');
          this.renewDevices();
        },
        advanceRoundTimer: function (elapsed) {
          while (elapsed >= this.roundRemainingMs) {
            elapsed -= this.roundRemainingMs;
            if (this.roundPhase === 'training') {
              if (root.PSS_AUDIO) root.PSS_AUDIO.event('roundEnd');
              if (this.roundRules.rest) {
                this.roundPhase = 'break';
                this.roundRemainingMs = this.roundRules.rest;
                store.IS_GAMING = false;
                this.stopDevices();
              } else this.beginTrainingInterval();
            } else {
              if (root.PSS_AUDIO) root.PSS_AUDIO.event('breakEnd');
              this.beginTrainingInterval();
            }
          }
          this.roundRemainingMs -= elapsed;
        },
        stopDevices: function () {
          var parent = this.$parent;
          core.DEVICE_TOPICS.forEach(function (topic) {
            parent.sendMessage(topic, 'StopWork', store.MQTT_OPTION);
          });
        },
        updateStopwatch: function () {
          if (this.active && this._stopwatchStartedAt !== undefined) {
            var now = Date.now();
            this.elapsedMs = this._stopwatchBase + Math.max(0, now - this._stopwatchStartedAt);
            if (this.timerMode === 'rounds')
              this.advanceRoundTimer(Math.max(0, now - this._roundTickAt));
            this._roundTickAt = now;
          }
        },
        resetStopwatch: function () {
          this.elapsedMs = 0;
          this._stopwatchBase = 0;
          this._stopwatchStartedAt = Date.now();
          this.save();
        },
        save: function () {
          try {
            var snapshot = this.session.snapshot();
            snapshot.elapsedMs = this.elapsedMs;
            snapshot.timing = {
              mode: this.timerMode,
              trainingSeconds: this.trainingSeconds,
              breakSeconds: this.breakSeconds,
              phase: this.roundPhase,
              remainingMs: this.roundRemainingMs,
              restMs: this.roundRules.rest
            };
            root.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
          } catch (error) {
            notify('Changes are in memory but could not be saved on this computer.');
          }
        },
        addPerson: function (values) {
          try {
            var person = this.session.add(values);
            this.resizeLayout();
            this.save();
            var view = this;
            this.$nextTick(function () {
              view.resizeLayout();
              var input = view.$el.querySelector('[data-person-name="' + person.id + '"]');
              if (input) {
                input.focus();
                input.select();
              }
            });
          } catch (error) {
            notify(error.message);
          }
        },
        updatePerson: function (person, field, event) {
          try {
            if (
              (field === 'bodyId' || field === 'helmetId') &&
              event.target.value &&
              root.PSS_EQUIPMENT
            ) {
              var device = root.PSS_EQUIPMENT.registry.findDevice(event.target.value);
              if (
                !device ||
                (device.detectedType || device.type) !== (field === 'bodyId' ? 'body' : 'helmet')
              )
                throw new Error('Choose the correct protector type.');
            }
            if (field === 'bodyId' || field === 'helmetId')
              this.session.swapEquipment(person.id, field, event.target.value);
            else this.session.update(person.id, field, event.target.value);
            this.save();
          } catch (error) {
            event.target.value = person[field];
            notify(error.message);
          }
        },
        removePerson: function (person) {
          this.session.remove(person.id);
          this.resizeLayout();
          if (!this.session.hasEquipment() && this.active) this.pause();
          this.save();
        },
        resetPerson: function (person) {
          this.session.reset(person.id);
          this.save();
        },
        resetGroup: function () {
          this.session.resetGroup();
          this.save();
        },
        renewDevices: function () {
          if (
            !this.active ||
            !this.online ||
            (this.timerMode === 'rounds' && this.roundPhase !== 'training')
          )
            return;
          var parent = this.$parent;
          core.DEVICE_TOPICS.forEach(function (topic) {
            parent.sendMessage(topic, WORK_COMMAND, store.MQTT_OPTION);
          });
        },
        start: function () {
          if (!this.session.participants.length) {
            notify('Add a person before starting tracking.');
            return;
          }
          if (this.active) return;
          this._stopwatchBase = this.elapsedMs;
          this._stopwatchStartedAt = Date.now();
          this._roundTickAt = this._stopwatchStartedAt;
          this.active = true;
          this._stopwatchTicker = root.setInterval(this.updateStopwatch, 100);
          store.IS_GAMING = this.timerMode !== 'rounds' || this.roundPhase !== 'break';
          if (this.timerMode === 'rounds' && this.roundPhase === 'ready')
            this.beginTrainingInterval();
          else if (this.timerMode !== 'rounds' && root.PSS_AUDIO)
            root.PSS_AUDIO.event(this._hasStarted ? 'resume' : 'roundStart');
          this._hasStarted = true;
          this.renewDevices();
          this._renewal = root.setInterval(this.renewDevices, RENEW_INTERVAL);
        },
        pause: function (silent) {
          var wasActive = this.active;
          this.updateStopwatch();
          if (this._stopwatchTicker) root.clearInterval(this._stopwatchTicker);
          this._stopwatchTicker = null;
          this.active = false;
          this.save();
          store.IS_GAMING = false;
          if (this._renewal) root.clearInterval(this._renewal);
          this._renewal = null;
          if (wasActive) {
            if (!silent && root.PSS_AUDIO) root.PSS_AUDIO.event('pause');
            this.stopDevices();
          }
        },
        toggleTracking: function () {
          if (this.active) this.pause();
          else this.start();
        },
        receive: function (payload) {
          this.updateStopwatch();
          var session = this.session;
          if (
            this.session.record(
              payload,
              this.active &&
                this.online &&
                (this.timerMode !== 'rounds' || this.roundPhase === 'training'),
              function (person) {
                if (root.PSS_AUDIO) root.PSS_AUDIO.hit('person', soundKey(session, person));
              }
            )
          )
            this.save();
        },
        onOnline: function (online) {
          this.online = !!online;
          if (this.active) this.renewDevices();
        },
        onDevices: function () {
          this.availableBody = store.huju_devices || [];
          this.availableHelmet = store.toukui_devices || [];
          if (this.active) this.renewDevices();
        },
        onSpace: function () {
          if (!root.UOBTKD_CONTROLLER_FIXES.ignoreSpaceShortcut()) this.toggleTracking();
        },
        home: function () {
          this.$router.push({ name: 'Index' });
        }
      },
      mounted: function () {
        if (root.document) {
          root.document.body.classList.add('pss-free-open');
          root.document.documentElement.classList.add('pss-free-open');
        }
        this.resizeLayout();
        if (root.addEventListener) root.addEventListener('resize', this.resizeLayout);
        var parent = this.$parent;
        this._previousCallbacks = {
          devdata_cb: parent.devdata_cb,
          online_cb: parent.online_cb,
          devstate_cb: parent.devstate_cb,
          vkspace_cb: parent.vkspace_cb
        };
        parent.devdata_cb = this.receive;
        parent.online_cb = this.onOnline;
        parent.devstate_cb = this.onDevices;
        parent.vkspace_cb = this.onSpace;
        parent.MqttRequestDeviceList();
        if (root.PSS_SPECTATOR) root.PSS_SPECTATOR.attach(this);
      },
      beforeDestroy: function () {
        if (root.document) {
          root.document.body.classList.remove('pss-free-open');
          root.document.documentElement.classList.remove('pss-free-open');
        }
        if (root.removeEventListener) root.removeEventListener('resize', this.resizeLayout);
        this.pause(true);
        if (this._hasStarted && root.PSS_AUDIO) root.PSS_AUDIO.event('roundEnd');
        this.save();
        if (root.PSS_SPECTATOR) root.PSS_SPECTATOR.detach(this);
        var parent = this.$parent,
          previous = this._previousCallbacks;
        if (previous)
          Object.keys(previous).forEach(function (key) {
            parent[key] = previous[key];
          });
      },
      render: function () {
        var view = this,
          h = view._self._c;
        function button(text, callback, attrs) {
          return h('button', { attrs: attrs || { type: 'button' }, on: { click: callback } }, [
            view._v(text)
          ]);
        }
        function field(person, key, label, type, list) {
          var attrs = { type: type || 'text', 'aria-label': label + ' for ' + person.name };
          if (key === 'name') {
            attrs['data-person-name'] = person.id;
            attrs.maxlength = '80';
          }
          if (type === 'number') {
            attrs.min = 0;
            attrs.max = core.MAX_LEVEL;
            attrs.step = 1;
          }
          if (list) attrs.list = list;
          var events = {};
          events[key === 'name' ? 'input' : 'change'] = function (event) {
            view.updatePerson(person, key, event);
          };
          return h('label', { staticClass: 'pss-free-field' }, [
            h('span', [view._v(label)]),
            h('input', { attrs: attrs, domProps: { value: person[key] }, on: events })
          ]);
        }
        function choices(id, values) {
          return h(
            'datalist',
            { attrs: { id: id } },
            view._l(values, function (value) {
              return h('option', { key: value, attrs: { value: value } });
            })
          );
        }
        function equipmentField(person, key, type, label) {
          if (!root.PSS_EQUIPMENT)
            return field(
              person,
              key,
              label + ' ID',
              'text',
              type === 'body' ? 'free-body-devices' : 'free-helmet-devices'
            );
          var equipment = root.PSS_EQUIPMENT;
          return h('div', { staticClass: 'pss-equipment-picker' }, [
            h('label', { staticClass: 'pss-free-field' }, [
              h('span', [view._v(label)]),
              h(
                'select',
                {
                  attrs: { 'aria-label': label + ' for ' + person.name },
                  domProps: { value: person[key] },
                  on: {
                    change: function (event) {
                      view.updatePerson(person, key, event);
                    }
                  }
                },
                [
                  h('option', { attrs: { value: '' } }, [view._v('None')]),
                  view._l(equipment.ids(type, person[key]), function (id) {
                    return h('option', { attrs: { value: id } }, [
                      view._v(
                        equipment.option(id, type) +
                          (view.session.participants.some(function (other) {
                            return other.id !== person.id && other[key] === id;
                          })
                            ? ' (swap with ' +
                              view.session.participants.filter(function (other) {
                                return other.id !== person.id && other[key] === id;
                              })[0].name +
                              ')'
                            : '')
                      )
                    ]);
                  })
                ],
                2
              )
            ]),
            button(
              'More information',
              function () {
                equipment.open(person[key]);
              },
              {
                type: 'button',
                disabled: !person[key],
                'aria-label': label + ' information for ' + person.name
              }
            )
          ]);
        }
        return h('main', { staticClass: 'pss-free' }, [
          h('header', { staticClass: 'pss-free-header' }, [
            h('h1', [view._v('Free Training')]),
            button('Home', view.home)
          ]),
          root.PSS_SPECTATOR ? root.PSS_SPECTATOR.controls(view, h) : view._e(),
          h('div', { staticClass: 'pss-free-toolbar pss-free-timing' }, [
            h('label', [
              view._v('Timer '),
              h(
                'select',
                {
                  attrs: { 'aria-label': 'Free training timer', disabled: view.active },
                  domProps: { value: view.timerMode },
                  on: { change: view.changeTimerMode }
                },
                [
                  h('option', { attrs: { value: 'stopwatch' } }, [view._v('Stopwatch')]),
                  h('option', { attrs: { value: 'rounds' } }, [view._v('Repeating rounds')])
                ]
              )
            ]),
            view.timerMode === 'rounds'
              ? h('label', [
                  view._v('Training (seconds) '),
                  h('input', {
                    attrs: {
                      type: 'number',
                      min: 1,
                      max: 36000,
                      step: 1,
                      'aria-label': 'Free training duration in seconds'
                    },
                    domProps: { value: view.trainingSeconds },
                    on: {
                      change: function (event) {
                        view.setDuration('trainingSeconds', event);
                      }
                    }
                  })
                ])
              : view._e(),
            view.timerMode === 'rounds'
              ? h('label', [
                  view._v('Break (seconds) '),
                  h('input', {
                    attrs: {
                      type: 'number',
                      min: 0,
                      max: 36000,
                      step: 1,
                      'aria-label': 'Free training break in seconds'
                    },
                    domProps: { value: view.breakSeconds },
                    on: {
                      change: function (event) {
                        view.setDuration('breakSeconds', event);
                      }
                    }
                  })
                ])
              : view._e(),
            view.timerMode === 'rounds'
              ? h('span', [
                  view._v('Changes apply next training interval. Scores reset each interval.')
                ])
              : view._e()
          ]),
          h('div', { staticClass: 'pss-free-toolbar' }, [
            button(view.active ? 'Pause tracking' : 'Start tracking', view.toggleTracking),
            h('span', { attrs: { role: 'status' } }, [
              view._v(phaseText(view) + (!view.online ? ' � Receiver offline' : ''))
            ]),
            button('Add person', function () {
              view.addPerson();
            }),
            button('Reset group scores', view.resetGroup),
            h(
              'strong',
              { attrs: { 'data-free-stopwatch': '', 'aria-label': 'Elapsed training time' } },
              [view._v(clockText(view))]
            ),
            button(
              view.timerMode === 'rounds' ? 'Reset timer' : 'Reset stopwatch',
              view.timerMode === 'rounds' ? view.resetRoundTimer : view.resetStopwatch
            ),
            h('strong', [view._v('Group score: ' + view.session.groupScore())])
          ]),
          choices('free-body-devices', view.availableBody),
          choices('free-helmet-devices', view.availableHelmet),
          view.session.participants.length
            ? h(
                'div',
                { staticClass: 'pss-free-people' },
                view._l(view.session.participants, function (person, index) {
                  var hit = person.lastHit;
                  return h(
                    'article',
                    {
                      key: person.id,
                      staticClass: 'pss-free-person',
                      class: 'pss-free-' + colour(person),
                      style: {
                        width: '560px',
                        height: '330px',
                        left: (((index % view.columns) + 0.5) * 100) / view.columns + '%',
                        top: ((Math.floor(index / view.columns) + 0.5) * 100) / view.rows + '%',
                        transform: 'translate(-50%, -50%) scale(' + view.cardScale + ')'
                      },
                      attrs: { 'data-person-id': person.id }
                    },
                    [
                      field(person, 'name', 'Name'),
                      h('div', { staticClass: 'pss-free-score' }, [
                        view._v('Score: ' + person.score)
                      ]),
                      h('p', [
                        view._v(
                          'Body hits ' +
                            person.bodyHits +
                            ' · Helmet hits ' +
                            person.helmetHits +
                            ' · Below threshold ' +
                            person.belowThreshold
                        )
                      ]),
                      h('p', { staticClass: 'pss-free-reading' }, [
                        view._v(
                          hit
                            ? (hit.type === 'helmet' ? 'Helmet' : 'Body') +
                                ': ' +
                                hit.raw +
                                ' raw (L' +
                                hit.level.toFixed(2) +
                                ') — ' +
                                (hit.valid ? 'meets threshold' : 'below threshold')
                            : 'Latest impact: --'
                        )
                      ]),
                      h('div', { staticClass: 'pss-free-fields' }, [
                        equipmentField(person, 'bodyId', 'body', 'Body protector'),
                        equipmentField(person, 'helmetId', 'helmet', 'Helmet'),
                        field(person, 'bodyLevel', 'Body threshold', 'number'),
                        field(person, 'helmetLevel', 'Helmet threshold', 'number')
                      ]),
                      h('p', { staticClass: 'pss-free-device-status' }, [
                        view._v(
                          !person.bodyId && !person.helmetId
                            ? 'No equipment assigned'
                            : 'Body ' +
                                (view.availableBody.map(core.normalizeId).indexOf(person.bodyId) >=
                                  0 && person.bodyId
                                  ? 'on'
                                  : 'off') +
                                ' · Helmet ' +
                                (view.availableHelmet
                                  .map(core.normalizeId)
                                  .indexOf(person.helmetId) >= 0 && person.helmetId
                                  ? 'on'
                                  : 'off')
                        )
                      ]),
                      h('div', { staticClass: 'pss-free-actions' }, [
                        button('Reset score', function () {
                          view.resetPerson(person);
                        }),
                        button(
                          'Test hit sound',
                          function () {
                            if (root.PSS_AUDIO)
                              root.PSS_AUDIO.hit('person', soundKey(view.session, person));
                          },
                          { type: 'button', 'aria-label': 'Test hit sound for ' + person.name }
                        ),
                        button('Remove person', function () {
                          view.removePerson(person);
                        })
                      ])
                    ]
                  );
                }),
                0
              )
            : h('p', { staticClass: 'pss-free-empty' }, [view._v('Add a person to begin.')])
        ]);
      }
    };
  }

  var api = {
    createModel: createModel,
    timeText: timeText,
    clockText: clockText,
    phaseText: phaseText,
    colour: colour,
    soundKey: soundKey,
    createComponent: createComponent,
    STORAGE_KEY: STORAGE_KEY,
    WORK_COMMAND: WORK_COMMAND,
    RENEW_INTERVAL: RENEW_INTERVAL
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PSS_FREE_TRAINING = api;
})(typeof window !== 'undefined' ? window : globalThis);
