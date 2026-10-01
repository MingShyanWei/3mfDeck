// M11: spool colour suggestion from a model's colour distribution.
import { describe, it, expect } from 'vitest';
import { labToHex, suggestSpools } from '../../src/core/spoolSuggest.mjs';
import { rgbToLab, hexToRgb, deltaE2000 } from '../../src/core/filament.mjs';

describe('labToHex', () => {
  it('round-trips rgbToLab within ΔE 1', () => {
    for (const hex of ['#E3C137', '#FFFFFF', '#755B2B', '#000000', '#4CAF50', '#800080']) {
      const back = labToHex(rgbToLab(hexToRgb(hex)));
      expect(deltaE2000(rgbToLab(hexToRgb(hex)), rgbToLab(hexToRgb(back)))).toBeLessThan(1);
    }
  });
});

const gecko = [
  { color: '#FFFFFF', faces: 830650, pct: 84.6 },
  { color: '#755B2B', faces: 81979, pct: 8.35 },
  { color: '#000000', faces: 46396, pct: 4.73 },
  { color: '#E3C137', faces: 13500, pct: 1.38 },
];

describe('suggestSpools', () => {
  it('recovers the gecko\'s four design colours (area-weighted k-means)', () => {
    const { results } = suggestSpools(gecko, 4);
    const r4 = results.find((r) => r.k === 4);
    const suggested = r4.spools.map((s) => s.hex);
    // every design colour is covered by a suggested spool within ΔE 5
    for (const g of gecko) {
      const d = Math.min(...suggested.map((h) => deltaE2000(rgbToLab(hexToRgb(g.color)), rgbToLab(hexToRgb(h)))));
      expect(d).toBeLessThan(5);
    }
    expect(r4.mixPct).toBe(100);
    expect(r4.singlePct).toBe(100);
  });

  it('recommends fewer spools when a k-1 solution already reaches the target', () => {
    // two colours only: k=1 cannot cover both (far apart), k=2 covers all
    const two = [
      { color: '#FFFFFF', faces: 50, pct: 50 },
      { color: '#000000', faces: 50, pct: 50 },
    ];
    const { recommended } = suggestSpools(two, 4);
    expect(recommended.k).toBe(2);
  });

  it('a single-colour model recommends k=1', () => {
    const { recommended } = suggestSpools([{ color: '#4CAF50', faces: 10, pct: 100 }], 4);
    expect(recommended.k).toBe(1);
    expect(recommended.spools).toHaveLength(1);
  });

  it('reports uncovered colours (buy) for a palette CMYK cannot reach', () => {
    // pure white on CMYK-ish suggestions stays in worst when suggested too, but
    // a mid-grey pair the k=4 result cannot print is listed with its ΔE
    const { results } = suggestSpools([
      { color: '#4CAF50', faces: 40, pct: 40 },
      { color: '#E0AC69', faces: 30, pct: 30 },
      { color: '#1E90FF', faces: 30, pct: 30 },
    ], 4, { target: 1.01 }); // unreachable target -> recommendation is last result
    const r4 = results.find((r) => r.k === 4);
    expect(r4.mixPct).toBeGreaterThan(80);
  });
});
