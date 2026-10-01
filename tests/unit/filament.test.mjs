import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { deltaE2000, rgbToLab, nearestSlot, mapToSlots, U1_SLOTS } from '../../src/core/filament.mjs';
import { parse3mf } from '../../src/core/parse/threemf.mjs';
import { FIXTURES } from './helpers.mjs';

describe('deltaE2000', () => {
  // Reference pairs from Sharma, Wu & Dalal (2005) CIEDE2000 test data
  const pairs = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  ];
  for (const [a, b, want] of pairs) {
    it(`${a} vs ${b} = ${want}`, () => {
      expect(deltaE2000(a, b)).toBeCloseTo(want, 3);
      expect(deltaE2000(b, a)).toBeCloseTo(want, 3); // symmetric
    });
  }

  it('sRGB -> Lab anchors', () => {
    const close = (got, want) => want.forEach((w, i) => expect(got[i]).toBeCloseTo(w, 2));
    close(rgbToLab([255, 255, 255]), [100, 0, 0]);
    close(rgbToLab([0, 0, 0]), [0, 0, 0]);
    close(rgbToLab([255, 0, 0]), [53.24, 80.09, 67.2]);
  });
});

describe('nearestSlot (U1 CMYK)', () => {
  it('maps each slot colour to itself with deltaE 0', () => {
    for (const s of U1_SLOTS) {
      const r = nearestSlot(s.hex);
      expect(r.slot).toBe(s.slot);
      expect(r.deltaE).toBeCloseTo(0, 6);
    }
  });

  it('maps off-palette colours to the perceptually nearest slot', () => {
    expect(nearestSlot('#1E90FF').name).toBe('C'); // dodger blue
    expect(nearestSlot('#E0457B').name).toBe('M'); // raspberry pink
    expect(nearestSlot('#FFD700').name).toBe('Y'); // gold
    expect(nearestSlot('#333333').name).toBe('K'); // dark grey
    expect(nearestSlot('#00CCCC').name).toBe('C');
  });
});

describe('mapToSlots', () => {
  it('ground truth painted.3mf (already CMYK): uses all 4 spools, identity mapping', async () => {
    const { colorStats } = await parse3mf(await fs.readFile(path.join(FIXTURES, 'painted.3mf')));
    const r = mapToSlots(colorStats);
    expect(r.mapping.map((m) => [m.color, m.slot, m.deltaE])).toEqual([
      ['#00FFFF', 1, 0],
      ['#FF00FF', 2, 0],
      ['#FFFF00', 3, 0],
      ['#000000', 4, 0],
    ]);
    expect(r.used.map((u) => [u.name, u.faces, u.pct])).toEqual([
      ['C', 6, 50],
      ['M', 3, 25],
      ['Y', 2, 16.67],
      ['K', 1, 8.33],
    ]);
  });

  it('offpalette.3mf: off-palette colours quantize onto the 4 spools', async () => {
    const { colorStats } = await parse3mf(await fs.readFile(path.join(FIXTURES, 'offpalette.3mf')));
    const r = mapToSlots(colorStats);
    expect(r.mapping.map((m) => [m.color, m.slot])).toEqual([
      ['#1E90FF', 1],
      ['#E0457B', 2],
      ['#FFD700', 3],
      ['#333333', 4],
    ]);
    expect(r.mapping.every((m) => m.deltaE > 0)).toBe(true);
  });

  it('merges several colours that land on the same spool', () => {
    const r = mapToSlots([
      { color: '#00FFFF', faces: 40, pct: 40 },
      { color: '#00E5E5', faces: 35, pct: 35 },
      { color: '#000000', faces: 25, pct: 25 },
    ]);
    expect(r.used.map((u) => [u.name, u.faces, u.pct])).toEqual([
      ['C', 75, 75],
      ['K', 25, 25],
    ]);
  });
});

describe('parse3mf geometry (preview data)', () => {
  it('painted.3mf: world-space mm positions, indices and per-face filament state', async () => {
    const { geometry: g } = await parse3mf(await fs.readFile(path.join(FIXTURES, 'painted.3mf')), { geometry: true });
    expect(g.positions.length).toBe(8 * 3);
    expect(g.indices.length).toBe(12 * 3);
    // build item: scale 2, translate (100, 100, 0)
    const xs = [...g.positions].filter((_, i) => i % 3 === 0);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([100, 120]);
    // unpainted face -> part extruder 4; split faces -> dominant (tie -> lower state)
    expect([...g.faceState]).toEqual([1, 1, 1, 1, 2, 2, 3, 4, 3, 1, 1, 1]);
    expect(g.colours).toEqual(['#00FFFF', '#FF00FF', '#FFFF00', '#000000']);
  });

  it('is omitted unless requested, and colours are null without slicer config', async () => {
    expect((await parse3mf(await fs.readFile(path.join(FIXTURES, 'painted.3mf')))).geometry).toBeUndefined();
    const { geometry: g } = await parse3mf(await fs.readFile(path.join(FIXTURES, 'plain.3mf')), { geometry: true });
    expect(g.colours).toBeNull();
    expect(g.faceState.length).toBe(12);
    expect(Math.max(...g.positions)).toBe(30); // cm -> mm
  });
});
