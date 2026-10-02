// Filament mapping (SPEC 3.4 mode 2): quantize paint colours to the nearest
// filament slot colour. Shared by main (tests) and renderer, so no Node APIs.
import { mixFilamentHex } from './filamentMixer.mjs';
import { t } from './i18n/index.mjs';

// Snapmaker U1 default slots: CMYK
export const U1_SLOTS = [
  { slot: 1, name: 'C', get label() { return t('ink.C'); }, hex: '#00FFFF' },
  { slot: 2, name: 'M', get label() { return t('ink.M'); }, hex: '#FF00FF' },
  { slot: 3, name: 'Y', get label() { return t('ink.Y'); }, hex: '#FFFF00' },
  { slot: 4, name: 'K', get label() { return t('ink.K'); }, hex: '#000000' },
];

/** Default spool colours for the settings page (ideal CMYK). */
export const DEFAULT_SPOOLS = U1_SLOTS.map((s) => s.hex);

/**
 * Slots from the user's spool colours (1-4, SPEC 3.5b). A slot whose colour is
 * the ideal default keeps its C/M/Y/K name; a custom colour is just "槽N"
 * (naming a red spool "C" would mislead).
 */
export function slotsFromColours(hexes) {
  return hexes.map((hex, i) => {
    const h = hex.toUpperCase();
    const ideal = U1_SLOTS[i];
    return ideal && ideal.hex === h ? { ...ideal } : { slot: i + 1, name: '', label: '', hex: h };
  });
}

