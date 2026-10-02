// Electron smoke test: launch the real app (isolated userData + library root),
// import files via the menu (stubbed file dialog) and via a real OS-level
// drag & drop (CDP Input.dispatchDragEvent), check the library UI, and fail
// on any console error.
// Run: npm run smoke   (builds the renderer first)
// Packaged app: MF_APP_PATH="/Applications/3mfDeck.app/Contents/MacOS/3mfDeck" node tests/smoke/smoke.mjs
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';

const ROOT = path.join(import.meta.dirname, '..', '..');
const FIX = path.join(ROOT, 'tests', 'fixtures');
// Optional real-world file (user-provided); copied, never moved.
const WINE = process.env.MF_WINE_3MF || path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/3mf/Wine-U1.3mf');

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'mfcab-smoke-'));
// M30: a stand-in for the GitHub Releases API that counts every request. Every
// launch points the app at it (MF_UPDATE_API_URL); with the update check off
// (the default) it must never be hit.
const updateHits = [];
const updateServer = http.createServer((req, res) => {
  updateHits.push(req.url);
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ body: 'Smoke release\n<!-- build: 9.9999.99999 -->', html_url: 'https://github.com/MingShyanWei/3mfDeck/releases/tag/v-smoke' }));
});
await new Promise((r) => updateServer.listen(0, '127.0.0.1', r));
const UPDATE_API = `http://127.0.0.1:${updateServer.address().port}/repos/MingShyanWei/3mfDeck/releases/latest`;
const lib = path.join(base, 'library');
const inbox = path.join(base, 'inbox');
await fs.mkdir(path.join(inbox, 'dup'), { recursive: true });
const stage = async (f, as = f, dir = inbox) => {
  const p = path.join(dir, as);
  await fs.copyFile(path.join(FIX, f), p);
  return p;
};
const exists = (p) => fs.access(p).then(() => true, () => false);

// Classify an sRGB pixel into the colours the M2 checks care about
function classify(r, g, b, a) {
  if (a < 200) return 'transparent';
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 45) return 'black';
  if (max - min < 20) return 'gray';
  const near = (x, y) => Math.abs(x - y) < 0.2 * max;
  if (r < 0.6 * Math.min(g, b) && near(g, b)) return 'cyan';
  if (g < 0.6 * Math.min(r, b) && near(r, b)) return 'magenta';
  if (b < 0.6 * Math.min(r, g) && near(r, g)) return 'yellow';
  if (r > 2 * g && r > 2 * b) return 'red';
  if (g > 2 * r && g > 2 * b) return 'green';
  if (b > 1.25 * g && g > 1.4 * r) return 'blue';
  return 'other';
}

// Counts of classified pixels; `order` is 'rgba' (canvas) or 'bgra' (nativeImage bitmap)
function colourCounts(buf, order = 'rgba') {
  const counts = {};
  for (let i = 0; i < buf.length; i += 4) {
    const [r, b] = order === 'rgba' ? [buf[i], buf[i + 2]] : [buf[i + 2], buf[i]];
    const k = classify(r, buf[i + 1], b, buf[i + 3]);
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}
const present = (counts, min = 150) => Object.keys(counts).filter((k) => counts[k] >= min && k !== 'transparent' && k !== 'other').sort();
// colour label keys -> the Traditional Chinese names the zh-TW UI shows
const ZH_LABEL = { black: '黑', white: '白', gray: '灰', red: '紅', orange: '橙', yellow: '黃', green: '綠', cyan: '青', blue: '藍', purple: '紫', pink: '粉', brown: '棕', skin: '膚', gold: '金', other: '其他' };
const step = (msg) => console.log(`• ${msg}`);

const consoleProblems = [];
const APP_PATH = process.env.MF_APP_PATH;
async function launch(extraEnv = {}) {
  // MF_LANG: the steps below assert the Traditional Chinese UI (a saved language choice still wins)
  const env = { ...process.env, MF_USER_DATA: path.join(base, 'userData'), MF_LIBRARY_ROOT: lib, MF_LANG: 'zh-TW', MF_UPDATE_API_URL: UPDATE_API, ...extraEnv };
  const a = await electron.launch(APP_PATH ? { executablePath: APP_PATH, args: [], env } : { args: [ROOT], env });
  a.process().stderr.on('data', (d) => {
    const s = d.toString();
    // Chromium's own noise on stderr is not ours; JS errors in main are
    if (/Error|Uncaught|UnhandledPromiseRejection/.test(s)) consoleProblems.push(`[main] ${s.trim()}`);
  });
  const p = await a.firstWindow();
  p.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') consoleProblems.push(`[renderer ${m.type()}] ${m.text()}`);
  });
  p.on('pageerror', (e) => consoleProblems.push(`[renderer pageerror] ${e.message}`));
  await p.waitForSelector('.toolbar');
  return [a, p];
}

