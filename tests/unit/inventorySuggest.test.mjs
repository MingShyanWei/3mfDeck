// M12: inventory-based spool suggestion.
import { describe, it, expect } from 'vitest';
import { coverageOf, suggestFromInventory } from '../../src/core/inventorySuggest.mjs';
import { deltaE2000, rgbToLab, hexToRgb } from '../../src/core/filament.mjs';

const gecko = [
  { color: '#FFFFFF', faces: 830650, pct: 84.6 },
  { color: '#755B2B', faces: 81979, pct: 8.35 },
  { color: '#000000', faces: 46396, pct: 4.73 },
  { color: '#E3C137', faces: 13500, pct: 1.38 },
];
const near = (a, b) => deltaE2000(rgbToLab(hexToRgb(a)), rgbToLab(hexToRgb(b)));

describe('coverageOf', () => {
  it('full coverage when a spool matches each colour', () => {
    const c = coverageOf(gecko, ['#FFFFFF', '#755B2B', '#000000', '#E3C137']);
    expect(c.singlePct).toBe(100);
    expect(c.mixPct).toBe(100);
    expect(c.worst).toHaveLength(0);
  });
  it('reports uncovered colours with their ΔE', () => {
    const c = coverageOf([{ color: '#4CAF50', faces: 10, pct: 100 }], ['#000000']);
    expect(c.singlePct).toBe(0);
    expect(c.worst[0].color).toBe('#4CAF50');
  });
});

describe('suggestFromInventory', () => {
  const inv = [
    { name: '象牙白', hex: '#F8F8F0' },
    { name: '咖啡', hex: '#7A5B30' },
    { name: '黑', hex: '#000000' },
    { name: '芥末黃', hex: '#E8C840' },
    { name: '紅', hex: '#FF0000' },
    { name: '藍', hex: '#0000FF' },
  ];
  it('picks the four inventory filaments closest to the gecko design colours', () => {
    const { results } = suggestFromInventory(gecko, inv, 4);
    const r4 = results.find((r) => r.k === 4);
    const hexes = r4.spools.map((s) => s.hex);
    expect(hexes).toEqual(expect.arrayContaining(['#F8F8F0', '#7A5B30', '#000000', '#E8C840']));
    expect(r4.mixPct).toBe(100);
    expect(r4.singlePct).toBe(100);
    for (const g of gecko) expect(Math.min(...hexes.map((h) => near(g.color, h)))).toBeLessThan(5);
  });

  it('stops at 3 spools (98.6 %) and suggests buying the small yellow remainder', () => {
    const { recommended, buy } = suggestFromInventory(gecko, inv, 4);
    // yellow is 1.38 % of the faces: not worth a 4th slot; 3 spools already pass 95 %
    expect(recommended.k).toBe(3);
    expect(recommended.mixPct).toBeCloseTo(98.61, 1);
    expect(buy).not.toBeNull();
    const buyHexes = buy.spools.map((s) => s.hex);
    expect(Math.min(...buyHexes.map((h) => near('#E3C137', h)))).toBeLessThan(10);
  });

  it('suggests purchases for colours the inventory cannot cover', () => {
    const { recommended, buy } = suggestFromInventory(
      [{ color: '#4CAF50', faces: 50, pct: 50 }, { color: '#FF8C00', faces: 50, pct: 50 }],
      [{ name: '黑', hex: '#000000' }],
      4,
    );
    expect(recommended.spools.map((s) => s.hex)).toEqual(['#000000']);
    expect(recommended.mixPct).toBeLessThan(95);
    expect(buy).not.toBeNull();
    expect(buy.k).toBeGreaterThan(0);
  });

  it('empty inventory returns nothing (caller falls back to ideal colours)', () => {
    const r = suggestFromInventory(gecko, [], 4);
    expect(r.results).toHaveLength(0);
    expect(r.recommended).toBeUndefined();
  });
});
