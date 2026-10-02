// M11 (SPEC 3.5d): spool colour suggestion from a model's colour distribution.
// Area-weighted k-means in CIE L*a*b* finds the k spool colours that best
// cover the model's faces; coverage is judged with the printing pipeline
// (single spool within MIX_DELTA_E, or a mixable two-spool blend).
// M29 (SPEC 3.5e): a k is recommended only when every must-cover colour
// prints (coverage.mjs), not when the area coverage passes 95 %; candidate
// spool sets also come from weightings that do not let the main colour
// average small colours away.
import { rgbToLab, hexToRgb, MIX_DELTA_E } from './filament.mjs';
import { coverageOf, compareCoverage, recommend, MUST_COVER_PCT } from './coverage.mjs';
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
 * Runs k = 1..maxK; each entry: { k, spools: [{slot, hex, faces, pct}],
 * singlePct, mixPct, unprintablePct, worst, uncovered, complete } (see
 * coverageOf; spool pct = usage split by mix recipe). Per k the best of three
 * k-means weightings is kept: by area (the plain fit), by sqrt(area) and one
 * weight per colour (so a 0.2 % colour can win its own spool). The
 * recommendation is the smallest k that prints every must-cover colour
 * (`complete`); if none does, the largest k, marked incomplete.
 */
export function suggestSpools(colorStats, maxK = 4, { threshold = MIX_DELTA_E, mustCoverPct = MUST_COVER_PCT, restarts = 8 } = {}) {
  const weightings = [(c) => c.faces, (c) => Math.sqrt(c.faces), () => 1];
  const results = [];
  for (let k = 1; k <= Math.min(maxK, 8); k++) {
    let pick = null;
    weightings.forEach((weigh, wi) => {
      const points = colorStats.map((c) => ({ lab: rgbToLab(hexToRgb(c.color)), w: weigh(c) }));
      let best = null;
      for (let r = 0; r < restarts; r++) {
        const run = weightedKMeans(points, k, r + 1);
        if (!best || run.err < best.err) best = run;
      }
      const hexes = best.centroids.map(labToHex);
      const cov = coverageOf(colorStats, hexes, { threshold, mustCoverPct });
      // the area-weighted fit (wi 0) wins ties: other weightings only replace it when they print more
      if (!pick || compareCoverage(cov, pick.cov) < 0) pick = { hexes, cov, wi };
    });
    const { usage, ...cov } = pick.cov;
    results.push({ k, spools: usage, ...cov });
  }
  return { results, recommended: recommend(results) };
}
