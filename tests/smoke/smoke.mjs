// Electron smoke test: launch the real app (isolated userData + library root),
// import files via the menu (stubbed file dialog) and via a real OS-level
// drag & drop (CDP Input.dispatchDragEvent), check the library UI, and fail
// on any console error.
// Run: npm run smoke   (builds the renderer first)
// Packaged app: MF_APP_PATH="/Applications/3MF 櫃.app/Contents/MacOS/3MF 櫃" node tests/smoke/smoke.mjs
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.join(import.meta.dirname, '..', '..');
const FIX = path.join(ROOT, 'tests', 'fixtures');
// Optional real-world file (user-provided); copied, never moved.
const WINE = process.env.MF_WINE_3MF || path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/3mf/Wine-U1.3mf');

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'mfcab-smoke-'));
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
const step = (msg) => console.log(`• ${msg}`);

const consoleProblems = [];
const APP_PATH = process.env.MF_APP_PATH;
async function launch() {
  const env = { ...process.env, MF_USER_DATA: path.join(base, 'userData'), MF_LIBRARY_ROOT: lib };
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
  assert.match(await page.textContent('[data-testid=warning-few-colors]'), /色塊少於 4 色不需混色，量化成實色平塗最乾淨/);
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
  assert.deepEqual(await cardLabels(), { 'm17-materials': ['橙', '藍', '白'], 'm17-painted': ['青', '粉', '黃'] });
  // sidebar 顏色 filter: chips with counts; several selected = all must match
  assert.match(await page.textContent('[data-testid=filter-color-藍]'), /藍\s*\d+/);
  await page.click('[data-testid=filter-color-藍]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=model-card]').length === 1);
  assert.equal(await page.textContent('[data-testid=model-card] .name'), 'm17-materials');
  await page.click('[data-testid=filter-color-青]');
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
  assert.match(await page.textContent('[data-testid=purchase-suggestions]'), new RegExp(`建議優先購買：.*${firstSuggest}`));
  await page.click(`[data-testid=purchase-add-${firstSuggest}]`);
  await page.waitForSelector(`[data-testid=purchase-added-${firstSuggest}]`);
  const inv = (await page.evaluate(() => window.api.getSettings())).inventory;
  assert.equal(inv.length, 1);
  assert.match(inv[0].name, new RegExp(`^${firstSuggest}（建議色）$`));
  assert.equal(await page.getAttribute(`[data-testid=purchase-row][data-label=${firstSuggest}]`, 'data-suggest'), '0', 'added colour is now covered by the inventory');
  await page.click('[data-testid=purchase-close]');
  await page.evaluate(() => window.api.setInventory([])); // leave the inventory empty again
  step(`M17 採購建議: ${purchaseRows.length} 個色名排行，建議 ${purchaseRows.filter(([, s]) => s === '1').map(([l]) => l).join('/')}；「加入線材庫」${firstSuggest} -> ${inv[0].name} ${inv[0].hex}`);
  await page.fill('[data-testid=search]', '');

  await page.screenshot({ path: path.join(base, 'smoke.png') });
  step('screenshot: ' + path.join(base, 'smoke.png'));
} finally {
  await app.close();
}

if (consoleProblems.length) {
  console.error('Console problems:\n' + consoleProblems.join('\n'));
  process.exit(1);
}
console.log(`SMOKE OK — no console errors/warnings. Temp dir: ${base}`);
