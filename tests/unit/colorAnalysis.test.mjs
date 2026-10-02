import { slotsFromColours } from '../../src/core/filament.mjs';
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { analyzeColors, ditherPairs, DITHER } from '../../src/core/colorAnalysis.mjs';
import { parse3mf } from '../../src/core/parse/threemf.mjs';
import { FIXTURES } from './helpers.mjs';

const stats = async (f) => (await parse3mf(await fs.readFile(path.join(FIXTURES, f)))).colorStats;
const types = (w) => w.map((x) => x.type);

describe('ditherPairs', () => {
  it('flags two near-identical colours sharing a large area (dither.3mf: 33.33% + 25%)', async () => {
    const pairs = ditherPairs(await stats('dither.3mf'));
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ colors: ['#FFD000', '#FFDC20'], pcts: [33.33, 25], combined: 58.33 });
    expect(pairs[0].deltaE).toBeLessThanOrEqual(DITHER.maxDeltaE);
  });

  it('a 42% / 35% split between near-identical values is flagged', () => {
    const pairs = ditherPairs([
      { color: '#E8C547', faces: 420, pct: 42 },
      { color: '#EFCB4E', faces: 350, pct: 35 },
      { color: '#000000', faces: 230, pct: 23 },
    ]);
    expect(pairs.map((p) => [p.colors, p.combined])).toEqual([[['#E8C547', '#EFCB4E'], 77]]);
  });

  it('ignores distinct colours even when both are large (C/M 42% / 35%)', () => {
    expect(ditherPairs([{ color: '#00FFFF', faces: 42, pct: 42 }, { color: '#FF00FF', faces: 35, pct: 35 }])).toEqual([]);
  });

  it('ignores close colours when one share is tiny or the pair is small', () => {
    expect(ditherPairs([{ color: '#FFD000', pct: 60 }, { color: '#FFDC20', pct: 5 }])).toEqual([]); // < minEach
    expect(ditherPairs([{ color: '#FFD000', pct: 15 }, { color: '#FFDC20', pct: 15 }, { color: '#000000', pct: 70 }])).toEqual([]); // < minCombined
  });
});

describe('analyzeColors', () => {
  it('painted.3mf (4 colours): only the "no mixing needed" hint', async () => {
    const w = analyzeColors(await stats('painted.3mf'));
    expect(types(w)).toEqual(['few-colors']);
    expect(w[0].message).toBe('每個顏色都能在 ΔE ≤ 15 內對應到某個耗材槽，不需混色，量化成實色平塗最乾淨');
  });

  it('dither.3mf (6 colours): dither pair + Full Spectrum warning', async () => {
    const w = analyzeColors(await stats('dither.3mf'));
    expect(types(w)).toEqual(['dither', 'needs-mixing']);
    expect(w[0].message).toMatch(/^疑似抖色配對：#FFD000（33.33%）與 #FFDC20（25%）/);
    expect(w[1].message).toBe('超過 4 色，需 Full Spectrum 混色');
  });

  it('M29: "no mixing needed" only when every colour is near a slot, not merely <= 4 colours', () => {
    const of = (hexes) => hexes.map((color) => ({ color, faces: 1, pct: 100 / hexes.length }));
    expect(types(analyzeColors(of(['#000000'])))).toEqual(['few-colors']);
    expect(types(analyzeColors(of(['#00FFFF', '#FF00FF', '#FFFF00', '#000000'])))).toEqual(['few-colors']);
    // 2 colours, white is far from every CMYK slot: no "no mixing needed" (the table summary covers it)
    expect(types(analyzeColors(of(['#000000', '#FFFFFF'])))).toEqual([]);
    // reindeer (4 colours, 3 of them far from CMYK): never the contradicting hint
    expect(types(analyzeColors(of(['#B5865B', '#6F5034', '#FF0000', '#000000'])))).toEqual([]);
    // more colours than slots and not all near -> needs mixing
    expect(types(analyzeColors(of(['#000000', '#FFFFFF', '#00FFFF', '#FF00FF', '#FFFF00'])))).toEqual(['needs-mixing']);
    // 6 colours all within ΔE 15 of CMYK: no mixing needed even though > 4
    expect(types(analyzeColors(of(['#00FFFF', '#00F0F0', '#FF00FF', '#F000F0', '#FFFF00', '#000000'])))).toEqual(['few-colors']);
  });

  it('judges against the given spools', () => {
    const two = [{ color: '#000000', faces: 1, pct: 50 }, { color: '#FFFFFF', faces: 1, pct: 50 }];
    expect(types(analyzeColors(two, slotsFromColours(['#000000'])))).toEqual(['needs-mixing']);
    expect(types(analyzeColors(two, slotsFromColours(['#000000', '#FFFFFF'])))).toEqual(['few-colors']);
  });
});
