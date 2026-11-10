/* Main-menu settings: existing match defaults and shared audio preferences. */
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
          sounds: root.PSS_AUDIO.state.enabled,
          volume: Math.round(root.PSS_AUDIO.state.volume * 100),
          message: ''
        };
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
        }
      },
      render: function () {
        var view = this,
          h = view._self._c;
        function button(text, action) {
          return h('button', { attrs: { type: 'button' }, on: { click: action } }, [view._v(text)]);
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
        return h('main', { staticClass: 'pss-settings' }, [
          h('header', { staticClass: 'pss-free-header' }, [
            h('h1', [view._v('Settings')]),
            button('Home', view.home)
          ]),
          h('section', { staticClass: 'pss-settings-section' }, [
            h('h2', [view._v('Match defaults')]),
            h('p', [
              view._v('Used by Court Training and Competition. Free Training has no timer.')
            ]),
            field('game_name', 'Team name'),
            field('game_rounds', 'Rounds (1–99)', 1, 99),
            field('game_time', 'Round duration in seconds (1–36000)', 1, 36000),
            field('rest_time', 'Break duration in seconds (0–3600)', 0, 3600),
            field('toukui_gate', 'Helmet threshold (0–71)', 0, 71),
            h('h3', [view._v('Competition rules')]),
            field('competition_max_gam_jeom', 'Maximum gam-jeoms per round (1–99)', 1, 99),
            field('competition_point_gap', 'Point gap (0 disables, maximum 999)', 0, 999),
            h('p', [
              view._v(
                'Competition uses best of the configured rounds. First to more than half wins; each round starts at 0–0 with no gam-jeoms. Odd round counts avoid a tied series. Changes apply to the next match or after Reset match.'
              )
            ]),
            button('Save match settings', view.save),
            h('p', { attrs: { role: 'status' } }, [view._v(view.message)])
          ]),
          h('section', { staticClass: 'pss-settings-section' }, [
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
            button('Test sound', function () {
              root.PSS_AUDIO.event('roundStart');
            }),
            h('p', [view._v('Sound changes are saved immediately.')])
          ])
        ]);
      }
    };
  }
  root.PSS_SETTINGS = { createComponent: createComponent };
})(window);
