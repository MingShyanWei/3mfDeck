// Metadata parsers for STL / OBJ / glTF / GLB / AMF.
// Each returns { tri_count, bbox_mm } (bbox_mm as {x,y,z} or null).
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { emptyBox, growBox, transformBox, mulAffine, boxSize, IDENTITY } from './geom.mjs';

export function parseStl(buf) {
  const box = emptyBox();
  // Binary STL: 80-byte header + uint32 count + 50 bytes per facet
  if (buf.length >= 84 && 84 + buf.readUInt32LE(80) * 50 === buf.length) {
    const n = buf.readUInt32LE(80);
    for (let i = 0; i < n; i++) {
      const o = 84 + i * 50 + 12;
      for (let v = 0; v < 3; v++) growBox(box, buf.readFloatLE(o + v * 12), buf.readFloatLE(o + v * 12 + 4), buf.readFloatLE(o + v * 12 + 8));
    }
    return { tri_count: n, bbox_mm: boxSize(box) };
  }
  const text = buf.toString('latin1');
  let n = 0;
  for (const m of text.matchAll(/^\s*(facet|vertex)\s+(\S+)?\s*(\S+)?\s*(\S+)?/gm)) {
    if (m[1] === 'facet') n++;
    else growBox(box, +m[2], +m[3], +m[4]);
  }
  return { tri_count: n, bbox_mm: boxSize(box) };
}

export function parseObj(buf) {
  const box = emptyBox();
  let n = 0;
  for (const line of buf.toString('utf8').split('\n')) {
    if (line.startsWith('v ')) {
      const [, x, y, z] = line.trim().split(/\s+/);
      growBox(box, +x, +y, +z);
    } else if (line.startsWith('f ')) {
      n += line.trim().split(/\s+/).length - 3; // polygon with k vertices = k-2 triangles
    }
  }
  return { tri_count: n, bbox_mm: boxSize(box) };
}

// glTF node local matrix (column-major `matrix`, or TRS) → row-major 3x4 affine
function nodeMatrix(node) {
  if (node.matrix) {
    const m = node.matrix;
    return [m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14]];
  }
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  return [
    (1 - 2 * (qy * qy + qz * qz)) * sx, 2 * (qx * qy - qz * qw) * sy, 2 * (qx * qz + qy * qw) * sz, tx,
    2 * (qx * qy + qz * qw) * sx, (1 - 2 * (qx * qx + qz * qz)) * sy, 2 * (qy * qz - qx * qw) * sz, ty,
    2 * (qx * qz - qy * qw) * sx, 2 * (qy * qz + qx * qw) * sy, (1 - 2 * (qx * qx + qy * qy)) * sz, tz,
  ];
}

// Uses accessor counts and POSITION min/max only, so external .bin buffers
// are not needed. glTF units are metres.
export function parseGltfJson(gltf) {
  const box = emptyBox();
  let n = 0;
  const meshTris = (mesh) => {
    let t = 0;
    for (const p of mesh.primitives) {
      if ((p.mode ?? 4) !== 4) continue; // triangles only
      const acc = gltf.accessors[p.indices ?? p.attributes.POSITION];
      t += Math.floor(acc.count / 3);
    }
    return t;
  };
  const visit = (idx, parent) => {
    const node = gltf.nodes[idx];
    const m = mulAffine(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      const mesh = gltf.meshes[node.mesh];
      n += meshTris(mesh);
      for (const p of mesh.primitives) {
        const acc = gltf.accessors[p.attributes.POSITION];
        if (acc.min && acc.max) transformBox({ min: acc.min, max: acc.max }, m, box);
      }
    }
    for (const c of node.children || []) visit(c, m);
  };
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  if (scene) for (const r of scene.nodes) visit(r, IDENTITY);
  else for (const mesh of gltf.meshes || []) n += meshTris(mesh);
  return { tri_count: n, bbox_mm: boxSize(box, 1000) };
}

export function parseGlb(buf) {
  if (buf.toString('latin1', 0, 4) !== 'glTF') throw new Error('not a GLB file');
  const jsonLen = buf.readUInt32LE(12);
  return parseGltfJson(JSON.parse(buf.toString('utf8', 20, 20 + jsonLen)));
}

const AMF_UNIT_MM = { micron: 0.001, millimeter: 1, inch: 25.4, feet: 304.8, meter: 1000 };

export async function parseAmf(buf) {
  let text;
  if (buf.toString('latin1', 0, 2) === 'PK') {
    // Compressed AMF: a zip holding the XML
    const zip = await JSZip.loadAsync(buf);
    text = await Object.values(zip.files).find((f) => !f.dir).async('string');
  } else {
    text = buf.toString('utf8');
  }
  const arr = new Set(['object', 'vertex', 'volume', 'triangle']);
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', isArray: (name) => arr.has(name) }).parse(text);
  const box = emptyBox();
  let n = 0;
  for (const obj of doc.amf.object || []) {
    for (const v of obj.mesh.vertices.vertex || []) growBox(box, +v.coordinates.x, +v.coordinates.y, +v.coordinates.z);
    for (const vol of obj.mesh.volume || []) n += (vol.triangle || []).length;
  }
  return { tri_count: n, bbox_mm: boxSize(box, AMF_UNIT_MM[doc.amf.unit || 'millimeter'] ?? 1) };
}
