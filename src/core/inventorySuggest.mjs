// M12: recommend spools FROM the user's own filament inventory.
// Greedy pick (max weighted coverage gain) + local swap refinement; coverage
// counts a face as covered when a chosen spool prints it within threshold or
// a mixable two-spool blend reaches it. Colours no inventory subset covers are
// the "buy gap", fed back through the open-ended k-means (spoolSuggest.mjs)
// as purchase suggestions.
import { nearestSlot, hexToRgb, rgbToLab, deltaE2000, slotsFromColours, MIX_DELTA_E } from './filament.mjs';
import { mixPrintPlan } from './mixExport.mjs';
import { suggestSpools } from './spoolSuggest.mjs';

/**
 * Coverage of `colorStats` by a set of spool hexes: { singlePct, mixPct,
 * worst: [{color, faces, deltaE, mode}] } (faces-then-percent rounded to 2 dp).
 * `maxColours`: mix search (expensive) runs only for the top colours by
 * face count; the remainder is judged by nearest single spool only — exact
 * for the dominant colours, approximate for dithered noise.
 */
export function coverageOf(colorStats, hexes, { threshold = MIX_DELTA_E, maxColours = Infinity } = {}) {
  const total = colorStats.reduce((t, c) => t + c.faces, 0) || 1;
  const slots = slotsFromColours(hexes);
  let deep = colorStats;
  let shallow = [];
  if (colorStats.length > maxColours) {
    const sorted = [...colorStats].sort((a, b) => b.faces - a.faces);
    deep = sorted.slice(0, maxColours);
    shallow = sorted.slice(maxColours);
  }
  let single = 0;
  let mix = 0;
  const worst = [];
  const evalColour = (c, canMix) => {
    const near = nearestSlot(c.color, slots);
    if (near.deltaE <= threshold) {
      single += c.faces;
      mix += c.faces;
      return;
    }
    const plan = canMix && slots.length >= 2 ? mixPrintPlan(c.color, slots, threshold) : null;
    if (plan?.mode === 'mix' && plan.mixable) {
      mix += c.faces;
    } else {
      worst.push({ color: c.color, faces: c.faces, deltaE: Math.round(near.deltaE * 10) / 10 });
    }
  };
  for (const c of deep) evalColour(c, true);
  for (const c of shallow) evalColour(c, false);
  const pct = (v) => Math.round((v / total) * 10000) / 100;
  worst.sort((a, b) => b.faces - a.faces);
  worst.length = Math.min(worst.length, 20);
  return { singlePct: pct(single), mixPct: pct(mix), worst };
}

/**
 * Best k-spool subset of the inventory for the colour distribution, by
 * weighted coverage. Greedy by marginal gain, then local swaps until stable.
 * Returns { hexes, names, singlePct, mixPct, worst }.
 */
function bestSubset(colorStats, inventory, k, threshold) {
  let chosen = [];
  let cov = { singlePct: 0, mixPct: 0, worst: [] };
  const cache = new Map();
  const evalSubset = (hexes) => {
    const key = [...hexes].sort().join();
    if (!cache.has(key)) cache.set(key, coverageOf(colorStats, hexes, { threshold }));
    return cache.get(key);
  };
  for (let step = 0; step < k && step < inventory.length; step++) {
    let best = null;
    for (const f of inventory) {
      if (chosen.some((c) => c.hex === f.hex)) continue;
      const next = [...chosen, f];
      const c = evalSubset(next.map((x) => x.hex));
      if (!best || c.mixPct > best.c.mixPct || (c.mixPct === best.c.mixPct && c.singlePct > best.c.singlePct)) {
        best = { f, next, c };
      }
    }
    if (!best || best.c.mixPct <= cov.mixPct + 1e-9 && best.c.singlePct <= cov.singlePct + 1e-9 && chosen.length) break;
    chosen = best.next;
    cov = best.c;
  }
  // local swap refinement: replace one chosen with one outside if coverage improves
  let improved = true;
  let passes = 0;
  while (improved && passes++ < 4) {
    improved = false;
    for (let i = 0; i < chosen.length; i++) {
      for (const f of inventory) {
        if (chosen.some((c) => c.hex === f.hex)) continue;
        const cand = chosen.map((c, j) => (j === i ? f : c));
        const c = evalSubset(cand.map((x) => x.hex));
        if (c.mixPct > cov.mixPct + 1e-9 || (c.mixPct === cov.mixPct && c.singlePct > cov.singlePct + 1e-9)) {
          chosen = cand;
          cov = c;
          improved = true;
        }
      }
    }
  }
  return { hexes: chosen.map((c) => c.hex), names: chosen.map((c) => c.name), ...cov };
}

/**
 * Inventory-based suggestion (SPEC 3.5d). Greedy subsets for k = 1..maxK with
 * per-k coverage, the smallest k reaching `target` recommended, and purchase
 * suggestions (ideal hexes, via k-means) for whatever the inventory cannot
 * cover at the recommended k.
 */
export function suggestFromInventory(colorStats, inventory, maxK = 4, { threshold = MIX_DELTA_E, target = 0.95 } = {}) {
  const results = [];
  for (let k = 1; k <= Math.min(maxK, inventory.length); k++) {
    const r = bestSubset(colorStats, inventory, k, threshold);
    results.push({ k, spools: r.hexes.map((h, i) => ({ hex: h, name: r.names[i], ...{ faces: 0, pct: 0 } })), singlePct: r.singlePct, mixPct: r.mixPct, worst: r.worst });
  }
  const recommended = results.find((r) => r.mixPct >= target * 100) || results[results.length - 1];
  // buy suggestions for the uncovered colours at the recommended k
  const uncovered = recommended?.worst || [];
  let buy = null;
  if (uncovered.length) {
    const gapStats = uncovered.map((w) => {
      const orig = colorStats.find((c) => c.color === w.color);
      return { color: w.color, faces: orig?.faces ?? w.faces, pct: 0 };
    });
    const total = colorStats.reduce((t, c) => t + c.faces, 0) || 1;
    for (const g of gapStats) g.pct = Math.round((g.faces / total) * 10000) / 100;
    buy = suggestSpools(gapStats, Math.min(2, gapStats.length), { target: 1.01 }).recommended;
  }
  return { results, recommended, buy };
}
