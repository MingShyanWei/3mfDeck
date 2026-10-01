// Decoder for the per-triangle `paint_color` attribute written by
// BambuStudio / OrcaSlicer (TriangleSelector serialization).
//
// Verified against OrcaSlicer source (SoftFever/OrcaSlicer @ 3384daa, 2026-10-01):
// - src/libslic3r/TriangleSelector.cpp  TriangleSelector::serialize() / deserialize()
//   https://github.com/SoftFever/OrcaSlicer/blob/3384daa6bcbdfccea9797238fc7acb9f4144dae8/src/libslic3r/TriangleSelector.cpp#L1699-L1790
// - src/libslic3r/Model.cpp  FacetsAnnotation::get_triangle_as_string() writes the
//   nibbles with out.insert(out.begin(), digit), i.e. the string is read from the END;
//   CONST_FILAMENTS lists the string for "extruder N": "4","8","0C","1C",...,"EC","0FC",...,"EFC"
//   https://github.com/SoftFever/OrcaSlicer/blob/3384daa6bcbdfccea9797238fc7acb9f4144dae8/src/libslic3r/Model.cpp#L55-L58
//
// Semantics: a triangle carries ONE state = ONE extruder/filament (state N ->
// project_settings filament_colour[N-1]); it is not a bitmask. A painted
// triangle may be split into 2-4 children, each with its own state.
// Each node nibble: low 2 bits = number of split sides (0 = leaf). Split node:
// bits 2-3 = special side, followed by (sides + 1) child subtrees. Leaf: bits
// 2-3 = state 0..2; 0b11 means "next nibble + 3" (states 3..17), and a next
// nibble of 0b1111 means "one more nibble + 18" (states 18..32).
// Full Spectrum colour mixing is therefore spatial: neighbouring triangles
// carry different single filaments (dithering), see parse/threemf.mjs.

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
      let state = code >> 2;
      if (state === 3) {
        const n = next();
        state = n === 0b1111 ? next() + 18 : n + 3;
      }
      out[state] = (out[state] || 0) + weight;
      return;
    }
    const children = sides + 1;
    for (let i = 0; i < children; i++) walk(weight / children);
  };
  walk(1);
  return out;
}
