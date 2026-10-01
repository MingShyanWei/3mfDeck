// M6 (SPEC 3.4 filament mapping, mixed colours). Background, verified against
// OrcaSlicer source (SoftFever/OrcaSlicer @ 3384daa): paint_color holds ONE
// filament per triangle (Model.cpp CONST_FILAMENTS "4","8","0C","1C","2C",...
// = extruder 1,2,3,4,5,...; TriangleSelector::serialize/deserialize), not a
// bitmask. Full Spectrum colour mixing is spatial dithering: neighbouring
// triangles carry different single filaments and blend optically.
//   https://github.com/SoftFever/OrcaSlicer/blob/3384daa6bcbdfccea9797238fc7acb9f4144dae8/src/libslic3r/Model.cpp#L55-L58
//   https://github.com/SoftFever/OrcaSlicer/blob/3384daa6bcbdfccea9797238fc7acb9f4144dae8/src/libslic3r/TriangleSelector.cpp#L1699-L1790
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse3mf } from '../../src/core/parse/threemf.mjs';
import { FULL_SPECTRUM } from '../../src/core/fullSpectrum.mjs';
import { mixedAverage } from '../../src/core/colorAnalysis.mjs';
import { mapToSlots } from '../../src/core/filament.mjs';
import { openDb, insertModel, listModels, getModel, deleteModels } from '../../src/core/db.mjs';
import { parseFile } from '../../src/core/parse/index.mjs';
import { estimateColours, prepareMesh, linearBytes } from '../../src/renderer/viewer/meshData.js';
import { FIXTURES } from './helpers.mjs';

const fixture = (f) => fs.readFile(path.join(FIXTURES, f));

describe('Full Spectrum (dithered) detection', () => {
  it('dithered grid: almost every vertex touches several filaments -> full spectrum', async () => {
    const r = await parse3mf(await fixture('dithered.3mf'));
    expect(r.mixing.fullSpectrum).toBe(true);
    expect(r.mixing.vertexMixedPct).toBeGreaterThan(90);
    // participating spools = the 5 filaments, each with its face share
    expect(r.colorStats.map((c) => c.color).sort()).toEqual(['#000000', '#0086D6', '#EC008C', '#F4EE2A', '#FFFFFF']);
    expect(r.colorStats.reduce((s, c) => s + c.faces, 0)).toBe(12800);
  });

  it('same grid painted in bands: region painting, not full spectrum', async () => {
    const r = await parse3mf(await fixture('regions.3mf'));
    expect(r.mixing.vertexMixedPct).toBeLessThan(10);
    expect(r.mixing.fullSpectrum).toBe(false);
  });

  it('tiny or few-colour models are never flagged', async () => {
    const painted = await parse3mf(await fixture('painted.3mf')); // 12 faces, 100 % mixed
    expect(painted.mixing).toEqual({ vertexMixedPct: 100, fullSpectrum: false });
    expect(painted.tri_count).toBeLessThan(FULL_SPECTRUM.minFaces);
    expect((await parse3mf(await fixture('plain.3mf'))).mixing.fullSpectrum).toBe(false);
  });

  it('non-full-spectrum files keep nearest-single-slot mapping', async () => {
    const r = await parse3mf(await fixture('offpalette.3mf'));
    expect(r.mixing.fullSpectrum).toBe(false);
    expect(mapToSlots(r.colorStats).used.map((u) => u.name)).toEqual(['C', 'M', 'Y', 'K']);
  });

  it('stored and listed: full_spectrum + vertex_mixed_pct, cascades on delete', async () => {
    const db = openDb(':memory:');
    const fs1 = insertModel(db, { name: 'd', relPath: '2026/dithered.3mf', parsed: await parseFile(path.join(FIXTURES, 'dithered.3mf')) });
    insertModel(db, { name: 'r', relPath: '2026/regions.3mf', parsed: await parseFile(path.join(FIXTURES, 'regions.3mf')) });
    insertModel(db, { name: 's', relPath: '2026/cube.stl', parsed: await parseFile(path.join(FIXTURES, 'cube.stl')) });
    expect(listModels(db, { sort: 'name' }).map((m) => [m.name, m.full_spectrum])).toEqual([
      ['d', true],
      ['r', false],
      ['s', false],
    ]);
    expect(getModel(db, fs1).vertex_mixed_pct).toBeGreaterThan(90);
    deleteModels(db, [fs1]);
    expect(db.prepare('SELECT COUNT(*) FROM color_mixing').pluck().get()).toBe(1);
  });
});

