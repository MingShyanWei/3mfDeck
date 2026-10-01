// Colour analysis (SPEC 3.5): warnings over a 3MF colour distribution.
// Shared by renderer and tests, so no Node APIs.
import { deltaE2000, rgbToLab, hexToRgb, U1_SLOTS } from './filament.mjs';

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
 * Warnings for a colour distribution ([{color, faces, pct}]):
 * - dither: suspected dither pair(s)
 * - few-colors: <= slot count, no mixing needed
 * - needs-mixing: more colours than filament slots
 */
export function analyzeColors(colors, slotCount = U1_SLOTS.length) {
  const warnings = [];
  for (const p of ditherPairs(colors)) {
    warnings.push({
      type: 'dither',
      colors: p.colors,
      message: `疑似抖色配對：${p.colors[0]}（${p.pcts[0]}%）與 ${p.colors[1]}（${p.pcts[1]}%）色差僅 ΔE ${p.deltaE}，合計 ${p.combined}%，可能是同一大色塊被抖色拆成兩個相近值`,
    });
  }
  if (colors.length <= slotCount) {
    warnings.push({ type: 'few-colors', message: `色塊少於 ${slotCount} 色不需混色，量化成實色平塗最乾淨` });
  } else {
    warnings.push({ type: 'needs-mixing', message: `超過 ${slotCount} 色，需 Full Spectrum 混色` });
  }
  return warnings;
}
