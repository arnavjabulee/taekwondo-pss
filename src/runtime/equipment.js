/* Shared equipment names and read-only receiver telemetry. ES5 for the native shell. */
(function (root) {
  'use strict';
  var KEY = 'uobtkd_equipment_v1';
  function colourFromId(value) {
    var id = String(value || '')
      .trim()
      .toLowerCase();
    if (!/^[a-f0-9]{12}$/.test(id)) return '';
    var last = id.charAt(11),
      odd = /^[0-9]$/.test(last) ? Number(last) % 2 : last.charCodeAt(0) % 2;
    return odd ? 'Blue' : 'Red';
  }
  function createRegistry(saved, persist) {
    var records = [],
      counters = (saved && saved.counters) || {},
      connected = {},
      readings = {},
      online = false,
      epoch = Number(saved && saved.epoch) || 0,
      emptyReset = false;
    function idOf(value) {
      return String(value || '')
        .trim()
        .toLowerCase();
    }
    function all() {
      return records
        .filter(function (record) {
          return !record.removed;
        })
        .sort(function (a, b) {
          return a.order - b.order;
        });
    }
    function findDevice(id) {
      id = idOf(id);
      for (var i = 0; i < records.length; i++) if (records[i].id === id) return records[i];
      return null;
    }
    function find(id) {
      var record = findDevice(id);
      return record && !record.removed ? record : null;
    }
    function save() {
      if (persist) persist({ records: records, counters: counters, epoch: epoch });
    }
    function ensure(id, type, unclaimed) {
      id = idOf(id);
      if (!/^[a-f0-9]{12}$/.test(id)) return null;
      var record = findDevice(id);
      if (record && record.removed && !unclaimed) return null;
      if (!record) {
        record = {
          id: id,
          type: type === 'helmet' ? 'helmet' : 'body',
          colour: colourFromId(id),
          size: '',
          ordinal: 1,
          order:
            records.reduce(function (max, item) {
              return Math.max(max, item.order);
            }, 0) + 1,
          numberEpoch: -1,
          removed: !!unclaimed,
          detectedType: type === 'helmet' || type === 'body' ? type : ''
        };
        records.push(record);
        save();
      }
      return record;
    }
    if (saved && Array.isArray(saved.records))
      saved.records.forEach(function (item) {
        var record = ensure(item.id, item.type, true);
        if (record) {
          record.colour = String(item.colour || colourFromId(item.id)).slice(0, 30);
          if (/^(red|blue)$/i.test(record.colour))
            record.colour =
              record.colour.charAt(0).toUpperCase() + record.colour.slice(1).toLowerCase();
          record.size = String(item.size || '').slice(0, 30);
          record.ordinal = Math.max(1, Math.floor(Number(item.ordinal) || 1));
          record.group = String(item.group || '');
          record.numberEpoch = typeof item.numberEpoch === 'number' ? item.numberEpoch : epoch;
          record.removed = !!item.removed;
          record.detectedType = item.detectedType || item.type || '';
          record.order = Number(item.order) || record.order;
          record.typeManual = !!item.typeManual;
        }
      });
    function rename(id, colour, size, partial) {
      var record = find(id);
      colour = String(colour || '').trim();
      size = String(size || '').trim();
      if (!record) throw new Error('Equipment not found.');
      if ((!partial && (!colour || !size)) || colour.length > 30 || size.length > 30)
        throw new Error('Enter a colour and size, up to 30 characters each.');
      var group = colour.toLowerCase() + '|' + size.toLowerCase();
      var oldGroup = record.group || record.colour.toLowerCase() + '|' + record.size.toLowerCase();
      if (colour && size && (group !== oldGroup || record.numberEpoch !== epoch)) {
        var maximum = Number(counters[group]) || 0;
        records.forEach(function (other) {
          if (
            other !== record &&
            !other.removed &&
            other.numberEpoch === epoch &&
            other.colour.toLowerCase() + '|' + other.size.toLowerCase() === group
          )
            maximum = Math.max(maximum, other.ordinal);
        });
        record.ordinal = maximum + 1;
        counters[group] = record.ordinal;
        record.numberEpoch = epoch;
      }
      if (colour && size) record.group = group;
      record.colour = colour;
      record.size = size;
      save();
      return record;
    }
    function edit(id, key, value) {
      var record = find(id);
      if (!record) throw new Error('Equipment not found.');
      if (key === 'type') {
        if (value !== 'body' && value !== 'helmet')
          throw new Error('Choose body protector or helmet.');
        record.type = value;
        record.typeManual = true;
        save();
        return record;
      }
      if (key !== 'colour' && key !== 'size') throw new Error('This field cannot be edited.');
      return rename(
        id,
        key === 'colour' ? value : record.colour,
        key === 'size' ? value : record.size,
        true
      );
    }
    function label(id, type) {
      if (!id) return 'None';
      var record = ensure(id, type);
      if (!record)
        return (
          colourFromId(id) +
          ' ' +
          (type === 'helmet' ? 'head protector' : 'body protector') +
          ' (unassigned)'
        );
      // Number only current saved rows, never historical claims or radio devices.
      var ordinal = 1,
        entries = all();
      for (var index = 0; index < entries.length; index++) {
        var other = entries[index];
        if (other.id === record.id) break;
        if (
          other.colour.toLowerCase() === record.colour.toLowerCase() &&
          other.size.toLowerCase() === record.size.toLowerCase()
        )
          ordinal++;
      }
      return record.colour && record.size
        ? record.colour + ' ' + record.size + (ordinal > 1 ? ' (' + ordinal + ')' : '')
        : 'Unnamed ' + (record.type === 'helmet' ? 'helmet ' : 'body protector ') + record.order;
    }
    function discover(payload) {
      connected = {};
      String(payload || '')
        .split(',')
        .forEach(function (item) {
          var id = item.slice(0, 12),
            type = item.slice(13);
          if (['huju', 'xlhuju', 'toukui', 'xltoukui'].indexOf(type) < 0) return;
          var record = ensure(id, type.indexOf('toukui') >= 0 ? 'helmet' : 'body', true);
          if (record) {
            record.detectedType = type.indexOf('toukui') >= 0 ? 'helmet' : 'body';
            if (record.removed || !record.typeManual) record.type = record.detectedType;
            connected[record.id] = true;
          }
        });
      if (Object.keys(connected).length === 0) {
        if (!emptyReset) {
          counters = {};
          epoch++;
          records.forEach(function (record) {
            record.ordinal = 1;
            record.numberEpoch = -1;
          });
          emptyReset = true;
          save();
        }
      } else {
        emptyReset = false;
        // Stable registry order, independent of packet/discovery ordering.
        records.forEach(function (record) {
          if (
            !record.removed &&
            connected[record.id] &&
            record.colour &&
            record.size &&
            record.numberEpoch !== epoch
          )
            rename(record.id, record.colour, record.size);
        });
      }
    }
    function battery(message) {
      var record = find(message.from);
      if (!record) record = ensure(message.from, undefined, true);
      if (!record) return;
      var percent = null;
      ['percentage', 'percent', 'battery_percent', 'battery_percentage'].some(function (key) {
        var value = message[key];
        if (value === null || value === undefined || String(value).trim() === '') return false;
        value = Number(value);
        if (isFinite(value) && value >= 0 && value <= 100) {
          percent = value;
          return true;
        }
        return false;
      });
      var raw = message.batt_id;
      var level =
        raw !== null &&
        raw !== undefined &&
        String(raw).trim() !== '' &&
        /^[0-3]$/.test(String(raw))
          ? Number(raw)
          : null;
      readings[record.id] = {
        percent: percent,
        level: level,
        raw: raw,
        updated: new Date().toISOString()
      };
    }
    function batteryText(id) {
      var value = readings[idOf(id)];
      if (!value) return 'Battery unknown';
      return value.percent !== null
        ? value.percent + '%'
        : value.level !== null
          ? ['Empty', 'Low', 'Medium', 'High'][value.level] + ' battery'
          : 'Battery unavailable';
    }
    function available(type, colour, current) {
      return records
        .filter(function (device) {
          return (
            (device.removed || device.id === idOf(current)) &&
            (device.detectedType || (device.id === idOf(current) ? device.type : '')) === type &&
            (!colour || colourFromId(device.id).toLowerCase() === String(colour).toLowerCase())
          );
        })
        .map(function (device) {
          return {
            id: device.id,
            type: device.detectedType || device.type,
            colour: colourFromId(device.id),
            connected: online && !!connected[device.id]
          };
        });
    }
    function remove(id) {
      var record = find(id);
      if (!record) throw new Error('Equipment not found.');
      record.removed = true;
      save();
      return record;
    }
    function claim(id, type, colour, size) {
      id = idOf(id);
      if (find(id)) throw new Error('That ID is already claimed by another equipment entry.');
      var device = findDevice(id);
      if (device && device.detectedType && device.detectedType !== type)
        throw new Error('That device is a different protector type.');
      if (colour && colourFromId(id).toLowerCase() !== String(colour).toLowerCase())
        throw new Error('That ID belongs to ' + colourFromId(id) + ' equipment.');
      if (!device) device = ensure(id, type, true);
      if (!device) throw new Error('Enter a valid 12-character device ID.');
      if (String(size || '').length > 30) throw new Error('Size must be at most 30 characters.');
      device.removed = false;
      device.type = type;
      device.typeManual = false;
      device.order =
        records.reduce(function (max, item) {
          return Math.max(max, item.order);
        }, 0) + 1;
      rename(id, colourFromId(id), String(size || ''), true);
      save();
      return device;
    }
    function assign(id, newId) {
      var record = find(id);
      newId = idOf(newId);
      if (!record) throw new Error('Equipment not found.');
      if (record.id === newId) return record;
      var options = available(record.type, record.colour, record.id);
      if (
        !options.some(function (item) {
          return item.id === newId;
        })
      )
        throw new Error('Choose an unclaimed ID with the matching type and colour.');
      var order = record.order,
        ordinal = record.ordinal,
        group = record.group,
        numberEpoch = record.numberEpoch;
      var replacement = findDevice(newId);
      replacement.removed = false;
      replacement.type = record.type;
      replacement.typeManual = false;
      replacement.colour = record.colour;
      replacement.size = record.size;
      remove(id);
      replacement.order = order;
      replacement.ordinal = ordinal;
      replacement.group = group;
      replacement.numberEpoch = numberEpoch;
      save();
      return replacement;
    }
    return {
      all: all,
      find: find,
      ensure: ensure,
      rename: rename,
      edit: edit,
      available: available,
      remove: remove,
      claim: claim,
      assign: assign,
      findDevice: findDevice,
      label: label,
      discover: discover,
      battery: battery,
      batteryText: batteryText,
      reading: function (id) {
        return readings[idOf(id)];
      },
      setOnline: function (value) {
        online = !!value;
      },
      isOnline: function () {
        return online;
      },
      connected: function (id) {
        return online && !!connected[idOf(id)];
      },
      snapshot: function () {
        return {
          records: JSON.parse(JSON.stringify(records)),
          counters: JSON.parse(JSON.stringify(counters)),
          epoch: epoch
        };
      }
    };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createRegistry: createRegistry, colourFromId: colourFromId };
    return;
  }
  var saved;
  try {
    saved = JSON.parse(root.localStorage.getItem(KEY));
  } catch (error) {
    /* Empty registry. */
  }
  var registry = createRegistry(saved);
  var host = null,
    store = null,
    panel = null,
    detailsId = null,
    previousFocus = null;
  function notify(text) {
    root.LEDA_UI.notify(text);
  }
  function changed() {
    try {
      root.localStorage.setItem(KEY, JSON.stringify(registry.snapshot()));
    } catch (error) {
      notify('Equipment changes could not be saved on this computer.');
    }
    function refresh(view) {
      if (!view || view._isDestroyed) return;
      view.$forceUpdate();
      (view.$children || []).forEach(refresh);
    }
    refresh(host);
    if (panel && !panel.hidden) renderList();
  }
  function element(tag, text, parent) {
    var node = root.document.createElement(tag);
    if (text !== null) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  }
  function button(text, parent, click) {
    var node = element('button', text, parent);
    node.type = 'button';
    node.onclick = click;
    return node;
  }
  function field(text, value, parent, options) {
    var label = element('label', text, parent),
      input = element(options ? 'select' : 'input', null, label);
    input.setAttribute('aria-label', text);
    if (options)
      options.forEach(function (item) {
        var option = element('option', item[1], input);
        option.value = item[0];
      });
    else {
      input.type = 'text';
      input.maxLength = 30;
    }
    input.value = value || '';
    return input;
  }
  function renderList() {
    var body = panel.querySelector('.pss-equipment-list');
    while (body.firstChild) body.removeChild(body.firstChild);
    element(
      'p',
      registry.isOnline()
        ? 'Receiver online'
        : 'Receiver offline — saved equipment is still available.',
      body
    );
    if (!registry.all().length)
      element('p', 'No equipment saved. Refresh connected equipment or add a device below.', body);
    registry.all().forEach(function (record) {
      var row = element('div', null, body);
      row.className = 'pss-equipment-row';
      row.setAttribute('data-equipment', record.id);
      element('strong', registry.label(record.id), row);
      element('span', record.type === 'helmet' ? 'Helmet' : 'Body protector', row);
      element('span', registry.connected(record.id) ? 'Connected' : 'Offline', row);
      element('span', registry.batteryText(record.id), row);
      button('More information', row, function () {
        showDetails(record.id);
      }).setAttribute('aria-label', 'More information for ' + registry.label(record.id));
    });
    if (detailsId) showDetails(detailsId);
  }
  function showDetails(id) {
    detailsId = id;
    var area = panel.querySelector('.pss-equipment-details');
    // Do not replace inputs during incoming telemetry: preserve edits and focus.
    if (area.getAttribute('data-editing') === id) {
      var live = area.querySelector('[data-battery]');
      if (live) live.textContent = registry.batteryText(id);
      var updated = area.querySelector('[data-battery-meta]');
      if (updated) updated.textContent = batteryMeta(id);
      return;
    }
    area.textContent = '';
    area.setAttribute('data-editing', id);
    var record = registry.find(id);
    if (!record) return;
    element('h3', 'Equipment information', area);
    element('p', 'Device ID: ' + record.id, area);
    var batteryInfo = element('p', registry.batteryText(id), area);
    batteryInfo.setAttribute('data-battery', '');
    element('p', batteryMeta(id), area).setAttribute('data-battery-meta', '');
    var colour = field('Colour', record.colour, area, [
        ['Red', 'Red'],
        ['Blue', 'Blue']
      ]),
      size = field('Size', record.size, area);
    button('Save equipment', area, function () {
      try {
        registry.rename(id, colour.value, size.value);
        area.removeAttribute('data-editing');
        changed();
      } catch (error) {
        notify(error.message);
      }
    });
    button('Refresh this battery', area, function () {
      if (!registry.isOnline()) return notify('Receiver offline.');
      host.query_battery_info(id);
    });
  }
  function batteryMeta(id) {
    var reading = registry.reading(id);
    return reading
      ? 'Last battery response: ' +
          reading.updated +
          ' · reported battery code: ' +
          String(reading.raw === undefined ? 'not supplied' : reading.raw)
      : 'No battery response received this session.';
  }
  function refresh() {
    if (!host || !registry.isOnline()) {
      notify('Receiver offline. Connect it to refresh equipment and batteries.');
      return;
    }
    host.MqttRequestDeviceList();
    root.LEDA_CORE.DEVICE_TOPICS.forEach(function (type) {
      host.query_battery_info_devices(type);
    });
  }
  function close() {
    if (!panel) return;
    panel.hidden = true;
    detailsId = null;
    panel.querySelector('.pss-equipment-details').removeAttribute('data-editing');
    if (previousFocus && previousFocus.focus) previousFocus.focus();
  }
  function open(id) {
    previousFocus = root.document.activeElement;
    if (!panel) {
      panel = element('div', null, root.document.body);
      panel.className = 'pss-equipment-overlay';
      panel.hidden = true;
      var dialog = element('section', null, panel);
      dialog.className = 'pss-equipment-dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-label', 'Equipment');
      var header = element('header', null, dialog);
      element('h2', 'Equipment', header);
      button('Close equipment', header, close);
      button('Refresh equipment and batteries', dialog, refresh);
      element(
        'p',
        'Set a colour and size once. New duplicates receive (2), (3), and so on. Battery percentages appear only when explicitly reported by the receiver.',
        dialog
      );
      element('div', null, dialog).className = 'pss-equipment-list';
      element('section', null, dialog).className = 'pss-equipment-details';
      var add = element('form', null, dialog);
      add.className = 'pss-equipment-add';
      element('h3', 'Add equipment manually', add);
      var device = field('New device ID', '', add),
        type = field('Equipment type', 'body', add, [
          ['body', 'Body protector'],
          ['helmet', 'Helmet']
        ]);
      var colour = field('New equipment colour', '', add, [
          ['Red', 'Red'],
          ['Blue', 'Blue']
        ]),
        size = field('New equipment size', '', add);
      var submit = element('button', 'Add equipment', add);
      submit.type = 'submit';
      add.onsubmit = function (event) {
        event.preventDefault();
        try {
          if (!/^[a-f0-9]{12}$/i.test(device.value.trim()))
            throw new Error('Enter a 12-character hexadecimal device ID.');
          if (registry.find(device.value.trim()))
            throw new Error('That equipment is already saved. Use More information to edit it.');
          if (!colour.value.trim() || !size.value.trim())
            throw new Error('Enter a colour and size.');
          registry.claim(device.value, type.value, colour.value, size.value);
          device.value = '';
          colour.value = '';
          size.value = '';
          changed();
        } catch (error) {
          notify(error.message);
        }
      };
      panel.addEventListener('keydown', function (event) {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
        }
        if (event.key === 'Tab') {
          var focusable = panel.querySelectorAll('button,input,select');
          var first = focusable[0],
            last = focusable[focusable.length - 1];
          if (event.shiftKey && root.document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && root.document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      });
    }
    panel.querySelector('.pss-equipment-details').textContent = '';
    panel.querySelector('.pss-equipment-details').removeAttribute('data-editing');
    detailsId = id && registry.find(id) ? id : null;
    panel.hidden = false;
    renderList();
    panel.querySelector('button').focus();
  }
  function attach(view, data) {
    host = view;
    store = data;
    root.PSS_NAV.attach(view, data);
    for (var index = 0; index < root.LEDA_CORE.COURT_COUNT; index++) {
      var court = store.ReadChangdiData(index);
      if (court && court.left && court.right)
        ['left', 'right'].forEach(function (side) {
          registry.ensure(court[side].huju, 'body');
          registry.ensure(court[side].toukui, 'helmet');
        });
    }
    try {
      var free = JSON.parse(root.localStorage.getItem('bristol_free_training_v1'));
      ((free && free.participants) || []).forEach(function (person) {
        registry.ensure(person.bodyId, 'body');
        registry.ensure(person.helmetId, 'helmet');
      });
    } catch (error) {
      /* Optional saved free-training roster. */
    }
    changed();
  }
  function mount() {
    var controls = root.document.querySelector('.pss-audio-controls');
    if (controls)
      button('Equipment', controls, function () {
        root.PSS_NAV.equipment();
      });
  }
  function rewriteAssignments(oldId, newId, type) {
    function update(record, body, head) {
      var touched = false;
      if (record[body] === oldId) {
        record[body] = type === 'body' ? newId : '';
        touched = true;
      }
      if (record[head] === oldId) {
        record[head] = type === 'helmet' ? newId : '';
        touched = true;
      }
      return touched;
    }
    if (store) {
      for (var i = 0; i < root.LEDA_CORE.COURT_COUNT; i++) {
        var court = store.ReadChangdiData(i);
        if (court && court.left && court.right) {
          var a = update(court.left, 'huju', 'toukui'),
            b = update(court.right, 'huju', 'toukui');
          if (a || b) store.SaveChangdiData(i, court);
        }
      }
      (store.game_list || []).forEach(function (court) {
        if (court.left) update(court.left, 'huju', 'toukui');
        if (court.right) update(court.right, 'huju', 'toukui');
      });
    }
    var free = root.localStorage.getItem('bristol_free_training_v1');
    if (free) {
      var savedFree = JSON.parse(free);
      (savedFree.participants || []).forEach(function (person) {
        update(person, 'bodyId', 'helmetId');
      });
      root.localStorage.setItem('bristol_free_training_v1', JSON.stringify(savedFree));
    }
    if (root.PSS_MODES.rewriteEquipment) root.PSS_MODES.rewriteEquipment(oldId, newId, type);
    if (root.PSS_NAV.rewriteEquipment) root.PSS_NAV.rewriteEquipment(oldId, newId, type);
  }
  if (root.document.readyState === 'loading')
    root.document.addEventListener('DOMContentLoaded', mount);
  else mount();
  root.PSS_EQUIPMENT = {
    attach: attach,
    open: open,
    close: close,
    isOpen: function () {
      return !!panel && !panel.hidden;
    },
    discover: function (payload) {
      registry.discover(payload);
      changed();
    },
    battery: function (message) {
      registry.battery(message);
      changed();
    },
    setOnline: function (value) {
      registry.setOnline(value);
      changed();
    },
    label: registry.label,
    option: function (id, type) {
      return registry.label(id, type) + ' · ' + registry.batteryText(id);
    },
    summary: function (id, type) {
      return registry.label(id, type) + (id ? ' · ' + registry.batteryText(id) : '');
    },
    ids: function (type, current) {
      if (current) registry.ensure(current, type);
      return registry
        .all()
        .filter(function (record) {
          return (
            (record.type === type && (!record.detectedType || record.detectedType === type)) ||
            record.id ===
              String(current || '')
                .trim()
                .toLowerCase()
          );
        })
        .map(function (record) {
          return record.id;
        });
    },
    registry: registry,
    colourFromId: colourFromId,
    saveField: function (id, key, value) {
      var record = registry.edit(id, key, value);
      changed();
      return record;
    },
    add: function (id, type, colour, size) {
      if (!/^[a-f0-9]{12}$/i.test(String(id).trim()))
        throw new Error('Enter a 12-character hexadecimal device ID.');
      if (registry.find(id)) throw new Error('That equipment is already saved.');
      var record = registry.claim(id, type, colour || colourFromId(id), size);
      changed();
      return record;
    },
    assignId: function (id, newId) {
      var record = registry.assign(id, newId);
      rewriteAssignments(id, record.id, record.type);
      changed();
      return record;
    },
    remove: function (id) {
      var record = registry.remove(id);
      rewriteAssignments(id, '', record.type);
      changed();
    },
    refresh: refresh,
    refreshBattery: function (id) {
      if (!registry.isOnline()) return notify('Receiver offline.');
      host.query_battery_info(id);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
