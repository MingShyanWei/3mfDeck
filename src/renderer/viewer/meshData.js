// Heavy per-face mesh preparation for painted 3MF previews. Pure functions
// (no DOM / three.js) so they run in a Web Worker and in unit tests.
import { nearestSlot } from '../../core/filament.mjs';

export const GRAY_HEX = '#b4b4b0';

// sRGB "#RRGGBB" -> linear RGB bytes (three treats vertex colours as linear)
export function linearBytes(hex) {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    const lin = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    return Math.round(lin * 255);
  });
}

/**
 * De-index positions so each face owns its 3 vertices, quantized to
 * normalized Int16 around the mesh centre: value * half + center restores mm.
 * Half the GPU memory of Float32 at ~0.002 mm precision for a 120 mm model.
 */
export function quantizeFaces(positions, indices) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  const center = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
  const half = [0, 1, 2].map((k) => Math.max((max[k] - min[k]) / 2, 1e-6));
  const inv = half.map((h) => 32767 / h);
  const out = new Int16Array(indices.length * 3);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i] * 3;
    out[i * 3] = Math.round((positions[v] - center[0]) * inv[0]);
    out[i * 3 + 1] = Math.round((positions[v + 1] - center[1]) * inv[1]);
    out[i * 3 + 2] = Math.round((positions[v + 2] - center[2]) * inv[2]);
  }
  return { positions: out, center, half };
}

/** Per-vertex colour bytes (3 vertices per face) from palette indices; 0 / unknown -> grey. */
export function faceColours(faceColor, palette) {
  const pal = new Uint8Array((palette.length + 1) * 3);
  pal.set(linearBytes(GRAY_HEX), 0);
  palette.forEach((hex, i) => pal.set(linearBytes(hex), (i + 1) * 3));
  const out = new Uint8Array(faceColor.length * 9);
  for (let f = 0, o = 0; f < faceColor.length; f++) {
    const p = (faceColor[f] <= palette.length ? faceColor[f] : 0) * 3;
    const r = pal[p], g = pal[p + 1], b = pal[p + 2];
    for (let k = 0; k < 3; k++, o += 3) {
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
    }
  }
  return out;
}

/**
 * Everything the viewer needs for a painted 3MF: quantized de-indexed
 * positions, original colours and nearest-U1-slot colours (null without a palette).
 */
export function prepareMesh({ positions, indices, faceColor, palette }) {
  const q = quantizeFaces(positions, indices);
  if (!palette.length) return { ...q, original: null, filament: null };
  return {
    ...q,
    original: faceColours(faceColor, palette),
    filament: faceColours(faceColor, palette.map((c) => nearestSlot(c).hex)),
  };
}
