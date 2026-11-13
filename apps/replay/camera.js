const invitation = new URLSearchParams(location.hash.slice(1));
const code = invitation.get('code') || '';
document.getElementById('address').textContent = location.origin;
document.getElementById('code').textContent = code;
document.getElementById('open').href =
  'uobtkd-camera://pair?server=' +
  encodeURIComponent(location.origin) +
  '&code=' +
  encodeURIComponent(code);
