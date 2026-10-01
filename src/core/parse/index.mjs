// Dispatch metadata parsing by file extension.
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse3mf } from './threemf.mjs';
import { parseStl, parseObj, parseGlb, parseGltfJson, parseAmf } from './mesh.mjs';

// Same list as Snapmaker Orca's supported import formats (SPEC 3.1)
export const SUPPORTED_EXTS = ['.3mf', '.stl', '.obj', '.glb', '.gltf', '.step', '.stp', '.amf'];

export function formatOf(file) {
  const ext = path.extname(file).toLowerCase().slice(1);
  return ext === 'stp' ? 'step' : ext;
}

/**
 * Parse a model file. Always returns format/size; geometry fields are null
 * when the format carries none (STEP is B-rep, no triangles) or parsing fails
 * (`error` is then set).
 */
export async function parseFile(file) {
  const format = formatOf(file);
  const buf = await fs.readFile(file);
  const base = { format, size_bytes: buf.length, tri_count: null, bbox_mm: null, color_count: null, colorStats: null, provenanceHint: null };
  try {
    switch (format) {
      case '3mf': return { ...base, ...(await parse3mf(buf)) };
      case 'stl': return { ...base, ...parseStl(buf) };
      case 'obj': return { ...base, ...parseObj(buf) };
      case 'glb': return { ...base, ...parseGlb(buf) };
      case 'gltf': return { ...base, ...parseGltfJson(JSON.parse(buf.toString('utf8'))) };
      case 'amf': return { ...base, ...(await parseAmf(buf)) };
      default: return base;
    }
  } catch (err) {
    return { ...base, error: err.message };
  }
}
