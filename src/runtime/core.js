/* Shared protocol and court helpers. Keep ES5 syntax for the vendor browser. */
(function (root) {
  'use strict';
  var app =
    typeof module !== 'undefined' && module.exports ? require('../app.json') : root.PSS_APP_CONFIG;

  var MAX_LEVEL = 71;
  var RAW_PER_LEVEL = 40;
  var COURT_COUNT = 16;
  var DEVICE_TOPICS = ['huju', 'xlhuju', 'toukui', 'xltoukui'];
  var PARTICIPANT_COUNTERS = [
    'score',
    'tkhits',
    'hjhits',
    'valid',
    'warning',
    'passive_warnings',
    'ivr_warnings',
    'technical_body',
    'technical_head',
    'body_points',
    'head_points',
    'punches',
    'first_score',
    'first_pss_score',
    'first_pss_hit',
    'weak_body',
    'weak_head'
  ];

  function normalizeId(value) {
    return String(value || '')
      .trim()
      .toLowerCase();
  }

  function parseImpact(payload) {
    var fields = String(payload).split(',');
    var raw = fields[1];
    var id = normalizeId(fields[0]);
    if (!/^[a-f0-9]{12}$/.test(id) || !raw || raw.indexOf(':') < 0) return null;

    raw = raw.slice(raw.indexOf(':') + 1).trim();
    if (!raw) return null;
    var value = Number(raw);
    if (!isFinite(value) || value < 0) return null;
    return { id: id, value: value };
  }

  function findEquipment(games, deviceId) {
    var id = normalizeId(deviceId);
    if (!id) return null;
    for (var court = 0; court < games.length; court++) {
      for (var index = 0; index < 2; index++) {
        var side = index === 0 ? 'left' : 'right';
        var slot = games[court][side];
        var type =
          normalizeId(slot.toukui) === id ? 'helmet' : normalizeId(slot.huju) === id ? 'body' : '';
        if (type) return { court: court, side: side, type: type, slot: slot };
      }
    }
    return null;
  }

  function parseLevel(value) {
    if (value === null || typeof value === 'undefined' || String(value).trim() === '') return null;
    var number = Number(value);
    return isFinite(number) && number >= 0 && number <= MAX_LEVEL && Math.floor(number) === number
      ? number
      : null;
  }

  function savedLevel(value, fallback) {
    if (value === null || typeof value === 'undefined' || String(value).trim() === '')
      return fallback;
    var number = Number(value);
    return isFinite(number) && number >= 0 ? Math.min(MAX_LEVEL, Math.floor(number)) : fallback;
  }

  function rawThreshold(value) {
    return Math.round(Number(value) * RAW_PER_LEVEL);
  }

  function emptyParticipant() {
    return {
      index: '',
      gamer: '',
      club: '',
      toukui: '',
      huju: '',
      score: 0,
      tkhits: 0,
      hjhits: 0,
      valid: 0,
      warning: 0,
      passive_warnings: 0,
      ivr_warnings: 0,
      technical_body: 0,
      technical_head: 0,
      body_points: 0,
      head_points: 0,
      punches: 0,
      first_score: 0,
      first_pss_score: 0,
      first_pss_hit: 0,
      weak_body: 0,
      weak_head: 0,
      last_weak: null,
      last_hit: null
    };
  }

  var api = {
    APP_NAME: app.name,
    MAX_LEVEL: MAX_LEVEL,
    RAW_PER_LEVEL: RAW_PER_LEVEL,
    COURT_COUNT: COURT_COUNT,
    DEVICE_TOPICS: DEVICE_TOPICS,
    PARTICIPANT_COUNTERS: PARTICIPANT_COUNTERS,
    normalizeId: normalizeId,
    parseImpact: parseImpact,
    findEquipment: findEquipment,
    parseLevel: parseLevel,
    savedLevel: savedLevel,
    rawThreshold: rawThreshold,
    emptyParticipant: emptyParticipant,
    emptyAthlete: emptyParticipant
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.UOBTKD_CORE = api;
})(typeof window !== 'undefined' ? window : globalThis);
