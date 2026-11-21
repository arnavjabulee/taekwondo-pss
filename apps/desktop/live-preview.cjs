const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
function previewVersion(webRoot, sourceRoot) {
  const styles = [
    path.join(sourceRoot, 'src/styles/app.css'),
    path.join(sourceRoot, 'apps/desktop/desktop.css'),
    path.join(sourceRoot, 'src/assets/menu-background.png')
  ];
  const fonts = path.join(sourceRoot, 'src/assets/fonts');
  if (fs.existsSync(fonts))
    for (const file of fs.readdirSync(fonts)) styles.push(path.join(fonts, file));
  const scripts = fs
    .readdirSync(webRoot)
    .filter((file) => /\.(js|html)$/.test(file))
    .sort()
    .map((file) => path.join(webRoot, file));
  scripts.push(
    path.join(sourceRoot, 'apps/desktop/renderer.js'),
    path.join(sourceRoot, 'apps/desktop/live-preview.js')
  );
  function fingerprint(files) {
    const hash = crypto.createHash('sha256');
    for (const file of files) {
      try {
        const stat = fs.statSync(file);
        hash.update(file).update(String(stat.mtimeMs)).update(String(stat.size));
      } catch {
        hash.update(file + 'missing');
      }
    }
    return hash.digest('hex').slice(0, 16);
  }
  return { styles: fingerprint(styles), interface: fingerprint(scripts) };
}
module.exports = { previewVersion };