/** Display name of a slot: "C" / "槽2". */
export const slotName = (s) => s.name || t('slot.n', { n: s.slot });

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// sRGB (0-255) -> CIE L*a*b* (D65)
export function rgbToLab([r, g, b]) {
  const lin = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** CIEDE2000 colour difference between two Lab colours. */
export function deltaE2000([L1, a1, b1], [L2, a2, b2]) {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hp = (a, b) => (a === 0 && b === 0 ? 0 : (Math.atan2(b, a) / rad + 360) % 360);
  const h1p = hp(a1p, b1);
  const h2p = hp(a2p, b2);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lmp = (L1 + L2) / 2;
  const Cmp = (C1p + C2p) / 2;
  let hmp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hmp += h1p + h2p < 360 ? 360 : -360;
    hmp /= 2;
  }
  const T = 1 - 0.17 * Math.cos((hmp - 30) * rad) + 0.24 * Math.cos(2 * hmp * rad) + 0.32 * Math.cos((3 * hmp + 6) * rad) - 0.2 * Math.cos((4 * hmp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hmp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lmp - 50) ** 2) / Math.sqrt(20 + (Lmp - 50) ** 2);
  const Sc = 1 + 0.045 * Cmp;
  const Sh = 1 + 0.015 * Cmp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

/** Nearest slot for one #RRGGBB colour: { ...slot, deltaE }. */
export function nearestSlot(hex, slots = U1_SLOTS) {
  const lab = rgbToLab(hexToRgb(hex));
  let best = null;
  for (const s of slots) {
    const d = deltaE2000(lab, rgbToLab(hexToRgb(s.hex)));
    if (!best || d < best.deltaE) best = { ...s, deltaE: d };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Halftone mixing recipes (M8). Since M15 printPlan uses the two-spool
// pigment model below instead (what the export writes); these stay as the
// halftone reference model.
// U1 Full Spectrum prints a mix as side-by-side dots of
// single filaments (halftone; see paintColor.mjs), so the perceived colour is
// the Neugebauer halftone mix with the filaments as primaries and no dot
// overlap (Yule–Nielsen n = 1): the area-weighted average of the filament
// colours in LINEAR light — the same forward model as the 混色估計 preview.
// A recipe is the slot weighting (1 % steps) whose mix is closest to the
// target by CIEDE2000. Partitive mixing can only desaturate/darken, so very
// saturated or very light targets may stay > MIX_DELTA_E away: those cannot
// be mixed from CMYK and are flagged (buy that filament).
// ---------------------------------------------------------------------------

/** Above this CIEDE2000 distance to the nearest single slot a colour must be mixed. */
export const MIX_DELTA_E = 15;

const srgbToLin = (c) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const linToSrgb = (c) => Math.round(Math.min(1, Math.max(0, c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)) * 255);
const toHex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

/** Halftone mix of slot colours: `weights` per slot (same order as `slots`), summing to 1. */
export function mixColour(weights, slots = U1_SLOTS) {
  const lin = slots.map((s) => hexToRgb(s.hex).map(srgbToLin));
  return toHex([0, 1, 2].map((k) => linToSrgb(weights.reduce((sum, w, i) => sum + w * lin[i][k], 0))));
}

// Every weighting of `slots` in `step` % increments (sum 100), with its Lab colour
function grid(slots, step) {
  const out = [];
  const walk = (i, left, acc) => {
    if (i === slots.length - 1) {
      const w = [...acc, left];
      out.push({ w, lab: rgbToLab(hexToRgb(mixColour(w.map((x) => x / 100), slots))) });
      return;
    }
    for (let v = 0; v <= left; v += step) walk(i + 1, left - v, [...acc, v]);
  };
  walk(0, 100, []);
  return out;
}
const coarseCache = new Map();
const recipeCache = new Map();

/**
 * Best CMYK (slot) recipe for a colour: 5 % grid search, then 1 % refinement
 * around the best weighting. Returns { weights: [{slot, name, label, hex, pct}]
 * (non-zero, largest first), mixHex, deltaE }.
 */
export function mixRecipe(hex, slots = U1_SLOTS) {
  const key = hex + slots.map((s) => s.hex).join();
  if (recipeCache.has(key)) return recipeCache.get(key);
  const slotKey = slots.map((s) => s.hex).join();
  if (!coarseCache.has(slotKey)) coarseCache.set(slotKey, grid(slots, 5));
  const target = rgbToLab(hexToRgb(hex));
  let best = null;
  for (const g of coarseCache.get(slotKey)) {
    const d = deltaE2000(target, g.lab);
    if (!best || d < best.d) best = { w: g.w, d };
  }
  // refine: every 1 % weighting within ±5 % of the coarse optimum
  const coarse = best.w;
  const walk = (i, left, acc) => {
    if (i === slots.length - 1) {
      if (Math.abs(left - coarse[i]) > 5) return;
      const w = [...acc, left];
      const d = deltaE2000(target, rgbToLab(hexToRgb(mixColour(w.map((x) => x / 100), slots))));
      if (d < best.d) best = { w, d };
      return;
    }
    for (let v = Math.max(0, coarse[i] - 5); v <= Math.min(left, coarse[i] + 5); v++) walk(i + 1, left - v, [...acc, v]);
  };
  walk(0, 100, []);
  const recipe = {
    weights: slots.map((s, i) => ({ ...s, pct: best.w[i] })).filter((x) => x.pct > 0).sort((a, b) => b.pct - a.pct),
    mixHex: mixColour(best.w.map((x) => x / 100), slots),
    deltaE: Math.round(best.d * 10) / 10,
  };
  recipeCache.set(key, recipe);
  return recipe;
}

/** "C 50%＋Y 50%" */
export const recipeText = (recipe) => recipe.weights.map((w) => `${slotName(w)} ${w.pct}%`).join('＋');

// ---------------------------------------------------------------------------
// Two-spool pigment mixing (M10, SPEC 3.5c). What the quantized export writes
// is a Full Spectrum mixed filament: TWO physical spools blended at
// mix_b_percent, coloured by Orca's FilamentMixer pigment model (port:
// filamentMixer.mjs). printPlan uses this same model so the colour analysis,
// the filament-mapping preview, the CSV report and the export all agree on
// what can be mixed (M15: the export used to trust the halftone recipe's
// `mixable`, so e.g. #61C680 on blue + yellow — halftone ΔE 19.1, pigment
// ΔE 8.3 — was quantized to one spool and no Mix was written).
// ---------------------------------------------------------------------------
const pigmentCache = new Map();

/**
 * Best two-spool pigment mix for a colour: ordered spool pairs x mix_b_percent
 * 0..100 (1 % steps), minimising CIEDE2000 to the target.
 * Returns { compA, compB, mixB, mixHex, deltaE, text }, or null with < 2 slots.
 */
export function bestMix(hex, slots) {
  if (slots.length < 2) return null; // no pair to blend
  const key = hex + '|' + slots.map((s) => s.hex).join();
  if (pigmentCache.has(key)) return pigmentCache.get(key);
  const target = rgbToLab(hexToRgb(hex));
  let best = null;
  for (const A of slots) {
    for (const B of slots) {
      if (A.slot === B.slot) continue;
      for (let b = 0; b <= 100; b++) {
        const mixHex = mixFilamentHex(A.hex, B.hex, 1 - b / 100);
        const d = deltaE2000(target, rgbToLab(hexToRgb(mixHex)));
        if (!best || d < best.deltaE) best = { compA: A.slot, compB: B.slot, mixB: b, mixHex, deltaE: d };
      }
    }
  }
  best.deltaE = Math.round(best.deltaE * 10) / 10;
  best.text = `${slotName(slots.find((s) => s.slot === best.compA))} ${100 - best.mixB}%＋${slotName(slots.find((s) => s.slot === best.compB))} ${best.mixB}%`;
  pigmentCache.set(key, best);
  return best;
}

/**
 * How a colour gets printed on the slots:
 * - mode 'single': nearest slot within MIX_DELTA_E -> that one spool
 * - mode 'mix':    must be mixed; `recipe` = the best two-spool pigment blend
 *                  (weights per slot, its colour and residual ΔE);
 *                  `mixable` false when even that blend stays > MIX_DELTA_E
 *                  (cannot be mixed from these slots: buy the filament)
 * `previewHex` is what the filament-mapping preview shows.
 */
export function printPlan(hex, slots = U1_SLOTS, threshold = MIX_DELTA_E) {
  const near = nearestSlot(hex, slots);
  const nearest = { slot: near.slot, name: near.name, hex: near.hex, deltaE: Math.round(near.deltaE * 10) / 10 };
  if (near.deltaE <= threshold) return { mode: 'single', nearest, previewHex: near.hex };
  const mix = bestMix(hex, slots);
  const slotOf = (n) => slots.find((s) => s.slot === n);
  const recipe = mix
    ? {
        weights: [
          { ...slotOf(mix.compA), pct: 100 - mix.mixB },
          { ...slotOf(mix.compB), pct: mix.mixB },
        ]
          .filter((w) => w.pct > 0)
          .sort((a, b) => b.pct - a.pct),
        mixHex: mix.mixHex,
        deltaE: mix.deltaE,
      }
    : { weights: [{ ...slotOf(near.slot), pct: 100 }], mixHex: near.hex, deltaE: nearest.deltaE }; // one spool: nothing to mix
  return { mode: 'mix', nearest, recipe, mixable: recipe.deltaE <= threshold, previewHex: recipe.mixHex };
}

/**
 * Map a colour distribution ([{color, faces, pct}], e.g. color_stats) onto
 * slots. Returns { mapping: [{color, faces, pct, slot, deltaE, mode, recipe?,
 * mixable?, previewHex}], used: [{slot, name, label, hex, faces, pct}],
 * printablePct, unprintablePct } — `used` answers "which spools will this
 * file use", sorted by slot number; mixed colours count towards each slot by
 * their recipe share. M29 (SPEC 3.5e): a colour that cannot be mixed counts
 * towards its nearest slot (what the export prints when the filament is not
 * bought), not towards the recipe it does not reach.
 */
export function mapToSlots(colorStats, slots = U1_SLOTS, threshold = MIX_DELTA_E) {
  const mapping = colorStats.map((c) => {
    const plan = printPlan(c.color, slots, threshold);
    return { color: c.color, faces: c.faces, pct: c.pct, slot: plan.nearest.slot, deltaE: plan.nearest.deltaE, ...plan };
  });
  const used = new Map();
  const add = (slot, faces, pct) => {
    const s = slots.find((x) => x.slot === slot);
    const u = used.get(slot) || { ...s, faces: 0, pct: 0 };
    u.faces += faces;
    u.pct += pct;
    used.set(slot, u);
  };
  let bad = 0;
  for (const m of mapping) {
    if (m.mode === 'mix' && m.mixable) for (const w of m.recipe.weights) add(w.slot, (m.faces * w.pct) / 100, (m.pct * w.pct) / 100);
    else add(m.slot, m.faces, m.pct);
    if (m.mode === 'mix' && !m.mixable) bad += m.faces;
  }
  const total = mapping.reduce((t, m) => t + m.faces, 0) || 1;
  const unprintablePct = Math.round((bad / total) * 10000) / 100;
  return {
    printablePct: Math.round((100 - unprintablePct) * 100) / 100,
    unprintablePct,
    mapping,
    used: [...used.values()]
      .map((u) => ({ ...u, faces: Math.round(u.faces), pct: Math.round(u.pct * 100) / 100 }))
      .sort((a, b) => a.slot - b.slot),
  };
}
