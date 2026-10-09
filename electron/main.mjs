// Electron main process: window, menu, IPC to the core library.
import { app, BrowserWindow, Menu, ipcMain, dialog, protocol, shell, nativeImage, net } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isNearlyBlack } from '../src/core/thumbCheck.mjs';
import { hashFile, isDataless } from '../src/core/contentHash.mjs';
import { openDb, listModels, getModel, updateModel, setTags, sidebarCounts, getThumb, idsNeedingThumb, cabinetColorRows, idsNeedingSourcePrinter, setSourcePrinter, idsNeedingEmbedded, setEmbedded, getCover, thumbsToCheck, setThumb, idsNeedingHash, setContentHash, conversionsOf, setConvertedFrom } from '../src/core/db.mjs';
import JSZip from 'jszip';
import { listEmbeddedImages, mimeOf } from '../src/core/embeddedImages.mjs';
import { convertToU1, readSourcePrinter } from '../src/core/u1Convert.mjs';
import { migrateUserData, OLD_APP_NAME } from '../src/core/userDataMigration.mjs';
import { versionLabel, AUTHOR, REPO, REPO_URL } from '../src/core/version.mjs';
import { loadU1Profiles, DEFAULT_PROFILES_DIR } from '../src/core/orcaProfiles.mjs';
import { cabinetColors } from '../src/core/purchase.mjs';
import { loadPreviewData, storeThumb, previewPlate } from '../src/core/preview.mjs';
import { importPaths, indexNewFiles } from '../src/core/importer.mjs';
import { trashModel, restoreModel, emptyTrash } from '../src/core/trash.mjs';
import { consistencyReport, relocateModel, removeRecord, findInTrash, restoreMissingFromTrash, isInside, removeMissingRecords, findByFilename, applyRelocations } from '../src/core/missing.mjs';
import { loadSettings, saveSettings, validateSpools, validateInventory, switchRoot, markMissing, modelPath } from '../src/core/settings.mjs';
import { mappingCsv, exportQuantized3mf } from '../src/core/exportMapping.mjs';
import { import3dfpInventory, FILAMENT_PROFILES_URL } from '../src/core/inventoryImport.mjs';
import { slotsFromColours } from '../src/core/filament.mjs';
import { SUPPORTED_EXTS } from '../src/core/parse/index.mjs';
import { t, setLang, getLang, pickLang, LANGS } from '../src/core/i18n/index.mjs';
import { runUpdateCycle, RELEASES_URL, LATEST_RELEASE_API } from '../src/core/updateCheck.mjs';

// Test hooks: isolate userData / library root (used by the smoke test)
if (process.env.MF_USER_DATA) app.setPath('userData', process.env.MF_USER_DATA);
const DEFAULT_ROOT = process.env.MF_LIBRARY_ROOT || path.join(os.homedir(), '3mf-library');

// Thumbnails are served to <img> as mfthumb://thumb/<id> straight from the DB,
// so the library list never ships PNG blobs over IPC.
protocol.registerSchemesAsPrivileged([
  { scheme: 'mfthumb', privileges: { standard: true, secure: true } },
  { scheme: 'mfimg', privileges: { standard: true, secure: true } }, // M19 embedded product images
]);

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
    title: t('dlg.importTitle'),
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    filters: [{ name: t('dlg.models3d'), extensions: SUPPORTED_EXTS.map((e) => e.slice(1)) }],
  });
  if (r.canceled || !r.filePaths.length) return null;
  return importAndNotify(r.filePaths);
}

function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      {
        label: t('menu.file'),
        submenu: [
          { id: 'import', label: t('menu.import'), accelerator: 'CmdOrCtrl+I', click: () => importViaDialog() },
          { type: 'separator' },
          { id: 'settings', label: t('menu.settings'), accelerator: 'CmdOrCtrl+,', click: () => win.webContents.send('ui:openSettings') },
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

// M22 (SPEC 3.11): version = build time, from dist/build-info.json written by `vite build`
function appInfo() {
  let info = { time: new Date().toISOString(), commit: 'unknown' };
  try {
    info = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'dist', 'build-info.json'), 'utf8'));
  } catch {
    // no build info (should not happen after vite build): show the launch time, still marked dev when unpackaged
  }
  // buildVersion: the bare stamp (no "dev"), what the update check compares
  return { ...versionLabel(info, app.isPackaged), buildVersion: versionLabel(info, true).version, commit: info.commit, author: AUTHOR, repo: REPO };
}

