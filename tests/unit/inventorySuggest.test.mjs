// M12: inventory-based spool suggestion.
import { describe, it, expect } from 'vitest';
import { coverageOf, suggestFromInventory } from '../../src/core/inventorySuggest.mjs';
import { deltaE2000, rgbToLab, hexToRgb, printPlan, slotsFromColours } from '../../src/core/filament.mjs';

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

  it('M29: does not stop at 3 spools (98.6 %) while the 1.38 % yellow cannot print; 4 print everything', () => {
    const { results, recommended, buy } = suggestFromInventory(gecko, inv, 4);
    const r3 = results.find((r) => r.k === 3);
    expect(r3.mixPct).toBeCloseTo(98.62, 1);
    expect(r3.complete).toBe(false);
    expect(r3.uncovered.map((u) => u.color)).toEqual(['#E3C137']);
    expect(r3.unprintablePct).toBeCloseTo(1.38, 1);
    expect(recommended.k).toBe(4);
    expect(recommended.complete).toBe(true);
    expect(recommended.unprintablePct).toBe(0);
    expect(buy).toBeNull();
  });

  it('M29: when no k prints everything, the largest is recommended as incomplete and the gap is bought', () => {
    const { recommended, buy } = suggestFromInventory(gecko, inv.filter((f) => f.hex !== '#E8C840'), 4);
    expect(recommended.complete).toBe(false);
    expect(recommended.uncovered.map((u) => u.color)).toEqual(['#E3C137']);
    expect(buy).not.toBeNull();
    expect(Math.min(...buy.spools.map((s) => near('#E3C137', s.hex)))).toBeLessThan(10);
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
    expect(r.recommended).toBeNull();
  });
});

describe('M31 (SPEC 3.5f): exhaustive subsets find colours only two spools together can mix', () => {
  // black 92.76 % + orange 7.24 %; the user's real inventory
  const model = [{ color: '#000000', faces: 9276, pct: 92.76 }, { color: '#F98C36', faces: 724, pct: 7.24 }];
  const inv = [
    { name: 'C', hex: '#0086D6' }, { name: 'M', hex: '#EC008C' }, { name: 'K', hex: '#000000' },
    { name: 'R', hex: '#FF0000' }, { name: 'W', hex: '#FFFFFF' }, { name: 'Y', hex: '#F5EC00' },
  ];
  const r = suggestFromInventory(model, inv, 4);

  it('recommends k=3, everything printable, nothing to buy (the greedy search stopped at k=1 and suggested buying orange)', () => {
    expect(r.recommended.k).toBe(3);
    expect(r.recommended.complete).toBe(true);
    expect(r.recommended.unprintablePct).toBe(0);
    expect(r.recommended.mixPct).toBe(100);
    expect(r.buy).toBeNull();
  });

  it('the recommended spools really print orange as a mix and black as a single spool', () => {
    const slots = slotsFromColours(r.recommended.spools.map((s) => s.hex));
    expect(r.recommended.spools.map((s) => s.hex)).toEqual(expect.arrayContaining(['#000000', '#F5EC00']));
    const orange = printPlan('#F98C36', slots);
    expect([orange.mode, orange.mixable]).toEqual(['mix', true]);
    expect(printPlan('#000000', slots).mode).toBe('single');
  });

  it('every k is reported (no early stop), each the best subset of that size', () => {
    expect(r.results.map((x) => x.k)).toEqual([1, 2, 3, 4]);
    expect(r.results[0].spools.map((s) => s.hex)).toEqual(['#000000']);
    expect(r.results[0].complete).toBe(false); // orange needs two spools
  });

  it('equally complete sets are decided by accuracy: magenta + yellow mixes this orange closer than red + yellow', () => {
    // pigment model (what the export writes): M34 + Y66 -> ΔE 0.6; R27 + Y73 -> ΔE 2.1
    const kmy = printPlan('#F98C36', slotsFromColours(['#EC008C', '#000000', '#F5EC00'])).recipe.deltaE;
    const kry = printPlan('#F98C36', slotsFromColours(['#000000', '#FF0000', '#F5EC00'])).recipe.deltaE;
    expect(kmy).toBeLessThan(kry);
    expect(r.recommended.spools.map((s) => s.hex)).toEqual(['#EC008C', '#000000', '#F5EC00']);
    expect(r.recommended.meanDeltaE).toBeLessThan(coverageOf(model, ['#000000', '#FF0000', '#F5EC00']).meanDeltaE);
  });

  it('a colour the inventory can mix is never in the purchase suggestion', () => {
    const noYellow = suggestFromInventory(model, inv.filter((f) => f.hex !== '#F5EC00'), 4);
    // without yellow orange cannot be mixed -> it is the gap to buy
    expect(noYellow.recommended.complete).toBe(false);
    expect(noYellow.recommended.uncovered.map((u) => u.color)).toEqual(['#F98C36']);
    expect(noYellow.buy).not.toBeNull();
  });
});
