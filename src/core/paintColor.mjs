// Decoder for the per-triangle `paint_color` attribute written by
// BambuStudio / OrcaSlicer (TriangleSelector serialization).
//
// The string is a sequence of hex nibbles read from the END backwards.
// Each node nibble: low 2 bits = number of split sides (0 = leaf);
// for a leaf, bits 2-3 hold the state, and 0b11 means "read one more
// nibble and add 3". For a split node the children (sides + 1 of them)
// follow recursively. State 0 = unpainted, state N = extruder/filament N.

/**
 * Decode a paint_color string into { state: weight } where the weights of
 * one triangle sum to 1. Each child of a split node gets an equal share of
 * its parent's weight (an approximation of its area).
 */
export function decodePaintColor(str) {
  let pos = str.length - 1;
  const next = () => {
    if (pos < 0) throw new Error(`paint_color truncated: "${str}"`);
    return parseInt(str[pos--], 16);
  };
  const out = {};
  const walk = (weight) => {
    const code = next();
    const sides = code & 0b11;
    if (sides === 0) {
      const state = (code & 0b1100) === 0b1100 ? next() + 3 : code >> 2;
      out[state] = (out[state] || 0) + weight;
      return;
    }
    const children = sides + 1;
    for (let i = 0; i < children; i++) walk(weight / children);
  };
  walk(1);
  return out;
}
