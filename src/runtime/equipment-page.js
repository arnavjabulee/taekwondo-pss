/* Physical inventory only: each field saves independently from the table. */
(function (root) {
  'use strict';
  function createComponent() {
    return {
      name: 'EquipmentPage',
      data: function () {
        return {
          search: '',
          newId: '',
          newType: 'body',
          newColour: '',
          newSize: '',
          newColourManual: false,
          message: '',
          drafts: {}
        };
      },
      methods: {
        home: function () {
          this.$router.push({ name: 'Index' });
        },
        edit: function (record, key, event) {
          try {
            root.PSS_EQUIPMENT.saveField(record.id, key, event.target.value);
            this.message = 'Saved.';
          } catch (error) {
            event.target.value = record[key];
            this.message = error.message;
          }
          this.$delete(this.drafts, record.id + '|' + key);
        },
        add: function (event) {
          event.preventDefault();
          try {
            root.PSS_EQUIPMENT.add(this.newId, this.newType, this.newColour, this.newSize);
            this.newId = '';
            this.newColour = '';
            this.newSize = '';
            this.newColourManual = false;
            this.message = 'Equipment added.';
          } catch (error) {
            this.message = error.message;
          }
        },
        assignId: function (record, event) {
          try {
            root.PSS_EQUIPMENT.assignId(record.id, event.target.value);
            this.message = 'Device ID assigned.';
          } catch (error) {
            event.target.value = record.id;
            this.message = error.message;
          }
        },
        remove: function (record) {
          try {
            root.PSS_EQUIPMENT.remove(record.id);
            this.message = 'Equipment deleted. Its device ID is available again.';
          } catch (error) {
            this.message = error.message;
          }
        },
        chooseNewId: function (value) {
          this.newId = value;
          var equipment = root.PSS_EQUIPMENT,
            device = equipment.registry.findDevice(value);
          if (!this.newColourManual) this.newColour = equipment.colourFromId(value);
          if (device && device.detectedType) this.newType = device.detectedType;
        }
      },
      render: function () {
        var view = this,
          h = view._self._c,
          equipment = root.PSS_EQUIPMENT,
          registry = equipment.registry;
        function button(text, action) {
          return h('button', { attrs: { type: 'button' }, on: { click: action } }, [view._v(text)]);
        }
        function input(record, key, label) {
          var draft = record.id + '|' + key;
          return h('input', {
            attrs: { type: 'text', maxlength: 30, 'aria-label': label },
            domProps: {
              value: view.drafts[draft] === undefined ? record[key] : view.drafts[draft]
            },
            on: {
              input: function (event) {
                view.$set(view.drafts, draft, event.target.value);
              },
              change: function (event) {
                view.edit(record, key, event);
              }
            }
          });
        }
        function typeSelect(value, label, change) {
          return h(
            'select',
            { attrs: { 'aria-label': label }, domProps: { value: value }, on: { change: change } },
            [
              h('option', { attrs: { value: 'body' } }, [view._v('Body protector')]),
              h('option', { attrs: { value: 'helmet' } }, [view._v('Head protector')])
            ]
          );
        }
        function colourSelect(value, label, change) {
          return h(
            'select',
            { attrs: { 'aria-label': label }, domProps: { value: value }, on: { change: change } },
            [
              h('option', { attrs: { value: '' } }, [view._v('Choose colour')]),
              h('option', { attrs: { value: 'Red' } }, [view._v('Red')]),
              h('option', { attrs: { value: 'Blue' } }, [view._v('Blue')])
            ]
          );
        }
        function idSelect(record) {
          var options = registry.available(record.type, record.colour, record.id);
          var matches = options.some(function (device) {
            return device.id === record.id;
          });
          return h(
            'select',
            {
              attrs: { 'aria-label': 'Device ID' },
              domProps: { value: matches ? record.id : '' },
              on: {
                change: function (event) {
                  view.assignId(record, event);
                }
              }
            },
            [
              h('option', { attrs: { value: '', disabled: true } }, [
                view._v('Choose a matching ID')
              ]),
              view._l(options, function (device) {
                return h('option', { key: device.id, attrs: { value: device.id } }, [
                  view._v(
                    device.id + ' · ' + device.colour + (device.connected ? '' : ' · offline')
                  )
                ]);
              })
            ],
            2
          );
        }
        function addField(key, label) {
          return h('label', [
            h('span', [view._v(label)]),
            h('input', {
              attrs: { type: 'text', 'aria-label': label, maxlength: key === 'newId' ? 12 : 30 },
              domProps: { value: view[key] },
              on: {
                input: function (event) {
                  if (key === 'newId') view.chooseNewId(event.target.value);
                  else view[key] = event.target.value;
                }
              }
            })
          ]);
        }
        var records = registry.all().filter(function (record) {
          var query = view.search.trim().toLowerCase();
          return (
            !query ||
            (
              registry.label(record.id) +
              ' ' +
              (record.type === 'helmet' ? 'head protector' : 'body protector')
            )
              .toLowerCase()
              .indexOf(query) >= 0
          );
        });
        return h('main', { staticClass: 'pss-inventory' }, [
          h('header', { staticClass: 'pss-free-header' }, [
            h('h1', [view._v('Equipment')]),
            button('Home', view.home)
          ]),
          h('div', { staticClass: 'pss-inventory-toolbar' }, [
            h('label', [
              view._v('Find equipment '),
              h('input', {
                attrs: { type: 'search', 'aria-label': 'Find equipment' },
                domProps: { value: view.search },
                on: {
                  input: function (event) {
                    view.search = event.target.value;
                  }
                }
              })
            ]),
            button('Refresh equipment and batteries', equipment.refresh),
            h('span', [view._v(registry.isOnline() ? 'Receiver online' : 'Receiver offline')])
          ]),
          h('p', [
            view._v(
              'Choose type and colour to see matching unclaimed IDs. Colour and protector type are detected automatically; size is manual. Newly discovered devices can be added below.'
            )
          ]),
          h('p', { attrs: { role: 'status' }, staticClass: 'pss-inventory-message' }, [
            view._v(view.message)
          ]),
          h('div', { staticClass: 'pss-inventory-scroll' }, [
            h('table', { staticClass: 'pss-inventory-table' }, [
              h('thead', [
                h(
                  'tr',
                  view._l(
                    ['Equipment', 'Type', 'Colour', 'Size', 'Status', 'Battery', 'ID', 'Actions'],
                    function (title) {
                      return h('th', { attrs: { scope: 'col' } }, [view._v(title)]);
                    }
                  ),
                  0
                )
              ]),
              h(
                'tbody',
                records.length
                  ? view._l(records, function (record) {
                      return h('tr', { key: record.id, attrs: { 'data-equipment': record.id } }, [
                        h('th', { attrs: { scope: 'row' } }, [view._v(registry.label(record.id))]),
                        h('td', [
                          typeSelect(record.type, 'Type', function (event) {
                            view.edit(record, 'type', event);
                          })
                        ]),
                        h('td', [
                          colourSelect(record.colour, 'Colour', function (event) {
                            view.edit(record, 'colour', event);
                          })
                        ]),
                        h('td', [input(record, 'size', 'Size')]),
                        h('td', [view._v(registry.connected(record.id) ? 'Connected' : 'Offline')]),
                        h('td', [
                          h('span', [view._v(registry.batteryText(record.id))]),
                          button('Refresh battery', function () {
                            equipment.refreshBattery(record.id);
                          })
                        ]),
                        h('td', [idSelect(record)]),
                        h('td', [
                          button('Delete', function () {
                            view.remove(record);
                          })
                        ])
                      ]);
                    })
                  : [
                      h('tr', [
                        h('td', { attrs: { colspan: 8 } }, [
                          view._v(
                            registry.all().length
                              ? 'No matching equipment.'
                              : 'No equipment saved. Refresh connected equipment or add a device below.'
                          )
                        ])
                      ])
                    ],
                0
              ),
              h('tfoot', [
                h('tr', [
                  h('td', { attrs: { colspan: 8 } }, [
                    h('form', { staticClass: 'pss-inventory-add', on: { submit: view.add } }, [
                      h('h2', [view._v('Add equipment')]),
                      h('label', [
                        h('span', [view._v('Type')]),
                        typeSelect(view.newType, 'New equipment type', function (event) {
                          view.newType = event.target.value;
                          view.newId = '';
                        })
                      ]),
                      h('label', [
                        h('span', [view._v('Colour')]),
                        colourSelect(view.newColour, 'New equipment colour', function (event) {
                          view.newColour = event.target.value;
                          view.newColourManual = true;
                          view.newId = '';
                        })
                      ]),
                      h('label', [
                        h('span', [view._v('Available device ID')]),
                        h(
                          'select',
                          {
                            attrs: { 'aria-label': 'New device ID' },
                            domProps: { value: view.newId },
                            on: {
                              change: function (event) {
                                view.chooseNewId(event.target.value);
                              }
                            }
                          },
                          [
                            h('option', { attrs: { value: '' } }, [
                              view._v('Choose an unclaimed device')
                            ]),
                            view._l(
                              registry.available(view.newType, view.newColour, ''),
                              function (device) {
                                return h('option', { attrs: { value: device.id } }, [
                                  view._v(
                                    device.id +
                                      ' · ' +
                                      device.colour +
                                      (device.connected ? '' : ' · offline')
                                  )
                                ]);
                              }
                            )
                          ],
                          2
                        )
                      ]),
                      addField('newSize', 'New equipment size'),
                      h('button', { attrs: { type: 'submit' } }, [view._v('Add equipment')]),
                      h('details', { staticClass: 'pss-offline-device' }, [
                        h('summary', [view._v('Add an offline device by ID')]),
                        addField('newId', 'Offline device ID')
                      ])
                    ])
                  ])
                ])
              ])
            ])
          ])
        ]);
      }
    };
  }
  root.PSS_EQUIPMENT_PAGE = { createComponent: createComponent };
})(window);
