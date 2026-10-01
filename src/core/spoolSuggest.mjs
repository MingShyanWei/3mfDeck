// M11 (SPEC 3.5d): spool colour suggestion from a model's colour distribution.
// Area-weighted k-means in CIE L*a*b* finds the k spool colours that best
// cover the model's faces; coverage is judged with the printing pipeline
// (single spool within MIX_DELTA_E, or a mixable two-spool blend), and the
// smallest k meeting the target is recommended.
import { rgbToLab, hexToRgb, nearestSlot, deltaE2000, MIX_DELTA_E, slotsFromColours } from './filament.mjs';
import { mixPrintPlan } from './mixExport.mjs';
import { t } from './i18n/index.mjs';

/** CIE L*a*b* (D65) -> sRGB hex (inverse of rgbToLab). */
export function labToHex([L, a, b]) {
  const f = (t) => (t ** 3 > 216 / 24389 ? t ** 3 : (108 * t - 16) / 24389);
  const y = (L + 16) / 116;
  const X = f(y + a / 500) * 0.95047;
  const Y = f(y);
  const Z = f(y - b / 200) * 1.08883;
  // XYZ -> linear sRGB (inverse sRGB matrix, D65)
  const R = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
  const G = -0.969266 * X + 1.8760108 * Y + 0.041556 * Z;
  const B = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
  const lin = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
  const ch = (c) => Math.max(0, Math.min(255, Math.round(lin(c) * 255)));
  return '#' + [ch(R), ch(G), ch(B)].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

const dist2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;

/**
 * Standard 4-spool sets worth comparing against the custom suggestion (SPEC 3.5d):
 * CMYK for dark palettes, CMYW (white instead of black) for light ones.
 */
export const STANDARD_PRESETS = [
  { id: 'cmyk', get name() { return t('preset.cmyk'); }, hexes: ['#00FFFF', '#FF00FF', '#FFFF00', '#000000'] },
  { id: 'cmyw', get name() { return t('preset.cmyw'); }, hexes: ['#00FFFF', '#FF00FF', '#FFFF00', '#FFFFFF'] },
];

/**
 * Weighted k-means in Lab space. `points` = [{ lab, w }]. Deterministic:
 * k-means++ seeding driven by a fixed PRNG so tests are stable.
 */
function weightedKMeans(points, k, seed = 1) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const total = points.reduce((t, p) => t + p.w, 0);
  // k-means++: first centroid by weight, then farthest weighted sampling
  const centroids = [];
  let acc = 0;
  const firstTarget = rnd() * total;
  for (const p of points) {
    acc += p.w;
    if (acc >= firstTarget) {
      centroids.push([...p.lab]);
      break;
    }
  }
  while (centroids.length < k) {
    const d = points.map((p) => Math.min(...centroids.map((c) => dist2(p.lab, c))));
    const sum = points.reduce((t, p, i) => t + d[i] * p.w, 0);
    let target = rnd() * sum;
    let hit = points[0];
    for (let i = 0; i < points.length; i++) {
      target -= d[i] * points[i].w;
      if (target <= 0) {
        hit = points[i];
        break;
      }
    }
    centroids.push([...hit.lab]);
  }
  for (let iter = 0; iter < 40; iter++) {
    const groups = centroids.map(() => ({ w: 0, lab: [0, 0, 0] }));
    let moved = false;
    for (const p of points) {
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < k; i++) {
        const d = dist2(p.lab, centroids[i]);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      const g = groups[best];
      g.w += p.w;
      for (let c = 0; c < 3; c++) g.lab[c] += p.lab[c] * p.w;
    }
    for (let i = 0; i < k; i++) {
      if (!groups[i].w) continue;
      const nc = groups[i].lab.map((v) => v / groups[i].w);
      if (dist2(nc, centroids[i]) > 0.01) moved = true;
      centroids[i] = nc;
    }
    if (!moved) break;
  }
  let err = 0;
  for (const p of points) err += Math.min(...centroids.map((c) => dist2(p.lab, c))) * p.w;
  return { centroids, err: err / total };
}

/**
 * Suggested spool colours for a colour distribution ([{color, faces, pct}]).
 * Runs k = 1..maxK; each entry: { k, spools: [{hex, faces, pct}], singlePct,
 * mixPct, worst }. `singlePct` = faces a single suggested spool prints within
 * threshold; `mixPct` additionally counts faces reachable by a mixable
 * two-spool blend. The recommendation is the smallest k with mixPct >= target.
 */
export function suggestSpools(colorStats, maxK = 4, { threshold = MIX_DELTA_E, target = 0.95, restarts = 8 } = {}) {
  const totalFaces = colorStats.reduce((t, c) => t + c.faces, 0) || 1;
  const points = colorStats.map((c) => ({ lab: rgbToLab(hexToRgb(c.color)), w: c.faces, color: c.color, faces: c.faces }));
  const results = [];
  for (let k = 1; k <= Math.min(maxK, 8); k++) {
    let best = null;
    for (let r = 0; r < restarts; r++) {
      const run = weightedKMeans(points, k, r + 1);
      if (!best || run.err < best.err) best = run;
    }
    const hexes = best.centroids.map(labToHex);
    const slots = slotsFromColours(hexes);
    // per-colour: which spool covers it, or a mixable blend
    const per = new Map();
    let singleFaces = 0;
    let mixFaces = 0;
    for (const c of colorStats) {
      const near = nearestSlot(c.color, slots);
      let mode = 'single';
      let via = t('slot.n', { n: near.slot });
      if (near.deltaE > threshold) {
        const plan = mixPrintPlan(c.color, slots, threshold);
        if (plan.mode === 'mix' && plan.mixable) {
          mode = 'mix';
          via = plan.mix.text;
        } else {
          mode = 'buy';
          via = t('suggest.viaNearest', { slot: t('slot.n', { n: near.slot }), dE: Math.round(near.deltaE * 10) / 10 });
        }
      }
      if (mode !== 'buy') singleFaces += mode === 'single' ? c.faces : 0;
      if (mode !== 'buy') mixFaces += c.faces;
      per.set(c.color, { mode, via, deltaE: Math.round(near.deltaE * 10) / 10 });
    }
    // spool usage: faces whose nearest spool is this slot
    const usage = slots.map((s) => {
      const faces = colorStats.filter((c) => nearestSlot(c.color, slots).slot === s.slot).reduce((t, c) => t + c.faces, 0);
      return { ...s, faces, pct: Math.round((faces / totalFaces) * 10000) / 100 };
    });
    const worst = [...per.entries()].filter(([, v]) => v.mode === 'buy').sort((a, b) => b[1].deltaE - a[1].deltaE).slice(0, 5);
    results.push({
      k,
      spools: usage,
      singlePct: Math.round((singleFaces / totalFaces) * 10000) / 100,
      mixPct: Math.round((mixFaces / totalFaces) * 10000) / 100,
      worst,
    });
  }
  const recommended = results.find((r) => r.mixPct >= target * 100) || results[results.length - 1];
  return { results, recommended };
}
