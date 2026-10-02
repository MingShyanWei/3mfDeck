// Colour analysis (SPEC 3.5): warnings over a 3MF colour distribution.
// Shared by renderer and tests, so no Node APIs.
import { deltaE2000, rgbToLab, hexToRgb, nearestSlot, U1_SLOTS, MIX_DELTA_E } from './filament.mjs';
import { t } from './i18n/index.mjs';

// "A large single-colour area split by dithering into two close values":
// two colours that are perceptually near-identical, each holding a real
// share, together covering a large part of the model.
export const DITHER = {
  maxDeltaE: 10, // CIEDE2000; ~2 is just noticeable, >10 reads as a different colour
  minEach: 10, // % of faces per colour
  minCombined: 40, // % of faces for the pair
};

/** Candidate dither pairs, largest combined share first. */
export function ditherPairs(colors, opts = DITHER) {
  const big = colors.filter((c) => c.pct >= opts.minEach);
  const pairs = [];
  for (let i = 0; i < big.length; i++) {
    for (let j = i + 1; j < big.length; j++) {
      const [a, b] = [big[i], big[j]];
      const deltaE = deltaE2000(rgbToLab(hexToRgb(a.color)), rgbToLab(hexToRgb(b.color)));
      const combined = Math.round((a.pct + b.pct) * 100) / 100;
      if (deltaE <= opts.maxDeltaE && combined >= opts.minCombined) {
        pairs.push({ colors: [a.color, b.color], pcts: [a.pct, b.pct], combined, deltaE: Math.round(deltaE * 10) / 10 });
      }
    }
  }
  return pairs.sort((x, y) => y.combined - x.combined);
}

/**
 * Warnings for a colour distribution ([{color, faces, pct}]) on `slots`:
 * - dither: suspected dither pair(s)
 * - few-colors: every colour is within MIX_DELTA_E of some slot, so no mixing
 *   is needed (M29, SPEC 3.5e: not just "<= slot count" — a 4-colour file can
 *   still have colours no slot prints)
 * - needs-mixing: more colours than slots and not all of them near a slot
 * A file with few colours that are not all near a slot gets neither: the
 * colour table's "cannot print with one spool" summary says what is needed.
 */
export function analyzeColors(colors, slots = U1_SLOTS) {
  const warnings = [];
  for (const p of ditherPairs(colors)) {
    warnings.push({
      type: 'dither',
      colors: p.colors,
      message: t('analysis.dither', { a: p.colors[0], pa: p.pcts[0], b: p.colors[1], pb: p.pcts[1], dE: p.deltaE, sum: p.combined }),
    });
  }
  const allNear = colors.every((c) => nearestSlot(c.color, slots).deltaE <= MIX_DELTA_E);
  if (allNear) warnings.push({ type: 'few-colors', message: t('analysis.fewColors', { dE: MIX_DELTA_E }) });
  else if (colors.length > slots.length) warnings.push({ type: 'needs-mixing', message: t('analysis.needsMixing', { n: slots.length }) });
  return warnings;
}

/**
 * Overall perceived colour of a dithered (Full Spectrum) distribution: the
 * face-weighted average of the filament colours in LINEAR light (optical
 * mixing of adjacent dots), returned as "#RRGGBB". An estimate.
 */
export function mixedAverage(colors) {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const enc = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
  const sum = [0, 0, 0];
  let total = 0;
  for (const c of colors) {
    const rgb = hexToRgb(c.color).map((v) => lin(v / 255));
    rgb.forEach((v, k) => (sum[k] += v * c.faces));
    total += c.faces;
  }
  if (!total) return null;
  return '#' + sum.map((v) => Math.round(enc(v / total) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}
