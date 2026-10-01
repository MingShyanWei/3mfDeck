// M6 validation: compare our preview of a Full Spectrum 3MF (original and
// mixed-colour estimate) with Orca's own preview images stored in the file
// (Metadata/plate_1.png lit, Metadata/plate_no_light_1.png unlit).
// Camera angle and lighting differ between Orca and us, so only colour
// statistics over model pixels are compared, never pixel-by-pixel.
// Run: npm run build && node tests/smoke/orcacompare.mjs [path/to/file.3mf]
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { rgbToLab, deltaE2000, hexToRgb } from '../../src/core/filament.mjs';

const ROOT = path.join(import.meta.dirname, '..', '..');
const FILE = process.argv[2] || path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/3mf/FullSpectrum Lizard-U1.3mf');

// ---- colour statistics over model pixels ({ r,g,b }[]) ----
function analyse(pixels, filaments) {
  const labs = filaments.map((hx) => [hx, rgbToLab(hexToRgb(hx))]);
  const share = Object.fromEntries(filaments.map((f) => [f, 0]));
  const dist = [];
  const mean = [0, 0, 0];
  const hue = new Map();
  for (const p of pixels) {
    const lab = rgbToLab([p.r, p.g, p.b]);
    let best = null;
    for (const [hx, l] of labs) {
      const d = deltaE2000(lab, l);
      if (!best || d < best[1]) best = [hx, d];
    }
    share[best[0]]++;
    dist.push(best[1]);
    mean[0] += lab[0];
    mean[1] += lab[1];
    mean[2] += lab[2];
    const bin = `${Math.round(lab[1] / 10)},${Math.round(lab[2] / 10)}`; // a*b* histogram, 10-unit bins
    hue.set(bin, (hue.get(bin) || 0) + 1);
  }
  dist.sort((a, b) => a - b);
  const n = pixels.length;
  return {
    pixels: n,
    meanLab: mean.map((v) => v / n),
    sharePct: Object.fromEntries(Object.entries(share).map(([k, v]) => [k, +((v / n) * 100).toFixed(1)])),
    purityP50: +dist[Math.floor(n / 2)].toFixed(1), // dE00 to nearest pure filament
    hue: new Map([...hue].map(([k, v]) => [k, v / n])),
  };
}
const histOverlap = (a, b) => {
  let s = 0;
  for (const [k, v] of a) s += Math.min(v, b.get(k) || 0);
  return +(s * 100).toFixed(1);
};

// RGBA/BGRA buffer -> model pixels (alpha >= 200)
function modelPixels(buf, w, h, order) {
  const out = [];
  for (let i = 0; i < w * h; i++) {
    if (buf[i * 4 + 3] < 200) continue;
    const [r, b] = order === 'rgba' ? [buf[i * 4], buf[i * 4 + 2]] : [buf[i * 4 + 2], buf[i * 4]];
    out.push({ r, g: buf[i * 4 + 1], b });
  }
  return out;
}
// Box-downsample so the model covers about `target` pixels (like Orca's 512 px image)
function downsample(buf, w, h, order, target) {
  const all = modelPixels(buf, w, h, order).length;
  const k = Math.max(1, Math.round(Math.sqrt(all / target)));
  const out = [];
  for (let y = 0; y + k <= h; y += k) {
    for (let x = 0; x + k <= w; x += k) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = 0; dy < k; dy++) {
        for (let dx = 0; dx < k; dx++) {
          const i = ((y + dy) * w + x + dx) * 4;
          if (buf[i + 3] < 200) continue;
          const [rr, bb] = order === 'rgba' ? [buf[i], buf[i + 2]] : [buf[i + 2], buf[i]];
          r += rr;
          g += buf[i + 1];
          b += bb;
          n++;
        }
      }
      if (n === k * k) out.push({ r: r / n, g: g / n, b: b / n });
    }
  }
  return { pixels: out, factor: k };
}

