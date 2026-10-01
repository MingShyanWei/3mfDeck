// Electron main process: window, menu, IPC to the core library.
import { app, BrowserWindow, Menu, ipcMain, dialog } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, listModels, getModel, updateModel, setTags, sidebarCounts } from '../src/core/db.mjs';
import { importPaths } from '../src/core/importer.mjs';
import { loadSettings, switchRoot, markMissing } from '../src/core/settings.mjs';
import { SUPPORTED_EXTS } from '../src/core/parse/index.mjs';

// Test hooks: isolate userData / library root (used by the smoke test)
if (process.env.MF_USER_DATA) app.setPath('userData', process.env.MF_USER_DATA);
const DEFAULT_ROOT = process.env.MF_LIBRARY_ROOT || path.join(os.homedir(), '3mf-library');

let win = null;
let db = null;
let root = null;

async function importAndNotify(paths) {
  const res = await importPaths(db, root, paths);
  win.webContents.send('lib:imported', res);
  return res;
}

async function importViaDialog() {
  const r = await dialog.showOpenDialog(win, {
    title: '匯入模型',
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    filters: [{ name: '3D 模型', extensions: SUPPORTED_EXTS.map((e) => e.slice(1)) }],
  });
  if (r.canceled || !r.filePaths.length) return null;
  return importAndNotify(r.filePaths);
}

function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      {
        label: '檔案',
        submenu: [
          { id: 'import', label: '匯入…', accelerator: 'CmdOrCtrl+I', click: () => importViaDialog() },
          { type: 'separator' },
          { id: 'settings', label: '設定…', accelerator: 'CmdOrCtrl+,', click: () => win.webContents.send('ui:openSettings') },
          { type: 'separator' },
          { role: 'close' },
        ],
      },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]),
  );
}

function registerIpc() {
  ipcMain.handle('lib:list', (_e, opts) => markMissing(listModels(db, opts), root));
  ipcMain.handle('lib:get', (_e, id) => markMissing([getModel(db, id)], root)[0]);
  ipcMain.handle('lib:sidebar', () => sidebarCounts(db));
  ipcMain.handle('lib:update', (_e, id, fields) => updateModel(db, id, fields));
  ipcMain.handle('lib:setTags', (_e, id, names) => setTags(db, id, names));
  ipcMain.handle('lib:importPaths', (_e, paths) => importAndNotify(paths));
  ipcMain.handle('lib:importDialog', () => importViaDialog());
  ipcMain.handle('settings:get', () => ({ libraryRoot: root }));
  ipcMain.handle('settings:chooseRoot', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: '選擇檔案櫃根目錄',
      defaultPath: root,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths.length) return null;
    // Changing root never moves files; old records not found under it show as 遺失.
    const res = await switchRoot(db, app.getPath('userData'), r.filePaths[0]);
    root = res.libraryRoot;
    return res;
  });
}

app.whenReady().then(() => {
  root = loadSettings(app.getPath('userData'), DEFAULT_ROOT).libraryRoot;
  fs.mkdirSync(root, { recursive: true });
  db = openDb(path.join(app.getPath('userData'), 'library.db'));
  registerIpc();
  buildMenu();
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 560,
    title: '3MF 櫃',
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  // Dropping a file outside the drop zone must not navigate the window away
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(import.meta.dirname, '..', 'dist', 'index.html'));
});

app.on('window-all-closed', () => app.quit());
