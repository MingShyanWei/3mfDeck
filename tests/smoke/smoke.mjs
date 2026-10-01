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

  // 6) Settings page: switch library root (SPEC 3.7)
  const rootB = path.join(base, 'libraryB');
  await fs.mkdir(path.join(rootB, '2025'), { recursive: true });
  await fs.copyFile(path.join(FIX, 'fixture.step'), path.join(rootB, '2025', 'part.step'));
  const allCount = total + 1;
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
