/* Categorised application preferences. */
(function (root) {
  'use strict';
  function createComponent(store) {
    return {
      name: 'AppSettings',
      data: function () {
        var info = JSON.parse(JSON.stringify(store.ReadGameInfo() || store.GAMEINFO));
        if (info.competition_max_gam_jeom === undefined) info.competition_max_gam_jeom = 5;
        if (info.competition_point_gap === undefined) info.competition_point_gap = 15;
        return {
          info: info,
          activeTab: 'Training',
          sounds: root.PSS_AUDIO.state.enabled,
          volume: Math.round(root.PSS_AUDIO.state.volume * 100),
          message: '',
          bindings: root.PSS_KEYS.get(),
          captureAction: '',
          previewSound: 'roundStart',
          autoSpectator: root.PSS_SPECTATOR.preferences.autoOpenCompetition
        };
      },
      beforeDestroy: function () {
        root.PSS_KEYS.cancelCapture(false);
      },
      methods: {
        save: function () {
          var fields = [
            ['game_rounds', 1, 99],
            ['game_time', 1, 36000],
            ['rest_time', 0, 3600],
            ['toukui_gate', 0, 71],
            ['competition_max_gam_jeom', 1, 99],
            ['competition_point_gap', 0, 999]
          ];
          for (var i = 0; i < fields.length; i++) {
            var rule = fields[i],
              raw = this.info[rule[0]],
              value = Number(raw);
            if (
              String(raw).trim() === '' ||
              !isFinite(value) ||
              Math.floor(value) !== value ||
              value < rule[1] ||
              value > rule[2]
            ) {
              this.message =
                'Check the match settings. Enter whole numbers within the displayed limits.';
              return;
            }
            this.info[rule[0]] = value;
          }
          if (!String(this.info.game_name || '').trim()) {
            this.message = 'Enter a team name.';
            return;
          }
          store.SaveGameInfo(JSON.parse(JSON.stringify(this.info)));
          this.message = 'Settings saved.';
        },
        home: function () {
          this.$router.push({ name: 'Index' });
        },
        setSounds: function (event) {
          this.sounds = event.target.checked;
          root.PSS_AUDIO.setEnabled(this.sounds);
        },
        setVolume: function (event) {
          this.volume = Number(event.target.value);
          root.PSS_AUDIO.setVolume(this.volume / 100);
        },
        recordKey: function (action) {
          var view = this;
          this.captureAction = action.id;
          this.message = 'Press a shortcut. Escape cancels.';
          root.PSS_KEYS.capture(action.id, function (error) {
            view.captureAction = '';
            view.bindings = root.PSS_KEYS.get();
            view.message = error || 'Shortcut saved.';
          });
        },
        clearKey: function (action) {
          try {
            root.PSS_KEYS.set(action.id, '');
            this.bindings = root.PSS_KEYS.get();
            this.message = 'Shortcut cleared.';
          } catch (error) {
            this.message = error.message;
          }
        },
        resetKeys: function () {
          try {
            root.PSS_KEYS.cancelCapture(false);
            this.captureAction = '';
            this.bindings = root.PSS_KEYS.reset();
            this.message = 'Default shortcuts restored.';
          } catch (error) {
            this.message = error.message;
          }
        }
      },
      render: function () {
        var view = this,
          h = view._self._c;
        function button(label, action, attrs) {
          return h('button', { attrs: attrs || { type: 'button' }, on: { click: action } }, [
            view._v(label)
          ]);
        }
        function field(key, label, min, max) {
          return h('label', { staticClass: 'pss-settings-field' }, [
            h('span', [view._v(label)]),
            h('input', {
              attrs: {
                type: key === 'game_name' ? 'text' : 'number',
                'aria-label': label,
                min: min,
                max: max,
                step: 1,
                maxlength: key === 'game_name' ? 80 : null
              },
              domProps: { value: view.info[key] },
              on: {
                input: function (event) {
                  view.$set(view.info, key, event.target.value);
                  view.message = '';
                }
              }
            })
          ]);
        }
        var contents;
        if (view.activeTab === 'Training')
          contents = [
            h('h2', [view._v('Training and timing')]),
            field('game_name', 'Team name'),
            field('game_time', 'Round duration in seconds (1–36000)', 1, 36000),
            field('rest_time', 'Break duration in seconds (0–3600)', 0, 3600),
            field('toukui_gate', 'Helmet threshold (0–71)', 0, 71),
            h('p', [
              view._v(
                'Court Training repeats continuously. Saved times apply from the next training interval. These times are also the defaults for new competition matches. Free Training uses a stopwatch.'
              )
            ])
          ];
        else if (view.activeTab === 'Competition')
          contents = [
            h('h2', [view._v('Competition rules')]),
            field('game_rounds', 'Rounds (1–99)', 1, 99),
            field('competition_max_gam_jeom', 'Maximum gam-jeoms per round (1–99)', 1, 99),
            field('competition_point_gap', 'Point gap (0 disables, maximum 999)', 0, 999),
            h('p', [
              view._v(
                'Best of the configured rounds. Timing comes from the Training tab. Saved changes apply to the next match or after Reset match.'
              )
            ])
          ];
        else if (view.activeTab === 'Sound')
          contents = [
            h('h2', [view._v('Sound')]),
            h('label', [
              h('input', {
                attrs: { type: 'checkbox' },
                domProps: { checked: view.sounds },
                on: { change: view.setSounds }
              }),
              view._v(' Enable sounds')
            ]),
            h('label', { staticClass: 'pss-settings-field' }, [
              h('span', [view._v('Volume')]),
              h('input', {
                attrs: { type: 'range', min: 0, max: 100, 'aria-label': 'Settings sound volume' },
                domProps: { value: view.volume },
                on: { input: view.setVolume }
              })
            ]),
            h('label', { staticClass: 'pss-settings-field' }, [
              h('span', [view._v('Preview sound')]),
              h(
                'select',
                {
                  attrs: { 'aria-label': 'Preview sound' },
                  domProps: { value: view.previewSound },
                  on: {
                    change: function (event) {
                      view.previewSound = event.target.value;
                    }
                  }
                },
                [
                  ['roundStart', 'Round start'],
                  ['roundEnd', 'Round end'],
                  ['breakEnd', 'Break end'],
                  ['addpoints', 'Add points'],
                  ['gamjeom', 'Gam-jeom'],
                  ['deduct', 'Deduct points']
                ].map(function (item) {
                  return h('option', { attrs: { value: item[0] } }, [view._v(item[1])]);
                })
              )
            ]),
            button('Play preview', function () {
              root.PSS_AUDIO.event(view.previewSound);
            }),
            h('p', [view._v('Sound changes are saved immediately.')])
          ];
        else if (view.activeTab === 'Keyboard')
          contents = [
            h('h2', [view._v('Keyboard shortcuts')]),
            h('p', [
              view._v(
                'Click a shortcut to record it. Use letters, numbers, arrows, F1–F12 or modifier combinations. Enter, Tab and Windows shortcuts are reserved. Scoring shortcuts only act in Competition; typing in fields never changes scores.'
              )
            ]),
            h(
              'div',
              { staticClass: 'pss-keybindings' },
              root.PSS_KEYS.actions.map(function (action) {
                return h('div', { staticClass: 'pss-keybinding' }, [
                  h('span', [view._v(action.label)]),
                  button(
                    view.captureAction === action.id
                      ? 'Press a key…'
                      : view.bindings[action.id] || 'Unassigned',
                    function () {
                      view.recordKey(action);
                    },
                    { type: 'button', 'aria-label': 'Change ' + action.label + ' shortcut' }
                  ),
                  button(
                    'Clear',
                    function () {
                      view.clearKey(action);
                    },
                    { type: 'button', 'aria-label': 'Clear ' + action.label + ' shortcut' }
                  )
                ]);
              })
            ),
            button('Restore default shortcuts', view.resetKeys),
            h('p', [
              view._v(
                'Shortcuts are saved immediately. Holding a key does not repeatedly award points.'
              )
            ])
          ];
        else
          contents = [
            h('h2', [view._v('Spectator display')]),
            h('label', [
              h('input', {
                attrs: { type: 'checkbox' },
                domProps: { checked: view.autoSpectator },
                on: {
                  change: function (event) {
                    view.autoSpectator = event.target.checked;
                    root.PSS_SPECTATOR.configure({ autoOpenCompetition: view.autoSpectator });
                    view.message = 'Display preference saved.';
                  }
                }
              }),
              view._v(' Automatically open competition spectator window')
            ]),
            h('p', [
              view._v(
                'Spectator windows open full screen. Use the control panel to open or close them, or Escape to close the focused spectator window.'
              )
            ])
          ];
        return h('main', { staticClass: 'pss-settings' }, [
          h('header', { staticClass: 'pss-free-header' }, [
            h('h1', [view._v('Settings')]),
            button('Home', view.home)
          ]),
          h(
            'nav',
            {
              staticClass: 'pss-settings-tabs',
              attrs: { role: 'tablist', 'aria-label': 'Settings categories' }
            },
            ['Training', 'Competition', 'Sound', 'Keyboard', 'Display'].map(function (tab) {
              return button(
                tab,
                function () {
                  root.PSS_KEYS.cancelCapture(false);
                  view.captureAction = '';
                  view.activeTab = tab;
                  view.message = '';
                },
                {
                  type: 'button',
                  role: 'tab',
                  'aria-selected': view.activeTab === tab,
                  'aria-controls': 'settings-' + tab.toLowerCase()
                }
              );
            })
          ),
          h(
            'section',
            {
              staticClass: 'pss-settings-section',
              attrs: {
                role: 'tabpanel',
                id: 'settings-' + view.activeTab.toLowerCase(),
                'aria-label': view.activeTab + ' settings'
              }
            },
            contents
          ),
          view.activeTab === 'Training' || view.activeTab === 'Competition'
            ? button('Save settings', view.save)
            : view._e(),
          h('p', { attrs: { role: 'status' } }, [view._v(view.message)])
        ]);
      }
    };
  }
  root.PSS_SETTINGS = { createComponent: createComponent };
})(window);
