// Electron smoke test: launch the real app (isolated userData + library root),
// import files via the menu (stubbed file dialog) and via a real OS-level
// drag & drop (CDP Input.dispatchDragEvent), check the library UI, and fail
// on any console error.
// Run: npm run smoke   (builds the renderer first)
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
const app = await electron.launch({
  args: [ROOT],
  env: { ...process.env, MF_USER_DATA: path.join(base, 'userData'), MF_LIBRARY_ROOT: lib },
});
app.process().stderr.on('data', (d) => {
  const s = d.toString();
  // Chromium's own noise on stderr is not ours; JS errors in main are
  if (/Error|Uncaught|UnhandledPromiseRejection/.test(s)) consoleProblems.push(`[main] ${s.trim()}`);
});

try {
  const page = await app.firstWindow();
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') consoleProblems.push(`[renderer ${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleProblems.push(`[renderer pageerror] ${e.message}`));
  await page.waitForSelector('.toolbar');
  step('app launched, window title: ' + (await page.title()));

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
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid=card-thumb]').length === n, total + 3);
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

  // 6) Settings page: switch library root (SPEC 3.7)
  const rootB = path.join(base, 'libraryB');
  await fs.mkdir(path.join(rootB, '2025'), { recursive: true });
  await fs.copyFile(path.join(FIX, 'fixture.step'), path.join(rootB, '2025', 'part.step'));
  const allCount = total + 3;
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
