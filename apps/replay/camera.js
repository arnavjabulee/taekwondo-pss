const invitation = new URLSearchParams(location.hash.slice(1));
const code = invitation.get('code') || '';
document.getElementById('address').textContent = location.origin;
document.getElementById('code').textContent = code;
document.getElementById('open').href =
  'uobtkd-camera://pair?server=' +
  encodeURIComponent(location.origin) +
  '&code=' +
  encodeURIComponent(code);

const ios =
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
document.getElementById('android-download').hidden = ios || location.protocol === 'https:';
document.getElementById('android-install').hidden = ios || location.protocol === 'https:';
document.getElementById('ios-install').hidden = !ios;
