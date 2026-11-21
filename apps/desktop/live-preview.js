/* Temporary local design preview. Never reload a training/match screen. */
(function () {
  const config = window.UOBTKD_DESKTOP_CONFIG;
  if (!config || !config.livePreview) return;
  let version = config.previewVersion,
    pending = false,
    busy = false;
  function atHome() {
    const home = document.getElementById('id_home');
    return (
      home &&
      home.__vue__ &&
      home.__vue__.$route.name === 'Index' &&
      !document.querySelector('[aria-modal="true"],.modal.in,.pss-equipment-overlay')
    );
  }
  window.PSS_DESKTOP.reloadInterface = function () {
    if (atHome()) location.reload();
    else {
      pending = true;
      if (window.UOBTKD_UI)
        window.UOBTKD_UI.notify('Interface reload queued. Return to the main menu to apply it.');
    }
  };
  async function check() {
    if (busy) return;
    busy = true;
    try {
      const response = await fetch('/__live-preview', { cache: 'no-store' });
      if (!response.ok) return;
      const next = await response.json();
      if (!version) {
        version = next;
        return;
      }
      if (!atHome()) return;
      if (pending || next.interface !== version.interface) {
        location.reload();
        return;
      }
      if (next.styles !== version.styles) {
        for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
          const url = new URL(link.href);
          if (url.origin === location.origin) {
            url.searchParams.set('preview', next.styles);
            link.href = url.href;
          }
        }
        const home = document.getElementById('id_home');
        home.style.setProperty(
          'background-image',
          'url("assets/menu-background.png?preview=' + next.styles + '")',
          'important'
        );
      }
      version = next;
    } catch {
    } finally {
      busy = false;
    }
  }
  setInterval(check, 800);
})();
