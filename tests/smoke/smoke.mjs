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
  await setMode('wireframe');
  px = await viewerPixels();
  assert.ok(!present(px).includes('cyan') && !present(px).includes('magenta'), 'wireframe hides paint colours ' + JSON.stringify(px));
  assert.ok((px.blue || 0) + (px.other || 0) > 150, 'wire lines drawn ' + JSON.stringify(px));
  step('線框: ' + JSON.stringify(px));
  await setMode('original');
  assert.ok(present(await viewerPixels()).includes('cyan'));

  // offpalette.3mf: filament mapping visibly re-colours to the nearest CMYK slots
  await openModel('offpalette');
  const before = await viewerPixels();
  await setMode('filament');
  const after = await viewerPixels();
  assert.ok(!present(before).includes('cyan') && present(before).includes('blue'), 'original: dodger blue ' + JSON.stringify(before));
  assert.ok(present(after).includes('cyan') && !present(after).includes('blue'), 'mapped: cyan ' + JSON.stringify(after));
  const mapping = await page.$$eval('[data-testid=spools] .mapping li', (els) => els.map((e) => e.textContent.trim()));
  assert.equal(mapping.length, 4);
  assert.match(mapping[0], /^#1E90FF → 槽1/);
  await page.$eval('[data-testid=detail-panel]', (el) => el.scrollTo(0, 0));
  await page.screenshot({ path: path.join(base, 'preview-filament.png') });
  step(`offpalette.3mf 原始 ${JSON.stringify(present(before))} -> 耗材映射 ${JSON.stringify(present(after))}; ${mapping.join(' | ')}`);

  // textured.glb: baseColorTexture (red | green halves)
  await openModel('textured');
  px = await viewerPixels();
  assert.ok(present(px).includes('red') && present(px).includes('green'), 'GLB texture ' + JSON.stringify(px));
  assert.equal(await page.isDisabled('[data-testid=mode-filament]'), true);
  await setMode('wireframe');
  assert.ok(!present(await viewerPixels()).includes('red'));
  step('preview textured.glb: ' + JSON.stringify(px) + '; 耗材映射 disabled; 線框 hides texture');

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

  // Export: copy, never move
  const exportDir = path.join(base, 'exported');
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, exportDir);
  await page.click('[data-testid=filter-all]');
  await openModel('painted');
  await page.click('[data-testid=export]');
  await page.waitForSelector('[data-testid=export-message]');
  assert.match(await page.textContent('[data-testid=export-message]'), new RegExp(`已匯出到 ${path.join(exportDir, 'painted.3mf')}`));
  assert.deepEqual(await fs.readFile(path.join(exportDir, 'painted.3mf')), await fs.readFile(path.join(lib, year, 'painted.3mf')));
  step('匯出: painted.3mf copied to ' + exportDir + ' (source still in library)');
  await page.fill('[data-testid=search]', '');

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

  // 6) Settings page: switch library root (SPEC 3.7)
  const rootB = path.join(base, 'libraryB');
  await fs.mkdir(path.join(rootB, '2025'), { recursive: true });
  await fs.copyFile(path.join(FIX, 'fixture.step'), path.join(rootB, '2025', 'part.step'));
  const allCount = liveFiles; // after the rebuild every live file is indexed again
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
  step(`settings: root -> ${rootB}; 1 file indexed, ${allCount} old records shown as 遺失; config.json in userData`);

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
