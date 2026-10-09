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
  colorRanking: () => ipcRenderer.invoke('lib:colorRanking'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  setLanguage: (lang) => ipcRenderer.invoke('settings:setLanguage', lang),
  openRepo: () => ipcRenderer.invoke('app:openRepo'),
  openFilamentProfiles: () => ipcRenderer.invoke('app:openFilamentProfiles'),
  openReleases: () => ipcRenderer.invoke('app:openReleases'),
  setUpdateCheck: (on) => ipcRenderer.invoke('settings:setUpdateCheck', on),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  openUpdate: () => ipcRenderer.invoke('update:open'),
  skipUpdate: (version) => ipcRenderer.invoke('update:skip', version),
  convertU1: (id) => ipcRenderer.invoke('lib:convertU1', id),
  update: (id, fields) => ipcRenderer.invoke('lib:update', id, fields),
  setTags: (id, names) => ipcRenderer.invoke('lib:setTags', id, names),
  importDialog: () => ipcRenderer.invoke('lib:importDialog'),
  // Dropped File objects -> absolute paths (File.path is gone in recent Electron)
  importFiles: (files) => ipcRenderer.invoke('lib:importPaths', files.map((f) => webUtils.getPathForFile(f))),
  trash: (id) => ipcRenderer.invoke('lib:trash', id),
  restore: (id) => ipcRenderer.invoke('lib:restore', id),
  emptyTrash: () => ipcRenderer.invoke('lib:emptyTrash'),
  checkConsistency: () => ipcRenderer.invoke('lib:consistency'),
  relocate: (id) => ipcRenderer.invoke('lib:relocate', id),
  removeRecord: (id) => ipcRenderer.invoke('lib:removeRecord', id),
  removeMissing: (ids) => ipcRenderer.invoke('lib:removeMissing', ids),
  findByFilename: () => ipcRenderer.invoke('lib:findByFilename'),
  applyRelocations: (pairs) => ipcRenderer.invoke('lib:applyRelocations', pairs),
  missingInTrash: (id) => ipcRenderer.invoke('lib:missingInTrash', id),
  restoreMissing: (id) => ipcRenderer.invoke('lib:restoreMissing', id),
  rebuildIndex: () => ipcRenderer.invoke('lib:rebuildIndex'),
  reveal: (id) => ipcRenderer.invoke('lib:reveal', id),
  preview: (id, plate) => ipcRenderer.invoke('lib:preview', id, plate),
  idsNeedingThumb: () => ipcRenderer.invoke('lib:idsNeedingThumb'),
  setThumb: (id, bytes) => ipcRenderer.invoke('lib:setThumb', id, bytes),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSpools: (spools) => ipcRenderer.invoke('settings:setSpools', spools),
  setInventory: (list) => ipcRenderer.invoke('settings:setInventory', list),
  importInventory: () => ipcRenderer.invoke('settings:importInventory'),
  exportCsv: (id, opts) => ipcRenderer.invoke('lib:exportCsv', id, opts),
  exportQuantized: (id, opts) => ipcRenderer.invoke('lib:exportQuantized', id, opts),
  chooseRoot: () => ipcRenderer.invoke('settings:chooseRoot'),
  onImported: on('lib:imported'),
  onOpenSettings: on('ui:openSettings'),
  onUpdate: on('ui:update'),
  onHashesUpdated: on('lib:hashesUpdated'),
});
