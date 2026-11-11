(function () {
  var view = this,
    h = view._self._c;
  function text(value) {
    return view._v(value);
  }
  function launch(name, destination, main) {
    return h(
      'button',
      {
        staticClass: main ? 'pss-launcher-mode' : 'pss-launcher-tool',
        attrs: { type: 'button', 'aria-label': name },
        on: {
          click: function () {
            view.loginAction(destination);
          }
        }
      },
      main
        ? [
            h('span', [text(name)]),
            h('span', { staticClass: 'pss-launcher-arrow', attrs: { 'aria-hidden': 'true' } }, [
              text('\u203a')
            ])
          ]
        : [text(name)]
    );
  }
  return h('main', { staticClass: 'pss-home pss-launcher', attrs: { id: 'id_home' } }, [
    h('header', { staticClass: 'pss-launcher-header' }, [
      h('h1', { attrs: { 'aria-label': 'UoBTKD Electronic Training Suite' } }, [
        h('strong', [text('UoBTKD')]),
        h('span', [text('Electronic Training Suite')])
      ]),
      h(
        'span',
        {
          staticClass: 'pss-launcher-status',
          class: { online: view.$parent.online },
          attrs: { role: 'status' }
        },
        [
          h('i', { attrs: { 'aria-hidden': 'true' } }),
          text(view.$parent.online ? 'Receiver online' : 'Receiver offline')
        ]
      )
    ]),
    h('div', { staticClass: 'pss-launcher-body' }, [
      h('nav', { staticClass: 'pss-launcher-menu', attrs: { 'aria-label': 'Main menu' } }, [
        h('h2', [text('Start a session')]),
        h('div', { staticClass: 'pss-launcher-modes' }, [
          launch('Competition', 'CompetitionSetup', true),
          launch('Court Training', 'GameCtrl', true),
          launch('Free Training', 'FreeTraining', true)
        ]),
        h('div', { staticClass: 'pss-launcher-tools' }, [
          launch('Equipment', 'GameData', false),
          launch('Settings', 'AppSettings', false),
          h(
            'button',
            {
              staticClass: 'pss-launcher-quit',
              attrs: { type: 'button' },
              on: {
                click: function () {
                  window.PSS_NAV.quit();
                }
              }
            },
            [text('Quit')]
          )
        ])
      ])
    ]),
    h('footer', { staticClass: 'pss-launcher-footer' }, [text('University of Bristol Taekwondo')])
  ]);
});