let [app, page] = await launch();
try {
  step(`app launched (${APP_PATH || 'dev: electron .'}), window title: ` + (await page.title()));

  const importViaMenu = async (paths) => {
    await app.evaluate(({ dialog, Menu }, filePaths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
      Menu.getApplicationMenu().getMenuItemById('import').click();
    }, paths);
    await page.waitForSelector('[data-testid=import-dialog]');
  };

  // 1) Single file via menu, fill provenance in the import dialog
  const cube = await stage('cube.stl');
  await importViaMenu([cube]);
  assert.equal(await page.inputValue('[data-testid=f-name]'), 'cube');
  await page.click('[data-testid=f-type-ai_generated]');
  await page.fill('[data-testid=f-platform]', 'Meshy');
  await page.fill('[data-testid=f-url]', 'https://www.meshy.ai/example');
  await page.fill('[data-testid=f-prompt]', 'a yellow rubber duck, low poly');
  await page.fill('[data-testid=f-tags]', '鴨子, smoke');
  await page.click('[data-testid=import-save]');
  await page.waitForSelector('[data-testid=import-dialog]', { state: 'detached' });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=model-card]').length === 1);
  const card = await page.textContent('[data-testid=model-card]');
  assert.match(card, /cube/);
  assert.match(card, /Meshy/);
  assert.equal(await exists(cube), false, 'source should be moved away');
  const year = String(new Date().getFullYear());
  assert.equal(await exists(path.join(lib, year, 'cube.stl')), true);
  step(`menu import: cube.stl moved to ${path.join(year, 'cube.stl')}, card shows "${card.trim()}"`);

  // 2) Mixed batch via menu: OBJ, painted 3MF, GLB, same-name STL, (+ Wine 3MF if available)
  const batch = [await stage('box.obj'), await stage('painted.3mf'), await stage('cube.glb'), await stage('pyramid_ascii.stl', 'cube.stl', path.join(inbox, 'dup'))];
  const haveWine = await exists(WINE);
  if (haveWine) batch.push(await fs.copyFile(WINE, path.join(inbox, 'Wine-U1.3mf')).then(() => path.join(inbox, 'Wine-U1.3mf')));
  await importViaMenu(batch);
  const seen = [];
  let prefillChecked = 0;
  for (let i = 0; i < batch.length; i++) {
    await page.waitForFunction((n) => document.querySelector('[data-testid=import-dialog] h2')?.textContent.includes(`${n} /`), i + 1);
    const name = await page.inputValue('[data-testid=f-name]');
    const platform = await page.inputValue('[data-testid=f-platform]');
    seen.push(`${name}${platform ? `(${platform})` : ''}`);
    if (name === 'painted' || name === 'Wine-U1') {
      // MakerWorld metadata in the 3MF prefills provenance
      assert.equal(platform, 'MakerWorld');
      assert.equal(await page.getAttribute('[data-testid=f-type-downloaded]', 'class'), 'seg on');
      if (name === 'Wine-U1') {
        const notes = await page.inputValue('[data-testid=f-notes]');
        for (const want of ['Title: Wine Rack', 'Designer: 3Design', 'License: Standard Digital File License', 'Origin: original']) assert.ok(notes.includes(want), `Wine notes missing "${want}"`);
        assert.equal(await page.inputValue('[data-testid=f-url]'), '');
      }
      prefillChecked++;
      await page.click('[data-testid=import-save]');
    } else if (name === 'box') {
      await page.click('[data-testid=f-type-self_made]');
      await page.fill('[data-testid=f-notes]', 'smoke note: drawn in Fusion');
      await page.click('[data-testid=import-save]');
    } else {
      await page.click('[data-testid=import-skip]'); // leave as 未標
    }
  }
  await page.waitForSelector('[data-testid=import-dialog]', { state: 'detached' });
  assert.deepEqual(seen.map((s) => s.replace(/\(.*\)/, '')), ['box', 'painted', 'cube', 'cube', ...(haveWine ? ['Wine-U1'] : [])]);
  assert.equal(prefillChecked, haveWine ? 2 : 1);
  const total = 1 + batch.length;
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid=model-card]').length === n, total);
  assert.equal(await exists(path.join(lib, year, 'cube-2.stl')), true, 'name clash should produce cube-2.stl');
  step(`batch import (${batch.length} files${haveWine ? ', incl. Wine-U1.3mf copy' : ', Wine-U1.3mf NOT found'}): dialog order ${seen.join(', ')}`);

  // 3) Real drag & drop of a file onto the window
  const dropped = await stage('box.amf');
  const cdp = await page.context().newCDPSession(page);
  const data = { items: [], files: [dropped], dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, x: 600, y: 400, data });
  await page.waitForSelector('[data-testid=import-dialog]');
  assert.equal(await page.inputValue('[data-testid=f-name]'), 'box');
  await page.click('[data-testid=import-skip-all]');
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid=model-card]').length === n, total + 1);
  assert.equal(await exists(dropped), false);
  assert.equal(await exists(path.join(lib, year, 'box.amf')), true);
  step('drag & drop import: box.amf moved into library');

  // 4) Badges, unlabeled hint, search, filters, sort, list view
  const cards = await page.$$eval('[data-testid=model-card]', (els) => els.map((e) => ({ text: e.innerText.replace(/\s+/g, ' '), unlabeled: e.classList.contains('unlabeled') })));
  const unlabeled = cards.filter((c) => c.unlabeled).length;
  assert.equal(unlabeled, 3, 'cube.glb, cube-2.stl and box.amf were skipped -> 未標');
  assert.match(await page.textContent('[data-testid=filter-unlabeled]'), /未標\s*3/);
  assert.ok(cards.some((c) => /painted.*4 色/.test(c.text)), 'painted.3mf shows 4 色 badge');
  step('cards: ' + cards.map((c) => c.text).join(' | '));

  const countCards = () => page.$$eval('[data-testid=model-card]', (els) => els.length);
  await page.fill('[data-testid=search]', '鴨子');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=model-card]').length === 1);
  await page.fill('[data-testid=search]', 'fusion');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=model-card]').length === 1);
  assert.match(await page.textContent('[data-testid=model-card]'), /box/);
  await page.fill('[data-testid=search]', '');
  await page.click('[data-testid=filter-unlabeled]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=model-card]').length === 3);
  await page.click('[data-testid="filter-type:ai_generated"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=model-card]').length === 1);
  await page.click('[data-testid="filter-tag:smoke"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=model-card]').length === 1);
  await page.click('[data-testid=filter-all]');
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid=model-card]').length === n, total + 1);
  step(`search (tag 鴨子, note "fusion") and filters (未標/AI 生成/tag) ok; ${await countCards()} cards total`);

  await page.selectOption('[data-testid=sort]', 'colors');
  await page.click('[data-testid=view-list]');
  await page.waitForSelector('[data-testid=model-list]');
  const firstRow = await page.textContent('[data-testid=model-row]');
  assert.match(firstRow, /painted/);
  assert.equal(await page.$$eval('[data-testid=model-row]', (r) => r.length), total + 1);
  step('list view + sort by 色數: first row = ' + firstRow.replace(/\s+/g, ' '));

  // 5) Edit provenance in the detail panel
  await page.click('[data-testid=view-grid]');
  await page.selectOption('[data-testid=sort]', 'name');
  await page.click('[data-testid=filter-unlabeled]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=model-card]').length === 3);
  await page.click('[data-testid=model-card] >> nth=0');
  await page.waitForSelector('[data-testid=detail-panel]');
  await page.click('[data-testid=detail-panel] [data-testid=f-type-downloaded]');
  await page.fill('[data-testid=detail-panel] [data-testid=f-platform]', 'Printables');
  await page.click('[data-testid=detail-save]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=model-card]').length === 2);
  assert.match(await page.textContent('[data-testid=filter-unlabeled]'), /未標\s*2/);
  step('detail panel: set 下載/Printables, 未標 count 3 -> 2');

  // 7) M2: 3D preview, shading modes, thumbnails
  await importViaMenu([await stage('offpalette.3mf'), await stage('textured.glb')]);
  await page.click('[data-testid=import-skip-all]');
  await page.click('[data-testid=filter-all]');
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid=model-card]').length === n, total + 3);

  const viewerPixels = async () => {
    const { b64 } = await page.evaluate(() => {
      const src = document.querySelector('[data-testid=viewer-canvas]');
      const c = document.createElement('canvas');
      c.width = src.width;
      c.height = src.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(src, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      let bin = '';
      for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
      return { b64: btoa(bin) };
    });
    return colourCounts(Buffer.from(b64, 'base64'));
  };
  const openModel = async (name, query = name) => {
    await page.fill('[data-testid=search]', query);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=model-card]').length === 1);
    await page.click('[data-testid=model-card]');
    await page.waitForFunction((n) => document.querySelector('[data-testid=detail-panel] h2')?.textContent === n, name);
    await page.waitForSelector('[data-testid=viewer][data-status=ready]');
  };
  const setMode = async (mode) => {
    await page.click(`[data-testid=mode-${mode}]`);
    await page.waitForSelector(`[data-testid=viewer][data-mode=${mode}]`);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  };

  // painted.3mf (ground truth): four CMYK paint colours in 原始 mode
  await openModel('painted');
  let px = await viewerPixels();
  assert.deepEqual(present(px).filter((k) => k !== 'gray'), ['black', 'cyan', 'magenta', 'yellow'], JSON.stringify(px));
  step('preview painted.3mf 原始: ' + JSON.stringify(px));
  await setMode('filament');
  const spools = await page.$$eval('[data-testid=spool]', (els) => els.map((e) => e.textContent.trim()));
  assert.deepEqual(spools, ['槽1 C 青 · 50%', '槽2 M 洋紅 · 25%', '槽3 Y 黃 · 16.67%', '槽4 K 黑 · 8.33%']);
  px = await viewerPixels();
  assert.deepEqual(present(px).filter((k) => k !== 'gray'), ['black', 'cyan', 'magenta', 'yellow']);
  step('耗材映射: spools ' + spools.join(' | '));
  await setMode('original');
  assert.ok(present(await viewerPixels()).includes('cyan'));

  // offpalette.3mf: filament mapping visibly re-colours to the nearest CMYK slots
  await openModel('offpalette');
  const before = await viewerPixels();
  await setMode('filament');
  const after = await viewerPixels();
  // #1E90FF (ΔE 39.3) and #E0457B (ΔE 21.6) must be mixed; #FFD700 / #333333 print from one slot.
  // M15: mixes are two-spool pigment blends (same model as the export): dodger blue -> C+M #5E9AF0,
  // still blue rather than the nearest slot's pure cyan
  assert.ok(!present(before).includes('cyan') && present(before).includes('blue'), 'original: dodger blue ' + JSON.stringify(before));
  assert.ok(!present(after).includes('cyan') && present(after).includes('yellow'), 'mapped: blue shown as its C+M mix (not nearest-slot cyan), gold -> Y ' + JSON.stringify(after));
  const mapping = await page.$$eval('[data-testid=mapping-row]', (els) => els.map((e) => `${e.dataset.mode}: ${e.textContent.trim()}`));
  assert.equal(mapping.length, 4);
  assert.match(mapping[0], /^mix: #1E90FF → 混色 C \d+%＋M \d+% ≈/);
  assert.match(mapping[1], /^mix: #E0457B → 混色/);
  assert.match(mapping[2], /^single: #FFD700 → 槽3（ΔE 11\.6）/);
  assert.match(mapping[3], /^single: #333333 → 槽4（ΔE 13\.4）/);
  await page.waitForSelector('[data-testid=mix-note]');
  await page.$eval('[data-testid=detail-panel]', (el) => el.scrollTo(0, 0));
  await page.screenshot({ path: path.join(base, 'preview-filament.png') });
  step(`offpalette.3mf 原始 ${JSON.stringify(present(before))} -> 耗材映射 ${JSON.stringify(present(after))}; ${mapping.join(' | ')}`);

  // textured.glb: baseColorTexture (red | green halves)
  await openModel('textured');
  px = await viewerPixels();
  assert.ok(present(px).includes('red') && present(px).includes('green'), 'GLB texture ' + JSON.stringify(px));
  assert.equal(await page.isDisabled('[data-testid=mode-filament]'), true);
  step('preview textured.glb: ' + JSON.stringify(px) + '; 耗材映射 disabled');

  // STL: grey (cube.stl is the one tagged 鴨子; "cube" alone also matches cube.glb / cube-2.stl)
  await openModel('cube', '鴨子');
  assert.match(await page.textContent('[data-testid=detail-panel]'), /2026\/cube\.stl/);
  px = await viewerPixels();
  assert.deepEqual(present(px), ['gray'], 'STL grey ' + JSON.stringify(px));
  step('preview STL: ' + JSON.stringify(px));
  await page.fill('[data-testid=search]', '');

  // Thumbnails: every renderable model got a 512px PNG in the DB
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid=card-thumb]').length === n, total + 3);  // before M3 imports
  const Database = (await import('better-sqlite3')).default;
  const rodb = new Database(path.join(base, 'userData', 'library.db'), { readonly: true });
  const thumbs = Object.fromEntries(rodb.prepare(`SELECT rel_path, thumb FROM models WHERE thumb IS NOT NULL`).all().map((r) => [r.rel_path, r.thumb]));
  rodb.close();
  const decode = (png) =>
    app.evaluate(({ nativeImage }, b64) => {
      const img = nativeImage.createFromBuffer(Buffer.from(b64, 'base64'));
      return { ...img.getSize(), bgra: img.toBitmap().toString('base64') };
    }, png.toString('base64'));
  for (const [rel, want] of [[`${year}/painted.3mf`, ['black', 'cyan', 'magenta', 'yellow']], [`${year}/textured.glb`, ['green', 'red']], [`${year}/cube.stl`, ['gray']]]) {
    const img = await decode(thumbs[rel]);
    assert.deepEqual([img.width, img.height], [512, 512]);
    const counts = colourCounts(Buffer.from(img.bgra, 'base64'), 'bgra');
    const got = present(counts).filter((k) => want.includes('gray') || k !== 'gray');
    assert.deepEqual(got, want, `${rel} thumbnail ${JSON.stringify(counts)}`);
  }
  step(`thumbnails: ${Object.keys(thumbs).length} stored (512×512 PNG); painted=CMYK, textured=red+green, STL=grey`);

  // 8) M3: colour analysis panel, material colours, Finder
  await importViaMenu([await stage('materials.3mf'), await stage('mixed.3mf'), await stage('dither.3mf')]);
  await page.click('[data-testid=import-skip-all]');
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid=model-card]').length === n, total + 6);
  const tableRows = () => page.$$eval('[data-testid=color-row]', (rows) => rows.map((r) => [...r.cells].slice(0, 3).map((c) => c.textContent.trim()).join(' ')));
  const warningTypes = () => page.$$eval('[data-testid^=warning-]', (els) => els.map((e) => e.dataset.testid.slice(8)));

  await openModel('painted');
  assert.deepEqual(await tableRows(), ['#00FFFF 6 50%', '#FF00FF 3 25%', '#FFFF00 2 16.67%', '#000000 1 8.33%']);
  assert.deepEqual(await warningTypes(), ['few-colors']);
  assert.match(await page.textContent('[data-testid=warning-few-colors]'), /每個顏色都能在 ΔE ≤ 15 內對應到某個耗材槽，不需混色，量化成實色平塗最乾淨/);
  const bars = await page.$$eval('[data-testid=color-row] .bar', (els) => els.map((e) => Math.round(parseFloat(e.style.width))));
  assert.deepEqual(bars, [100, 50, 33, 17]);
  step('painted.3mf 分布表: ' + (await tableRows()).join(' | ') + '; 警示: few-colors; 長條 ' + bars.join('/'));

  // Finder: capture the path instead of opening Finder
  await app.evaluate(({ shell }) => {
    globalThis.__revealed = [];
    shell.showItemInFolder = (p) => globalThis.__revealed.push(p);
  });
  await page.click('[data-testid=reveal]');
  await page.waitForFunction(() => true);
  const revealed = await app.evaluate(() => globalThis.__revealed);
  assert.deepEqual(revealed, [path.join(lib, year, 'painted.3mf')]);
  step('在 Finder 顯示 -> ' + revealed[0]);

  await openModel('dither');
  assert.equal((await tableRows()).length, 6);
  assert.deepEqual(await warningTypes(), ['dither', 'needs-mixing']);
  assert.match(await page.textContent('[data-testid=warning-dither]'), /疑似抖色配對：#FFD000（33.33%）與 #FFDC20（25%）/);
  assert.match(await page.textContent('[data-testid=warning-needs-mixing]'), /超過 4 色，需 Full Spectrum 混色/);
  const ditherRows = await page.$$eval('[data-testid=color-row].dither', (rows) => rows.map((r) => r.cells[0].textContent.trim()));
  assert.deepEqual(ditherRows, ['#FFD000抖色？', '#FFDC20抖色？']);
  step('dither.3mf: 6 色; 警示 dither + needs-mixing; 標記列 ' + ditherRows.join(', '));

  await openModel('materials');
  assert.deepEqual(await tableRows(), ['#FF8800 4 33.33%', '#3355DD 3 25%', '#FFFFFF 3 25%', '#22AA44 2 16.67%']);
  px = await viewerPixels();
  assert.ok(present(px).includes('green'), 'material colour rendered ' + JSON.stringify(px));
  assert.equal(await page.isDisabled('[data-testid=mode-filament]'), false);
  await setMode('filament');
  assert.ok((await page.$$eval('[data-testid=spool]', (e) => e.length)) > 0);
  step('materials.3mf (basematerials+colorgroup): 分布 ' + (await tableRows()).join(' | ') + '; preview ' + JSON.stringify(present(px)));

  await openModel('mixed');
  assert.deepEqual(await tableRows(), ['#00FFFF 6 50%', '#FF8800 4 33.33%', '#FF00FF 2 16.67%']);
  step('mixed.3mf (paint_color 優先 + 材質色): ' + (await tableRows()).join(' | '));

  // Colour badges on the cards
  await page.fill('[data-testid=search]', '');
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid=model-card]').length === n, total + 6);
  const badge = (name) => page.$$eval('[data-testid=model-card]', (cards, n) => cards.find((c) => c.querySelector('.name').textContent === n)?.querySelector('.badge-colors')?.textContent.trim(), name);
  assert.deepEqual([await badge('materials'), await badge('mixed'), await badge('dither')], ['4 色', '3 色', '6 色']);
  await page.$eval('[data-testid=detail-panel]', (el) => el.scrollTo(0, 420));
  await page.screenshot({ path: path.join(base, 'color-analysis.png') });

  // 9) M4: trash (restore keeps metadata), empty trash with two confirmations, export
  const cardCount = () => page.$$eval('[data-testid=model-card]', (els) => els.length);
  const liveCount = total + 6;
  await page.fill('[data-testid=search]', '');
  await page.click('[data-testid=filter-all]');
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid=model-card]').length === n, liveCount);
  await openModel('cube', '鴨子'); // cube.stl, tagged 鴨子 + smoke, provenance AI/Meshy
  await page.click('[data-testid=trash]');
  await page.waitForSelector('[data-testid=detail-panel]', { state: 'detached' });
  await page.fill('[data-testid=search]', '');
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid=model-card]').length === n, liveCount - 1);
  assert.equal(await exists(path.join(lib, year, 'cube.stl')), false);
  const trashed = (await fs.readdir(path.join(lib, '.trash'), { recursive: true })).filter((f) => f.endsWith('cube.stl'));
  assert.equal(trashed.length, 1);
  assert.match(await page.textContent('[data-testid=filter-trash]'), /回收桶\s*1/);
  assert.equal(await page.$('[data-testid="filter-tag:鴨子"]'), null, 'tag of a trashed model is hidden');
  step(`刪除: cube.stl -> .trash/${trashed[0]}; 清單 ${liveCount} -> ${await cardCount()}`);

  await page.click('[data-testid=filter-trash]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=model-card]').length === 1);
  await page.click('[data-testid=model-card]');
  await page.waitForSelector('[data-testid=viewer][data-status=ready]'); // preview works from the trash too
  await page.click('[data-testid=restore]');
  await page.waitForSelector('[data-testid=detail-panel]', { state: 'detached' });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=model-card]').length === 0);
  assert.equal(await exists(path.join(lib, year, 'cube.stl')), true);
  await page.click('[data-testid="filter-tag:鴨子"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=model-card]').length === 1);
  assert.match(await page.textContent('[data-testid=model-card]'), /Meshy/);
  step('還原: cube.stl back at ' + path.join(year, 'cube.stl') + ', tag 鴨子 + Meshy provenance intact');

  // Empty trash: cancel at the 2nd confirmation keeps everything; confirming twice deletes
  await page.click('[data-testid=filter-all]');
  await openModel('textured');
  await page.click('[data-testid=trash]');
  await page.waitForSelector('[data-testid=detail-panel]', { state: 'detached' });
  await page.fill('[data-testid=search]', '');
  await page.click('[data-testid=filter-trash]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=model-card]').length === 1);
  const stubConfirm = (responses) =>
    app.evaluate(({ dialog }, rs) => {
      globalThis.__asked = [];
      dialog.showMessageBox = async (_w, opts) => {
        globalThis.__asked.push(opts.message);
        return { response: rs.shift() ?? 0 };
      };
    }, responses);
  await stubConfirm([1, 0]);
  await page.click('[data-testid=empty-trash]');
  await page.waitForFunction(() => true);
  await new Promise((r) => setTimeout(r, 300));
  const askedCancel = await app.evaluate(() => globalThis.__asked);
  assert.equal(askedCancel.length, 2);
  assert.equal(await cardCount(), 1, 'cancelled at the second confirmation');
  await stubConfirm([1, 1]);
  await page.click('[data-testid=empty-trash]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=model-card]').length === 0);
  const asked = await app.evaluate(() => globalThis.__asked);
  assert.deepEqual(asked, ['清空回收桶？', '再次確認：永久刪除 1 個檔案？']);
  assert.equal(await exists(path.join(lib, '.trash')), false);
  assert.equal(await exists(path.join(lib, year, 'textured.glb')), false);
  step(`清空回收桶: 取消於第 2 次確認 -> 保留; 兩次確認 -> 永久刪除 (${asked.join(' / ')})`);

  // 10) Pull the DB and restart: startup consistency check offers a rebuild
  const liveFiles = liveCount - 1; // textured.glb was deleted permanently
  await app.close();
  for (const f of ['library.db', 'library.db-wal', 'library.db-shm']) await fs.rm(path.join(base, 'userData', f), { force: true });
  [app, page] = await launch();
  await page.waitForSelector('[data-testid=consistency-banner]');
  assert.match(await page.textContent('[data-testid=consistency-banner]'), new RegExp(`發現 ${liveFiles} 個檔案`));
  assert.equal(await cardCount(), 0);
  await page.click('[data-testid=rebuild-index]');
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid=model-card]').length === n, liveFiles);
  await page.waitForSelector('[data-testid=consistency-banner]', { state: 'detached' });
  await page.fill('[data-testid=search]', 'painted');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=model-card]').length === 1);
  assert.match(await page.textContent('[data-testid=model-card]'), /MakerWorld.*4 色/);
  await page.fill('[data-testid=search]', '');
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid=card-thumb]').length === n, liveFiles);
  step(`拔掉 DB 重開: banner "發現 ${liveFiles} 個檔案"; 重建索引 -> ${await cardCount()} cards, thumbnails regenerated, 3MF metadata re-parsed`);

  // 9b) M8/M15: colours one slot cannot print -> two-spool pigment mixing recipes (what the export writes)
  await importViaMenu([await stage('mixneeded.3mf')]);
  await page.click('[data-testid=import-skip-all]');
  await openModel('mixneeded');
  const printCells = await page.$$eval('[data-testid=color-row]', (rows) =>
    rows.map((r) => [r.cells[0].textContent.trim().replace(/\s+/g, ' '), r.querySelector('[data-testid=print-cell]').dataset.mode, r.querySelector('[data-testid=print-cell]').textContent.trim()]),
  );
  const modeOf = Object.fromEntries(printCells.map(([c, m]) => [c, m]));
  // M15: the halftone model called orange unmixable, but the pigment blend Y+M reaches it (ΔE 7.3)
  assert.deepEqual(modeOf, { '#4CAF50': 'mix', '#FF8C00': 'mix', '#800080': 'mix', '#E0AC69': 'mix' });
  assert.match(printCells.find((r) => r[0] === '#800080')[2], /^M \d+%＋K \d+%（ΔE \d+(\.\d)?）$/);
  assert.match(printCells.find((r) => r[0] === '#FF8C00')[2], /^Y \d+%＋M \d+%（ΔE 7\.3）$/);
  const mixSummary = await page.textContent('[data-testid=needs-mix-summary]');
  assert.match(mixSummary, /4 色單捲印不出/);
  assert.doesNotMatch(mixSummary, /混不出/);
  await setMode('filament');
  const mixPx = await viewerPixels();
  const opaque = (c) => Object.entries(c).filter(([k]) => k !== 'transparent').reduce((sum, [, n]) => sum + n, 0);
  // nearest single slots would paint green, orange and skin pure yellow (#FFFF00) over whole faces; their
  // pigment mixes (#69A218 / #F9A456 / #F9AD4F, purple #71009F) are not pure slot colours. A few shaded
  // edge pixels of the orange mixes can still classify as yellow, so judge by share, not presence.
  assert.ok((mixPx.yellow || 0) / opaque(mixPx) < 0.01 && (mixPx.other || 0) / opaque(mixPx) > 0.8, 'preview shows mix colours, not nearest slots ' + JSON.stringify(mixPx));
  const mixRows = await page.$$eval('[data-testid=mapping-row]', (els) => els.map((e) => e.dataset.mode));
  assert.deepEqual(mixRows, ['mix', 'mix', 'mix', 'mix']);
  step('mixneeded.3mf: 列印方式 ' + printCells.map((r) => `${r[0]}=${r[1]} ${r[2]}`).join(' | ') + '; filament preview uses mix colours');
  // 9c) M11: spool suggestion in its own modal, then apply
  await page.click('[data-testid=suggest-open]');
  await page.waitForSelector('[data-testid=spool-suggest]');
  // M13b: standard-preset coverage comparison (CMYK / CMYW)
  const cmyw = await page.textContent('[data-testid=preset-cmyw]');
  assert.match(cmyw, /CMYW.*單捲 \d+(\.\d+)?%／含混色 \d+(\.\d+)?%/, `preset row: ${cmyw}`);
  const covText = async (id) => ((await page.textContent(`[data-testid=preset-${id}]`)).replace(/\s+/g, ' ').match(/：單捲.*$/)?.[0] || '').trim();
  step(`標準配置: CMYK${await covText('cmyk')}；CMYW${await covText('cmyw')}`);
  await page.click('[data-testid=suggest-spools]');
  await page.waitForSelector('[data-testid=suggest-spools-list]');
  await page.waitForSelector('[data-testid=suggest-results]');
  const recK = Number((await page.textContent('[data-testid=suggest-recommended]')).match(/建議 (\d) 捲/)[1]);
  const kCoverage = await page.$$eval('[data-testid=suggest-results] input[type=radio]', (els) => els.map((e) => e.parentElement.textContent.trim()));
  assert.equal(kCoverage.length, 4, '1..4 spool options');
  assert.match(kCoverage.join('|'), /4 捲：單捲 100%（含 .*100%）|4 捲：.*含混色 100%/);
  // apply the recommended suggestion, verify the slots changed and mapping reflects them
  await page.click(`[data-testid=suggest-k${recK === 4 ? 4 : recK}]`); // pick recommended k (radio re-runs)
  await page.waitForSelector('[data-testid=suggest-spools-list]');
  await page.click('[data-testid=suggest-apply]');
  await page.waitForSelector('[data-testid=suggest-apply]:disabled');
  await page.click('[data-testid=suggest-close]');
  await page.click('[data-testid=settings-button]');
  await page.waitForSelector('[data-testid=spool-editor]');
  const newSpools = (await page.$$eval('[data-testid=spool-editor] input[data-testid^=spool-]', (els) => els.map((e) => e.value))).filter((v) => /^#[0-9A-F]{6}$/.test(v));
  assert.equal(newSpools.length, recK, `applied ${recK} suggested spools: ${newSpools.join(' ')}`);
  // restore the default CMYK spools in the same settings session
  await page.selectOption('[data-testid=spool-count]', '4');
  await page.fill('[data-testid=spool-1]', '#00FFFF');
  await page.fill('[data-testid=spool-2]', '#FF00FF');
  await page.fill('[data-testid=spool-3]', '#FFFF00');
  await page.fill('[data-testid=spool-4]', '#000000');
  await page.click('[data-testid=spool-save]');
  await page.waitForSelector('[data-testid=spool-message]');
  await page.click('[data-testid=settings-done]');
  await page.waitForSelector('[data-testid=viewer][data-status=ready]');
  step(`M11 建議捲色: 建議 ${recK} 捲（${newSpools.join(' ')}），已套用後還原 CMYK；覆蓋率選項 ${kCoverage.length} 組`);
  // 9d) M12: filament inventory — register two filaments, suggest FROM them
  await page.click('[data-testid=settings-button]');
  await page.waitForSelector('[data-testid=inventory-editor]');
  // M26: how to get the export — steps, a named import button, the site opened in the system browser
  {
    const help = await page.textContent('[data-testid=inventory-help]');
    for (const s of ['登入後到 My Spools 匯出（JSON 或 CSV）', '「從 3dfilamentprofiles 匯入…」']) assert.ok(help.includes(s), `help mentions ${s}: ${help}`);
    assert.ok(!help.includes('Export'), 'no button on the site is named (its export UI needs a login to verify)');
    assert.equal((await page.textContent('[data-testid=inventory-import]')).trim(), '從 3dfilamentprofiles 匯入…');
    await app.evaluate(({ shell }) => {
      shell.openExternal = async (url) => {
        globalThis.__openedExternal = url; // no browser in tests
      };
    });
    await page.click('[data-testid=inventory-3dfp-link]');
    assert.equal(await app.evaluate(() => globalThis.__openedExternal), 'https://3dfilamentprofiles.com/my/spools');
    step('M26 線材庫說明: 登入後到 My Spools 匯出（JSON 或 CSV）→ 「從 3dfilamentprofiles 匯入…」；連結交給系統瀏覽器開 https://3dfilamentprofiles.com/my/spools');
  }
  // M12b: import a real-format 3dfilamentprofiles export through the (mocked) file dialog
  {
    const invFile = path.join(base, 'my-spools.json');
    await fs.writeFile(invFile, JSON.stringify([
      { brand: 'Bambu Lab', material: 'PLA', material_type: 'Basic', color: 'Cyan (10603)', rgb: '#0086D6', filament_id: 68 },
      { brand: 'Bambu Lab', material: 'PLA', material_type: 'Basic', color: 'Yellow (10400)', rgb: '#F4EE2A', filament_id: 42 },
    ]));
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, invFile);
    await page.click('[data-testid=inventory-import]');
    await page.waitForFunction(() => /匯入 2 條線材/.test(document.querySelector('[data-testid=inventory-message]')?.textContent || ''));
    const imported = await page.$$eval('[data-testid=inventory-list] [data-testid^=inventory-hex-]', (els) => els.map((e) => e.value));
    assert.deepEqual(imported.sort(), ['#0086D6', '#F4EE2A']);
    step('M12b 線材庫匯入: 3dfilamentprofiles JSON → Bambu Lab 青+黃 2 條入庫');
    // clear them again so the manual-entry part below starts clean
    for (let i = 1; i >= 0; i--) await page.click(`[data-testid=inventory-del-${i}]`);
  }
  await page.click('[data-testid=inventory-add]');
  await page.click('[data-testid=inventory-add]');
  await page.fill('[data-testid=inventory-hex-0]', '#4CAF50');
  await page.fill('[data-testid=inventory-name-0]', '翠綠');
  await page.fill('[data-testid=inventory-hex-1]', '#800080');
  await page.fill('[data-testid=inventory-name-1]', '紫');
  await page.click('[data-testid=inventory-save]');
  await page.waitForSelector('[data-testid=inventory-message]');
  await page.click('[data-testid=settings-done]');
  await page.waitForSelector('[data-testid=viewer][data-status=ready]');
  await page.click('[data-testid=suggest-open]');
  await page.waitForSelector('[data-testid=spool-suggest]');
  await page.click('[data-testid=suggest-inventory]');
  await page.waitForSelector('[data-testid=suggest-spools-list]');
  const invSwatches = await page.$$eval('[data-testid=suggest-spools-list] code', (els) => els.map((e) => e.textContent));
  assert.ok(invSwatches.every((h) => h === '#4CAF50' || h === '#800080'), `spools picked from inventory: ${invSwatches.join(' ')}`);
  assert.match(await page.textContent('[data-testid=suggest-note]'), /從線材庫挑選/);
  assert.match(await page.textContent('[data-testid=suggest-buy]') || '', /建議採購/);
  step(`M12 線材庫: 登記 翠綠+紫 → 從我的線材挑出 ${invSwatches.join(' ')}，其餘列採購建議`);
  // close the suggest modal, then clear the inventory so later steps are unaffected
  await page.click('[data-testid=suggest-close]');
  await page.click('[data-testid=settings-button]');
  await page.waitForSelector('[data-testid=inventory-editor]');
  for (let i = 1; i >= 0; i--) await page.click(`[data-testid=inventory-del-${i}]`);
  await page.click('[data-testid=inventory-save]');
  await page.waitForSelector('[data-testid=inventory-message]');
  await page.click('[data-testid=settings-done]');
  await page.waitForSelector('[data-testid=viewer][data-status=ready]');
  // restore the default CMYK spools again (the inventory apply changed them)
  await page.click('[data-testid=settings-button]');
  await page.waitForSelector('[data-testid=spool-editor]');
  await page.click('[data-testid=spool-reset]');
  await page.waitForSelector('[data-testid=spool-message]');
  await page.click('[data-testid=settings-done]');
  await page.waitForSelector('[data-testid=viewer][data-status=ready]');
  step('M12 線材庫: 清空庫、捲色還原 CMYK');
  await page.$eval('[data-testid=detail-panel]', (el) => el.scrollTo(0, 0));
  await page.screenshot({ path: path.join(base, 'mixneeded.png') });
  await page.fill('[data-testid=search]', '');

  // 6) Settings page: switch library root (SPEC 3.8)
  const rootB = path.join(base, 'libraryB');
  await fs.mkdir(path.join(rootB, '2025'), { recursive: true });
  await fs.copyFile(path.join(FIX, 'fixture.step'), path.join(rootB, '2025', 'part.step'));
  const allCount = liveFiles + 1; // every live file after the rebuild, plus mixneeded.3mf (M8)
  await page.click('[data-testid=filter-all]');
  await page.click('[data-testid=settings-button]');
  await page.waitForFunction((v) => document.querySelector('[data-testid=settings-root]')?.textContent === v, lib);
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, rootB);
  await page.click('[data-testid=settings-change-root]');
  await page.waitForSelector('[data-testid=settings-message]');
  assert.equal(await page.textContent('[data-testid=settings-root]'), rootB);
  assert.match(await page.textContent('[data-testid=settings-message]'), new RegExp(`新增索引 1 個檔案，${allCount} 筆記錄標示為遺失`));
  await page.click('[data-testid=settings-done]');
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid=model-card]').length === n, allCount + 1);
  assert.equal(await page.$$eval('[data-testid=missing-badge]', (els) => els.length), allCount);
  const cfg = JSON.parse(await fs.readFile(path.join(base, 'userData', 'config.json'), 'utf8'));
  assert.equal(cfg.libraryRoot, rootB);
  assert.equal(await exists(path.join(lib, year, 'cube.stl')), true, 'old root files must not move');
  // M7: the root switch raises a one-time "newly missing" notice
  await page.waitForSelector('[data-testid=missing-toast]');
  assert.match(await page.textContent('[data-testid=missing-toast]'), new RegExp(`${allCount} 筆記錄新出現遺失`));
  await page.click('[data-testid=missing-toast-close]');
  await page.waitForSelector('[data-testid=missing-toast]', { state: 'detached' });
  step(`settings: root -> ${rootB}; 1 file indexed, ${allCount} old records shown as 遺失 + one-time notice; config.json in userData`);

  // 11) M5: multi-plate 3MF — one entry, plate badge, plate switcher, per-plate analysis
  const REAL = path.dirname(WINE);
  const multi = [await stage('multiplate.3mf')];
  for (const f of ['BOOK-U1.3mf', 'U1Cover-U1.3mf']) {
    if (await exists(path.join(REAL, f))) {
      await fs.copyFile(path.join(REAL, f), path.join(inbox, f)); // copy, never move the original
      multi.push(path.join(inbox, f));
    }
  }
  await importViaMenu(multi);
  await page.click('[data-testid=import-skip-all]');
  await page.click('[data-testid=filter-all]');
  const cardFor = async (q) => {
    await page.fill('[data-testid=search]', q);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=model-card]').length === 1);
    return (await page.textContent('[data-testid=model-card]')).replace(/\s+/g, ' ').trim();
  };
  assert.match(await cardFor('multiplate'), /4 盤.*3 色/);
  if (haveWine) assert.doesNotMatch(await cardFor('Wine'), /盤/);
  assert.doesNotMatch(await cardFor('painted'), /盤/);
  await cardFor('part'); // part.step in the current root: no plate info
  await page.click('[data-testid=model-card]');
  await page.waitForFunction(() => document.querySelector('[data-testid=detail-panel] h2')?.textContent === 'part');
  assert.equal(await page.$('[data-testid=plate-switcher]'), null, 'files without plates show no plate UI');

  await openModel('multiplate');
  const plateButtons = await page.$$eval('[data-testid=plate-switcher] button', (b) => b.map((x) => [x.textContent.trim(), x.classList.contains('on')]));
  assert.deepEqual(plateButtons, [['盤 1', true], ['盤 2', false], ['盤 3', false], ['盤 4', false]]);
  const plateState = async () => ({
    caption: await page.textContent('[data-testid=plate-caption]'),
    title: (await page.textContent('[data-testid=color-analysis-title]')).trim(),
    rows: await tableRows(),
    total: await page.$$eval('[data-testid=color-row] td.total', (t) => t.map((x) => x.textContent)),
    colours: present(await viewerPixels()).filter((k) => k !== 'gray'),
  });
  let st = await plateState();
  assert.equal(st.title.startsWith('顏色分析 · 盤 1：1 色 ／ 全檔 3 色'), true, `title: ${st.title}`);
  assert.match(st.title, /建議捲色…/, 'single-colour plate also offers the suggestion');
  assert.deepEqual(st.colours, ['cyan']);
  assert.deepEqual(st.rows, ['#00FFFF 12 100%', '#FFFF00 — —', '#FF00FF — —']);
  assert.deepEqual(st.total, ['25%', '50%', '25%']);
  assert.match(st.caption, /「Cyan plate」 · 12 面/);
  assert.deepEqual(await warningTypes(), ['few-colors']);
  step(`multiplate.3mf 盤 1: ${st.title}; rows ${st.rows.join(' | ')}; 全檔欄 ${st.total.join('/')}; preview ${st.colours}`);
  const choosePlate = async (n) => {
    await page.click(`[data-testid=plate-${n}]`);
    await page.waitForFunction((k) => {
      const v = document.querySelector('[data-testid=viewer]');
      return v.dataset.loaded.endsWith(`:${k}`) && ['ready', 'empty'].includes(v.dataset.status);
    }, n, { timeout: 120000 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  };
  await choosePlate(2);
  st = await plateState();
  assert.equal(st.title.startsWith('顏色分析 · 盤 2：2 色 ／ 全檔 3 色'), true, `title: ${st.title}`);
  assert.deepEqual(st.colours, ['magenta', 'yellow']);
  assert.deepEqual(st.rows, ['#FF00FF 12 50%', '#FFFF00 12 50%', '#00FFFF — —']);
  step(`盤 2: ${st.title}; preview ${st.colours}`);
  await choosePlate(3);
  st = await plateState();
  assert.deepEqual(st.colours, ['yellow']); // 2nd instance of the yellow object
  await choosePlate(4);
  assert.equal(await page.getAttribute('[data-testid=viewer]', 'data-status'), 'empty');
  assert.match(await page.textContent('[data-testid=color-analysis]'), /這個盤面沒有物件/);
  step('盤 3: yellow only (instance 1); 盤 4 (plate_4.json only): empty plate message');

  // Thumbnail = first plate only
  await page.fill('[data-testid=search]', 'multiplate');
  await page.waitForSelector('[data-testid=card-thumb]');
  const rodb2 = new Database(path.join(base, 'userData', 'library.db'), { readonly: true });
  const mpThumb = rodb2.prepare(`SELECT thumb FROM models WHERE rel_path LIKE '%multiplate.3mf'`).pluck().get();
  rodb2.close();
  const mpImg = await decode(mpThumb);
  assert.deepEqual(present(colourCounts(Buffer.from(mpImg.bgra, 'base64'), 'bgra')).filter((k) => k !== 'gray'), ['cyan']);
  step('multiplate thumbnail: plate 1 only (cyan)');

  if (multi.length === 3) {
    assert.match(await cardFor('BOOK'), /5 盤/);
    await openModel('BOOK-U1', 'BOOK');
    await choosePlate(3);
    assert.match(await page.textContent('[data-testid=plate-caption]'), /「SPINE \+ EXTENSION」 · 7,528 面/);
    assert.match(await page.textContent('[data-testid=color-analysis-title]'), /盤 3：2 色 ／ 全檔 2 色/);
    assert.match(await cardFor('U1Cover'), /8 盤/);
    await openModel('U1Cover-U1', 'U1Cover');
    await choosePlate(8);
    assert.equal(await page.getAttribute('[data-testid=viewer]', 'data-status'), 'ready');
    assert.match(await page.textContent('[data-testid=plate-caption]'), /1,513,200 面/);
    step('BOOK-U1 (5 盤, 盤 3 「SPINE + EXTENSION」 7,528 面) and U1Cover-U1 (8 盤, 盤 8 1,513,200 面) previewed per plate');
  } else {
    step('BOOK-U1 / U1Cover-U1 not found: real multi-plate files skipped');
  }
  await page.fill('[data-testid=search]', '');

  // 12) M6: Full Spectrum (dithered) filament mapping + mixed-colour estimate
  await importViaMenu([await stage('dithered.3mf'), await stage('regions.3mf')]);
  await page.click('[data-testid=import-skip-all]');
  await openModel('dithered');
  const modeNames = await page.$$eval('.modes button', (b) => b.map((x) => x.dataset.testid));
  assert.deepEqual(modeNames, ['mode-original', 'mode-filament', 'mode-estimate']);
  assert.match(await page.textContent('[data-testid=mixing-detect]'), /抖色檔（頂點混色率 9\d\.\d%，門檻 50%）/);
  assert.match(await page.textContent('[data-testid=mixing-spools]'), /5 捲（超過 U1 的 4 個耗材槽）/);
  assert.match(await page.textContent('[data-testid=mixing-average]'), /#D7BE8C.*估計值，實際以 Orca 渲染為準/);
  const pure = (c) => ['cyan', 'magenta', 'yellow', 'black', 'red', 'green', 'blue'].reduce((s, k) => s + (c[k] || 0), 0);
  await setMode('filament');
  const fsSpools = await page.$$eval('[data-testid=spool]', (e) => e.map((x) => x.textContent.trim()));
  assert.equal(fsSpools.length, 5);
  assert.match(await page.textContent('[data-testid=fs-spools-title]'), /不量化到 CMYK.*會用到 5 捲/);
  assert.match(await page.textContent('[data-testid=fs-slots-warning]'), /需要 5 捲，超過 U1 的 4 個耗材槽/);
  const pxFil = await viewerPixels();
  assert.ok(present(pxFil).includes('yellow') && present(pxFil).includes('magenta'), 'own spool colours, not CMYK-quantized ' + JSON.stringify(pxFil));
  await setMode('original');
  const pxOrig = await viewerPixels();
  await setMode('estimate');
  assert.match(await page.textContent('[data-testid=estimate-note]'), /估計值，實際以 Orca 渲染為準/);
  const pxEst = await viewerPixels();
  const pureOrig = pure(pxOrig) / opaque(pxOrig);
  const pureEst = pure(pxEst) / opaque(pxEst);
  assert.ok(pureOrig > 0.5 && pureEst < pureOrig / 3, `estimate blends the dots: pure-colour pixels ${pureOrig.toFixed(2)} -> ${pureEst.toFixed(2)}`);
  step(`dithered.3mf: modes ${modeNames.join('/')}; spools ${fsSpools.join(' | ')}; pure-colour pixels 原始 ${(pureOrig * 100).toFixed(0)}% -> 混色估計 ${(pureEst * 100).toFixed(0)}%`);
  await page.$eval('[data-testid=detail-panel]', (el) => el.scrollTo(0, 0));
  await page.screenshot({ path: path.join(base, 'fullspectrum.png') });

  await openModel('regions');
  assert.equal(await page.$('[data-testid=mode-estimate]'), null, 'region-painted files have no estimate mode');
  assert.equal(await page.$('[data-testid=mixing-stats]'), null);
  await setMode('filament');
  const regionSpools = await page.$$eval('[data-testid=spool]', (e) => e.map((x) => x.textContent.trim()));
  assert.ok(regionSpools.every((t) => /^槽\d [CMYK] /.test(t)), 'non-dithered: nearest single U1 slot ' + regionSpools.join(' | '));
  step('regions.3mf (not dithered): no estimate mode, nearest-slot mapping ' + regionSpools.join(' | '));
  await page.fill('[data-testid=search]', '');

  // 13) M7: missing records after the root switch (the user's iCloud scenario)
  // a) Restart with a file dropped into the root while the app was closed
  await app.close();
  await fs.copyFile(path.join(FIX, 'cube.glb'), path.join(rootB, year, 'dropped-in.glb'));
  [app, page] = await launch();
  await page.waitForSelector('[data-testid=consistency-banner]');
  assert.match(await page.textContent('[data-testid=consistency-banner]'), /發現 1 個檔案/);
  await page.waitForTimeout(500);
  assert.equal(await page.$('[data-testid=missing-toast]'), null, 'already-notified missing records do not raise the notice again');
  await page.click('[data-testid=rebuild-index]');
  await page.waitForSelector('[data-testid=consistency-banner]', { state: 'detached' });
  await cardFor('dropped-in');
  step('restart: no repeated 遺失 notice; file added while closed -> 「發現 1 個檔案」 banner -> 重建索引 indexed it');

  // b) 遺失 filter + card marking
  await page.fill('[data-testid=search]', '');
  const missingCount = allCount;
  assert.match(await page.textContent('[data-testid=filter-missing]'), new RegExp(`遺失\\s*${missingCount}`));
  await page.click('[data-testid=filter-missing]');
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid=model-card]').length === n, missingCount);
  assert.equal(await page.$$eval('[data-testid=missing-overlay]', (e) => e.length), missingCount);
  assert.equal(await page.$$eval('[data-testid=model-card].missing', (e) => e.length), missingCount);
  await page.waitForSelector('[data-testid=missing-note]');
  step(`遺失 filter: ${missingCount} cards, each with red border + 「檔案遺失」 overlay`);

  const openMissing = async (name, query = name) => {
    await page.click('[data-testid=filter-missing]');
    await page.fill('[data-testid=search]', query);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=model-card]').length === 1);
    await page.click('[data-testid=model-card]');
    await page.waitForFunction((n) => document.querySelector('[data-testid=detail-panel] h2')?.textContent === n, name);
    await page.waitForSelector('[data-testid=missing-actions]');
  };
  const missingNow = async (n) => page.waitForFunction((k) => new RegExp(`遺失\\s*${k}$`).test(document.querySelector('[data-testid=filter-missing]').textContent.trim()), n);
  const stubDialogs = (open, confirm) =>
    app.evaluate(({ dialog }, [o, c]) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [o] });
      dialog.showMessageBox = async () => ({ response: c });
    }, [open, confirm]);

  // c) Relocate to a copy inside the new root: used in place, metadata kept
  const winCopy = path.join(rootB, 'relocated', 'Wine copy.3mf');
  if (haveWine) {
    await fs.mkdir(path.dirname(winCopy), { recursive: true });
    await fs.copyFile(WINE, winCopy);
    await openMissing('Wine-U1', 'Wine');
    await stubDialogs(winCopy, 1);
    await page.click('[data-testid=relocate]');
    await page.waitForSelector('[data-testid=missing-actions]', { state: 'detached' });
    await page.waitForSelector('[data-testid=viewer][data-status=ready]');
    assert.match(await page.textContent('[data-testid=detail-panel]'), /relocated\/Wine copy\.3mf/);
    assert.equal(await page.inputValue('[data-testid=f-platform]'), 'MakerWorld');
    await missingNow(missingCount - 1);
    step('重新定位 (inside root): Wine-U1 -> relocated/Wine copy.3mf, preview ready, MakerWorld provenance kept');
  }
  let left = haveWine ? missingCount - 1 : missingCount;

  // d) Remove record: index entry gone, the old file untouched
  await openMissing('painted');
  await stubDialogs('', 1);
  await page.click('[data-testid=remove-record]');
  await page.waitForSelector('[data-testid=detail-panel]', { state: 'detached' });
  await missingNow(--left);
  assert.equal(await exists(path.join(lib, year, 'painted.3mf')), true, 'remove record never deletes files');
  step('移除記錄: painted record removed, its file in the old root still exists');

  // e) Restore when the file is in the new root's .trash
  await fs.mkdir(path.join(rootB, '.trash', '77', year), { recursive: true });
  await fs.copyFile(path.join(FIX, 'offpalette.3mf'), path.join(rootB, '.trash', '77', year, 'offpalette.3mf'));
  await openMissing('offpalette');
  await page.waitForSelector('[data-testid=restore-missing]');
  await page.click('[data-testid=restore-missing]');
  await page.waitForSelector('[data-testid=missing-actions]', { state: 'detached' });
  assert.equal(await exists(path.join(rootB, year, 'offpalette.3mf')), true);
  await missingNow(--left);
  step('從回收桶還原: offpalette .trash/77/2026/offpalette.3mf -> 2026/offpalette.3mf');

  // f) Relocate to a file outside the root: confirmed, moved in like an import
  const outside = await stage('dither.3mf', 'dither.3mf', path.join(inbox, 'dup'));
  await openMissing('dither', 'dither');
  await stubDialogs(outside, 1);
  await page.click('[data-testid=relocate]');
  await page.waitForSelector('[data-testid=missing-actions]', { state: 'detached' });
  assert.equal(await exists(outside), false);
  assert.equal(await exists(path.join(rootB, year, 'dither.3mf')), true);
  await missingNow(--left);
  step(`重新定位 (outside root, confirmed): dither.3mf moved into ${path.join('libraryB', year)}; 遺失 ${missingCount} -> ${left}`);

  // g) Next launch: still no notice for the remaining (already known) missing records
  await app.close();
  [app, page] = await launch();
  await page.waitForTimeout(800);
  assert.equal(await page.$('[data-testid=missing-toast]'), null);
  assert.match(await page.textContent('[data-testid=filter-missing]'), new RegExp(`遺失\\s*${left}`));
  step(`relaunch: no 遺失 notice, filter still lists ${left}`);
  await page.click('[data-testid=filter-missing]');
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid=model-card]').length === n, left);
  await page.screenshot({ path: path.join(base, 'missing.png') });

  // 14) Batch handling of missing records
  // a) 依檔名找回: preview name matches under the root, apply the confirmed ones
  const put = async (from, rel) => {
    await fs.mkdir(path.dirname(path.join(rootB, rel)), { recursive: true });
    await fs.copyFile(from, path.join(rootB, rel));
  };
  await put(path.join(lib, year, 'materials.3mf'), 'recovered/a/materials.3mf'); // unique, same size
  await put(path.join(lib, year, 'mixed.3mf'), 'recovered/b/deep/mixed.3mf'); // unique, nested
  await put(path.join(FIX, 'pyramid_ascii.stl'), 'recovered/c/cube.stl'); // same name, different size
  await put(path.join(lib, year, 'box.obj'), 'recovered/x/box.obj'); // two candidates -> ambiguous
  await put(path.join(lib, year, 'box.obj'), 'recovered/y/box.obj');
  await page.click('[data-testid=recover-open]');
  await page.waitForSelector('[data-testid=recover-summary]');
  assert.match(await page.textContent('[data-testid=recover-summary]'), new RegExp(`找到 3 筆 · 多個候選 1 筆.*找不到 ${left - 4} 筆`));
  const recRows = await page.$$eval('[data-testid=recover-row]', (rows) =>
    rows.map((r) => [r.dataset.name, r.dataset.status, r.querySelector('[data-testid=recover-check]')?.checked ?? null, r.cells[3].textContent.trim()]),
  );
  const rowOf = (n) => recRows.find((r) => r[0] === n);
  assert.deepEqual(rowOf('materials').slice(1, 3), ['match', true]);
  assert.deepEqual(rowOf('mixed').slice(1, 3), ['match', true]);
  assert.match(rowOf('mixed')[3], /recovered\/b\/deep\/mixed\.3mf/);
  assert.deepEqual(rowOf('cube').slice(1, 3), ['match', false]); // different size: not pre-selected
  assert.match(rowOf('cube')[3], /大小不同/);
  assert.equal(rowOf('box')[1], 'ambiguous');
  assert.match(rowOf('box')[3], /多個候選：recovered\/x\/box\.obj、recovered\/y\/box\.obj/);
  assert.match(await page.textContent('[data-testid=recover-apply]'), /套用 2 筆/);
  await page.screenshot({ path: path.join(base, 'recover.png') });
  await page.click('[data-testid=recover-apply]');
  await page.waitForSelector('[data-testid=recover-result]');
  assert.match(await page.textContent('[data-testid=recover-result]'), /已重新定位 2 筆$/);
  await page.click('[data-testid=recover-close]');
  left -= 2;
  await missingNow(left);
  assert.equal(await exists(path.join(rootB, 'recovered', 'a', 'materials.3mf')), true, 'recovered in place, not moved');
  step(`依檔名找回: ${recRows.map((r) => `${r[0]}=${r[1]}${r[2] ? '✓' : ''}`).join(', ')}; applied 2 -> 遺失 ${left}`);

  // b) Batch remove: partial selection, cancel at the 2nd confirmation, then confirm; then select all
  await page.click('[data-testid=filter-missing]');
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid=model-card]').length === n, left);
  const picks = await page.$$('[data-testid=pick]');
  await picks[0].click();
  await picks[1].click();
  assert.match(await page.textContent('[data-testid=missing-remove-selected]'), /移除所選（2）/);
  const confirmAnswers = (answers) =>
    app.evaluate(({ dialog }, rs) => {
      globalThis.__asked = [];
      dialog.showMessageBox = async (_w, o) => {
        globalThis.__asked.push(o.message);
        return { response: rs.shift() ?? 0 };
      };
    }, answers);
  await confirmAnswers([1, 0]);
  await page.click('[data-testid=missing-remove-selected]');
  await page.waitForFunction(() => true);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await app.evaluate(() => globalThis.__asked)).length, 2);
  await missingNow(left); // cancelled at the 2nd confirmation: nothing removed
  await confirmAnswers([1, 1]);
  await page.click('[data-testid=missing-remove-selected]');
  left -= 2;
  await missingNow(left);
  assert.deepEqual(await app.evaluate(() => globalThis.__asked), ['移除 2 筆遺失記錄？', '再次確認：移除 2 筆記錄？']);
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid=model-card]').length === n, left);
  await page.click('[data-testid=missing-select-all]');
  assert.match(await page.textContent('[data-testid=missing-remove-selected]'), new RegExp(`移除所選（${left}）`));
  await confirmAnswers([1, 1]);
  await page.click('[data-testid=missing-remove-selected]');
  await missingNow(0);
  for (const f of ['cube.stl', 'cube.glb', 'cube-2.stl', 'box.obj', 'box.amf']) assert.equal(await exists(path.join(lib, year, f)), true, `${f} must survive record removal`);
  step('批次移除: 2 selected (cancel at 2nd confirm kept them, then removed), then 全選 removed the rest -> 遺失 0; old files untouched');
  await page.click('[data-testid=filter-all]');

  // 15) M9: mapping report CSV, quantized 3MF export, custom spool colours
  const exportsDir = path.join(base, 'exports');
  await fs.mkdir(exportsDir);
  const saveTo = (file) =>
    app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, path.join(exportsDir, file));
  const offSrc = path.join(rootB, year, 'offpalette.3mf');
  const offBefore = await fs.readFile(offSrc);
  await openModel('offpalette');
  await page.waitForSelector('[data-testid=export-quantized]');

  const { parse3mf } = await import('../../src/core/parse/threemf.mjs');
  const statsOfFile = async (p) => Object.fromEntries((await parse3mf(await fs.readFile(p))).colorStats.map((c) => [c.color, c.faces]));
  // 15) M10: the single export action (detail header, Mix always on)
  await saveTo('q-mix.3mf');
  await page.click('[data-testid=export-quantized]');
  await page.waitForFunction(() => /q-mix\.3mf/.test(document.querySelector('[data-testid=export-message]')?.textContent || ''));
  assert.match(await page.textContent('[data-testid=export-message]'), /Mix 2 組/);
  {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(await fs.readFile(path.join(exportsDir, 'q-mix.3mf')));
    const cfg = JSON.parse(await zip.file('Metadata/project_settings.config').async('string'));
    const rows = cfg.mixed_filament_definitions.split(';');
    assert.equal(rows.length, 2, 'one mix row per unmixed colour');
    for (const row of rows) assert.match(row, /^[1-4],[1-4],1,1,(?:\d{1,3}),0,g,w,m0,z0,xa0,xb0,d0,o0,u\d+,cm2$/);
    assert.equal(cfg.mixed_filament_region_collapse, '1');
    // faces point at virtual extruders 5.. (2 mixes over 4 physical spools)
    const { decodePaintColor } = await import('../../src/core/paintColor.mjs');
    const states = new Set();
    for (const name of Object.keys(zip.files)) {
      if (/\.model$/i.test(name)) {
        const xml = await zip.file(name).async('string');
        for (const m of xml.matchAll(/paint_color="([^"]+)"/g)) for (const s of Object.keys(decodePaintColor(m[1]))) states.add(Number(s));
      }
    }
    assert.ok([...states].some((s) => s >= 5), `virtual extruder states present: ${[...states].sort((a, b) => a - b).join(',')}`);
  }
  assert.deepEqual(await fs.readFile(offSrc), offBefore, 'source 3MF never modified (mix)');
  step('M10 export: 超門檻顏色寫成 mixed_filament_definitions（2 組 Mix），面指向虛擬擠出頭 5+；原檔未動');

  // Custom spools: 2 spools equal to two of the file colours
  await page.click('[data-testid=settings-button]');
  await page.waitForSelector('[data-testid=spool-editor]');
  await page.selectOption('[data-testid=spool-count]', '2');
  await page.fill('[data-testid=spool-1]', '#1E90FF');
  await page.fill('[data-testid=spool-2]', '#333333');
  await page.click('[data-testid=spool-save]');
  await page.waitForSelector('[data-testid=spool-message]');
  await page.click('[data-testid=settings-done]');
  await page.waitForSelector('[data-testid=viewer][data-status=ready]');
  await setMode('filament');
  assert.match(await page.textContent('[data-testid=slots-title]'), /自訂耗材槽（2 捲/);
  const customCells = await page.$$eval('[data-testid=color-row]', (rows) => rows.map((r) => [r.cells[0].textContent.trim().slice(0, 7), r.querySelector('[data-testid=print-cell]').dataset.mode]));
  assert.deepEqual(Object.fromEntries(customCells)['#1E90FF'], 'single');
  assert.ok(Object.values(Object.fromEntries(customCells)).includes('buy'), 'unmixable colours on blue + dark grey show 需買線材 ' + JSON.stringify(customCells));
  await saveTo('q-custom.3mf');
  await page.click('[data-testid=export-quantized]');
  await page.waitForFunction(() => /q-custom\.3mf/.test(document.querySelector('[data-testid=export-message]')?.textContent || ''));
  const JSZipMod = (await import('jszip')).default;
  const customZip = await JSZipMod.loadAsync(await fs.readFile(path.join(exportsDir, 'q-custom.3mf')));
  assert.deepEqual(JSON.parse(await customZip.file('Metadata/project_settings.config').async('string')).filament_colour, ['#1E90FFFF', '#333333FF']);
  assert.deepEqual(Object.keys(await statsOfFile(path.join(exportsDir, 'q-custom.3mf'))).sort(), ['#1E90FF', '#333333']);
  step('custom spools (#1E90FF, #333333): mapping title/cells follow, quantized export uses 2 filaments with those colours');
  await page.click('[data-testid=settings-button]');
  await page.waitForSelector('[data-testid=spool-editor]');
  await page.click('[data-testid=spool-reset]');
  await page.waitForSelector('[data-testid=spool-message]');
  await page.click('[data-testid=settings-done]');
  await page.fill('[data-testid=search]', '');

  // 13) M17: colour labels, colour filter, colour-name search, cabinet purchase suggestions
  await importViaMenu([await stage('painted.3mf', 'm17-painted.3mf'), await stage('materials.3mf', 'm17-materials.3mf')]);
  await page.click('[data-testid=import-skip-all]');
  await page.fill('[data-testid=search]', 'm17');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=model-card]').length === 2);
  const cardLabels = async () =>
    page.$$eval('[data-testid=model-card]', (cards) =>
      Object.fromEntries(cards.map((c) => [c.querySelector('.name').textContent, [...c.querySelectorAll('[data-testid=color-tags] .ctag')].map((t) => t.dataset.label)])),
    );
  // labels are language-neutral keys (M24), shown in the UI language
  assert.deepEqual(await cardLabels(), { 'm17-materials': ['orange', 'white', 'blue'], 'm17-painted': ['cyan', 'pink', 'yellow'] });
  // sidebar 顏色 filter: chips with counts; several selected = all must match
  assert.match(await page.textContent('[data-testid=filter-color-blue]'), /藍\s*\d+/);
  await page.click('[data-testid=filter-color-blue]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=model-card]').length === 1);
  assert.equal(await page.textContent('[data-testid=model-card] .name'), 'm17-materials');
  await page.click('[data-testid=filter-color-cyan]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=model-card]').length === 0);
  await page.click('[data-testid=color-filter-clear]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=model-card]').length === 2);
  // search box: colour names 「藍色」 / 「青」
  await page.fill('[data-testid=search]', '藍色');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=model-card] .name')].some((n) => n.textContent === 'm17-materials'));
  assert.ok(!(await page.$$eval('[data-testid=model-card] .name', (n) => n.map((x) => x.textContent))).includes('m17-painted'), '「藍色」 does not match the CMYK file');
  // detail panel: colour badges with shares
  await openModel('m17-painted');
  assert.deepEqual(await page.$$eval('[data-testid=detail-color-tags] .ctag', (t) => t.map((x) => x.textContent.trim())), ['青50%', '粉25%', '黃16.67%']);
  step('M17 顏色標籤: m17-painted 青/粉/黃, m17-materials 橙/藍/白; 過濾「藍」-> 1, 「藍+青」-> 0; 搜尋「藍色」命中 materials; 詳情徽章含佔比');
  // purchase suggestions (cabinet level), add one to the inventory
  await page.click('[data-testid=purchase-open]');
  await page.waitForSelector('[data-testid=purchase-row]');
  const purchaseRows = await page.$$eval('[data-testid=purchase-row]', (r) => r.map((x) => [x.dataset.label, x.dataset.suggest]));
  assert.ok(purchaseRows.length >= 8, 'every colour name in the cabinet is ranked ' + JSON.stringify(purchaseRows));
  const firstSuggest = purchaseRows.find(([, s]) => s === '1')[0];
  const firstSuggestName = ZH_LABEL[firstSuggest];
  assert.match(await page.textContent('[data-testid=purchase-suggestions]'), new RegExp(`建議優先購買：.*${firstSuggestName}`));
  await page.click(`[data-testid=purchase-add-${firstSuggest}]`);
  await page.waitForSelector(`[data-testid=purchase-added-${firstSuggest}]`);
  const inv = (await page.evaluate(() => window.api.getSettings())).inventory;
  assert.equal(inv.length, 1);
  assert.match(inv[0].name, new RegExp(`^${firstSuggestName}（建議色）$`));
  assert.equal(await page.getAttribute(`[data-testid=purchase-row][data-label=${firstSuggest}]`, 'data-suggest'), '0', 'added colour is now covered by the inventory');
  await page.click('[data-testid=purchase-close]');
  await page.evaluate(() => window.api.setInventory([])); // leave the inventory empty again
  step(`M17 採購建議: ${purchaseRows.length} 個色名排行，建議 ${purchaseRows.filter(([, s]) => s === '1').map(([l]) => l).join('/')}；「加入線材庫」${firstSuggest} -> ${inv[0].name} ${inv[0].hex}`);
  await page.fill('[data-testid=search]', '');

  // 14) M18: a Bambu P1S project -> 非 U1 badge / filter / warning -> 轉換為 Snapmaker U1
  {
    const JSZipM18 = (await import('jszip')).default;
    const zip = await JSZipM18.loadAsync(await fs.readFile(path.join(FIX, 'multiplate.3mf')));
    const curRoot = (await page.evaluate(() => window.api.getSettings())).libraryRoot;
    zip.file('Metadata/project_settings.config', JSON.stringify({
      printer_model: 'Bambu Lab P1S', printer_settings_id: 'Bambu Lab P1S 0.4 nozzle', print_settings_id: '0.20mm Standard @BBL X1C',
      nozzle_diameter: ['0.4'], printable_area: ['0x0', '256x0', '256x256', '0x256'], layer_height: '0.2',
      filament_colour: ['#00FFFF', '#FF00FF', '#FFFF00', '#000000'], filament_type: ['PLA', 'PLA', 'PLA', 'PLA'],
      filament_settings_id: ['Bambu PLA Basic @BBL X1C', 'Bambu PLA Basic @BBL X1C', 'Bambu PLA Basic @BBL X1C', 'Bambu PLA Basic @BBL X1C'],
      brim_type: 'auto_brim', exclude_object: '1',
    }));
    const p1sFile = path.join(inbox, 'm18-p1s.3mf');
    await fs.writeFile(p1sFile, await zip.generateAsync({ type: 'nodebuffer' }));
    await importViaMenu([p1sFile]);
    await page.click('[data-testid=import-skip-all]');
    await page.fill('[data-testid=search]', 'm18-p1s');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=model-card]').length === 1);
    assert.match(await page.textContent('[data-testid=model-card] [data-testid=u1-badge]'), /非 U1/);
    assert.match(await page.textContent('[data-testid=filter-nonu1]'), /非 U1\s*1/);
    await page.fill('[data-testid=search]', '');
    await page.click('[data-testid=filter-nonu1]');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=model-card]').length === 1);
    await page.click('[data-testid=filter-all]');
    await openModel('m18-p1s');
    assert.match(await page.textContent('[data-testid=u1-warning]'), /Bambu Lab P1S.*0\.20mm Standard @BBL X1C.*不是 Snapmaker U1/);
    const libFile = (await fs.readdir(path.join(curRoot, year))).find((f) => f.startsWith('m18-p1s'));
    const srcBytes = await fs.readFile(path.join(curRoot, year, libFile));
    await page.click('[data-testid=convert-u1]');
    await page.waitForSelector('[data-testid=u1-result]', { timeout: 120000 });
    const result = (await page.textContent('[data-testid=u1-result]')).replace(/\s+/g, ' ');
    assert.match(result, /已轉換為「m18-p1s-U1」.*原檔未變動/);
    assert.match(result, /Snapmaker U1 \(0\.4 nozzle\) · 0\.20mm Standard @Snapmaker U1 \(0\.4 nozzle\)/);
    assert.match(await page.textContent('[data-testid=u1-plates]'), /2 盤移到 U1 盤面；盤 3 保持原位/);
    assert.deepEqual(await fs.readFile(path.join(curRoot, year, libFile)), srcBytes, 'source 3MF untouched by the conversion');
    await page.click('[data-testid=u1-open-converted]');
    await page.waitForFunction(() => document.querySelector('[data-testid=detail-panel] h2')?.textContent === 'm18-p1s-U1');
    assert.equal(await page.$('[data-testid=u1-warning]'), null, 'the converted project is a U1 project');
    const outFile = (await fs.readdir(path.join(curRoot, year))).find((f) => f.startsWith('m18-p1s-U1'));
    const out = JSON.parse(await (await JSZipM18.loadAsync(await fs.readFile(path.join(curRoot, year, outFile)))).file('Metadata/project_settings.config').async('string'));
    assert.deepEqual([out.printer_model, out.brim_type, out.exclude_object], ['Snapmaker U1', 'no_brim', '1']);
    assert.deepEqual(out.filament_colour, ['#00FFFF', '#FF00FF', '#FFFF00', '#000000']);
    await page.fill('[data-testid=search]', 'm18-p1s-U1');
    await page.waitForSelector('[data-testid=model-card] [data-testid=card-thumb]', { timeout: 120000 }); // thumbnail rendered for the new record
    await page.fill('[data-testid=search]', '');
    step(`M18 U1: m18-p1s 非 U1 徽章/過濾/警示 -> 轉換 ${outFile}（${out.print_settings_id}，2 盤搬到 U1 盤面、盤 3 保持原位），原檔未動`);
  }

  // 15) M19: embedded product images — 3D / 原檔圖 switch, thumbnail strip, plate switcher link
  {
    const JSZipM19 = (await import('jszip')).default;
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
    const zip = await JSZipM19.loadAsync(await fs.readFile(path.join(FIX, 'multiplate.3mf')));
    zip.file('Auxiliaries/.thumbnails/thumbnail_middle.png', PNG);
    zip.file('Auxiliaries/Model Pictures/photo.png', PNG);
    zip.file('Metadata/plate_1.png', PNG);
    zip.file('Metadata/plate_2.png', PNG);
    const picFile = path.join(inbox, 'm19-pictures.3mf');
    await fs.writeFile(picFile, await zip.generateAsync({ type: 'nodebuffer' }));
    await importViaMenu([picFile]);
    await page.click('[data-testid=import-skip-all]');
    // a file without embedded images: no switch at all
    await openModel('m17-painted');
    assert.equal(await page.$('[data-testid=preview-switch]'), null, 'no 3D / 原檔圖 switch without embedded images');
    await openModel('m19-pictures');
    assert.match(await page.textContent('[data-testid=preview-mode-images]'), /原檔圖\s*4/);
    assert.equal(await page.$('[data-testid=embedded-images]'), null, '3D is the default view');
    await page.click('[data-testid=preview-mode-images]');
    await page.waitForSelector('[data-testid=embedded-image]');
    const shown = () => page.getAttribute('[data-testid=embedded-image]', 'data-path');
    const loaded = () => page.waitForFunction(() => document.querySelector('[data-testid=embedded-image]')?.naturalWidth > 0);
    assert.equal(await shown(), 'Auxiliaries/.thumbnails/thumbnail_middle.png');
    await loaded(); // the cover, served from the index
    assert.equal(await page.$eval('[data-testid=viewer]', (v) => v.offsetParent === null), true, 'the 3D view is hidden, not unmounted');
    assert.deepEqual(await page.$$eval('[data-testid=embedded-thumb]', (b) => b.map((x) => x.textContent.trim())), ['封面', '實拍', '盤 1', '盤 2']);
    await page.click('[data-testid=embedded-thumb][data-path="Auxiliaries/Model Pictures/photo.png"]');
    await page.waitForFunction(() => document.querySelector('[data-testid=embedded-image]')?.dataset.path.endsWith('photo.png'));
    await loaded(); // read from the 3MF on demand
    await page.click('[data-testid=plate-2]');
    await page.waitForFunction(() => document.querySelector('[data-testid=embedded-image]')?.dataset.path === 'Metadata/plate_2.png');
    await loaded();
    await page.click('[data-testid=preview-mode-3d]');
    await page.waitForSelector('[data-testid=viewer][data-status=ready]');
    assert.equal(await page.$eval('[data-testid=viewer]', (v) => v.offsetParent !== null), true);
    step('M19 原檔圖: 無內嵌圖時不顯示切換；m19-pictures 預設 3D，原檔圖 4 張（封面/實拍/盤 1/盤 2），選盤 2 -> plate_2.png，切回 3D 正常');
    await page.fill('[data-testid=search]', '');
  }

  // 17) M21: card / row thumbnails — cover, else the 3D render, never a black blob
  {
    const JSZipM21 = (await import('jszip')).default;
    const zip = await JSZipM21.loadAsync(await fs.readFile(path.join(FIX, 'painted.3mf')));
    const cfg = JSON.parse(await zip.file('Metadata/project_settings.config').async('string'));
    cfg.filament_colour = cfg.filament_colour.map(() => '#000000'); // an all-black part, like 咕咕嘎嘎-U1's first plate
    zip.file('Metadata/project_settings.config', JSON.stringify(cfg));
    const blackFile = path.join(inbox, 'm21-black.3mf');
    await fs.writeFile(blackFile, await zip.generateAsync({ type: 'nodebuffer' }));
    await importViaMenu([blackFile]);
    await page.click('[data-testid=import-skip-all]');
    const source = (name) => page.$eval(`[data-testid=model-card]:has(.name:text-is("${name}")) [data-testid=card-thumb]`, (i) => i.dataset.source).catch(() => null);
    await page.fill('[data-testid=search]', 'm');
    await page.waitForFunction(() => document.querySelector('[data-testid=model-card] .name') !== null);
    await page.fill('[data-testid=search]', 'm21-black');
    await page.waitForSelector('[data-testid=model-card] [data-testid=card-thumb]', { timeout: 120000 }); // rendered, not judged black
    assert.equal(await source('m21-black'), 'render', 'a black part renders shaded (M21 lighting), not as a black blob');
    // the stored render, decoded by Electron (the page cannot read mfthumb:// pixels: cross-origin)
    const SqliteM21 = (await import('better-sqlite3')).default;
    const rodb = new SqliteM21(path.join(base, 'userData', 'library.db'), { readonly: true, fileMustExist: true });
    const rendered = rodb.prepare(`SELECT thumb FROM models WHERE name = 'm21-black'`).pluck().get();
    rodb.close();
    const blackThumb = await app.evaluate(({ nativeImage }, b64) => {
      const d = nativeImage.createFromBuffer(Buffer.from(b64, 'base64')).toBitmap();
      let opaque = 0, dark = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] >= 200) { opaque++; if (Math.max(d[i], d[i + 1], d[i + 2]) < 24) dark++; }
      return { opaque, darkShare: dark / opaque };
    }, Buffer.from(rendered).toString('base64'));
    assert.ok(blackThumb.darkShare < 0.9, 'rendered black part is not nearly all black ' + JSON.stringify(blackThumb));
    await page.fill('[data-testid=search]', 'm19-pictures');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=model-card]').length === 1);
    assert.equal(await source('m19-pictures'), 'cover', 'a 3MF with an embedded cover shows it');
    await page.fill('[data-testid=search]', 'm17-painted');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=model-card]').length === 1);
    assert.equal(await source('m17-painted'), 'render', 'no cover: our 3D render');
    // a black silhouette stored through the normal path is detected in main and not shown
    const blackId = (await page.evaluate(() => window.api.list({ q: 'm21-black' })))[0].id;
    await page.evaluate(async (id) => {
      const c = document.createElement('canvas');
      c.width = c.height = 512;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(256, 270, 170, 90, 0, 0, Math.PI * 2);
      ctx.fill();
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      await window.api.setThumb(id, new Uint8Array(await blob.arrayBuffer()));
    }, blackId);
    await page.fill('[data-testid=search]', '');
    await page.fill('[data-testid=search]', 'm21-black');
    await page.waitForFunction(() => document.querySelector('[data-testid=model-card] .thumb .fmt')?.textContent === '3MF');
    assert.equal(await page.$('[data-testid=model-card] [data-testid=card-thumb]'), null, 'black blob replaced by the format icon');
    // table view uses the same order
    await page.fill('[data-testid=search]', 'm');
    await page.click('[data-testid=view-list]');
    await page.waitForSelector('[data-testid=model-row]');
    const rowSource = (name) => page.$eval(`[data-testid=model-row]:has(td.name:text-matches("^${name}")) .thumb-col`, (td) => td.querySelector('img')?.dataset.source ?? 'icon');
    assert.deepEqual([await rowSource('m19-pictures'), await rowSource('m17-painted'), await rowSource('m21-black')], ['cover', 'render', 'icon']);
    await page.click('[data-testid=view-grid]');
    await page.fill('[data-testid=search]', '');
    step(`M21 縮圖: m19-pictures 用封面、m17-painted 用 3D 渲染；全黑零件渲染成有明暗的深灰（暗像素 ${(blackThumb.darkShare * 100).toFixed(1)}%）；黑剪影縮圖 -> 格式圖示；表格同序`);
  }

  // 18) M22: build version + author / repository, bottom left of the sidebar
  {
    const version = (await page.textContent('[data-testid=app-version]')).trim();
    // M28: 1.<YYMM>.<DHHMM>, day not zero-padded (strict semver)
    assert.match(version, APP_PATH ? /^v1\.\d{4}\.[1-9]\d{4,5}$/ : /^v1\.\d{4}\.[1-9]\d{4,5} dev$/, `version label: ${version}`);
    assert.ok(await page.isVisible('[data-testid=app-version]'));
    const tooltip = await page.getAttribute('[data-testid=app-version]', 'title');
    assert.match(tooltip, /^建置時間 \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} · git ([0-9a-f]{7,}(\+dirty)?|unknown)/);
    // the label is the build time in the tooltip, minutes precision
    const [, y, mo, d, h, mi] = /(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(tooltip);
    assert.equal(version.split(' ')[0], `v1.${y.slice(2)}${mo}.${Number(d)}${h}${mi}`);
    // installed app: the sidebar string is the packaged app version, i.e. the one in the file names
    if (APP_PATH) assert.equal(version, `v${await app.evaluate(({ app: a }) => a.getVersion())}`);
    if (!APP_PATH) {
      const built = JSON.parse(await fs.readFile(path.join(ROOT, 'dist', 'build-info.json'), 'utf8'));
      assert.match(tooltip, new RegExp(`git ${built.commit.replace('+', '\\+')}`));
    }
    const credit = await page.$eval('[data-testid=app-credit]', (b) => [...b.querySelectorAll('span')].map((s) => s.textContent.trim()).join(' · '));
    assert.equal(credit, 'Caspar Wei · github.com/MingShyanWei/3mfDeck');
    assert.equal(await page.$eval('[data-testid=app-credit] span:last-child', (s) => s.scrollWidth <= s.clientWidth), true, 'repository shown in full');
    await app.evaluate(({ shell }) => {
      shell.openExternal = async (url) => {
        globalThis.__openedExternal = url; // no browser in tests
      };
    });
    await page.click('[data-testid=app-credit]');
    assert.equal(await app.evaluate(() => globalThis.__openedExternal), 'https://github.com/MingShyanWei/3mfDeck');
    step(`M22 版本: ${version}（${tooltip}）；作者列「${credit}」點擊交給系統瀏覽器`);
  }

  // 16b) M29 (SPEC 3.5e): honest numbers on reindeer's colour shares (97.47 % main colour + 3 small colours)
  {
    await page.click('[data-testid=settings-button]');
    await page.waitForSelector('[data-testid=spool-editor]');
    await page.click('[data-testid=spool-reset]'); // ideal CMYK
    await page.waitForSelector('[data-testid=spool-message]');
    await page.click('[data-testid=settings-done]');
    await importViaMenu([await stage('reindeer.3mf', 'm29-reindeer.3mf')]);
    await page.click('[data-testid=import-skip-all]');
    await openModel('m29-reindeer');
    // fix 5: no "no mixing needed" next to colours that need mixing / buying
    assert.equal(await page.$('[data-testid=warning-few-colors]'), null, 'no contradicting "no mixing needed" hint');
    // fix 4: the unprintable share stated next to the printable one
    assert.equal((await page.textContent('[data-testid=color-analysis] [data-testid=printable-summary]')).trim(), '可印 97.66%、不可印 2.34%');
    // fix 5: a colour to buy shows the fallback spool; its blend is marked reference-only
    const buyCells = await page.$$eval('[data-testid=print-cell][data-mode=buy]', (cells) => cells.map((c) => ({ first: c.firstElementChild?.className, fallback: c.querySelector('[data-testid=buy-fallback]')?.textContent, ref: c.querySelector('[data-testid=buy-reference]')?.textContent })));
    assert.equal(buyCells.length, 2, JSON.stringify(buyCells));
    for (const b of buyCells) {
      assert.match(b.first, /badge/, 'the cell leads with 需買線材, not a recipe');
      assert.match(b.fallback, /^不買則用 槽\d [CMYK]（ΔE [\d.]+）$/);
      assert.match(b.ref, /仍差 ΔE [\d.]+（超過 15），僅供參考、不會採用/);
    }
    // fix 3: spool usage split by recipe (main colour Y68 + M32), unprintable colours on their nearest slot
    await setMode('filament');
    const used = await page.$$eval('[data-testid=spool]', (els) => els.map((e) => e.textContent.trim()));
    assert.deepEqual(used, ['槽2 M 洋紅 · 31.42%', '槽3 Y 黃 · 66.28%', '槽4 K 黑 · 2.3%']);
    assert.equal((await page.textContent('[data-testid=spools] [data-testid=printable-summary]')).trim(), '可印 97.66%、不可印 2.34%');
    await setMode('original');
    // fix 1 + 2: k=1 (97.47 % of the area) leaves 3 colours unprintable and is not recommended
    await page.click('[data-testid=suggest-open]');
    await page.waitForSelector('[data-testid=suggest-recommended]');
    const rec = await page.$eval('[data-testid=suggest-recommended]', (e) => ({ text: e.textContent.trim(), complete: e.dataset.complete }));
    const recK = Number(rec.text.match(/建議 (\d) 捲/)[1]);
    assert.equal(rec.complete, '1', rec.text);
    assert.ok(recK > 1, rec.text);
    assert.match(rec.text, /所有顏色都印得出/);
    assert.equal((await page.textContent('[data-testid=suggest-k1-missing]')).trim(), '印不出 3 色');
    assert.equal(await page.$(`[data-testid=suggest-k${recK}-missing]`), null);
    assert.equal((await page.textContent('[data-testid=suggest-unprintable]')).trim(), '不可印 0%');
    const k1 = (await page.textContent('[data-testid=suggest-results] label:first-child')).replace(/\s+/g, ' ').trim();
    await page.click('[data-testid=suggest-close]');
    step(`M29 誠實數字（reindeer 色分布）: 無「不需混色」；可印 97.66%、不可印 2.34%；買線材列「不買則用…／僅供參考」×2；捲用量 ${used.join(' | ')}；k=1「${k1}」不推薦，推薦 k=${recK}（全部印得出、不可印 0%）`);
    await page.fill('[data-testid=search]', '');
  }

  // 16c) M30 (SPEC 3.13): update notification — off by default and then silent; on: one request, a non-blocking notice
  let hitsWhenDisabled;
  {
    const settings = () => page.evaluate(() => window.api.getSettings());
    const config = async () => JSON.parse(await fs.readFile(path.join(base, 'userData', 'config.json'), 'utf8'));
    // the setting is saved by main over IPC after the click: wait for it
    const configHas = async (key, value) => {
      for (let i = 0; i < 50 && (await config())[key] !== value; i++) await new Promise((r) => setTimeout(r, 100));
      assert.equal((await config())[key], value, `config.json ${key}`);
    };
    // every launch so far (several restarts) ran with the check off: not one request
    assert.deepEqual(updateHits, [], 'update API hit while the check is off');
    assert.equal((await settings()).updateCheck, false);
    // record every http(s) request the app makes from here on (main's net.fetch goes through the session too)
    const watchRequests = () => app.evaluate(({ session }) => {
      globalThis.__requests = [];
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (d, cb) => {
        globalThis.__requests.push(d.url);
        cb({});
      });
    });
    const requests = () => app.evaluate(() => globalThis.__requests);
    await watchRequests();
    await app.evaluate(({ shell }) => {
      shell.openExternal = async (url) => {
        globalThis.__openedExternal = url; // no browser in tests
      };
    });
    // layer 1: version + Releases page via the system browser; layer 3 stated
    await page.click('[data-testid=settings-button]');
    await page.waitForSelector('[data-testid=updates-section]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=settings-version]').textContent.includes('…'));
    const shownVersion = (await page.textContent('[data-testid=settings-version]')).trim();
    const sidebarVersion = (await page.textContent('[data-testid=app-version]')).trim().replace(/^v/, '');
    assert.equal(shownVersion, `目前版本 ${sidebarVersion}`);
    assert.equal(await page.isChecked('[data-testid=settings-update-check]'), false);
    assert.match(await page.textContent('[data-testid=settings-update-check] + span'), /自動檢查更新（會連線 GitHub）/);
    assert.match(await page.textContent('[data-testid=update-manual-note]'), /更新一律手動下載安裝/);
    await page.click('[data-testid=settings-open-releases]');
    assert.equal(await app.evaluate(() => globalThis.__openedExternal), 'https://github.com/MingShyanWei/3mfDeck/releases');
    await page.click('[data-testid=settings-done]');
    await new Promise((r) => setTimeout(r, 1500));
    assert.deepEqual(updateHits, [], 'opening settings / the Releases button made a request');
    assert.deepEqual(await requests(), [], 'the app made an http(s) request with the check off');
    // layer 2 on: one request, a newer build -> non-blocking notice
    await page.click('[data-testid=settings-button]');
    await page.check('[data-testid=settings-update-check]');
    await page.click('[data-testid=settings-done]');
    await page.waitForSelector('[data-testid=update-notice][data-version="9.9999.99999"]');
    assert.equal(updateHits.length, 1);
    assert.deepEqual(await requests(), [UPDATE_API]);
    await configHas('updateCheck', true);
    assert.match(await page.textContent('[data-testid=update-notice]'), /有新版本 9\.9999\.99999.*請手動下載並安裝/s);
    await page.click('[data-testid=update-open]');
    assert.equal(await app.evaluate(() => globalThis.__openedExternal), 'https://github.com/MingShyanWei/3mfDeck/releases/tag/v-smoke');
    await page.click('[data-testid=update-close]'); // closed for this session only
    assert.equal(await page.$('[data-testid=update-notice]'), null);
    // restart: checked at startup, offered again; skip this version
    await app.close();
    [app, page] = await launch();
    await page.waitForSelector('[data-testid=update-notice][data-version="9.9999.99999"]');
    assert.equal(updateHits.length, 2);
    await page.click('[data-testid=update-skip]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=update-notice]'));
    await configHas('skippedUpdate', '9.9999.99999');
    // restart: checked, but the skipped version is not offered
    await app.close();
    [app, page] = await launch();
    for (let i = 0; i < 50 && updateHits.length < 3; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(updateHits.length, 3);
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(await page.$('[data-testid=update-notice]'), null, 'skipped version offered again');
    // off again: no request from now on (checked at the end of the run, after more restarts)
    await page.click('[data-testid=settings-button]');
    await page.uncheck('[data-testid=settings-update-check]');
    await page.click('[data-testid=settings-done]');
    await configHas('updateCheck', false);
    await app.close();
    [app, page] = await launch();
    await new Promise((r) => setTimeout(r, 1500));
    hitsWhenDisabled = updateHits.length;
    assert.equal(hitsWhenDisabled, 3, 'switched off: no request at startup');
    step(`M30 更新通知: 預設關閉，前面所有啟動（含多次重啟）對更新 API 0 次請求、App http(s) 請求 0；設定頁顯示「${shownVersion}」＋開啟 Releases（系統瀏覽器）；開啟後 1 次請求、側欄提示 9.9999.99999（前往下載／關閉／略過）；重啟再查、略過後不再提示；關閉後重啟 0 次請求`);
  }

  // 17) M24: UI language — settings switch (en / zh-CN / zh-TW), menu, Intl, cross-language colour search, remembered
  {
    const sidebarText = () => page.textContent('.sidebar');
    const menuLabels = () => app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map((i) => i.label));
    const cards = () => page.$$eval('[data-testid=model-card] .name', (n) => n.map((x) => x.textContent));
    const search = async (q, name) => {
      await page.fill('[data-testid=search]', q);
      // wait for the filtered list (m17-materials is already listed before the query applies)
      const settled = await page
        .waitForFunction((n) => { const names = [...document.querySelectorAll('[data-testid=model-card] .name')].map((x) => x.textContent); return names.includes(n) && !names.includes('m17-painted'); }, name, { timeout: 10000 })
        .then(() => true, () => false);
      assert.ok(settled, `「${q}」 lists ${name} and not the CMYK file: ${await cards()}`);
    };
    const setLanguage = async (lang, marker) => {
      await page.click('[data-testid=settings-button]');
      await page.selectOption('[data-testid=settings-language]', lang);
      await page.waitForFunction((m) => document.querySelector('.sidebar').textContent.includes(m), marker);
      await page.click('[data-testid=settings-done]');
    };
    await page.click('[data-testid=settings-button]');
    assert.equal(await page.inputValue('[data-testid=settings-language]'), 'zh-TW');
    assert.deepEqual(await page.$$eval('[data-testid=settings-language] option', (o) => o.map((x) => x.textContent)), ['English', '繁體中文', '简体中文']);
    await page.click('[data-testid=settings-done]');

    await setLanguage('en', 'Trash');
    assert.match(await sidebarText(), /All.*Source.*Colours.*Tags/s);
    assert.match(await page.textContent('[data-testid=filter-color-blue]'), /Blue\s*\d+/);
    assert.equal(await page.getAttribute('[data-testid=search]', 'placeholder'), 'Search names, tags, notes, colours (e.g. red)');
    assert.ok(!/[\u4e00-\u9fff]/.test((await sidebarText()).replace('3mfDeck', '')), 'no Chinese left in the English sidebar: ' + (await sidebarText()));
    assert.ok((await menuLabels()).includes('File'), 'menu rebuilt in English: ' + (await menuLabels()));
    await page.click('[data-testid=settings-button]');
    assert.equal((await page.textContent('[data-testid=inventory-import]')).trim(), 'Import from 3dfilamentprofiles…');
    assert.match(await page.textContent('[data-testid=inventory-help]'), /Log in and export from My Spools \(JSON or CSV\)/);
    await page.click('[data-testid=settings-done]');
    await search('white', 'm17-materials');
    await search('白', 'm17-materials'); // a Chinese name still works in the English UI
    await openModel('m17-painted');
    assert.match(await page.textContent('[data-testid=detail-panel]'), /Colour analysis/);
    assert.deepEqual(await page.$$eval('[data-testid=detail-color-tags] .ctag', (t) => t.map((x) => x.textContent.trim())), ['Cyan50%', 'Pink25%', 'Yellow16.67%']);
    const enInfo = await page.textContent('[data-testid=detail-panel]');
    const enDate = enInfo.match(/Imported\s*(\d{2}\/\d{2}\/\d{4})/)?.[1];
    assert.ok(enDate, 'English date MM/DD/YYYY: ' + enInfo.slice(0, 400));

    await setLanguage('zh-CN', '回收站');
    assert.match(await page.textContent('[data-testid=filter-color-blue]'), /蓝\s*\d+/);
    assert.ok((await menuLabels()).includes('文件'), 'menu rebuilt in Simplified Chinese: ' + (await menuLabels()));
    assert.match(await page.textContent('[data-testid=detail-panel]'), /颜色分析/);
    await search('蓝色', 'm17-materials');
    await search('blue', 'm17-materials');

    // remembered across restarts (the saved choice beats MF_LANG=zh-TW)
    assert.equal((await page.evaluate(() => window.api.getSettings())).language, 'zh-CN');
    await app.close();
    [app, page] = await launch();
    assert.match(await sidebarText(), /回收站/);
    await setLanguage('zh-TW', '回收桶');
    assert.equal((await page.evaluate(() => window.api.getSettings())).language, 'zh-TW');
    assert.ok((await menuLabels()).includes('檔案'));
    await page.fill('[data-testid=search]', '');
    step(`M24 語言: 設定頁切換 en（側欄/選單 File/搜尋 placeholder/顏色分析/徽章 Cyan50%/日期 ${enDate}）→ zh-CN（回收站/选单 文件/颜色分析）→ 重啟仍為 zh-CN → 切回 zh-TW；跨語言搜尋 white/白/蓝色/blue 皆命中 m17-materials`);
  }

  await page.screenshot({ path: path.join(base, 'smoke.png') });
  step('screenshot: ' + path.join(base, 'smoke.png'));

  // 16) M20: renamed 3mfDeck — first launch copies the old 「3MF 櫃」 userData, never touching it
  {
    const before = await page.evaluate(async () => ({ list: (await window.api.list({})).length, sidebar: await window.api.sidebar(), settings: await window.api.getSettings() }));
    assert.equal(await page.title(), '3mfDeck');
    assert.match(await page.textContent('.sidebar .brand'), /3mfDeck/);
    await app.close();
    const legacy = path.join(base, '3MF 櫃'); // the old app's userData, as this run left it
    await fs.mkdir(legacy);
    for (const f of await fs.readdir(path.join(base, 'userData'))) {
      if (/^(library\.db(-wal|-shm)?|config\.json)$/.test(f)) await fs.copyFile(path.join(base, 'userData', f), path.join(legacy, f));
    }
    const crypto = await import('node:crypto');
    const snapshot = async () => Object.fromEntries(await Promise.all((await fs.readdir(legacy)).sort().map(async (f) => [f, crypto.createHash('sha256').update(await fs.readFile(path.join(legacy, f))).digest('hex')])));
    const legacyBefore = await snapshot();
    const fresh = path.join(base, '3mfDeck');
    [app, page] = await launch({ MF_USER_DATA: fresh, MF_LEGACY_USER_DATA: legacy });
    await page.waitForSelector('.toolbar');
    const after = await page.evaluate(async () => ({ list: (await window.api.list({})).length, sidebar: await window.api.sidebar(), settings: await window.api.getSettings() }));
    assert.equal(after.list, before.list);
    assert.deepEqual([after.sidebar.all, after.sidebar.nonU1, after.sidebar.colors], [before.sidebar.all, before.sidebar.nonU1, before.sidebar.colors]);
    assert.equal(after.settings.libraryRoot, before.settings.libraryRoot);
    assert.match(await fs.readFile(path.join(fresh, 'migrated-from.json'), 'utf8'), /3MF 櫃/);
    assert.deepEqual(await snapshot(), legacyBefore, 'old userData untouched');
    step(`M20 3mfDeck: 視窗標題/側欄已改名；遷移 ${Object.keys(legacyBefore).join(', ')} -> 新資料夾，${after.list} 筆、非 U1 ${after.sidebar.nonU1}、色名 ${after.sidebar.colors.length} 種與遷移前相同；舊資料夾 sha256 不變`);
  }
  // M30: the relaunch above (fresh userData, check off) made no request either
  assert.equal(updateHits.length, hitsWhenDisabled, `update API hit after the check was switched off: ${updateHits.join(', ')}`);
} finally {
  await app.close();
  updateServer.close();
}

if (consoleProblems.length) {
  console.error('Console problems:\n' + consoleProblems.join('\n'));
  process.exit(1);
}
console.log(`SMOKE OK — no console errors/warnings. Temp dir: ${base}`);