// M30/M32 (SPEC 3.13): the update check (layer 2), ON by default. Runs in
// the background once the window has loaded, at most once per 24 h (the
// time and the release found are kept in config.json), and right away when
// the user switches it back on. Switched off: runUpdateCycle makes no
// request. Tests point it at a local server with MF_UPDATE_API_URL.
let updateNotice = null; // { version, url } of a newer release, or null
async function runUpdateCheck({ force = false } = {}) {
  const { notice, save } = await runUpdateCycle({
    settings: loadSettings(app.getPath('userData'), root),
    current: appInfo().buildVersion,
    fetch: (url, opts) => net.fetch(url, opts),
    url: process.env.MF_UPDATE_API_URL || LATEST_RELEASE_API,
    force,
  });
  // the setting may have been switched off while the request was in flight
  const on = loadSettings(app.getPath('userData'), root).updateCheck;
  if (on && save) saveSettings(app.getPath('userData'), save);
  updateNotice = on ? notice : null;
  win?.webContents.send('ui:update', updateNotice);
  return updateNotice;
}

/** Switch the main process to `lang`: core messages, menu, About panel. */
function applyLanguage(lang) {
  setLang(lang);
  buildMenu();
  const about = appInfo();
  app.setAboutPanelOptions({ applicationName: '3mfDeck', applicationVersion: about.version, version: `git ${about.commit}`, credits: t('about.credits', { author: AUTHOR, repo: REPO }) });
}

