const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { previewVersion } = require('./live-preview.cjs');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.svg': 'image/svg+xml'
};
function createUiServer(webRoot, desktopRoot, config = {}) {
  const root = path.resolve(webRoot);
  return http.createServer((req, res) => {
    try {
      if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(req.headers.host || '')) {
        res.writeHead(403);
        return res.end();
      }
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405);
        return res.end();
      }
      const url = new URL(req.url, 'http://127.0.0.1');
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      if (relative === '__live-preview' && config.previewRoot) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(previewVersion(root, config.previewRoot)));
      }
      let file = path.resolve(root, relative);
      if (relative === 'desktop-adapter.js') file = path.join(desktopRoot, 'renderer.js');
      else if (relative === 'live-preview.js' && config.previewRoot)
        file = path.join(desktopRoot, 'live-preview.js');
      else if (relative === 'english-controls.css' && config.previewRoot)
        file = path.join(config.previewRoot, 'src/styles/app.css');
      else if (relative === 'desktop.css' && config.previewRoot)
        file = path.join(config.previewRoot, 'apps/desktop/desktop.css');
      else if (relative === 'assets/menu-background.png' && config.previewRoot)
        file = path.join(config.previewRoot, 'src/assets/menu-background.png');
      else if (/^assets\/fonts\/[A-Za-z0-9_.-]+$/.test(relative) && config.previewRoot)
        file = path.join(config.previewRoot, 'src', relative);
      else if (relative === 'desktop.css') file = path.join(desktopRoot, 'desktop.css');
      else if (!file.startsWith(root + path.sep)) {
        res.writeHead(403);
        return res.end();
      }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404);
        return res.end();
      }
      let bytes = fs.readFileSync(file);
      if (relative === 'index.html') {
        const publicConfig = { ...config };
        delete publicConfig.previewRoot;
        if (config.previewRoot) {
          publicConfig.livePreview = true;
          publicConfig.previewVersion = previewVersion(root, config.previewRoot);
        }
        const data = JSON.stringify(publicConfig).replace(/</g, '\\u003c');
        bytes = Buffer.from(
          bytes
            .toString()
            .replace(
              '<head>',
              '<head><script>window.UOBTKD_DESKTOP_CONFIG=' +
                data +
                ';</script><script src="desktop-adapter.js"></script>'
            )
            .replace(
              '</head>',
              '<link rel="stylesheet" href="desktop.css">' +
                (config.previewRoot ? '<script src="live-preview.js" defer></script>' : '') +
                '</head>'
            )
        );
      } else if (relative === 'index.js') {
        // Receiver MQTT remains local; the old vendor cloud is not part of this shell.
        bytes = Buffer.from(
          bytes
            .toString()
            .replace('this.MqttClientLogin(),this.MqttHostLogin()', 'this.MqttClientLogin()')
        );
      }
      res.writeHead(200, {
        'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
        'Content-Length': bytes.length,
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch {
      res.writeHead(400);
      res.end();
    }
  });
}
module.exports = { createUiServer };
