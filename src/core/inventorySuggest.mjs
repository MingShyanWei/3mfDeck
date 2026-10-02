// M12: recommend spools FROM the user's own filament inventory.
// M31: every subset per k is scored (exhaustive; see bestSubset); coverage
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

/** Every k-element subset of `items`, in inventory order. */
function* subsets(items, k, start = 0, acc = []) {
  if (acc.length === k) {
    yield acc;
    return;
  }
  for (let i = start; i <= items.length - (k - acc.length); i++) yield* subsets(items, k, i + 1, [...acc, items[i]]);
}

/**
 * M31 (SPEC 3.5f): best k-spool subset of the inventory, by exhaustive search.
 * The former greedy pick (add the best single spool, stop when one more
 * spool does not help) could not see colours that only two spools TOGETHER
 * can mix — black + red + yellow prints orange, but neither red nor yellow
 * alone improves on black. An inventory is small (6 spools: 56 subsets for
 * k <= 4), so every subset is scored with compareCoverage; the first best in
 * inventory order wins ties. `cache` is shared across k.
 * Returns { hexes, names, ...coverage }.
 */
function bestSubset(colorStats, inventory, k, threshold, mustCoverPct, cache) {
  let best = null;
  for (const set of subsets(inventory, k)) {
    const key = set.map((f) => f.hex).join();
    if (!cache.has(key)) cache.set(key, coverageOf(colorStats, set.map((f) => f.hex), { threshold, mustCoverPct }));
    const cov = cache.get(key);
    if (!best || compareCoverage(cov, best.cov) < 0) best = { set, cov };
  }
  return { hexes: best.set.map((f) => f.hex), names: best.set.map((f) => f.name), ...best.cov };
}

/**
 * Inventory-based suggestion (SPEC 3.5d). Best subsets for k = 1..maxK with
 * per-k coverage, the smallest k reaching `target` recommended, and purchase
 * suggestions (ideal hexes, via k-means) for whatever the inventory cannot
 * cover at the recommended k.
 */
export function suggestFromInventory(colorStats, inventory, maxK = 4, { threshold = MIX_DELTA_E, mustCoverPct = MUST_COVER_PCT } = {}) {
  const results = [];
  const cache = new Map();
  for (let k = 1; k <= Math.min(maxK, inventory.length); k++) {
    const { names, usage, ...cov } = bestSubset(colorStats, inventory, k, threshold, mustCoverPct, cache);
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
