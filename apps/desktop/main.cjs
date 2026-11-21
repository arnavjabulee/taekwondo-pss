const { app, BrowserWindow, Menu, ipcMain, dialog, screen, session, shell } = require('electron');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const { createUiServer } = require('./server.cjs');
const { readLegacy } = require('./legacy.cjs');
const run = promisify(execFile);
app.setName('UoBTKD Training Suite');
if (process.env.UOBTKD_DESKTOP_DATA)
  app.setPath('userData', path.resolve(process.env.UOBTKD_DESKTOP_DATA));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const resources = app.isPackaged
  ? path.join(process.resourcesPath, 'suite')
  : path.resolve(__dirname, '../../UoBTKD Training Suite');
const webRoot = app.isPackaged
  ? path.join(resources, 'web')
  : path.join(resources, 'nginx/html/train');
const bridgeRoot = path.join(resources, 'judge-bridge');
const children = new Set();
let previewRoot;
try {
  const settings = JSON.parse(fs.readFileSync(path.join(__dirname, 'live-preview.json'), 'utf8'));
  if (settings.sourceRoot && fs.existsSync(path.join(settings.sourceRoot, 'src/styles/app.css')))
    previewRoot = settings.sourceRoot;
} catch {}
let mainWindow, uiServer, origin;
function secureWindow(window, allowedOrigin) {
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== allowedOrigin) event.preventDefault();
  });
  window.webContents.on('page-title-updated', (event) => event.preventDefault());
}
async function startBridge() {
  await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(bridgeRoot, 'Start-Bridge.ps1')
    ],
    { windowsHide: true, timeout: 30000 }
  );
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:8976/health', {
        signal: AbortSignal.timeout(1000)
      });
      const result = await response.json();
      if (result.service === 'uobtkd-judge-bridge') return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('The phone service did not start. Close other installations and try again.');
}
function openReplay() {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.executeJavaScript('window.PSS_DESKTOP.openReplay()');
}
async function start() {
  if (!fs.existsSync(path.join(webRoot, 'index.html')))
    throw new Error('Build the web interface first: python tools/build_english.py');
  await startBridge();
  uiServer = createUiServer(webRoot, __dirname, {
    previewRoot,
    receiverAddress: process.env.UOBTKD_RECEIVER_ADDRESS || '192.168.99.1:1884',
    legacyData: readLegacy(path.join(resources, 'LocalStorage/http_localhost_10808.localstorage'))
  });
  const port = 11818;
  await new Promise((resolve, reject) => {
    uiServer.once('error', reject);
    uiServer.listen(port, '127.0.0.1', resolve);
  });
  origin = 'http://127.0.0.1:' + port;
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) =>
    callback(
      ['fullscreen', 'local-network', 'loopback-network', 'local-network-access'].includes(
        permission
      )
    )
  );
  const preload = path.join(__dirname, 'preload.cjs');
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1000,
    minHeight: 680,
    title: 'UoBTKD Training Suite',
    backgroundColor: '#101010',
    icon: app.isPackaged
      ? path.join(resources, 'app.ico')
      : path.resolve(__dirname, '../../src/assets/app.ico'),
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  secureWindow(mainWindow, origin);
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (
      input.type === 'keyDown' &&
      input.key === 'Escape' &&
      !input.control &&
      !input.alt &&
      !input.meta &&
      !input.shift
    ) {
      event.preventDefault();
      if (!input.isAutoRepeat)
        mainWindow.webContents
          .executeJavaScript('window.PSS_DESKTOP && window.PSS_DESKTOP.escape()')
          .catch(() => {});
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const target = new URL(url);
    if (target.origin !== origin || target.pathname !== '/spectator.html')
      return { action: 'deny' };
    const displays = screen.getAllDisplays();
    const current = screen.getDisplayMatching(mainWindow.getBounds());
    const display = displays.find((item) => item.id !== current.id) || current;
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        title: 'UoBTKD Spectator',
        backgroundColor: '#000000',
        ...display.bounds,
        fullscreen: true,
        autoHideMenuBar: true,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          backgroundThrottling: false
        }
      }
    };
  });
  mainWindow.webContents.on('did-create-window', (child) => {
    children.add(child);
    child.setMenu(null);
    secureWindow(child, origin);
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    child.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault();
        child.close();
      }
    });
    child.on('closed', () => children.delete(child));
  });
  mainWindow.on('closed', () => {
    for (const child of children) child.destroy();
    mainWindow = null;
  });
  mainWindow.once('ready-to-show', () => {
    mainWindow.setFullScreen(true);
    mainWindow.setMenuBarVisibility(false);
    mainWindow.show();
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [
          { label: 'Video replay', click: openReplay },
          {
            label: 'Recordings folder',
            click: () => {
              const folder = path.join(bridgeRoot, 'recordings');
              fs.mkdirSync(folder, { recursive: true });
              shell.openPath(folder);
            }
          },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      {
        label: 'View',
        submenu: [
          ...(previewRoot
            ? [
                {
                  label: 'Reload interface',
                  accelerator: 'CmdOrCtrl+Shift+R',
                  click: () =>
                    mainWindow.webContents.executeJavaScript('window.PSS_DESKTOP.reloadInterface()')
                }
              ]
            : []),
          { role: 'togglefullscreen' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' }
        ]
      }
    ])
  );
  ipcMain.on('suite:quit', (event) => {
    if (mainWindow && event.sender === mainWindow.webContents) app.quit();
  });
  await mainWindow.loadURL(origin);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  app
    .whenReady()
    .then(start)
    .catch((error) => {
      dialog.showErrorBox('UoBTKD Training Suite', error.message);
      app.quit();
    });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    if (uiServer) uiServer.close();
  });
}
