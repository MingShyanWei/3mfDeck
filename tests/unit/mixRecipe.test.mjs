// M8: CMYK mixing recipes for colours a single U1 slot cannot print.
// Model: Neugebauer halftone with the 4 filaments as primaries and no dot
// overlap (U1 Full Spectrum prints side-by-side single-filament faces), Yule–
// Nielsen n = 1 -> area-weighted average in linear light. Recipes are found by
// CIEDE2000 search (5 % grid + 1 % refinement).
import { describe, it, expect } from 'vitest';
import { mixColour, mixRecipe, printPlan, mapToSlots, recipeText, MIX_DELTA_E, U1_SLOTS, nearestSlot } from '../../src/core/filament.mjs';
import { mixedAverage } from '../../src/core/colorAnalysis.mjs';
import { parse3mf } from '../../src/core/parse/threemf.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FIXTURES } from './helpers.mjs';

const pct = (recipe) => Object.fromEntries(['C', 'M', 'Y', 'K'].map((n) => [n, recipe.weights.find((w) => w.name === n)?.pct ?? 0]));
const fwd = (c, m, y, k) => mixColour([c, m, y, k].map((v) => v / 100));

describe('mixColour (forward halftone model)', () => {
  it('a single slot at 100 % is that slot; the model matches the M6 estimate', () => {
    expect(fwd(0, 0, 100, 0)).toBe('#FFFF00');
    // half black, half white dots average in linear light: #BCBCBC, not sRGB mid-grey #808080
    expect(mixColour([0.5, 0.5], [{ hex: '#000000' }, { hex: '#FFFFFF' }])).toBe('#BCBCBC');
    // same linear-light average as mixedAverage (M6 overall estimate)
    expect(fwd(50, 0, 50, 0)).toBe(mixedAverage([{ color: '#00FFFF', faces: 1 }, { color: '#FFFF00', faces: 1 }]));
  });
});

describe('mixRecipe recovers known recipes (forward-generated targets)', () => {
  const cases = [
    ['green  ≈ C50 + Y50', [50, 0, 50, 0]],
    ['orange ≈ M40 + Y60', [0, 40, 60, 0]],
    ['purple ≈ C50 + M50', [50, 50, 0, 0]],
    ['skin   ≈ M25 + Y60 + K15', [0, 25, 60, 15]],
  ];
  for (const [label, w] of cases) {
    it(label, () => {
      const r = mixRecipe(fwd(...w));
      const got = pct(r);
      ['C', 'M', 'Y', 'K'].forEach((n, i) => expect(Math.abs(got[n] - w[i]), `${n}`).toBeLessThanOrEqual(2));
      expect(r.deltaE).toBeLessThan(0.5);
    });
  }
});

describe('real colours: recipe direction, residual, verdict', () => {
  it('green #4CAF50: cyan + yellow (+ black), no magenta, mixable', () => {
    const p = printPlan('#4CAF50');
    expect(p.mode).toBe('mix');
    const r = pct(p.recipe);
    expect(r.C).toBeGreaterThan(0);
    expect(r.Y).toBeGreaterThan(0);
    expect(r.M).toBe(0);
    expect(p.mixable).toBe(true);
    expect(p.recipe.deltaE).toBeLessThan(p.nearest.deltaE);
  });

  it('purple #800080: magenta + black, almost exact', () => {
    const p = printPlan('#800080');
    expect(pct(p.recipe)).toMatchObject({ C: 0, Y: 0 });
    expect(p.recipe.deltaE).toBeLessThan(1);
    expect(recipeText(p.recipe)).toMatch(/^K \d+%＋M \d+%$/);
  });

  it('skin #E0AC69: magenta + yellow (+ black), no cyan, mixable', () => {
    const p = printPlan('#E0AC69');
    const r = pct(p.recipe);
    expect([r.C, r.M > 0, r.Y > r.M]).toEqual([0, true, true]);
    expect(p.mixable).toBe(true);
  });

  it('saturated orange #FF8C00: magenta + yellow, but halftone CMYK cannot reach it -> buy the filament', () => {
    const p = printPlan('#FF8C00');
    const r = pct(p.recipe);
    expect([r.C, r.M > 0, r.Y > r.M]).toEqual([0, true, true]);
    expect(p.recipe.deltaE).toBeGreaterThan(MIX_DELTA_E);
    expect(p.mixable).toBe(false);
  });

  it('the best mix is never worse than the nearest single slot', () => {
    for (const hex of ['#4CAF50', '#2E8B57', '#FF8C00', '#800080', '#8E44AD', '#E0AC69', '#F1C27D', '#8D5524', '#1E90FF', '#E0457B', '#777777']) {
      expect(mixRecipe(hex).deltaE).toBeLessThanOrEqual(Math.round(nearestSlot(hex).deltaE * 10) / 10);
    }
  });
});

describe('printPlan threshold (MIX_DELTA_E = 15, adjustable)', () => {
  it('within 15 -> single slot; beyond -> mix; threshold is a parameter', () => {
    expect(MIX_DELTA_E).toBe(15);
    expect(printPlan('#FFD700')).toMatchObject({ mode: 'single', previewHex: '#FFFF00', nearest: { name: 'Y', deltaE: 11.6 } });
    expect(printPlan('#1E90FF').mode).toBe('mix');
    expect(printPlan('#1E90FF', U1_SLOTS, 50).mode).toBe('single');
    expect(printPlan('#00FFFF')).toMatchObject({ mode: 'single', nearest: { deltaE: 0 } });
  });
});

describe('mapToSlots with mixes', () => {
  it('mixed colours count towards each slot by their recipe share', () => {
    const { mapping, used } = mapToSlots([
      { color: fwd(50, 0, 50, 0), faces: 100, pct: 50 },
      { color: '#FF00FF', faces: 100, pct: 50 },
    ]);
    expect(mapping.map((m) => m.mode)).toEqual(['mix', 'single']);
    expect(used.map((u) => [u.name, u.faces, u.pct])).toEqual([
      ['C', 50, 25],
      ['M', 100, 50],
      ['Y', 50, 25],
    ]);
  });

  it('CMYK-exact files (painted.3mf colours) stay single-slot', () => {
    const { mapping } = mapToSlots(['#00FFFF', '#FF00FF', '#FFFF00', '#000000'].map((color) => ({ color, faces: 1, pct: 25 })));
    expect(mapping.every((m) => m.mode === 'single')).toBe(true);
  });

  it('is fast enough for a 16-colour file', () => {
    const t = performance.now();
    for (let i = 0; i < 16; i++) mixRecipe('#' + ((i * 0x0f1f2f + 0x203040) & 0xffffff).toString(16).padStart(6, '0'));
    expect(performance.now() - t).toBeLessThan(1000);
  });
});

describe('mixneeded.3mf fixture', () => {
  it('every colour needs mixing; the saturated orange cannot be mixed', async () => {
    const { colorStats, mixing } = await parse3mf(await fs.readFile(path.join(FIXTURES, 'mixneeded.3mf')));
    expect(mixing.fullSpectrum).toBe(false); // not dithered: M8 rules apply
    const { mapping } = mapToSlots(colorStats);
    expect(Object.fromEntries(mapping.map((m) => [m.color, [m.mode, m.mixable]]))).toEqual({
      '#4CAF50': ['mix', true],
      '#FF8C00': ['mix', false],
      '#800080': ['mix', true],
      '#E0AC69': ['mix', true],
    });
  });
});
