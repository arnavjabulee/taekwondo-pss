/* Shared, dependency-free judge-controller contract. */
(function (root) {
  'use strict';
  var api = {
    version: 1,
    windowMs: 3000,
    validSide: function (side) {
      return side === 'left' || side === 'right';
    },
    judgeCount: function (value) {
      return [1, 2, 3].indexOf(Number(value)) >= 0 ? Number(value) : 3;
    },
    requiredVotes: function (count) {
      return Number(count) === 3 ? 2 : 1;
    },
    name: function (value, fallback) {
      return String(value || fallback || '')
        .replace(/[\x00-\x1f<>]/g, '')
        .slice(0, 60);
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.UOBTKD_JUDGE_PROTOCOL = api;
})(typeof window !== 'undefined' ? window : globalThis);
