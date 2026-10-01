// Data handed to the renderer for 3D preview and thumbnails.
import fs from 'node:fs/promises';
import { parse3mf } from './parse/threemf.mjs';
import { setThumb } from './db.mjs';

/**
 * 3MF: pre-parsed geometry with per-face colours (three's 3MFLoader does not
 * expose paint_color); `plate` limits it to one slicer plate. Other meshes:
 * raw bytes for three's loaders. STEP is B-rep and cannot be previewed.
 */
export async function loadPreviewData(absPath, format, plate = null) {
  if (format === 'step') return { format, unsupported: true };
  const buf = await fs.readFile(absPath);
  if (format === '3mf') {
    const { geometry } = await parse3mf(buf, { geometry: true, plate });
    return { format, ...geometry };
  }
  return { format, bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) };
}

export const THUMB_SIZE = 512;

/**
 * Plate to preview: the requested one, else the first plate of a
 * multi-plate file (also used for its thumbnail; an empty first plate is
 * skipped), else the whole file.
 */
export function previewPlate(model, requested) {
  if (requested != null) return requested;
  if (!(model.plates?.length > 1)) return null;
  return (model.plates.find((p) => p.tri_count > 0) ?? model.plates[0]).plate;
}

/** Width/height from a PNG's IHDR chunk, or null if `buf` is not a PNG. */
export function pngSize(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 24 || sig.some((b, i) => buf[i] !== b) || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Store a renderer-produced thumbnail after checking it is a 512×512 PNG. */
export function storeThumb(db, id, bytes) {
  const buf = Buffer.from(bytes);
  const size = pngSize(buf);
  if (!size || size.width !== THUMB_SIZE || size.height !== THUMB_SIZE) {
    throw new Error(`thumbnail for model ${id} must be a ${THUMB_SIZE}px PNG, got ${size ? `${size.width}x${size.height}` : 'non-PNG'}`);
  }
  setThumb(db, id, buf);
}
