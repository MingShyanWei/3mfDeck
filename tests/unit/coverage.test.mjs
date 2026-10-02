// M29 (SPEC 3.5e): honest spool / colour numbers. The distribution below is
// reindeer_ams-U1.3mf's (the user's acceptance sample; only its colour table).
import { describe, it, expect } from 'vitest';
import { coverageOf, recommend, MUST_COVER_PCT } from '../../src/core/coverage.mjs';
import { suggestSpools } from '../../src/core/spoolSuggest.mjs';
import { mapToSlots, U1_SLOTS, nearestSlot, slotsFromColours, MIX_DELTA_E } from '../../src/core/filament.mjs';
import { analyzeColors } from '../../src/core/colorAnalysis.mjs';

const reindeer = [
  { color: '#B5865B', faces: 888151, pct: 97.47 },
  { color: '#6F5034', faces: 19203, pct: 2.11 },
  { color: '#FF0000', faces: 2116, pct: 0.23 },
  { color: '#000000', faces: 1764, pct: 0.19 },
];
const CMYK = U1_SLOTS.map((s) => s.hex);

describe('suggestSpools: recommend only a k that prints every colour (fix 1, 2)', () => {
  const { results, recommended } = suggestSpools(reindeer, 4);

  it('k=1 covers 97.47 % of the area but leaves 3 colours unprintable -> not recommended', () => {
    const k1 = results.find((r) => r.k === 1);
    expect(k1.mixPct).toBeCloseTo(97.47, 1);
    expect(k1.complete).toBe(false);
    expect(k1.uncovered.map((u) => u.color).sort()).toEqual(['#000000', '#6F5034', '#FF0000']);
    expect(k1.unprintablePct).toBeCloseTo(2.53, 1);
  });

  it('the recommendation prints every colour; never "k=1 with 3 colours unprintable"', () => {
    expect(recommended.complete).toBe(true);
    expect(recommended.k).toBeGreaterThan(1);
    expect(recommended.uncovered).toEqual([]);
    expect(recommended.unprintablePct).toBe(0);
    // every colour really prints on the recommended spools
    const slots = slotsFromColours(recommended.spools.map((s) => s.hex));
    for (const c of reindeer) expect([c.color, nearestSlot(c.color, slots).deltaE <= MIX_DELTA_E || recommended.mixPct === 100]).toEqual([c.color, true]);
  });

  it('small colours are not averaged away: the 0.19 % black and 0.23 % red each get a spool by k=3', () => {
    const k3 = results.find((r) => r.k === 3);
    expect(k3.complete).toBe(true);
    const slots = slotsFromColours(k3.spools.map((s) => s.hex));
    expect(nearestSlot('#000000', slots).deltaE).toBeLessThan(5);
    expect(nearestSlot('#FF0000', slots).deltaE).toBeLessThan(5);
  });

  it('spool shares are usage and add up to 100 %', () => {
    for (const r of results) expect(r.spools.reduce((t, s) => t + s.pct, 0)).toBeCloseTo(100, 0);
  });
});

describe('coverageOf on CMYK (fix 3, 4)', () => {
  const c = coverageOf(reindeer, CMYK);

  it('states the unprintable share next to the printable one: 97.66 % / 2.34 %', () => {
    expect(c.mixPct).toBe(97.66);
    expect(c.unprintablePct).toBe(2.34);
    expect(c.uncovered.map((u) => u.color)).toEqual(['#6F5034', '#FF0000']);
  });

  it('splits the main colour by its recipe (Y68 + M32 of 97.47 %) instead of giving it all to one slot', () => {
    const by = Object.fromEntries(c.usage.map((u) => [u.hex, u.pct]));
    expect(by['#FFFF00']).toBeCloseTo(66.28, 1); // Y
    expect(by['#FF00FF']).toBeCloseTo(31.42, 1); // M: 31.19 from the main colour + the unprintable red on its nearest slot
    expect(by['#000000']).toBeCloseTo(2.3, 1); // K: black + the unprintable dark brown on its nearest slot
    expect(c.usage.reduce((t, u) => t + u.pct, 0)).toBeCloseTo(100, 1);
  });
});

describe('must-cover threshold (fix 2)', () => {
  const stats = (pct) => [
    { color: '#000000', faces: 10000 - pct * 100, pct: 100 - pct },
    { color: '#4CAF50', faces: pct * 100, pct }, // green: neither single nor mixable on black + white
  ];
  it(`a colour of >= ${MUST_COVER_PCT} % blocks the recommendation; below it is listed but does not`, () => {
    expect(coverageOf(stats(0.1), ['#000000', '#FFFFFF']).complete).toBe(false);
    const tiny = coverageOf(stats(0.05), ['#000000', '#FFFFFF']);
    expect(tiny.complete).toBe(true);
    expect(tiny.worst.map((w) => w.color)).toEqual(['#4CAF50']);
    expect(tiny.unprintablePct).toBe(0.05);
  });
  it('recommend: smallest complete k, else the largest marked incomplete', () => {
    expect(recommend([{ k: 1, complete: false }, { k: 2, complete: true }, { k: 3, complete: true }])).toMatchObject({ k: 2, complete: true });
    expect(recommend([{ k: 1, complete: false }, { k: 2, complete: false }])).toMatchObject({ k: 2, complete: false });
    expect(recommend([])).toBeNull();
  });
});

describe('mapToSlots and analyzeColors (fix 3, 5)', () => {
  it('an unmixable colour counts on its nearest slot (what the export prints), and the unprintable share is given', () => {
    const m = mapToSlots(reindeer, U1_SLOTS);
    const by = Object.fromEntries(m.used.map((u) => [u.name, u.pct]));
    expect(by).toEqual({ M: 31.42, Y: 66.28, K: 2.3 });
    expect([m.printablePct, m.unprintablePct]).toEqual([97.66, 2.34]);
  });
  it('reindeer gets no "no mixing needed" hint', () => {
    expect(analyzeColors(reindeer).map((w) => w.type)).toEqual([]);
  });
});
