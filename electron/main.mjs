// Electron main process: window, menu, IPC to the core library.
import { app, BrowserWindow, Menu, ipcMain, dialog, protocol, shell } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, listModels, getModel, updateModel, setTags, sidebarCounts, getThumb, idsNeedingThumb } from '../src/core/db.mjs';
import { loadPreviewData, storeThumb, previewPlate } from '../src/core/preview.mjs';
import { importPaths, indexNewFiles } from '../src/core/importer.mjs';
import { trashModel, restoreModel, emptyTrash, exportModel } from '../src/core/trash.mjs';
import { consistencyReport, relocateModel, removeRecord, findInTrash, restoreMissingFromTrash, isInside, removeMissingRecords, findByFilename, applyRelocations } from '../src/core/missing.mjs';
import { loadSettings, saveSettings, validateSpools, validateInventory, switchRoot, markMissing, modelPath } from '../src/core/settings.mjs';
import { mappingCsv, exportQuantized3mf } from '../src/core/exportMapping.mjs';
import { import3dfpInventory } from '../src/core/inventoryImport.mjs';
import { slotsFromColours } from '../src/core/filament.mjs';
import { SUPPORTED_EXTS } from '../src/core/parse/index.mjs';

// Test hooks: isolate userData / library root (used by the smoke test)
if (process.env.MF_USER_DATA) app.setPath('userData', process.env.MF_USER_DATA);
const DEFAULT_ROOT = process.env.MF_LIBRARY_ROOT || path.join(os.homedir(), '3mf-library');