function registerIpc() {
  ipcMain.handle('app:info', () => appInfo());
  ipcMain.handle('settings:setLanguage', (_e, lang) => {
    if (!LANGS.includes(lang)) return { error: `unknown language ${lang}` };
    saveSettings(app.getPath('userData'), { language: lang });
    applyLanguage(lang);
    return { language: lang };
  });
  // Opens the project page in the system browser; the app itself never makes a
  // network request (SPEC: fully offline). Only this fixed URL can be opened.
  ipcMain.handle('app:openRepo', () => shell.openExternal(REPO_URL));
  // M30 layer 1: the Releases page in the system browser (no request from the app)
  ipcMain.handle('app:openReleases', () => shell.openExternal(RELEASES_URL));
  ipcMain.handle('update:status', () => updateNotice);
  ipcMain.handle('update:open', () => shell.openExternal(updateNotice?.url ?? RELEASES_URL));
  ipcMain.handle('update:skip', (_e, version) => {
    saveSettings(app.getPath('userData'), { skippedUpdate: String(version) });
    updateNotice = null;
    win?.webContents.send('ui:update', null);
  });
  ipcMain.handle('settings:setUpdateCheck', (_e, on) => {
    saveSettings(app.getPath('userData'), { updateCheck: on === true });
    if (on === true) return runUpdateCheck({ force: true }); // switched back on: check now
    updateNotice = null;
    win?.webContents.send('ui:update', null);
    return null;
  });
  // M26: the inventory export source, same rule: one fixed URL in the system browser
  ipcMain.handle('app:openFilamentProfiles', () => shell.openExternal(FILAMENT_PROFILES_URL));
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
  // M17: cabinet-wide colour ranking (purchase suggestions are matched against the inventory in the renderer)
  ipcMain.handle('lib:colorRanking', () => cabinetColors(cabinetColorRows(db)));
  // M18: convert a non-U1 project into a new "-U1" 3MF (source untouched), import it and
  // give it the source record's provenance, notes and tags
  ipcMain.handle('lib:convertU1', async (_e, id) => {
    const src = getModel(db, id);
    // M33 (SPEC 3.1b): already converted once -> ask before making another "-U1-2"
    const earlier = conversionsOf(db, id);
    if (earlier.length) {
      const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        message: t('dlg.alreadyConverted', { name: earlier[0].name }),
        detail: t('dlg.alreadyConvertedDetail', { rel: earlier[0].rel_path }),
        buttons: [t('dlg.cancel'), t('dlg.convertAgain')],
        defaultId: 0,
        cancelId: 0,
      });
      if (response !== 1) return { cancelled: true };
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mfcab-u1-'));
    try {
      const dest = path.join(tmp, `${path.basename(src.rel_path, path.extname(src.rel_path))}-U1.3mf`);
      const report = await convertToU1(modelPath(db, root, id), dest, loadU1Profiles(process.env.MF_ORCA_PROFILES || DEFAULT_PROFILES_DIR));
      const res = await importPaths(db, root, [dest]);
      const newId = res.ids[0];
      if (!newId && res.duplicates[0]) throw new Error(t('u1.err.duplicate', { rel: res.duplicates[0].relPath }));
      if (!newId) throw new Error(res.errors[0]?.error || t('u1.err.importFailed'));
      setConvertedFrom(db, newId, id);
      const { provenance_type, platform, url, prompt, retrieved_at, notes } = src;
      updateModel(db, newId, { name: `${src.name}-U1`, provenance_type, platform, url, prompt, retrieved_at, notes });
      setTags(db, newId, src.tags);
      return { id: newId, name: `${src.name}-U1`, relPath: getModel(db, newId).rel_path, report };
    } catch (err) {
      return { error: err.message };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
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
      message: t('dlg.emptyTrash'),
      detail: t('dlg.emptyTrashDetail', { n }),
      buttons: [t('dlg.cancel'), t('dlg.emptyTrashButton')],
      defaultId: 0,
      cancelId: 0,
    });
    if (first.response !== 1) return null;
    const second = await dialog.showMessageBox(win, {
      type: 'warning',
      message: t('dlg.emptyTrashConfirm', { n }),
      detail: t('dlg.cannotUndo'),
      buttons: [t('dlg.cancel'), t('dlg.deleteForever')],
      defaultId: 0,
      cancelId: 0,
    });
    if (second.response !== 1) return null;
    return emptyTrash(db, root);
  });
  ipcMain.handle('lib:consistency', () => consistencyReport(db, root, app.getPath('userData')));
  // Missing-record actions. Errors come back as { error } for the UI to show.
  ipcMain.handle('lib:relocate', async (_e, id) => {
    const r = await dialog.showOpenDialog(win, {
      title: t('dlg.relocateTitle'),
      properties: ['openFile'],
      filters: [{ name: t('dlg.models3d'), extensions: SUPPORTED_EXTS.map((e) => e.slice(1)) }],
    });
    if (r.canceled || !r.filePaths.length) return null;
    const picked = r.filePaths[0];
    if (!isInside(root, picked)) {
      const ok = await dialog.showMessageBox(win, {
        type: 'question',
        message: t('dlg.outsideRoot'),
        detail: t('dlg.outsideRootDetail', { dir: path.join(root, String(new Date().getFullYear())) }),
        buttons: [t('dlg.cancel'), t('dlg.moveIn')],
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
      message: t('dlg.removeRecord', { name: getModel(db, id).name }),
      detail: t('dlg.removeRecordDetail'),
      buttons: [t('dlg.cancel'), t('dlg.removeRecordButton')],
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
      message: t('dlg.removeMissing', { n: ids.length }),
      detail: t('dlg.removeMissingDetail'),
      buttons: [t('dlg.cancel'), t('dlg.removeEllipsis')],
      defaultId: 0,
      cancelId: 0,
    });
    if (first.response !== 1) return null;
    const second = await dialog.showMessageBox(win, {
      type: 'warning',
      message: t('dlg.removeMissingConfirm', { n: ids.length }),
      detail: t('dlg.removeMissingConfirmDetail'),
      buttons: [t('dlg.cancel'), t('dlg.removeRecordButton')],
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
  ipcMain.handle('lib:setThumb', (_e, id, bytes) => storeThumb(db, id, bytes, thumbIsBlack(bytes)));
  ipcMain.handle('lib:importDialog', () => importViaDialog());
  ipcMain.handle('settings:get', () => {
    const s = loadSettings(app.getPath('userData'), root);
    return { libraryRoot: root, spools: s.spools, inventory: s.inventory, language: getLang(), updateCheck: s.updateCheck };
  });
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
      title: t('dlg.importInventory'),
      filters: [{ name: 'JSON / CSV', extensions: ['json', 'csv'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths.length) return null;
    try {
      const text = await fs.promises.readFile(r.filePaths[0], 'utf8');
      return { ...import3dfpInventory(text), path: r.filePaths[0] };
    } catch (err) {
      return { error: t('inventory.err.importFailed', { message: err.message }) };
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
    const dest = await askSavePath(t('dlg.exportCsv'), t('export.csvName', { name: m.name }), 'csv');
    if (!dest) return null;
    await fs.promises.writeFile(dest, mappingCsv(m.colors, userSlots(), opts));
    return { path: dest };
  });
  ipcMain.handle('lib:exportQuantized', async (_e, id, opts) => {
    const m = getModel(db, id);
    const slots = userSlots();
    const dest = await askSavePath(t('dlg.export3mf'), t('export.quantizedName', { name: m.name, n: slots.length, mix: opts?.mix ? t('export.mixSuffix') : '' }), '3mf');
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
      title: t('dlg.chooseRoot'),
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
  // M19: mfimg://cover/<id> = the cover stored at import; mfimg://entry/<id>?p=<path> = one
  // listed image entry read from the 3MF on demand
  protocol.handle('mfimg', async (req) => {
    const url = new URL(req.url);
    const id = Number(url.pathname.slice(1));
    try {
      if (url.hostname === 'cover') {
        const c = getCover(db, id);
        return c ? new Response(c.bytes, { headers: { 'content-type': mimeOf(c.path) } }) : new Response(null, { status: 404 });
      }
      const entry = url.searchParams.get('p');
      const listed = getModel(db, id)?.embedded_images?.images.some((i) => i.path === entry);
      if (!listed) return new Response(null, { status: 404 }); // only the images the index lists
      const bytes = await readZipEntry(modelPath(db, root, id), entry);
      return bytes ? new Response(bytes, { headers: { 'content-type': mimeOf(entry) } }) : new Response(null, { status: 404 });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
  // M20: renamed from 「3MF 櫃」 — copy the old userData (index + settings) on first launch.
  // Tests point MF_USER_DATA at a temp folder; they opt in with MF_LEGACY_USER_DATA.
  if (!process.env.MF_USER_DATA || process.env.MF_LEGACY_USER_DATA) {
    const legacy = process.env.MF_LEGACY_USER_DATA || path.join(app.getPath('appData'), OLD_APP_NAME);
    try {
      const r = migrateUserData(legacy, app.getPath('userData'));
      if (r.migrated) console.log(`userData migrated from ${legacy}: ${r.copied.join(', ')}`);
    } catch (err) {
      console.error('userData migration failed:', err.message); // start with a fresh index rather than not at all
    }
  }
  root = loadSettings(app.getPath('userData'), DEFAULT_ROOT).libraryRoot;
  fs.mkdirSync(root, { recursive: true });
  db = openDb(path.join(app.getPath('userData'), 'library.db'));
  // M21: thumbnails rendered before the thumbnail lighting fix that came out
  // as black silhouettes are dropped, so the queue renders them again
  for (const { id, thumb } of thumbsToCheck(db)) {
    if (thumbIsBlack(thumb)) setThumb(db, id, null);
    else setThumb(db, id, thumb, false);
  }
  registerIpc();
  // M24 (SPEC 3.12): the saved choice, else (tests) MF_LANG, else the system locale; English by default
  applyLanguage(loadSettings(app.getPath('userData'), root).language || process.env.MF_LANG || pickLang(app.getPreferredSystemLanguages()));
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 560,
    title: '3mfDeck',
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  // Dropping a file outside the drop zone must not navigate the window away
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(import.meta.dirname, '..', 'dist', 'index.html'));
  // after the UI is up, in the background; failures are silent (runUpdateCycle never throws)
  win.webContents.once('did-finish-load', () => runUpdateCheck());
  backfillSourcePrinters().then(backfillHashes);
});

// M18 / M19: one-time fill of source_printer and embedded images for 3MF records
// indexed before they existed. Runs in the background; records whose file is
// missing stay unknown (NULL) and are retried on a later launch.
async function backfillSourcePrinters() {
  for (const id of idsNeedingSourcePrinter(db)) {
    try {
      setSourcePrinter(db, id, await readSourcePrinter(modelPath(db, root, id)));
    } catch {
      // missing or unreadable file
    }
  }
  for (const id of idsNeedingEmbedded(db)) {
    try {
      const zip = await JSZip.loadAsync(await fs.promises.readFile(modelPath(db, root, id)));
      const embedded = listEmbeddedImages(Object.keys(zip.files));
      setEmbedded(db, id, embedded, embedded.cover ? await zip.file(embedded.cover).async('nodebuffer') : null);
    } catch {
      // missing or unreadable file
    }
  }
}

// M33 (SPEC 3.1b): fingerprints for records indexed before M33, in the
// background, one file at a time. iCloud files whose contents are not on this
// Mac are skipped (reading them would download them); they get a fingerprint
// on a later start once downloaded. Missing / unreadable files are skipped too.
async function backfillHashes() {
  let done = 0;
  for (const id of idsNeedingHash(db)) {
    try {
      const file = modelPath(db, root, id);
      if (!fs.existsSync(file) || (await isDataless(file))) continue;
      setContentHash(db, id, await hashFile(file));
      done++;
    } catch {
      // missing or unreadable file: try again next start
    }
  }
  if (done) win?.webContents.send('lib:hashesUpdated', { done });
}

/** Decode a PNG thumbnail (BGRA bitmap) and test it for a black blob. */
function thumbIsBlack(bytes) {
  const img = nativeImage.createFromBuffer(Buffer.from(bytes));
  return !img.isEmpty() && isNearlyBlack(img.toBitmap());
}

// One zip entry from a 3MF; the last opened archive is kept so browsing a
// project's images reads the file once
let zipCache = null; // { file, mtimeMs, zip }
async function readZipEntry(file, entry) {
  const { mtimeMs } = await fs.promises.stat(file);
  if (zipCache?.file !== file || zipCache.mtimeMs !== mtimeMs) {
    zipCache = { file, mtimeMs, zip: await JSZip.loadAsync(await fs.promises.readFile(file)) };
  }
  return (await zipCache.zip.file(entry)?.async('nodebuffer')) ?? null;
}

app.on('window-all-closed', () => app.quit());
