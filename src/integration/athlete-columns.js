/* Render expressions inserted into the vendor athlete table. */
[
  a('td', [
    a(
      'select',
      {
        staticClass: 'form-control',
        attrs: { 'aria-label': 'Court for ' + e.name },
        domProps: { value: e.court || '' },
        on: {
          change: function (event) {
            t.assignCourt(i, event.target.value);
          }
        }
      },
      [
        a('option', { attrs: { value: '' } }, [t._v('Unassigned')]),
        t._l(16, function (court) {
          return a('option', { key: court, attrs: { value: court } }, [t._v('Court ' + court)]);
        })
      ],
      2
    )
  ]),
  a(
    'td',
    {
      class:
        t.courtLabel(e) === 'Blue'
          ? 'leda-colour-blue'
          : t.courtLabel(e) === 'Red'
            ? 'leda-colour-red'
            : 'leda-colour-none'
    },
    [t._v(t.courtLabel(e))]
  )
];
