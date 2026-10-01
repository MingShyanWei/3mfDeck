// Preload: expose a narrow API to the renderer.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('api', {
  list: (opts) => ipcRenderer.invoke('lib:list', opts),
  get: (id) => ipcRenderer.invoke('lib:get', id),
  sidebar: () => ipcRenderer.invoke('lib:sidebar'),
  update: (id, fields) => ipcRenderer.invoke('lib:update', id, fields),
  setTags: (id, names) => ipcRenderer.invoke('lib:setTags', id, names),
  importDialog: () => ipcRenderer.invoke('lib:importDialog'),
  // Dropped File objects -> absolute paths (File.path is gone in recent Electron)
  importFiles: (files) => ipcRenderer.invoke('lib:importPaths', files.map((f) => webUtils.getPathForFile(f))),
  reveal: (id) => ipcRenderer.invoke('lib:reveal', id),
  preview: (id) => ipcRenderer.invoke('lib:preview', id),
  idsNeedingThumb: () => ipcRenderer.invoke('lib:idsNeedingThumb'),
  setThumb: (id, bytes) => ipcRenderer.invoke('lib:setThumb', id, bytes),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  chooseRoot: () => ipcRenderer.invoke('settings:chooseRoot'),
  onImported: on('lib:imported'),
  onOpenSettings: on('ui:openSettings'),
});
