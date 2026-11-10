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
    notification.className = 'leda-notification';
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
      /^(Training|Taekwondo|Bristol Taekwondo Electronic Training Suite|跆\s*拳\s*道|乐打智能体育|南京乐打体育科技有限公司)$/.test(
        info.game_name || ''
      )
    ) {
      info.game_name = root.LEDA_CORE.APP_NAME;
    }
  }

  root.LEDA_UI = { notify: notify, cleanDefaults: cleanDefaults };
})(window);
