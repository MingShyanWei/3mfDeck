// M17 (SPEC 3.5d): colour labels. Every palette colour maps to one fixed
// colour name: nearest prototype in CIE Lab (CIEDE2000); colours farther than
// LABEL_MAX_DELTA_E from every prototype are "other". Since M24 (SPEC 3.12)
// the DB stores language-neutral keys (black, skin, ...); the UI shows them
// in the current language and search accepts the name in any language.
// Shared by main (DB backfill, queries) and renderer, so no Node APIs.
import { rgbToLab, hexToRgb, deltaE2000 } from './filament.mjs';
import { t, DICTS, LANGS } from './i18n/index.mjs';

/**
 * Colour names in display order, each with a swatch for the UI and the
 * prototype colours it is matched against (several per name so dark/light
 * and muted variants land in the right bucket).
 */
export const COLOR_NAMES = [
  { key: 'black', swatch: '#1A1A1A', protos: ['#000000', '#1A1A1A', '#2B2B2B'] },
  { key: 'white', swatch: '#F5F5F5', protos: ['#FFFFFF', '#F2F2F2', '#E8E8E0'] },
  { key: 'gray', swatch: '#8C8C8C', protos: ['#404040', '#5A5A5A', '#808080', '#A0A0A0', '#C4C4C4', '#797772'] },
  { key: 'red', swatch: '#D32F2F', protos: ['#FF0000', '#E72F1D', '#D32F2F', '#B71C1C', '#8B0000'] },
  { key: 'orange', swatch: '#F57C00', protos: ['#FF8C00', '#FF6F00', '#F57C00', '#FFA040'] },
  { key: 'yellow', swatch: '#FBE134', protos: ['#FFFF00', '#FFEB3B', '#F4EE2A', '#FDEF6E', '#FFF59D'] },
  { key: 'green', swatch: '#43A047', protos: ['#00FF00', '#4CAF50', '#2E7D32', '#1B5E20', '#8BC34A', '#4C7761', '#829B66', '#305E5B'] },
  { key: 'cyan', swatch: '#00BCD4', protos: ['#00FFFF', '#00BCD4', '#40E0D0', '#71BAAE', '#008080', '#80DEEA'] },
  { key: 'blue', swatch: '#1E63D6', protos: ['#0000FF', '#1E90FF', '#2196F3', '#0086D6', '#0A2989', '#3F51B5', '#314869', '#87CEEB'] },
  { key: 'purple', swatch: '#8E44AD', protos: ['#800080', '#8000FF', '#8A2BE2', '#8E44AD', '#6A0DAD', '#9C27B0', '#B57EDC', '#2E1B38', '#AB8C9C'] },
  { key: 'pink', swatch: '#F48FB1', protos: ['#FF00FF', '#EC008C', '#FF69B4', '#FFC0CB', '#F499A0', '#FA788F', '#E0457B'] },
  { key: 'brown', swatch: '#795548', protos: ['#8B4513', '#A0522D', '#6D4C41', '#5D4037', '#8D5524', '#7E545D', '#947B71'] },
  { key: 'skin', swatch: '#F1C27D', protos: ['#F1C27D', '#E0AC69', '#FFDBAC', '#FCCFC1', '#FCB7AC', '#C68642'] },
  { key: 'gold', swatch: '#D4AF37', protos: ['#D4AF37', '#C9A227', '#B8860B', '#CFB53B'] },
];
export const OTHER = 'other';
/** Every label a colour can get, in display order ("other" last). */
export const LABELS = [...COLOR_NAMES.map((c) => c.key), OTHER];
/** Beyond this CIEDE2000 distance to every prototype a colour is "other". */
export const LABEL_MAX_DELTA_E = 20;
/** A model "has" a colour label when that label covers at least this share (%) of its painted area. */
export const MODEL_LABEL_MIN_PCT = 5;

const PROTOS = COLOR_NAMES.flatMap((c) => c.protos.map((hex) => ({ key: c.key, lab: rgbToLab(hexToRgb(hex)) })));
const cache = new Map();

/** Colour label key for one #RRGGBB colour. */
export function labelFor(hex) {
  const id = hex.toUpperCase();
  if (cache.has(id)) return cache.get(id);
  const lab = rgbToLab(hexToRgb(id));
  let best = null;
  for (const p of PROTOS) {
    const d = deltaE2000(lab, p.lab);
    if (!best || d < best.d) best = { key: p.key, d };
  }
  const key = best.d <= LABEL_MAX_DELTA_E ? best.key : OTHER;
  cache.set(id, key);
  return key;
}

/** A label key in the current language: "black" -> Black / 黑. */
export const labelName = (key) => t(`color.${key}`);

/** Swatch colour shown for a label ("other" has none: the UI draws a neutral dot). */
export const swatchOf = (label) => COLOR_NAMES.find((c) => c.key === label)?.swatch ?? null;

/**
 * A model's colour labels by area: [{label, pct}] (pct summed over its
 * palette colours), largest first, only labels covering >= minPct.
 * `colors` = [{color, pct, label?}] (label is computed when missing).
 */
export function modelLabels(colors, { top = 3, minPct = MODEL_LABEL_MIN_PCT } = {}) {
  const sums = new Map();
  for (const c of colors) {
    const l = c.label || labelFor(c.color);
    sums.set(l, (sums.get(l) || 0) + c.pct);
  }
  return [...sums]
    .map(([label, pct]) => ({ label, pct: Math.round(pct * 100) / 100 }))
    .filter((x) => x.pct >= minPct)
    .sort((a, b) => b.pct - a.pct || LABELS.indexOf(a.label) - LABELS.indexOf(b.label))
    .slice(0, top);
}

// Every language's name for every label (lower case), so search works in any language
const NAME_TO_KEY = new Map(LABELS.flatMap((k) => LANGS.map((l) => [DICTS[l][`color.${k}`].toLowerCase(), k])));

/**
 * The colour label a search query names, if any, in any UI language:
 * "white" / 「白」 / 「白色」 / "white color" -> white.
 */
export function labelInQuery(q) {
  const s = q.trim().toLowerCase().replace(/\s*(colou?r|色)$/, ''); // i18n-ignore: suffix to strip, not UI text
  return NAME_TO_KEY.get(s) ?? (LABELS.includes(s) ? s : null);
}

// Labels stored before M24 were these Traditional Chinese names; the DB migration maps them to keys.
// Frozen on purpose: later dictionary edits must not change what old databases migrate to.
export const LEGACY_LABELS = { 黑: 'black', 白: 'white', 灰: 'gray', 紅: 'red', 橙: 'orange', 黃: 'yellow', 綠: 'green', 青: 'cyan', 藍: 'blue', 紫: 'purple', 粉: 'pink', 棕: 'brown', 膚: 'skin', 金: 'gold', 其他: 'other' }; // i18n-ignore: stored data, not UI text
