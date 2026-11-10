(function () {
  var view = this,
    h = view._self._c;
  function button(text, action) {
    return h(
      'button',
      { staticClass: 'pss-menu-button', attrs: { type: 'button' }, on: { click: action } },
      [view._v(text)]
    );
  }
  var title = window.LEDA_CORE.APP_NAME.split(' ');
  return h('main', { staticClass: 'pss-home', attrs: { id: 'id_home' } }, [
    h('div', { staticClass: 'pss-menu-content' }, [
      h('h1', { attrs: { 'aria-label': title[0] + ' Electronic Training Suite' } }, [
        h('span', { staticClass: 'pss-menu-title' }, [view._v(title[0])]),
        view._v(' '),
        h('span', { staticClass: 'pss-menu-subtitle' }, [view._v('Electronic Training Suite')])
      ]),
      h('nav', { staticClass: 'pss-home-actions', attrs: { 'aria-label': 'Main menu' } }, [
        button('Competition', function () {
          view.loginAction('CompetitionSetup');
        }),
        button('Court Training', function () {
          view.loginAction('GameCtrl');
        }),
        button('Free Training', function () {
          view.loginAction('FreeTraining');
        }),
        h('div', { staticClass: 'pss-menu-secondary' }, [
          button('Equipment', function () {
            view.loginAction('GameData');
          }),
          button('Settings', function () {
            view.loginAction('AppSettings');
          })
        ])
      ])
    ]),
    h('p', { staticClass: 'pss-home-status' }, [
      view._v(view.$parent.online ? 'Receiver online' : 'Receiver offline')
    ])
  ]);
});
