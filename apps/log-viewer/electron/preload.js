const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (partial) => ipcRenderer.invoke('config:set', partial),
  fetchLatest: (opts) => ipcRenderer.invoke('logs:fetchLatest', opts),
  fetchAll: (opts) => ipcRenderer.invoke('logs:fetchAll', opts),
});
