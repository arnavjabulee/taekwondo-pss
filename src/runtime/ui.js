/* Shared presentation helpers. Notifications never contain interpreted HTML. */
(function (root) {
  'use strict';
  var notification = null;
  var timeout = null;

  function dismiss() {
    if (timeout) root.clearTimeout(timeout);
    if (notification && notification.parentNode) notification.parentNode.removeChild(notification);
    notification = null;
    timeout = null;
  }

  function notify(message) {
    dismiss();
    var document = root.document;
    if (!document) return;
    notification = document.createElement('div');
    notification.className = 'uobtkd-notification';
    notification.setAttribute('role', 'alert');
    var text = document.createElement('span');
    text.textContent = message;
    notification.appendChild(text);
    var close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Dismiss';
    close.onclick = dismiss;
    notification.appendChild(close);
    document.body.appendChild(notification);
    timeout = root.setTimeout(dismiss, 12000);
  }

  function cleanDefaults(info) {
    // Migrate only built-in titles; never rename a user's team or athletes.
    if (
      /^(Training|Taekwondo|Bristol Taekwondo Electronic Training Suite|\u8dc6\s*\u62f3\s*\u9053|\u4e50\u6253\u667a\u80fd\u4f53\u80b2|\u5357\u4eac\u4e50\u6253\u4f53\u80b2\u79d1\u6280\u6709\u9650\u516c\u53f8)$/.test(
        info.game_name || ''
      )
    ) {
      info.game_name = root.UOBTKD_CORE.APP_NAME;
    }
  }

  function confirm(message, done) {
    var document = root.document,
      previous = document.activeElement;
    var overlay = document.createElement('div');
    overlay.className = 'pss-confirm-overlay';
    var panel = document.createElement('section');
    panel.className = 'pss-confirm-panel';
    panel.setAttribute('role', 'alertdialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Leave match mode');
    var text = document.createElement('p');
    text.textContent = message;
    panel.appendChild(text);
    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    var leave = document.createElement('button');
    leave.type = 'button';
    leave.textContent = 'Leave match';
    var finished = false;
    function finish(accepted) {
      if (finished) return;
      finished = true;
      document.removeEventListener('keydown', trap, true);
      overlay.parentNode.removeChild(overlay);
      if (previous && document.documentElement.contains(previous)) previous.focus();
      done(accepted);
    }
    function trap(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        finish(false);
      } else if (event.key === 'Tab') {
        event.preventDefault();
        (document.activeElement === cancel ? leave : cancel).focus();
      }
    }
    cancel.onclick = function () {
      finish(false);
    };
    leave.onclick = function () {
      finish(true);
    };
    panel.appendChild(cancel);
    panel.appendChild(leave);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', trap, true);
    cancel.focus();
    return function () {
      finish(false);
    };
  }
  root.UOBTKD_UI = { notify: notify, cleanDefaults: cleanDefaults, confirm: confirm };
})(window);
