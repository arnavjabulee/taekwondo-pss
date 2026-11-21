/* Desktop-only integration; scoring remains in the shared renderer. */
(function () {
  'use strict';
  var config = window.UOBTKD_DESKTOP_CONFIG || {};
  if (!localStorage.getItem('uobtkd_desktop_migration_v1')) {
    Object.keys(config.legacyData || {}).forEach(function (key) {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, config.legacyData[key]);
    });
    localStorage.setItem('uobtkd_desktop_migration_v1', '1');
  }
  window.PSS_DESKTOP = {
    replayShortcut: function (key) {
      var replay = document.getElementById('desktop-replay');
      if (!replay || !replay.open) return false;
      if (key === 'Escape') {
        replay.close();
        return true;
      }
      var action = { Space: 'toggle', ArrowLeft: 'back', ArrowRight: 'forward' }[key];
      if (action)
        replay
          .querySelector('iframe')
          .contentWindow.postMessage(
            { type: 'uobtkd-replay-shortcut', action: action },
            'http://127.0.0.1:8976'
          );
      // Other scoring shortcuts must not reach the match underneath replay.
      return key !== 'Tab' && key !== 'Enter';
    },
    escape: function () {
      var replay = document.getElementById('desktop-replay');
      if (replay && replay.open) {
        replay.close();
        return;
      }
      if ((!window.PSS_KEYS || !window.PSS_KEYS.nativeKey('Escape')) && window.PSS_NAV)
        window.PSS_NAV.back();
    },
    matchState: (function () {
      var previous = '',
        queue = Promise.resolve(),
        key = '';
      return function (phase) {
        if (phase === previous) return;
        previous = phase;
        var pausedAt = Date.now();
        queue = queue
          .catch(function () {})
          .then(async function () {
            if (!key)
              key = (await (await fetch('http://127.0.0.1:8976/api/desktop/bootstrap')).json()).key;
            var response = await fetch('http://127.0.0.1:8976/api/desktop/replay/match', {
              method: 'POST',
              headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
              body: JSON.stringify({ phase: phase, at: pausedAt })
            });
            if (!response.ok) {
              key = '';
              throw new Error('Replay pause marker unavailable');
            }
          })
          .catch(function () {
            key = '';
            previous = '';
          });
      };
    })(),
    receiverAddress:
      localStorage.getItem('uobtkd_receiver_address') ||
      config.receiverAddress ||
      '192.168.99.1:1884',
    openReplay: function () {
      var existing = document.getElementById('desktop-replay');
      if (existing) {
        existing.showModal();
        existing
          .querySelector('iframe')
          .contentWindow.postMessage('uobtkd-default-review', 'http://127.0.0.1:8976');
        return;
      }
      var dialog = document.createElement('dialog');
      dialog.id = 'desktop-replay';
      dialog.style.cssText =
        'position:fixed;inset:0;width:calc(100vw - 32px);height:calc(100vh - 32px);max-width:none;max-height:none;padding:0;border:1px solid #444;background:#101010;color:white;';
      var bar = document.createElement('div');
      bar.style.cssText =
        'display:flex;align-items:center;justify-content:space-between;padding:8px 16px;height:48px;box-sizing:border-box';
      var title = document.createElement('strong');
      title.textContent = 'Video replay';
      bar.appendChild(title);
      var close = document.createElement('button');
      close.textContent = 'Return to control panel';
      close.onclick = function () {
        dialog.close();
      };
      bar.appendChild(close);
      var frame = document.createElement('iframe');
      frame.title = 'Video replay';
      frame.src = 'http://127.0.0.1:8976/replay';
      window.addEventListener('message', function (event) {
        if (
          event.source === frame.contentWindow &&
          event.origin === 'http://127.0.0.1:8976' &&
          event.data === 'uobtkd-close-replay'
        )
          dialog.close();
      });
      frame.style.cssText =
        'display:block;border:0;width:100%;height:calc(100% - 48px);background:#101010';
      dialog.appendChild(bar);
      dialog.appendChild(frame);
      document.body.appendChild(dialog);
      dialog.addEventListener(
        'keydown',
        function (event) {
          if (event.key === 'Escape') {
            event.stopImmediatePropagation();
            event.preventDefault();
            dialog.close();
          }
        },
        true
      );
      // Capture before the shared back-navigation handler while this view is open.
      window.addEventListener(
        'keydown',
        function (event) {
          if (dialog.open && event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            dialog.close();
          }
        },
        true
      );
      dialog.showModal();
    }
  };
  window.HostQuit = function () {
    window.UOBTKD_DESKTOP.quit();
  };
})();