const zip = await JSZip.loadAsync(await fs.readFile(FILE));
const filaments = JSON.parse(await zip.file('Metadata/project_settings.config').async('string')).filament_colour.map((c) => c.slice(0, 7).toUpperCase());

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'mfcab-orca-'));
await fs.mkdir(path.join(base, 'inbox'));
const src = path.join(base, 'inbox', path.basename(FILE));
await fs.copyFile(FILE, src); // never touch the original
const env = { ...process.env, MF_USER_DATA: path.join(base, 'userData'), MF_LIBRARY_ROOT: path.join(base, 'library') };
const app = await electron.launch(process.env.MF_APP_PATH ? { executablePath: process.env.MF_APP_PATH, args: [], env } : { args: [ROOT], env });
const problems = [];
try {
  const page = await app.firstWindow();
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && problems.push(m.text()));
  await page.waitForSelector('.toolbar');
  await app.evaluate(({ dialog, Menu }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    Menu.getApplicationMenu().getMenuItemById('import').click();
  }, src);
  await page.waitForSelector('[data-testid=import-dialog] [data-testid=f-name]', { timeout: 300000 });
  await page.click('[data-testid=import-skip-all]');
  await page.click('[data-testid=model-card]');
  await page.waitForSelector('[data-testid=viewer][data-status=ready]', { timeout: 300000 });

  const decodePng = async (bytes) =>
    app.evaluate(({ nativeImage }, b64) => {
      const img = nativeImage.createFromBuffer(Buffer.from(b64, 'base64'));
      return { ...img.getSize(), bgra: img.toBitmap().toString('base64') };
    }, Buffer.from(bytes).toString('base64'));
  const orca = {};
  for (const [k, f] of [['orcaLit', 'Metadata/plate_1.png'], ['orcaUnlit', 'Metadata/plate_no_light_1.png']]) {
    const img = await decodePng(await zip.file(f).async('nodebuffer'));
    orca[k] = { ...img, buf: Buffer.from(img.bgra, 'base64') };
  }
  const orcaPixels = modelPixels(orca.orcaLit.buf, orca.orcaLit.width, orca.orcaLit.height, 'bgra').length;

  const capture = async (mode) => {
    await page.click(`[data-testid=mode-${mode}]`);
    await page.waitForSelector(`[data-testid=viewer][data-mode=${mode}]`);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const { w, h, b64 } = await page.evaluate(() => {
      const src = document.querySelector('[data-testid=viewer-canvas]');
      const c = document.createElement('canvas');
      c.width = src.width;
      c.height = src.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(src, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      let bin = '';
      for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
      return { w: c.width, h: c.height, b64: btoa(bin) };
    });
    await page.locator('[data-testid=viewer]').screenshot({ path: path.join(base, `ours-${mode}.png`) });
    return { w, h, buf: Buffer.from(b64, 'base64') };
  };
  const ours = { original: await capture('original'), estimate: await capture('estimate') };
  await fs.writeFile(path.join(base, 'orca-plate_1.png'), await zip.file('Metadata/plate_1.png').async('nodebuffer'));

  const sets = {
    'Orca plate_1.png (lit)': analyse(modelPixels(orca.orcaLit.buf, orca.orcaLit.width, orca.orcaLit.height, 'bgra'), filaments),
    'Orca plate_no_light_1.png (unlit)': analyse(modelPixels(orca.orcaUnlit.buf, orca.orcaUnlit.width, orca.orcaUnlit.height, 'bgra'), filaments),
    'ours 原始 (full res)': analyse(modelPixels(ours.original.buf, ours.original.w, ours.original.h, 'rgba'), filaments),
  };
  const ds = downsample(ours.original.buf, ours.original.w, ours.original.h, 'rgba', orcaPixels);
  sets[`ours 原始 (box-downsampled x${ds.factor} to Orca scale)`] = analyse(ds.pixels, filaments);
  sets['ours 混色估計 (estimate)'] = analyse(modelPixels(ours.estimate.buf, ours.estimate.w, ours.estimate.h, 'rgba'), filaments);

  const ref = sets['Orca plate_1.png (lit)'];
  const refUnlit = sets['Orca plate_no_light_1.png (unlit)'];
  const rows = Object.entries(sets).map(([name, s]) => ({
    name,
    pixels: s.pixels,
    meanLab: s.meanLab.map((v) => +v.toFixed(1)),
    dE_meanVsOrcaLit: +deltaE2000(s.meanLab, ref.meanLab).toFixed(1),
    dE_meanVsOrcaUnlit: +deltaE2000(s.meanLab, refUnlit.meanLab).toFixed(1),
    hueOverlapVsOrcaLitPct: histOverlap(s.hue, ref.hue),
    purityP50: s.purityP50,
    nearestFilamentSharePct: s.sharePct,
  }));
  console.log(JSON.stringify({ file: path.basename(FILE), filaments, rows, images: base }, null, 2));
} finally {
  await app.close();
}
if (problems.length) {
  console.error('console problems:\n' + problems.join('\n'));
  process.exit(1);
}
