(function () {
  var view = this,
    h = view._self._c;
  function text(value) {
    return view._v(value);
  }
  function select(event) {
    var button = event.currentTarget,
      options = button.parentNode.children;
    for (var i = 0; i < options.length; i++)
      options[i].classList.toggle('is-selected', options[i] === button);
  }
  function launch(name, destination, main) {
    return h(
      'button',
      {
        staticClass: main
          ? 'pss-launcher-mode' + (name === 'Competition' ? ' is-selected' : '')
          : 'pss-launcher-tool',
        attrs: { type: 'button', 'aria-label': name },
        on: {
          click: function () {
            view.loginAction(destination);
          },
          mouseenter: main ? select : function () {},
          focus: main ? select : function () {},
          keydown: function (event) {
            if (!main || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
            event.preventDefault();
            var options = event.currentTarget.parentNode.children,
              index = Array.prototype.indexOf.call(options, event.currentTarget);
            options[
              (index + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length
            ].focus();
          }
        }
      },
      [h('span', [text(name)])]
    );
  }
  return h('main', { staticClass: 'pss-home pss-launcher', attrs: { id: 'id_home' } }, [
    h('header', { staticClass: 'pss-launcher-header' }, [
      h('h1', { attrs: { 'aria-label': 'UoBTKD Electronic Training Suite' } }, [
        h('strong', [text('UoBTKD')]),
        h('span', [text('Electronic Training Suite')])
      ])
    ]),
    h('div', { staticClass: 'pss-launcher-body' }, [
      h('div', { staticClass: 'pss-launcher-menu' }, [
        h('nav', { staticClass: 'pss-launcher-modes', attrs: { 'aria-label': 'Main menu' } }, [
          launch('Competition', 'CompetitionJudges', true),
          launch('Court Training', 'GameCtrl', true),
          launch('Free Training', 'FreeTraining', true)
        ]),
        h('nav', { staticClass: 'pss-launcher-tools', attrs: { 'aria-label': 'Tools' } }, [
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
    h('footer', { staticClass: 'pss-launcher-footer' }, [
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
    ])
  ]);
});
