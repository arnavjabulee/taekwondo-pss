/* Text-only court view. The build replaces __COUNT__ with the layout size. */

(function () {
  var view = this;

  var h = view._self._c;

  function equipment(court, side, slot, key, type, title) {
    var parent = view.$parent,
      current = parent.gvi.game[court][side][key];

    return h('label', { staticClass: 'pss-court-equipment' }, [
      h('span', [view._v(__COUNT__ === 16 ? (type === 'body' ? 'Body' : 'Head') : title)]),

      h(
        'select',

        {
          attrs: {
            'aria-label':
              'Court ' + (court + 1) + (side === 'left' ? ' blue ' : ' red ') + title.toLowerCase()
          },

          domProps: { value: current },

          on: {
            change: function (event) {
              try {
                parent.setParticipantEquipment(court, side, key, event.target.value);
              } catch (error) {
                event.target.value = current;

                window.UOBTKD_UI.notify(error.message);
              }
            }
          }
        },

        [
          h('option', { attrs: { value: '' } }, [view._v('None')]),

          view._l(window.PSS_EQUIPMENT.ids(type, current), function (id) {
            var owner =
              id !== current ? window.UOBTKD_CONTROLLER_FIXES.equipmentOwner(parent, id) : '';

            return h('option', { attrs: { value: id } }, [
              view._v(
                window.PSS_EQUIPMENT.option(id, type) + (owner ? ' (swap with ' + owner + ')' : '')
              )
            ]);
          })
        ],

        2
      ),

      h(
        'button',

        {
          staticClass: 'pss-equipment-link',

          attrs: {
            type: 'button',

            disabled: !current,

            'aria-label':
              'Court ' +
              (court + 1) +
              (side === 'left' ? ' blue ' : ' red ') +
              title.toLowerCase() +
              ' information'
          },

          on: {
            click: function (event) {
              event.preventDefault();

              window.PSS_EQUIPMENT.open(current);
            }
          }
        },

        [view._v('Info')]
      )
    ]);
  }

  function participant(court, side) {
    var slot = view.gvi.game[court][side];

    var parentSlot = view.$parent.gvi.game[court][side];

    var blue = side === 'left';

    var offset = court * 4 + (blue ? 0 : 2);

    var competition = window.PSS_MODES.isCompetition();

    var title = blue ? 'Blue' : 'Red';

    var enabled = window.UOBTKD_CONTROLLER_FIXES.canAdjustCompetition(view.$parent);

    var matchState = competition ? window.PSS_COMPETITION.state(view.$parent) : null;
    var penaltiesEnabled = competition && window.PSS_COMPETITION.canManagePenalties(view.$parent);

    var leading = competition ? window.PSS_COMPETITION.leaders(view.$parent.gvi.game[0]) : null;

    function adjustButton(label, aria, action, disabled) {
      return h(
        'button',

        {
          attrs: { type: 'button', 'aria-label': aria, disabled: disabled },

          on: { click: action }
        },

        [view._v(label)]
      );
    }

    return h('section', { staticClass: 'pss-participant', class: blue ? 'pss-blue' : 'pss-red' }, [
      competition
        ? h('div', { staticClass: 'pss-competition-identity' }, [
            h('span', [view._v(title)]),

            h('span', {
              staticClass: 'pss-leader-light',

              class: { lit: !!(matchState && leading[side]) },

              style: {
                visibility: 'visible'
              },

              attrs: {
                role: 'img',

                'aria-label': title + (leading[side] ? ' leading' : ' trailing')
              }
            }),

            h('h2', { staticClass: 'pss-competition-name' }, [view._v(parentSlot.gamer || title)]),

            parentSlot.club
              ? h('div', { staticClass: 'pss-competition-club' }, [view._v(parentSlot.club)])
              : view._e()
          ])
        : h('label', { staticClass: 'pss-participant-name' }, [
            h('span', [view._v(blue ? 'Blue' : 'Red')]),

            h('input', {
              attrs: {
                type: 'text',

                maxlength: 80,

                placeholder: 'Name',

                'aria-label': 'Court ' + (court + 1) + (blue ? ' blue name' : ' red name')
              },

              domProps: { value: parentSlot.gamer },

              on: {
                input: function (event) {
                  view.$parent.setParticipantName(court, side, event.target.value);
                }
              }
            })
          ]),

      h('div', { staticClass: 'uobtkd-impact' }, [
        view._v(window.UOBTKD_SENSOR_MONITOR.formatHit(slot))
      ]),

      h('div', { staticClass: 'pss-score' }, [view._v(view._s(slot.score))]),

      h('div', { staticClass: 'pss-hit-counts' }, [
        view._v('Head hits ' + slot.tkhits + ' · Body hits ' + slot.hjhits)
      ]),

      competition
        ? h('div', { staticClass: 'pss-kick-stats' }, [
            h('div', [
              view._v(
                'Technical kicks: body ' +
                  (slot.technical_body || 0) +
                  ' · head ' +
                  (slot.technical_head || 0) +
                  ' \u00b7 points ' +
                  (2 * (slot.technical_body || 0) + 3 * (slot.technical_head || 0))
              )
            ]),

            h('div', [
              view._v(
                'Techniques: head ' +
                  Math.floor((slot.head_points || 0) / 3) +
                  ' · body ' +
                  Math.floor((slot.body_points || 0) / 2) +
                  ' · punches ' +
                  (slot.punches || 0)
              )
            ]),

            h('div', { staticClass: 'pss-weak-counts' }, [
              view._v(
                'Below threshold: head ' +
                  (slot.weak_head || 0) +
                  ' · body ' +
                  (slot.weak_body || 0) +
                  ' · total ' +
                  ((slot.weak_head || 0) + (slot.weak_body || 0))
              )
            ]),

            slot.last_weak
              ? h(
                  'div',

                  {
                    staticClass: 'pss-panel-weak-meter',

                    class: {
                      'labels-close': Math.abs(slot.last_weak.threshold - slot.last_weak.level) < 6
                    }
                  },

                  [
                    h('div', { staticClass: 'weak-track' }, [
                      h('span', {
                        staticClass: 'threshold-mark',

                        style: {
                          left:
                            Math.max(0, Math.min(100, (slot.last_weak.threshold / 72) * 100)) + '%'
                        }
                      }),

                      h(
                        'b',

                        {
                          staticClass: 'threshold-value',

                          style: {
                            left:
                              Math.max(0, Math.min(100, (slot.last_weak.threshold / 72) * 100)) +
                              '%'
                          }
                        },

                        [view._v(Math.round(slot.last_weak.threshold))]
                      ),

                      h('span', {
                        staticClass: 'measured-mark',

                        style: {
                          left: Math.max(0, Math.min(100, (slot.last_weak.level / 72) * 100)) + '%'
                        }
                      }),

                      h(
                        'b',

                        {
                          staticClass: 'measured-value',

                          style: {
                            left:
                              Math.max(0, Math.min(100, (slot.last_weak.level / 72) * 100)) + '%'
                          }
                        },

                        [view._v(Math.round(slot.last_weak.level))]
                      )
                    ])
                  ]
                )
              : view._e()
          ])
        : view._e(),

      competition
        ? h('div', { staticClass: 'pss-competition-controls' }, [
            h(
              'div',

              { staticClass: 'pss-technical-controls' },

              view._l(['body', 'head'], function (type) {
                var label = type === 'body' ? 'body' : 'head',
                  points = type === 'body' ? 2 : 3;

                return h('div', [
                  adjustButton(
                    'Technical ' + label + ' +' + points,

                    title + ' technical ' + label + ' +' + points,

                    function () {
                      view.$parent.adjustCompetitionTechnical(side, type, 1);
                    },

                    !enabled
                  ),

                  adjustButton(
                    'Undo',

                    title + ' undo technical ' + label,

                    function () {
                      view.$parent.adjustCompetitionTechnical(side, type, -1);
                    },

                    !enabled || !(slot['technical_' + type] > 0)
                  )
                ]);
              })
            ),

            h('div', { staticClass: 'pss-ivr-controls' }, [
              h('span', [
                view._v(
                  'IVR card: ' +
                    (matchState && matchState.ivrPending && matchState.ivrPending.side === side
                      ? 'in review'
                      : matchState && matchState.ivrCards && matchState.ivrCards[side]
                        ? 'available'
                        : 'unavailable')
                )
              ]),
              adjustButton(
                'Raise IVR',
                'Raise ' + title + ' IVR appeal',
                function () {
                  view.$parent.raiseIVR(side);
                },
                !penaltiesEnabled ||
                  !matchState ||
                  !matchState.ivrCards ||
                  !matchState.ivrCards[side]
              ),
              adjustButton(
                'Undo IVR decision',
                'Undo ' + title + ' IVR decision',
                function () {
                  view.$parent.undoIVR(side);
                },
                !window.PSS_COMPETITION.canUndoIVR(view.$parent, side)
              )
            ]),
            h('div', { staticClass: 'pss-gam-jeom-controls' }, [
              h('strong', [view._v('Gam-jeoms: ' + slot.warning)]),

              adjustButton(
                'Add gam-jeom',

                'Add ' + title + ' gam-jeom',

                function () {
                  view.$parent.adjustCompetitionGamJeom(side, 1);
                },

                !penaltiesEnabled
              ),

              adjustButton(
                'Undo gam-jeom',

                'Remove ' + title + ' gam-jeom',

                function () {
                  view.$parent.adjustCompetitionGamJeom(side, -1);
                },

                !penaltiesEnabled ||
                  slot.warning - (slot.passive_warnings || 0) - (slot.ivr_warnings || 0) <= 0
              )
            ]),

            matchState &&
            matchState.started &&
            (matchState.remaining <= 10 || slot.passive_warnings > 0)
              ? h('div', { staticClass: 'pss-passive-gam-jeom-controls' }, [
                  adjustButton(
                    'Add passive gam-jeom',
                    'Add ' + title + ' passive gam-jeom',
                    function () {
                      view.$parent.adjustCompetitionGamJeom(side, 1, true);
                    },
                    !penaltiesEnabled || matchState.remaining > 10
                  ),

                  adjustButton(
                    'Undo passive gam-jeom',
                    'Remove ' + title + ' passive gam-jeom',
                    function () {
                      view.$parent.adjustCompetitionGamJeom(side, -1, true);
                    },
                    (!penaltiesEnabled &&
                      !window.UOBTKD_CONTROLLER_FIXES.canUndoPassive(view.$parent, side)) ||
                      !(slot.passive_warnings > 0)
                  ),

                  h('small', [
                    view._v(
                      'Passive: ' + (slot.passive_warnings || 0) + ' \u00b7 2 points to opponent'
                    )
                  ])
                ])
              : view._e(),

            h(
              'div',

              { staticClass: 'pss-point-controls' },

              view._l([1, 2, 3, -1, -2, -3], function (delta) {
                return adjustButton(
                  (Math.abs(delta) === 1 ? 'Punch ' : '') +
                    (delta > 0 ? '+' : '−') +
                    Math.abs(delta),

                  title + (delta > 0 ? ' add ' : ' remove ') + Math.abs(delta) + ' points',

                  function () {
                    view.$parent.adjustCompetitionScore(side, delta);
                  },

                  !enabled
                );
              })
            ),

            h('small', [
              view._v(
                enabled
                  ? 'Gam-jeoms and IVR: paused play or breaks. Standard penalty: 1 point.'
                  : window.PSS_COMPETITION.state(view.$parent) &&
                      window.PSS_COMPETITION.state(view.$parent).results.length
                    ? 'Use Undo last round to reopen the previous round for corrections.'
                    : 'Start the match to enable score controls.'
              )
            ])
          ])
        : view._e(),

      h('div', { staticClass: 'pss-equipment' }, [
        equipment(court, side, slot, 'huju', 'body', 'Body protector'),

        equipment(court, side, slot, 'toukui', 'helmet', 'Head protector'),

        view._v(
          'Helmet ' +
            (view.gvi.dev_state[offset] ? 'on' : 'off') +
            ' · Body ' +
            (view.gvi.dev_state[offset + 1] ? 'on' : 'off')
        )
      ])
    ]);
  }

  if (window.PSS_MODES.isCompetition() && view.$parent.gvi.competitionTab === 'spectator')
    return h('div', { staticClass: 'uobtkd-courts pss-courts pss-spectator-preview-container' }, [
      __COUNT__ === 1 ? window.PSS_SPECTATOR.preview(view, h, view.$parent) : view._e()
    ]);

  var courts = h(
    'div',

    { staticClass: 'uobtkd-courts pss-courts pss-courts-__COUNT__' },

    view._l(__COUNT__, function (number) {
      var court = number - 1;

      return h('article', { key: court, staticClass: 'pss-court' }, [
        window.PSS_MODES.isCompetition()
          ? window.PSS_SPECTATOR.tabs(view, h, view.$parent)
          : view._e(),

        h('header', { staticClass: 'pss-court-heading' }, [
          view._v((window.PSS_MODES.isCompetition() ? 'Competition · ' : '') + 'Court ' + number)
        ]),

        window.PSS_MODES.isCompetition()
          ? window.PSS_COMPETITION.render(view, h, view.$parent)
          : view._e(),

        h('div', { staticClass: 'pss-sides' }, [
          participant(court, 'left'),

          participant(court, 'right')
        ]),

        h('footer', { staticClass: 'pss-court-threshold' }, [
          h('span', [view._v('Threshold')]),

          h(
            'button',

            {
              attrs: { type: 'button', 'aria-label': 'Lower court ' + number + ' threshold' },

              on: {
                click: function () {
                  view.$parent.lidu_reduce(court);
                }
              }
            },

            [view._v('−')]
          ),

          h('span', [view._v(view._s(view.gvi.game[court].lidu))]),

          h(
            'button',

            {
              attrs: { type: 'button', 'aria-label': 'Raise court ' + number + ' threshold' },

              on: {
                click: function () {
                  view.$parent.lidu_plus(court);
                }
              }
            },

            [view._v('+')]
          ),

          h(
            'button',

            {
              attrs: { type: 'button', 'aria-label': 'Test court ' + number + ' hit sound' },

              on: {
                click: function () {
                  window.PSS_AUDIO.hit('court', number);
                }
              }
            },

            [view._v('Test hit')]
          )
        ])
      ]);
    }),

    0
  );

  return window.PSS_MODES.isCompetition()
    ? courts
    : h('div', { staticClass: 'pss-training-courts-frame' }, [
        window.PSS_SPECTATOR.controls(view, h),

        courts
      ]);
});
