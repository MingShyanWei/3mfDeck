// 3MF parser: jszip for the container, a streaming tag scanner for the
// (potentially huge, >500 MB) mesh XML, fast-xml-parser for the small
// config/rels XML. Per-face colour comes from paint_color (BambuStudio/Orca
// encoding, resolved to filament colours from project_settings.config) or,
// for faces without paint_color, from 3MF material properties
// (basematerials displaycolor / materials-extension colorgroup).
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

const attrRes = {};
const attr = (attrs, name) => {
  const re = (attrRes[name] ??= new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  const m = re.exec(attrs);
  return m ? m[1] : undefined;
};

// "#rrggbb" / "#RRGGBBAA" -> "#RRGGBB"
const normHex = (c) => (c ? c.slice(0, 7).toUpperCase() : undefined);

/**
 * Stream one .model part and collect objects, build items and model metadata.
 *
 * Each face gets a colour key: "S<n>" for paint state n (S0 = unpainted,
 * resolved to the default extruder at placement time) or "#RRGGBB" for a
 * material colour. paint_color takes priority; material colour applies only
 * to faces without paint_color. Per mesh, `keys` sums face weights per key
 * (split paint triangles contribute fractions). With model.geometry set,
 * vertices, triangle indices and each face's dominant key are kept too.
 */
async function scanModel(zipFile, partPath, model) {
  const decoder = new StringDecoder('utf8');
  const tagRe = /<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"]|"[^"]*")*?)(\/?)>|([^<]+)/g;
  let rest = '';
  let obj = null; // current <object>
  let group = null; // colours of the <basematerials>/<colorgroup> being read
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
        const mesh = obj.mesh;
        mesh.tris++;
        const pc = attr(attrs, 'paint_color');
        let dominant;
        if (pc) {
          let best = 0;
          for (const [state, w] of Object.entries(decodePaintColor(pc))) {
            const key = `S${state}`;
            mesh.keys[key] = (mesh.keys[key] || 0) + w;
            if (w > best) (best = w), (dominant = key);
          }
        } else {
          // Triangle pid/p1 override the object's pid/pindex; p1 alone uses the object pid.
          // Per-vertex p2/p3 are ignored: the face takes its p1 colour.
          const tpid = attr(attrs, 'pid');
          const pid = tpid ?? obj.pid;
          const p1 = attr(attrs, 'p1') ?? (tpid === undefined ? obj.pindex : undefined);
          dominant = (pid !== undefined && model.groups.get(`${partPath}#${pid}`)?.[p1]) || 'S0';
          mesh.keys[dominant] = (mesh.keys[dominant] || 0) + 1;
        }
        if (mesh.indices) {
          mesh.indices.push(+attr(attrs, 'v1'));
          mesh.indices.push(+attr(attrs, 'v2'));
          mesh.indices.push(+attr(attrs, 'v3'));
          mesh.faceKey.push(keyIndex(model, dominant));
        }
      } else if ((name === 'base' || name === 'color') && group && !close) {
        group.push(normHex(attr(attrs, name === 'base' ? 'displaycolor' : 'color')));
      } else if (close) {
        if (name === 'object') obj = null;
        else if (name === 'basematerials' || name === 'colorgroup') group = null;
        else if (name === 'metadata' && metaName) {
          model.metadata[metaName] = decodeEntities(metaText.trim());
          metaName = null;
        }
      } else if (name === 'basematerials' || name === 'colorgroup') {
        group = [];
        model.groups.set(`${partPath}#${attr(attrs, 'id')}`, group);
      } else if (name === 'object') {
        obj = { id: attr(attrs, 'id'), pid: attr(attrs, 'pid'), pindex: attr(attrs, 'pindex'), mesh: null, components: [] };
        model.objects.set(`${partPath}#${obj.id}`, obj);
      } else if (name === 'mesh' && obj) {
        obj.mesh = { box: emptyBox(), tris: 0, keys: {} };
        if (model.geometry) Object.assign(obj.mesh, { verts: new Grow(Float32Array), indices: new Grow(Uint32Array), faceKey: new Grow(Uint16Array) });
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

// Colour keys used by preview geometry are stored as small integers
function keyIndex(model, key) {
  let i = model.keyIndex.get(key);
  if (i === undefined) {
    i = model.keyList.length;
    model.keyList.push(key);
    model.keyIndex.set(key, i);
  }
  return i;
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
 * Parse a 3MF. `colorStats` is the merged per-face colour distribution
 * (paint_color first, then material colour, then the default extruder's
 * filament colour); null when no face has a resolvable colour.
 * With { geometry: true } the result also has `geometry`: world-space (mm)
 * positions and triangle indices for every placed build instance, plus
 * `faceColor` (index into `palette`, 0 = no colour; split triangles take
 * their dominant colour) and `palette` (index 1.. -> "#RRGGBB").
 */
export async function parse3mf(buffer, { geometry = false } = {}) {
  const zip = await JSZip.loadAsync(buffer);
  const text = async (p) => (zip.file(p) ? zip.file(p).async('string') : null);

  const rootPath = rootModelPath(await text('_rels/.rels'));
  const model = { rootPath, unitScale: 1, metadata: {}, objects: new Map(), build: [], groups: new Map(), keyList: [], keyIndex: new Map(), geometry };
  await scanModel(zip.file(rootPath), rootPath, model);
  // Sub-models referenced via p:path (Production extension, used by Bambu/Orca)
  const subPaths = new Set();
  for (const o of model.objects.values()) for (const c of o.components) subPaths.add(c.key.split('#')[0]);
  for (const p of subPaths) if (p !== rootPath && zip.file(p)) await scanModel(zip.file(p), p, model);

  const colours = readFilamentColours(await text('Metadata/project_settings.config'));
  const ext = readExtruders(await text('Metadata/model_settings.config'));

  // Colour key -> "#RRGGBB" (or null). Unpainted faces without a material
  // colour (S0) take the part's extruder, else the object's, else extruder 1.
  const resolve = (key, defExt) => {
    if (key[0] === '#') return key;
    const state = key === 'S0' ? defExt : Number(key.slice(1));
    return colours?.[state - 1] ?? null;
  };

  // Walk the build: every placed instance counts (bbox, triangles, colours),
  // i.e. what would actually be printed.
  const box = emptyBox();
  const byColour = {};
  let triCount = 0;
  const geo = geometry && { positions: new Grow(Float32Array), indices: new Grow(Uint32Array), faceColor: new Grow(Uint16Array), palette: [], paletteIndex: new Map() };
  const paletteIndex = (hex) => {
    if (!hex) return 0;
    let i = geo.paletteIndex.get(hex);
    if (i === undefined) {
      geo.palette.push(hex);
      i = geo.palette.length;
      geo.paletteIndex.set(hex, i);
    }
    return i;
  };
  const place = (key, m, rootId, depth) => {
    const o = model.objects.get(key);
    if (!o) return;
    const rootExt = ext.objects[rootId] || 1;
    if (o.mesh && o.mesh.tris) {
      transformBox(o.mesh.box, m, box);
      triCount += o.mesh.tris;
      const defExt = depth === 0 ? rootExt : ext.parts[`${rootId}/${o.id}`] || rootExt;
      for (const [key, w] of Object.entries(o.mesh.keys)) {
        const hex = resolve(key, defExt);
        if (hex) byColour[hex] = (byColour[hex] || 0) + w;
      }
      if (geo) {
        const base = geo.positions.n / 3;
        const v = o.mesh.verts.array;
        const k = model.unitScale;
        for (let i = 0; i < v.length; i += 3) {
          for (const c of applyAffine(m, v[i], v[i + 1], v[i + 2])) geo.positions.push(c * k);
        }
        for (const idx of o.mesh.indices.array) geo.indices.push(base + idx);
        const toPalette = model.keyList.map((key) => paletteIndex(resolve(key, defExt)));
        for (const k of o.mesh.faceKey.array) geo.faceColor.push(toPalette[k]);
      }
    }
    for (const c of o.components) place(c.key, mulAffine(m, c.transform), rootId, depth + 1);
  };
  for (const item of model.build) place(item.key, item.transform, item.key.split('#')[1], 0);

  const entries = Object.entries(byColour);
  const colorStats = entries.length
    ? entries
        .map(([color, w]) => ({ color, faces: Math.round(w), pct: triCount ? Math.round((w / triCount) * 10000) / 100 : 0 }))
        .sort((a, b) => b.faces - a.faces || a.color.localeCompare(b.color))
    : null;

  return {
    tri_count: triCount,
    bbox_mm: boxSize(box, model.unitScale),
    color_count: colorStats ? colorStats.length : null,
    colorStats,
    metadata: model.metadata,
    provenanceHint: provenanceHint(model.metadata),
    ...(geo && {
      geometry: { positions: geo.positions.array, indices: geo.indices.array, faceColor: geo.faceColor.array, palette: geo.palette },
    }),
  };
}
