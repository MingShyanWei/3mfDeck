// M17 (SPEC 3.5d): cabinet-wide colour ranking and purchase suggestions.
// Pure functions over color_stats rows, shared by main and renderer.
import { rgbToLab, hexToRgb } from './filament.mjs';
import { labelFor, LABELS, OTHER, MODEL_LABEL_MIN_PCT } from './colorNames.mjs';
import { labToHex } from './spoolSuggest.mjs';

/**
 * Rank colour labels over the whole cabinet. Every coloured model counts
 * equally (its palette shares sum to 100 %), so a 2-million-face model does
 * not outweigh a small one. `rows` = [{model_id, color, pct, label}].
 * Returns [{label, share, models, hex}] by share, largest first:
 * - share:  mean share (%) of that label across coloured models
 * - models: models carrying the label (>= MODEL_LABEL_MIN_PCT of their area)
 * - hex:    representative colour, the share-weighted Lab mean of its colours
 */
export function cabinetColors(rows) {
  const perModel = new Map(); // model -> label -> pct
  const lab = new Map(); // label -> { sum: [L,a,b], w }
  for (const r of rows) {
    const label = r.label || labelFor(r.color);
    if (!perModel.has(r.model_id)) perModel.set(r.model_id, new Map());
    const m = perModel.get(r.model_id);
    m.set(label, (m.get(label) || 0) + r.pct);
    const acc = lab.get(label) || { sum: [0, 0, 0], w: 0 };
    const c = rgbToLab(hexToRgb(r.color));
    for (let k = 0; k < 3; k++) acc.sum[k] += c[k] * r.pct;
    acc.w += r.pct;
    lab.set(label, acc);
  }
  const n = perModel.size || 1;
  const out = [];
  for (const label of lab.keys()) {
    let total = 0;
    let models = 0;
    for (const m of perModel.values()) {
      const p = m.get(label) || 0;
      total += p;
      if (p >= MODEL_LABEL_MIN_PCT) models++;
    }
    const acc = lab.get(label);
    out.push({ label, share: Math.round((total / n) * 100) / 100, models, hex: labToHex(acc.sum.map((v) => v / (acc.w || 1))) });
  }
  return out.sort((a, b) => b.share - a.share || LABELS.indexOf(a.label) - LABELS.indexOf(b.label));
}

/**
 * Purchase suggestions: each ranked label with the inventory filaments of that
 * colour name. Labels the inventory lacks are suggested in ranking order;
 * 「其他」 is never suggested (it is not one colour). Returns
 * { ranking: [{...row, owned: [{name, hex}], suggest}], suggestions: [row] }.
 */
export function purchaseSuggestions(ranking, inventory = []) {
  const rows = ranking.map((r) => {
    const owned = inventory.filter((f) => labelFor(f.hex) === r.label);
    return { ...r, owned, suggest: !owned.length && r.label !== OTHER };
  });
  return { ranking: rows, suggestions: rows.filter((r) => r.suggest) };
}
