const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('UOBTKD_DESKTOP', {
  quit: () => ipcRenderer.send('suite:quit')
});
