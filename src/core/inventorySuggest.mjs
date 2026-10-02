// M12: recommend spools FROM the user's own filament inventory.
// Greedy pick (max weighted coverage gain) + local swap refinement; coverage
// counts a face as covered when a chosen spool prints it within threshold or
// a mixable two-spool blend reaches it. Colours no inventory subset covers are
// the "buy gap", fed back through the open-ended k-means (spoolSuggest.mjs)
// as purchase suggestions.
// M29 (SPEC 3.5e): coverage (must-cover colours, unprintable share, recipe
// split usage) lives in coverage.mjs; the recommended k must print every
// must-cover colour.
import { MIX_DELTA_E } from './filament.mjs';
import { suggestSpools } from './spoolSuggest.mjs';
import { coverageOf, compareCoverage, recommend, MUST_COVER_PCT } from './coverage.mjs';

export { coverageOf };

/**
 * Best k-spool subset of the inventory for the colour distribution, by
 * weighted coverage. Greedy by marginal gain, then local swaps until stable.
 * Returns { hexes, names, singlePct, mixPct, worst }.
 */
function bestSubset(colorStats, inventory, k, threshold, mustCoverPct) {
  let chosen = [];
  let cov = null;
  const cache = new Map();
  const evalSubset = (hexes) => {
    const key = hexes.join();
    if (!cache.has(key)) cache.set(key, coverageOf(colorStats, hexes, { threshold, mustCoverPct }));
    return cache.get(key);
  };
  for (let step = 0; step < k && step < inventory.length; step++) {
    let best = null;
    for (const f of inventory) {
      if (chosen.some((c) => c.hex === f.hex)) continue;
      const next = [...chosen, f];
      const c = evalSubset(next.map((x) => x.hex));
      if (!best || compareCoverage(c, best.c) < 0) best = { f, next, c };
    }
    if (!best || (cov && compareCoverage(best.c, cov) >= 0)) break;
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
        if (compareCoverage(c, cov) < 0) {
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
export function suggestFromInventory(colorStats, inventory, maxK = 4, { threshold = MIX_DELTA_E, mustCoverPct = MUST_COVER_PCT } = {}) {
  const results = [];
  for (let k = 1; k <= Math.min(maxK, inventory.length); k++) {
    const { hexes, names, usage, ...cov } = bestSubset(colorStats, inventory, k, threshold, mustCoverPct);
    if (results.length && hexes.length < k) break; // the inventory adds nothing more
    results.push({ k, spools: usage.map((u, i) => ({ ...u, name: names[i] })), ...cov });
  }
  const recommended = recommend(results);
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
    buy = suggestSpools(gapStats, Math.min(2, gapStats.length)).recommended;
  }
  return { results, recommended, buy };
}