describe('mixedAverage (overall perceived colour, linear light)', () => {
  it('one colour is itself; black/white 50/50 is linear-light mid grey, not sRGB #808080', () => {
    expect(mixedAverage([{ color: '#F4EE2A', faces: 3 }])).toBe('#F4EE2A');
    expect(mixedAverage([{ color: '#000000', faces: 1 }, { color: '#FFFFFF', faces: 1 }])).toBe('#BCBCBC');
    expect(mixedAverage([])).toBeNull();
  });
});

describe('estimateColours (mixed-colour estimate for the preview)', () => {
  // 2x1 quad strip: 4 vertices, 2 faces sharing the edge 1-2
  const indices = new Uint32Array([0, 1, 2, 1, 3, 2]);

  it('a uniformly coloured area keeps its colour', () => {
    const out = estimateColours(indices, new Uint16Array([1, 1]), ['#F4EE2A'], 4);
    for (let i = 0; i < 6; i++) expect([...out.subarray(i * 3, i * 3 + 3)]).toEqual(linearBytes('#F4EE2A'));
  });

  it('shared vertices blend neighbouring faces in linear light', () => {
    const out = estimateColours(indices, new Uint16Array([1, 2]), ['#000000', '#FFFFFF'], 4, 1);
    // corner 1 (vertex 1, shared by both faces) = average of black and white in linear light
    expect([...out.subarray(3, 6)]).toEqual([128, 128, 128]); // linear 0.5
    // corner 0 (vertex 0, only the black face) stays black
    expect([...out.subarray(0, 3)]).toEqual([0, 0, 0]);
  });

  it('dithered fixture: the estimate is smooth and centred on the mixed average', async () => {
    const { geometry: g, colorStats } = await parse3mf(await fixture('dithered.3mf'), { geometry: true });
    const est = estimateColours(g.indices, g.faceColor, g.palette, g.positions.length / 3);
    const orig = prepareMesh({ ...g, positions: g.positions.slice(), indices: g.indices.slice(), faceColor: g.faceColor.slice() }).original;
    // per channel (R, G, B): mean and standard deviation over all corners
    const stats = (a, k) => {
      let mean = 0;
      let n = 0;
      for (let i = k; i < a.length; i += 3) (mean += a[i]), n++;
      mean /= n;
      let v = 0;
      for (let i = k; i < a.length; i += 3) v += (a[i] - mean) ** 2;
      return [mean, Math.sqrt(v / n)];
    };
    const avg = linearBytes(mixedAverage(colorStats));
    for (let k = 0; k < 3; k++) {
      const [, sdOrig] = stats(orig, k);
      const [meanEst, sdEst] = stats(est, k);
      expect(sdEst).toBeLessThan(sdOrig / 3); // dithering noise averaged out (measured ~1/4)
      expect(Math.abs(meanEst - avg[k])).toBeLessThan(2); // centred on the face-weighted mixed average
    }
  });

  it('prepareMesh computes the estimate only when asked', async () => {
    const { geometry: g } = await parse3mf(await fixture('dithered.3mf'), { geometry: true });
    const copy = () => ({ ...g, positions: g.positions.slice(), indices: g.indices.slice(), faceColor: g.faceColor.slice() });
    expect(prepareMesh(copy()).estimate).toBeNull();
    expect(prepareMesh(copy(), { estimate: true }).estimate.length).toBe(12800 * 9);
  });
});

const DIR = path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/3mf');
const LIZARD = path.join(DIR, 'FullSpectrum Lizard-U1.3mf');
describe.skipIf(!existsSync(LIZARD))('real files', () => {
  it(
    'FullSpectrum Lizard: 5 single filaments (C/M/Y/K/W), dithered -> full spectrum',
    async () => {
      const r = await parse3mf(await fs.readFile(LIZARD));
      expect(r.mixing).toEqual({ vertexMixedPct: 82.3, fullSpectrum: true });
      expect(r.colorStats.map((c) => [c.color, c.pct])).toEqual([
        ['#F4EE2A', 44.59], // "0C" = extruder 3
        ['#EC008C', 21.01], // "8"  = extruder 2
        ['#0086D6', 14.84], // "4"  = extruder 1
        ['#FFFFFF', 10.11], // "2C" = extruder 5
        ['#000000', 9.45], //  "1C" = extruder 4
      ]);
    },
    60000,
  );

  it('region-painted multi-colour files are not flagged', async () => {
    for (const [f, max] of [['chick_love_keycap-U1.3mf', 5], ['Meshy_AI_Crowned Garden Kiki.3mf', 25]]) {
      const r = await parse3mf(await fs.readFile(path.join(DIR, f)));
      expect(r.mixing.fullSpectrum, f).toBe(false);
      expect(r.mixing.vertexMixedPct, f).toBeLessThan(max);
    }
  }, 60000);
});