// Thumbnails are served to <img> as mfthumb://thumb/<id> straight from the DB,
// so the library list never ships PNG blobs over IPC.
protocol.registerSchemesAsPrivileged([{ scheme: 'mfthumb', privileges: { standard: true, secure: true } }]);

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
  ipcMain.handle('lib:list', (_e, opts) => {
    // 遺失 filter: records whose file is not under the current root
    if (opts?.filter === 'missing') return markMissing(listModels(db, { ...opts, filter: 'all' }), root).filter((m) => m.missing);
    return markMissing(listModels(db, opts), root);
  });
  ipcMain.handle('lib:get', (_e, id) => markMissing([getModel(db, id)], root)[0]);
  ipcMain.handle('lib:sidebar', () => ({
    ...sidebarCounts(db),
    missing: markMissing(listModels(db), root).filter((m) => m.missing).length,
  }));
  ipcMain.handle('lib:update', (_e, id, fields) => updateModel(db, id, fields));
  ipcMain.handle('lib:setTags', (_e, id, names) => setTags(db, id, names));
  ipcMain.handle('lib:importPaths', (_e, paths) => importAndNotify(paths));
  // Keep the last preview payload: right after an import the thumbnail and
  // the preview ask for the same model, and a 5M-face 3MF takes ~9 s to parse.
  let lastPreview = null;
  ipcMain.handle('lib:preview', async (_e, id, requestedPlate) => {
    const model = getModel(db, id);
    const plate = previewPlate(model, requestedPlate);
    const file = modelPath(db, root, id);
    // A missing record (遺失) is an expected state, not an error
    if (!fs.existsSync(file)) return { format: model.format, missing: true };
    const { mtimeMs } = await fs.promises.stat(file);
    if (lastPreview?.file === file && lastPreview.mtimeMs === mtimeMs && lastPreview.plate === plate) return lastPreview.payload;
    const payload = await loadPreviewData(file, model.format, plate);
    lastPreview = { file, mtimeMs, plate, payload };
    return payload;
  });
  ipcMain.handle('lib:trash', (_e, id) => trashModel(db, root, id));
  ipcMain.handle('lib:restore', (_e, id) => restoreModel(db, root, id));
  // Permanent deletion: two separate confirmations (SPEC 3.7)
  ipcMain.handle('lib:emptyTrash', async () => {
    const n = sidebarCounts(db).trash;
    if (!n) return 0;
    const first = await dialog.showMessageBox(win, {
      type: 'warning',
      message: `清空回收桶？`,
      detail: `回收桶內的 ${n} 個檔案將被永久刪除。`,
      buttons: ['取消', '清空…'],
      defaultId: 0,
      cancelId: 0,
    });
    if (first.response !== 1) return null;
    const second = await dialog.showMessageBox(win, {
      type: 'warning',
      message: `再次確認：永久刪除 ${n} 個檔案？`,
      detail: '此動作無法復原。',
      buttons: ['取消', '永久刪除'],
      defaultId: 0,
      cancelId: 0,
    });
    if (second.response !== 1) return null;
    return emptyTrash(db, root);
  });
  ipcMain.handle('lib:export', async (_e, id) => {
    const r = await dialog.showOpenDialog(win, { title: '匯出到…', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths.length) return null;
    return exportModel(db, root, id, r.filePaths[0]);
  });
  ipcMain.handle('lib:consistency', () => consistencyReport(db, root, app.getPath('userData')));
  // Missing-record actions. Errors come back as { error } for the UI to show.
  ipcMain.handle('lib:relocate', async (_e, id) => {
    const r = await dialog.showOpenDialog(win, {
      title: '重新定位檔案',
      properties: ['openFile'],
      filters: [{ name: '3D 模型', extensions: SUPPORTED_EXTS.map((e) => e.slice(1)) }],
    });
    if (r.canceled || !r.filePaths.length) return null;
    const picked = r.filePaths[0];
    if (!isInside(root, picked)) {
      const ok = await dialog.showMessageBox(win, {
        type: 'question',
        message: '這個檔案不在檔案櫃根目錄裡',
        detail: `重新定位會把它搬進 ${path.join(root, String(new Date().getFullYear()))}（與匯入相同，同名自動加後綴、不覆蓋）。`,
        buttons: ['取消', '搬進檔案櫃'],
        defaultId: 1,
        cancelId: 0,
      });
      if (ok.response !== 1) return null;
    }
    try {
      return { relPath: await relocateModel(db, root, id, picked) };
    } catch (err) {
      return { error: err.message };
    }
  });
  ipcMain.handle('lib:removeRecord', async (_e, id) => {
    const ok = await dialog.showMessageBox(win, {
      type: 'question',
      message: `移除「${getModel(db, id).name}」的記錄？`,
      detail: '只刪除檔案櫃的索引記錄（標籤、來源等），不會刪除任何檔案。',
      buttons: ['取消', '移除記錄'],
      defaultId: 0,
      cancelId: 0,
    });
    if (ok.response !== 1) return false;
    removeRecord(db, id);
    return true;
  });
  // Batch remove of missing records: two confirmations; index only, files untouched
  ipcMain.handle('lib:removeMissing', async (_e, ids) => {
    if (!ids.length) return [];
    const first = await dialog.showMessageBox(win, {
      type: 'warning',
      message: `移除 ${ids.length} 筆遺失記錄？`,
      detail: '只刪除檔案櫃的索引記錄（標籤、來源、備註），不會刪除任何檔案。',
      buttons: ['取消', '移除…'],
      defaultId: 0,
      cancelId: 0,
    });
    if (first.response !== 1) return null;
    const second = await dialog.showMessageBox(win, {
      type: 'warning',
      message: `再次確認：移除 ${ids.length} 筆記錄？`,
      detail: '這些記錄的標籤與來源資料將無法復原。',
      buttons: ['取消', '移除記錄'],
      defaultId: 0,
      cancelId: 0,
    });
    if (second.response !== 1) return null;
    return removeMissingRecords(db, root, ids);
  });
  ipcMain.handle('lib:findByFilename', () => findByFilename(db, root));
  ipcMain.handle('lib:applyRelocations', (_e, pairs) => applyRelocations(db, root, pairs));
  ipcMain.handle('lib:missingInTrash', async (_e, id) => Boolean(await findInTrash(root, getModel(db, id).rel_path)));
  ipcMain.handle('lib:restoreMissing', async (_e, id) => {
    try {
      return { relPath: await restoreMissingFromTrash(db, root, id) };
    } catch (err) {
      return { error: err.message };
    }
  });
  ipcMain.handle('lib:rebuildIndex', async () => (await indexNewFiles(db, root)).length);
  ipcMain.handle('lib:reveal', (_e, id) => shell.showItemInFolder(modelPath(db, root, id)));
  ipcMain.handle('lib:idsNeedingThumb', () => idsNeedingThumb(db));
  ipcMain.handle('lib:setThumb', (_e, id, bytes) => storeThumb(db, id, bytes));
  ipcMain.handle('lib:importDialog', () => importViaDialog());
  ipcMain.handle('settings:get', () => ({ libraryRoot: root, spools: loadSettings(app.getPath('userData'), root).spools, inventory: loadSettings(app.getPath('userData'), root).inventory }));
  ipcMain.handle('settings:setInventory', (_e, list) => {
    try {
      const clean = validateInventory(list);
      saveSettings(app.getPath('userData'), { inventory: clean });
      return { inventory: clean };
    } catch (err) {
      return { error: err.message };
    }
  });
  ipcMain.handle('settings:importInventory', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: '匯入線材庫（3dfilamentprofiles 匯出檔）',
      filters: [{ name: 'JSON / CSV', extensions: ['json', 'csv'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths.length) return null;
    try {
      const text = await fs.promises.readFile(r.filePaths[0], 'utf8');
      return { ...import3dfpInventory(text), path: r.filePaths[0] };
    } catch (err) {
      return { error: `匯入失敗：${err.message}` };
    }
  });
  ipcMain.handle('settings:setSpools', (_e, spools) => {
    try {
      const clean = validateSpools(spools);
      saveSettings(app.getPath('userData'), { spools: clean });
      return { spools: clean };
    } catch (err) {
      return { error: err.message };
    }
  });
  // M9 exports. Both go to a file the user picks (the save dialog confirms a replace);
  // the source 3MF is only read.
  const userSlots = () => slotsFromColours(loadSettings(app.getPath('userData'), root).spools);
  const askSavePath = async (title, defaultName, ext) => {
    const r = await dialog.showSaveDialog(win, { title, defaultPath: path.join(app.getPath('downloads'), defaultName), filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    return r.canceled || !r.filePath ? null : r.filePath;
  };
  ipcMain.handle('lib:exportCsv', async (_e, id, opts) => {
    const m = getModel(db, id);
    const dest = await askSavePath('匯出映射報告', `${m.name}-映射報告.csv`, 'csv');
    if (!dest) return null;
    await fs.promises.writeFile(dest, mappingCsv(m.colors, userSlots(), opts));
    return { path: dest };
  });
  ipcMain.handle('lib:exportQuantized', async (_e, id, opts) => {
    const m = getModel(db, id);
    const slots = userSlots();
    const dest = await askSavePath('匯出量化 3MF', `${m.name}-量化${slots.length}捲${opts?.mix ? 'mix' : ''}.3mf`, '3mf');
    if (!dest) return null;
    try {
      const r = await exportQuantized3mf(modelPath(db, root, id), dest, slots, { ...opts, overwrite: true });
      return { path: dest, summary: r.summary, mixes: r.mixes.length };
    } catch (err) {
      return { error: err.message };
    }
  });
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
  protocol.handle('mfthumb', (req) => {
    const png = getThumb(db, Number(new URL(req.url).pathname.slice(1)));
    return png ? new Response(png, { headers: { 'content-type': 'image/png' } }) : new Response(null, { status: 404 });
  });
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
