// Real-file acceptance run (M2/M3) against user-provided 3MFs.
// Copies each file into a temp library (originals are never touched),
// imports it through the app, and measures per phase:
//   - wall time (import parse, thumbnail, preview, mode switches)
//   - UI responsiveness: longest renderer frame gap (rAF) and slowest
//     main-process IPC round trip while the phase runs
//   - peak memory per process type (app.getAppMetrics)
// Run: npm run realfiles -- [file ...]   (builds the renderer first)   (MF_REAL_DIR overrides the folder,
//      MF_APP_PATH runs a packaged app)
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..', '..');
const DIR = process.env.MF_REAL_DIR || path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/3mf');
const FILES = process.argv.slice(2).length ? process.argv.slice(2) : ['警徽多色.3mf', 'Meshy_AI_Crowned Garden Kiki.3mf', 'FullSpectrum Lizard-U1.3mf'];
const APP_PATH = process.env.MF_APP_PATH;

const results = [];
const problems = [];

for (const file of FILES) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'mfcab-real-'));
  const inbox = path.join(base, 'inbox');
  await fs.mkdir(inbox);
  const src = path.join(inbox, file);
  await fs.copyFile(path.join(DIR, file), src); // copy, never move the original

  const env = { ...process.env, MF_USER_DATA: path.join(base, 'userData'), MF_LIBRARY_ROOT: path.join(base, 'library') };
  const app = await electron.launch(APP_PATH ? { executablePath: APP_PATH, args: [], env } : { args: [ROOT], env });
  const page = await app.firstWindow();
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && problems.push(`${file}: [renderer ${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`${file}: [pageerror] ${e.message}`));
  await page.waitForSelector('.toolbar');

  // Probes: rAF gaps in the renderer, IPC round trips to main
  await page.evaluate(() => {
    window.__probe = { maxGap: 0, maxIpc: 0 };
    window.__long = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ type: 'longtask' });
    let last = performance.now();
    const frame = (t) => {
      window.__probe.maxGap = Math.max(window.__probe.maxGap, t - last);
      last = t;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    setInterval(async () => {
      const t = performance.now();
      await window.api.sidebar();
      window.__probe.maxIpc = Math.max(window.__probe.maxIpc, performance.now() - t);
    }, 100);
  });
  let memPeak = {};
  const memTimer = setInterval(async () => {
    try {
      const metrics = await app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => ({ type: m.type, kb: m.memory.workingSetSize })));
      for (const m of metrics) memPeak[m.type] = Math.max(memPeak[m.type] || 0, Math.round(m.kb / 1024));
    } catch {
      // app closing
    }
  }, 250);

  const phase = async (name, fn) => {
    await page.evaluate(() => Object.assign(window.__probe, { maxGap: 0, maxIpc: 0 }));
    memPeak = {};
    const t = Date.now();
    await fn();
    const ms = Date.now() - t;
    await new Promise((r) => setTimeout(r, 300)); // let a last memory sample land
    const probe = await page.evaluate(() => ({ ...window.__probe }));
    return { phase: name, ms, maxFrameGapMs: Math.round(probe.maxGap), maxIpcMs: Math.round(probe.maxIpc), peakMB: { ...memPeak } };
  };

  const r = { file, phases: [] };
  r.phases.push(
    await phase('import (move + parse + index)', async () => {
      await app.evaluate(({ dialog, Menu }, p) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
        Menu.getApplicationMenu().getMenuItemById('import').click();
      }, src);
      await page.waitForSelector('[data-testid=import-dialog] [data-testid=f-name]', { timeout: 300000 });
    }),
  );
  r.prefill = { platform: await page.inputValue('[data-testid=f-platform]') };
  await page.click('[data-testid=import-skip-all]');

  r.phases.push(
    await phase('thumbnail (background)', async () => {
      await page.waitForSelector('[data-testid=card-thumb]', { timeout: 300000 });
    }),
  );
  r.card = (await page.textContent('[data-testid=model-card]')).replace(/\s+/g, ' ').trim();

  r.phases.push(
    await phase('open preview', async () => {
      await page.click('[data-testid=model-card]');
      await page.waitForSelector('[data-testid=viewer][data-status=ready]', { timeout: 300000 });
    }),
  );
  for (const mode of ['filament', 'wireframe', 'original']) {
    r.phases.push(
      await phase(`mode ${mode}`, async () => {
        if (await page.isDisabled(`[data-testid=mode-${mode}]`)) return;
        await page.click(`[data-testid=mode-${mode}]`);
        await page.waitForSelector(`[data-testid=viewer][data-mode=${mode}]`);
        await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
      }),
    );
  }
  // Orbit: 30 drag steps; frame gaps show interactive cost
  r.phases.push(
    await phase('orbit drag (30 steps)', async () => {
      const box = await page.locator('[data-testid=viewer-canvas]').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      for (let i = 0; i < 30; i++) await page.mouse.move(box.x + box.width / 2 + i * 6, box.y + box.height / 2 + i * 2);
      await page.mouse.up();
    }),
  );

  r.longTasksMs = await page.evaluate(() => window.__long.sort((x, y) => y - x).slice(0, 5)); // longest UI blocks, whole run
  r.previewBreakdown = await page.evaluate(() =>
    Object.fromEntries(performance.getEntriesByType('measure').filter((m) => m.name.startsWith('preview:')).map((m) => [m.name, Math.round(m.duration)])),
  );
  await page.click('[data-testid=mode-filament]').catch(() => {});
  r.spools = await page.$$eval('[data-testid=spool]', (els) => els.map((e) => e.textContent.trim()));
  r.table = await page.$$eval('[data-testid=color-row]', (rows) => rows.map((row) => [...row.cells].slice(0, 3).map((c) => c.textContent.trim()).join(' ')));
  r.warnings = await page.$$eval('[data-testid^=warning-]', (els) => els.map((e) => e.textContent.trim()));
  await page.$eval('[data-testid=detail-panel]', (el) => el.scrollTo(0, 0));
  r.screenshot = path.join(base, 'detail.png');
  await page.screenshot({ path: r.screenshot });
  const thumb = path.join(base, 'thumb.png');
  await page.locator('[data-testid=card-thumb]').screenshot({ path: thumb });
  r.thumbScreenshot = thumb;

  clearInterval(memTimer);
  await app.close();
  results.push(r);
  console.log(JSON.stringify(r, null, 2));
}

if (problems.length) {
  console.error('Console problems:\n' + problems.join('\n'));
  process.exit(1);
}
console.log('REALFILES OK — no console errors/warnings');
