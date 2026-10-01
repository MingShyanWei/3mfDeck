// 3MF parser: jszip for the container, a streaming tag scanner for the
// (potentially huge, >500 MB) mesh XML, fast-xml-parser for the small
// config/rels XML. Reads per-face paint_color (BambuStudio/Orca encoding)
// and resolves it to filament colours from project_settings.config.
import JSZip from 'jszip';
import { StringDecoder } from 'node:string_decoder';
import { Readable } from 'node:stream';
import { XMLParser } from 'fast-xml-parser';
import { decodePaintColor } from '../paintColor.mjs';
import { emptyBox, growBox, transformBox, mulAffine, applyAffine, boxSize, IDENTITY } from './geom.mjs';

const UNIT_MM = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
const asArray = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

const decodeEntities = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// 3MF transform "m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32" (row-vector convention)
function parseTransform(s) {
  if (!s) return IDENTITY;
  const m = s.trim().split(/\s+/).map(Number);
  return [m[0], m[3], m[6], m[9], m[1], m[4], m[7], m[10], m[2], m[5], m[8], m[11]];
}

// Growable typed array (geometry collection for previews)
class Grow {
  constructor(Type, size = 1024) {
    this.Type = Type;
    this.a = new Type(size);
    this.n = 0;
  }
  push(v) {
    if (this.n === this.a.length) {
      const b = new this.Type(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = v;
  }
  get array() {
    return this.a.subarray(0, this.n);
  }
}

const attr = (attrs, name) => {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m ? m[1] : undefined;
};

/**
 * Stream one .model part and collect objects, build items and model metadata.
 * With model.geometry set, also keep vertices, triangle indices and each
 * face's dominant paint state (for previews).
 */
async function scanModel(zipFile, partPath, model) {
  const decoder = new StringDecoder('utf8');
  const tagRe = /<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"]|"[^"]*")*?)(\/?)>|([^<]+)/g;
  let rest = '';
  let obj = null; // current <object>
  let metaName = null; // current model-level <metadata name=...>
  let metaText = '';

  const handle = (text) => {
    tagRe.lastIndex = 0;
    let m;
    while ((m = tagRe.exec(text))) {
      if (m[5] !== undefined) {
        if (metaName) metaText += m[5];
        continue;
      }
      const [, close, rawName, attrs] = m;
      const name = rawName.includes(':') ? rawName.slice(rawName.indexOf(':') + 1) : rawName;
      if (name === 'vertex' && obj) {
        const x = +attr(attrs, 'x'), y = +attr(attrs, 'y'), z = +attr(attrs, 'z');
        growBox(obj.mesh.box, x, y, z);
        if (obj.mesh.verts) obj.mesh.verts.push(x), obj.mesh.verts.push(y), obj.mesh.verts.push(z);
      } else if (name === 'triangle' && obj) {
        obj.mesh.tris++;
        const pc = attr(attrs, 'paint_color');
        let dominant = 0;
        if (pc) {
          let best = 0;
          for (const [state, w] of Object.entries(decodePaintColor(pc))) {
            obj.mesh.paint[state] = (obj.mesh.paint[state] || 0) + w;
            if (w > best) (best = w), (dominant = Number(state));
          }
          obj.mesh.painted++;
        }
        if (obj.mesh.indices) {
          obj.mesh.indices.push(+attr(attrs, 'v1'));
          obj.mesh.indices.push(+attr(attrs, 'v2'));
          obj.mesh.indices.push(+attr(attrs, 'v3'));
          obj.mesh.faceState.push(dominant);
        }
      } else if (close) {
        if (name === 'object') obj = null;
        else if (name === 'metadata' && metaName) {
          model.metadata[metaName] = decodeEntities(metaText.trim());
          metaName = null;
        }
      } else if (name === 'object') {
        obj = { id: attr(attrs, 'id'), mesh: null, components: [] };
        model.objects.set(`${partPath}#${obj.id}`, obj);
      } else if (name === 'mesh' && obj) {
        obj.mesh = { box: emptyBox(), tris: 0, painted: 0, paint: {} };
        if (model.geometry) Object.assign(obj.mesh, { verts: new Grow(Float32Array), indices: new Grow(Uint32Array), faceState: new Grow(Uint8Array) });
      } else if (name === 'component' && obj) {
        const p = attr(attrs, 'p:path');
        obj.components.push({
          key: `${p ? p.replace(/^\//, '') : partPath}#${attr(attrs, 'objectid')}`,
          transform: parseTransform(attr(attrs, 'transform')),
        });
      } else if (name === 'item') {
        const p = attr(attrs, 'p:path');
        model.build.push({
          key: `${p ? p.replace(/^\//, '') : partPath}#${attr(attrs, 'objectid')}`,
          transform: parseTransform(attr(attrs, 'transform')),
        });
      } else if (name === 'model') {
        const unit = attr(attrs, 'unit');
        if (partPath === model.rootPath) model.unitScale = UNIT_MM[unit || 'millimeter'] ?? 1;
      } else if (name === 'metadata' && !obj && !m[4] && partPath === model.rootPath) {
        metaName = attr(attrs, 'name');
        metaText = '';
      }
    }
  };

  // jszip returns an old-style stream; wrap it to get async iteration
  for await (const chunk of new Readable().wrap(zipFile.nodeStream('nodebuffer'))) {
    const text = rest + decoder.write(chunk);
    const cut = text.lastIndexOf('>') + 1;
    handle(text.slice(0, cut));
    rest = text.slice(cut);
  }
  handle(rest + decoder.end());
}

function readFilamentColours(text) {
  if (!text) return null;
  const cfg = JSON.parse(text);
  const list = cfg.filament_colour;
  return Array.isArray(list) && list.length ? list.map((c) => c.slice(0, 7).toUpperCase()) : null;
}

// model_settings.config → { objects: {rootId: extruder}, parts: {"rootId/partId": extruder} }
function readExtruders(text) {
  const res = { objects: {}, parts: {} };
  if (!text) return res;
  const doc = xml.parse(text);
  const extruderOf = (node) => {
    const md = asArray(node.metadata).find((x) => x.key === 'extruder');
    return md ? Number(md.value) : undefined;
  };
  for (const o of asArray(doc.config?.object)) {
    const e = extruderOf(o);
    if (e) res.objects[o.id] = e;
    for (const p of asArray(o.part)) {
      const pe = extruderOf(p);
      if (pe) res.parts[`${o.id}/${p.id}`] = pe;
    }
  }
  return res;
}

function rootModelPath(relsText) {
  if (relsText) {
    const doc = xml.parse(relsText);
    const rel = asArray(doc.Relationships?.Relationship).find((r) => /\/3dmodel$/.test(r.Type));
    if (rel) return rel.Target.replace(/^\//, '');
  }
  return '3D/3dmodel.model';
}

// BambuStudio/Orca write design metadata into files downloaded from a model
// platform. DesignerUserId or a region-prefixed DesignModelId ("US4ac9…",
// "CNdb6d…") identifies MakerWorld; a bare numeric DesignModelId comes from
// some other platform, so it is marked downloaded without guessing a platform.
// Files saved locally (e.g. Meshy exports re-saved in BambuStudio) carry
// neither field and get no hint.
export function provenanceHint(md) {
  if (!md.DesignModelId && !md.DesignerUserId) return null;
  const makerWorld = Boolean(md.DesignerUserId) || /^[A-Z]{2}[0-9a-f]{8,}$/.test(md.DesignModelId || '');
  const lines = [
    md.Title && `Title: ${md.Title}`,
    md.Designer && `Designer: ${md.Designer}`,
    md.License && `License: ${md.License}`,
    md.Origin && `Origin: ${md.Origin}`,
    md.DesignModelId && `DesignModelId: ${md.DesignModelId}`,
    md.ProfileTitle && `Profile: ${md.ProfileTitle}`,
  ].filter(Boolean);
  return { provenance_type: 'downloaded', platform: makerWorld ? 'MakerWorld' : null, notes: lines.join('\n') };
}

/**
 * Parse a 3MF. With { geometry: true } the result also has `geometry`:
 * world-space (mm) positions, triangle indices and per-face filament state
 * (1-based extruder; split triangles take their dominant state) for every
 * placed build instance, plus the filament colour list (or null).
 */
export async function parse3mf(buffer, { geometry = false } = {}) {
  const zip = await JSZip.loadAsync(buffer);
  const text = async (p) => (zip.file(p) ? zip.file(p).async('string') : null);

  const rootPath = rootModelPath(await text('_rels/.rels'));
  const model = { rootPath, unitScale: 1, metadata: {}, objects: new Map(), build: [], geometry };
  await scanModel(zip.file(rootPath), rootPath, model);
  // Sub-models referenced via p:path (Production extension, used by Bambu/Orca)
  const subPaths = new Set();
  for (const o of model.objects.values()) for (const c of o.components) subPaths.add(c.key.split('#')[0]);
  for (const p of subPaths) if (p !== rootPath && zip.file(p)) await scanModel(zip.file(p), p, model);

  const colours = readFilamentColours(await text('Metadata/project_settings.config'));
  const ext = readExtruders(await text('Metadata/model_settings.config'));

  // Walk the build: every placed instance counts (bbox, triangles, colours),
  // i.e. what would actually be printed. Unpainted faces (state 0) take the
  // part's extruder, else the object's, else extruder 1.
  const box = emptyBox();
  const byState = {};
  let triCount = 0;
  const geo = geometry && { positions: new Grow(Float32Array), indices: new Grow(Uint32Array), faceState: new Grow(Uint8Array) };
  const place = (key, m, rootId, depth) => {
    const o = model.objects.get(key);
    if (!o) return;
    const rootExt = ext.objects[rootId] || 1;
    if (o.mesh && o.mesh.tris) {
      transformBox(o.mesh.box, m, box);
      triCount += o.mesh.tris;
      const defExt = depth === 0 ? rootExt : ext.parts[`${rootId}/${o.id}`] || rootExt;
      for (const [s, w] of Object.entries(o.mesh.paint)) {
        const st = s === '0' ? defExt : Number(s);
        byState[st] = (byState[st] || 0) + w;
      }
      const unpainted = o.mesh.tris - o.mesh.painted;
      if (unpainted) byState[defExt] = (byState[defExt] || 0) + unpainted;
      if (geo) {
        const base = geo.positions.n / 3;
        const v = o.mesh.verts.array;
        const k = model.unitScale;
        for (let i = 0; i < v.length; i += 3) {
          for (const c of applyAffine(m, v[i], v[i + 1], v[i + 2])) geo.positions.push(c * k);
        }
        for (const idx of o.mesh.indices.array) geo.indices.push(base + idx);
        for (const st of o.mesh.faceState.array) geo.faceState.push(st || defExt);
      }
    }
    for (const c of o.components) place(c.key, mulAffine(m, c.transform), rootId, depth + 1);
  };
  for (const item of model.build) place(item.key, item.transform, item.key.split('#')[1], 0);

  // paint_color distribution, resolved to filament colours
  let colorStats = null;
  if (colours) {
    const byColour = {};
    for (const [st, w] of Object.entries(byState)) {
      const c = colours[st - 1];
      if (c) byColour[c] = (byColour[c] || 0) + w;
    }
    colorStats = Object.entries(byColour)
      .map(([color, w]) => ({ color, faces: Math.round(w), pct: triCount ? Math.round((w / triCount) * 10000) / 100 : 0 }))
      .sort((a, b) => b.faces - a.faces);
  }

  return {
    tri_count: triCount,
    bbox_mm: boxSize(box, model.unitScale),
    color_count: colorStats ? colorStats.length : null,
    colorStats,
    metadata: model.metadata,
    provenanceHint: provenanceHint(model.metadata),
    ...(geo && {
      geometry: { positions: geo.positions.array, indices: geo.indices.array, faceState: geo.faceState.array, colours },
    }),
  };
}
