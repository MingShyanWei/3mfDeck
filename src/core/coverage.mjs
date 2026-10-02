// M29 (SPEC 3.5e): honest coverage numbers for a set of spools. Shared by the
// ideal-colour suggestion, the standard presets, the inventory pick and the
// "current spools" baseline, so every place reports the same thing:
// - which colours print (single spool within threshold, or a mixable
//   two-spool pigment blend) and which do not, with the unprintable share
//   stated next to the printable one;
// - "must cover" colours: every colour holding at least MUST_COVER_PCT of the
//   area, however small next to the main colour — a 0.19 % eye still has to
//   print;
// - per-spool usage split by the mix recipe (97.47 % at Y68 + M32 -> Y 66.3 %,
//   M 31.2 %), not all given to the nearest slot. A colour that cannot be
//   printed counts towards its nearest spool: that is what the export prints
//   when the filament is not bought.
import { nearestSlot, slotsFromColours, MIX_DELTA_E } from './filament.mjs';
import { mixPrintPlan } from './mixExport.mjs';

/** A colour covering at least this share (%) of the area must be printable before a spool set is recommended. */
export const MUST_COVER_PCT = 0.1;

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Coverage of `colorStats` ([{color, faces}]) by spool `hexes`:
 * { singlePct, mixPct, unprintablePct, worst, uncovered, complete, usage }
 * - worst: unprintable colours, largest first (top 20) [{color, faces, pct, deltaE, nearest}]
 * - uncovered: every unprintable colour at or above `mustCoverPct` (not truncated)
 * - complete: no must-cover colour is unprintable
 * - usage: per spool [{slot, hex, faces, pct}] (recipe split, unprintable -> nearest)
 * `maxColours`: the mix search (expensive) runs for must-cover colours and the
 * top colours by area; the rest is judged by nearest single spool only.
 */
export function coverageOf(colorStats, hexes, { threshold = MIX_DELTA_E, maxColours = Infinity, mustCoverPct = MUST_COVER_PCT } = {}) {
  const total = colorStats.reduce((t, c) => t + c.faces, 0) || 1;
  const pctOf = (faces) => (faces / total) * 100;
  const slots = slotsFromColours(hexes);
  const byArea = [...colorStats].sort((a, b) => b.faces - a.faces);
  const deep = new Set(byArea.filter((c, i) => i < maxColours || pctOf(c.faces) >= mustCoverPct).map((c) => c.color));
  const used = new Map(slots.map((s) => [s.slot, 0]));
  let single = 0;
  let mix = 0;
  let errSum = 0; // M31: area-weighted ΔE of how each colour is printed (nearest spool when unprintable)
  const unprintable = [];
  for (const c of colorStats) {
    const near = nearestSlot(c.color, slots);
    if (near.deltaE <= threshold) {
      single += c.faces;
      errSum += near.deltaE * c.faces;
      used.set(near.slot, used.get(near.slot) + c.faces);
      continue;
    }
    const plan = deep.has(c.color) && slots.length >= 2 ? mixPrintPlan(c.color, slots, threshold) : null;
    if (plan?.mode === 'mix' && plan.mixable) {
      mix += c.faces;
      errSum += plan.mix.deltaE * c.faces;
      used.set(plan.mix.compA, used.get(plan.mix.compA) + (c.faces * (100 - plan.mix.mixB)) / 100);
      used.set(plan.mix.compB, used.get(plan.mix.compB) + (c.faces * plan.mix.mixB) / 100);
    } else {
      errSum += near.deltaE * c.faces;
      used.set(near.slot, used.get(near.slot) + c.faces);
      unprintable.push({ color: c.color, faces: c.faces, pct: round2(pctOf(c.faces)), deltaE: Math.round(near.deltaE * 10) / 10, nearest: near.slot });
    }
  }
  unprintable.sort((a, b) => b.faces - a.faces);
  const uncovered = unprintable.filter((u) => pctOf(u.faces) >= mustCoverPct);
  const badFaces = unprintable.reduce((t, u) => t + u.faces, 0);
  return {
    singlePct: round2(pctOf(single)),
    mixPct: round2(pctOf(single + mix)),
    unprintablePct: round2(pctOf(badFaces)),
    meanDeltaE: Math.round((errSum / total) * 100) / 100,
    worst: unprintable.slice(0, 20),
    uncovered,
    complete: uncovered.length === 0,
    usage: slots.map((s) => ({ slot: s.slot, hex: s.hex, faces: Math.round(used.get(s.slot)), pct: round2(pctOf(used.get(s.slot))) })),
  };
}

/**
 * Order two coverages: fewer must-cover colours left out, then less
 * unprintable area, then more single-spool area, then (M31) the closer
 * colours — lower area-weighted ΔE — so a tie between equally complete
 * spool sets is decided by accuracy, not by list order.
 */
export function compareCoverage(a, b) {
  return a.uncovered.length - b.uncovered.length || a.unprintablePct - b.unprintablePct || b.singlePct - a.singlePct || a.meanDeltaE - b.meanDeltaE;
}

/**
 * The recommended entry of per-k results ([{k, complete, ...}]): the smallest k
 * that prints every must-cover colour. When no k does, the largest k, marked
 * incomplete — its unprintable colours must be shown, never a bare coverage %.
 */
export function recommend(results) {
  const ok = results.find((r) => r.complete);
  return ok ? { ...ok, complete: true } : results.length ? { ...results[results.length - 1], complete: false } : null;
}
