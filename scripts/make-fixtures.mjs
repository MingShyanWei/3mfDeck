// Generate deterministic test fixtures into tests/fixtures/.
// Run: npm run fixtures
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import JSZip from 'jszip';

const OUT = path.join(import.meta.dirname, '..', 'tests', 'fixtures');

// Fixed zip entry dates keep the generated 3MFs byte-identical across runs
function newZip() {
  const zip = new JSZip();
  const file = zip.file.bind(zip);
  zip.file = (name, data) => file(name, data, { date: new Date(Date.UTC(2026, 0, 1)), createFolders: false });
  return zip;
}

// Axis-aligned box: 8 vertices, 12 triangles (outward winding)
function box(sx, sy, sz) {
  const v = [
    [0, 0, 0], [sx, 0, 0], [sx, sy, 0], [0, sy, 0],
    [0, 0, sz], [sx, 0, sz], [sx, sy, sz], [0, sy, sz],
  ];
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  const tris = quads.flatMap(([a, b, c, d]) => [[a, b, c], [a, c, d]]);
  return { v, quads, tris };
}

function stlBinary({ v, tris }) {
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.write('fixture cube', 0);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => {
    let o = 84 + i * 50 + 12; // normal left as 0
    for (const idx of t) for (const c of v[idx]) { buf.writeFloatLE(c, o); o += 4; }
  });
  return buf;
}

function stlAscii({ v, tris }) {
  const lines = ['solid pyramid'];
  for (const t of tris) {
    lines.push('  facet normal 0 0 0', '    outer loop');
    for (const idx of t) lines.push(`      vertex ${v[idx].join(' ')}`);
    lines.push('    endloop', '  endfacet');
  }
  lines.push('endsolid pyramid');
  return lines.join('\n') + '\n';
}

function obj({ v, quads }) {
  return ['# fixture box', ...v.map((p) => `v ${p.join(' ')}`), ...quads.map((q) => `f ${q.map((i) => i + 1).join(' ')}`)].join('\n') + '\n';
}

// BambuStudio/Orca-style 3MF: root model with a component pointing to
// 3D/Objects/object_1.model, model_settings.config, project_settings.config.
// Faces in box() order: bottom(2), top(2), front y=0 (2), right x=max (2), back(2), left(2).
// 5x state1 ("4"), 2x state2 ("8"), 2x state3 ("0C"),
// 2x split into 2 children state1/state2 ("841" read backwards: 1=split in 2, 4, 8),
// 1x unpainted -> part extruder 4 from model_settings.config.
// Expected per state: s1 = 5 + 1 = 6, s2 = 2 + 1 = 3, s3 = 2, s4 = 1.
// From the default preview angle (top, front, right visible) all four
// colours show: top = s1, front = s2, right = s3 + s4.
const PAINTS = ['4', '4', '4', '4', '8', '8', '0C', null, '0C', '4', '841', '841'];

// `materials`: optional basematerials colours for the mesh object (object-level
// default pindex 0), to test that per-face paint_color wins over material colour.
async function painted3mf(colours, paints = PAINTS, materials = null) {
  const { v, tris } = box(10, 10, 10);
  const mats = materials
    ? `  <basematerials id="5">${materials.map((c, i) => `<base name="mat${i}" displaycolor="${c}"/>`).join('')}</basematerials>\n`
    : '';
  const mesh = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
${mats}  <object id="1" type="model"${materials ? ' pid="5" pindex="0"' : ''}>
   <mesh>
    <vertices>
${v.map((p) => `     <vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join('\n')}
    </vertices>
    <triangles>
${tris.map((t, i) => `     <triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"${paints[i] ? ` paint_color="${paints[i]}"` : ''}/>`).join('\n')}
    </triangles>
   </mesh>
  </object>
 </resources>
 <build/>
</model>
`;
  const root = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">
 <metadata name="Application">BambuStudio-02.04.00.70</metadata>
 <metadata name="Title">Fixture &amp; Cube</metadata>
 <metadata name="Designer">Fixture Maker</metadata>
 <metadata name="License">CC BY</metadata>
 <metadata name="Copyright" />
 <resources>
  <object id="2" type="model">
   <components>
    <component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
   </components>
  </object>
 </resources>
 <build>
  <item objectid="2" transform="2 0 0 0 2 0 0 0 2 100 100 0" printable="1"/>
 </build>
 <metadata name="DesignModelId">US0f1e2d3c4b5a69</metadata>
</model>
`;
  const modelSettings = `<?xml version="1.0" encoding="UTF-8"?><config>
  <object id="2">
    <metadata key="name" value="cube"/>
    <metadata key="extruder" value="1"/>
    <part id="1" subtype="normal_part">
      <metadata key="name" value="cube"/>
      <metadata key="extruder" value="4"/>
    </part>
  </object>
</config>
`;
  const projectSettings = JSON.stringify({ filament_colour: colours }, null, 4);
  const zip = newZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>');
  zip.file('3D/3dmodel.model', root);
  zip.file('3D/Objects/object_1.model', mesh);
  zip.file('Metadata/model_settings.config', modelSettings);
  zip.file('Metadata/project_settings.config', projectSettings);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// Material-coloured 3MF as exported by Meshy & co (no slicer config, no
// paint_color): basematerials + materials-extension colorgroup, an object
// default (pid/pindex) and per-triangle pid/p1 overrides.
// Expected: #FF8800 4 faces, #FFFFFF 3, #3355DD 3, #22AA44 2.
async function materials3mf() {
  const { v, tris } = box(10, 10, 10);
  const props = [
    '', '', '', '', // object default: basematerials[0] orange
    ' pid="1" p1="1"', ' pid="1" p1="1"', // white
    ' pid="2" p1="0"', ' pid="2" p1="0"', // colorgroup green
    ' pid="2" p1="1"', ' pid="2" p1="1"', ' pid="2" p1="1"', // colorgroup blue
    ' p1="1"', // p1 without pid -> object pid (basematerials) -> white
  ];
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" requiredextensions="m">
 <resources>
  <basematerials id="1"><base name="Orange" displaycolor="#FF8800"/><base name="White" displaycolor="#ffffffff"/></basematerials>
  <m:colorgroup id="2"><m:color color="#22AA44FF"/><m:color color="#3355DDFF"/></m:colorgroup>
  <object id="3" type="model" pid="1" pindex="0"><mesh>
   <vertices>${v.map((p) => `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join('')}</vertices>
   <triangles>${tris.map((t, i) => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"${props[i]}/>`).join('')}</triangles>
  </mesh></object>
 </resources>
 <build><item objectid="3"/></build>
</model>
`;
  const zip = newZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>');
  zip.file('3D/3dmodel.model', model);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// BambuStudio-style multi-plate project. Root objects 2/4/6 each point to a
// cube mesh in 3D/Objects/object_1.model. Plates (model_settings.config):
//   plate 1 "Cyan plate": object 2            -> extruder 1, cyan, 12 faces
//   plate 2 "Mixed":      object 4 + object 6 instance 0 -> magenta (painted) + yellow
//   plate 3 (no plate_3.json): object 6 instance 1 (second build item of 6) -> yellow
//   plate 4: only Metadata/plate_4.json exists -> empty plate
// Whole file: yellow 24 (50 %), cyan 12, magenta 12.
async function multiplate3mf() {
  const { v, tris } = box(10, 10, 10);
  const meshObj = (id, paint) => `  <object id="${id}" type="model"><mesh>
   <vertices>${v.map((p) => `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join('')}</vertices>
   <triangles>${tris.map((t) => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"${paint ? ` paint_color="${paint}"` : ''}/>`).join('')}</triangles>
  </mesh></object>`;
  const meshes = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
${meshObj(1)}
${meshObj(3, '8')}
${meshObj(5)}
 </resources>
 <build/>
</model>
`;
  const rootObj = (id, mesh) => `  <object id="${id}" type="model"><components><component p:path="/3D/Objects/object_1.model" objectid="${mesh}"/></components></object>`;
  const item = (id, x) => `  <item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${x} 100 0" printable="1"/>`;
  const root = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
 <metadata name="Application">BambuStudio-02.04.00.70</metadata>
 <resources>
${rootObj(2, 1)}
${rootObj(4, 3)}
${rootObj(6, 5)}
 </resources>
 <build>
${item(2, 100)}
${item(4, 400)}
${item(6, 430)}
${item(6, 700)}
 </build>
</model>
`;
  const obj = (id, ext) => `  <object id="${id}">
    <metadata key="extruder" value="${ext}"/>
    <part id="${id - 1}" subtype="normal_part"><metadata key="extruder" value="${ext}"/></part>
  </object>`;
  const plate = (n, name, insts) => `  <plate>
    <metadata key="plater_id" value="${n}"/>
    <metadata key="plater_name" value="${name}"/>
${insts.map(([o, i]) => `    <model_instance>
      <metadata key="object_id" value="${o}"/>
      <metadata key="instance_id" value="${i}"/>
      <metadata key="identify_id" value="${100 + o * 10 + i}"/>
    </model_instance>`).join('\n')}
  </plate>`;
  const modelSettings = `<?xml version="1.0" encoding="UTF-8"?><config>
${obj(2, 1)}
${obj(4, 1)}
${obj(6, 3)}
${plate(1, 'Cyan plate', [[2, 0]])}
${plate(2, 'Mixed', [[4, 0], [6, 0]])}
${plate(3, '', [[6, 1]])}
</config>
`;
  // plate_N.json ids are slicer runtime ids, not 3MF object ids (as in real files)
  const plateJson = (ids) => JSON.stringify({ bbox_objects: ids.map((id) => ({ id, name: `obj${id}` })), version: 2 });
  const zip = newZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>');
  zip.file('3D/3dmodel.model', root);
  zip.file('3D/Objects/object_1.model', meshes);
  zip.file('Metadata/model_settings.config', modelSettings);
  zip.file('Metadata/project_settings.config', JSON.stringify({ filament_colour: ['#00FFFF', '#FF00FF', '#FFFF00', '#000000'] }, null, 4));
  zip.file('Metadata/plate_1.json', plateJson([901]));
  zip.file('Metadata/plate_2.json', plateJson([902, 903, 1000]));
  zip.file('Metadata/plate_4.json', plateJson([]));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// 80 x 80 grid (shared vertices, 12,800 faces), 5 filaments C/M/Y/K/W as in
// FullSpectrum Lizard. `paintOf(face, x, y)` returns the 1-based filament.
// Paint strings are OrcaSlicer's CONST_FILAMENTS (one filament per face).
const ORCA_FILAMENT = ['', '4', '8', '0C', '1C', '2C'];
const CMYKW = ['#0086D6', '#EC008C', '#F4EE2A', '#000000', '#FFFFFF'];
async function grid3mf(paintOf) {
  const N = 80;
  const verts = [];
  for (let y = 0; y <= N; y++) for (let x = 0; x <= N; x++) verts.push(`<vertex x="${x}" y="${y}" z="0"/>`);
  const tris = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const a = y * (N + 1) + x, b = a + 1, c = a + N + 1, d = c + 1;
      for (const [i, t] of [[a, b, d], [a, d, c]].entries()) {
        tris.push(`<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}" paint_color="${ORCA_FILAMENT[paintOf(tris.length, x, y, i)]}"/>`);
      }
    }
  }
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <metadata name="Application">BambuStudio-02.04.00.70</metadata>
 <resources>
  <object id="1" type="model"><mesh>
   <vertices>${verts.join('')}</vertices>
   <triangles>${tris.join('')}</triangles>
  </mesh></object>
 </resources>
 <build><item objectid="1"/></build>
</model>
`;
  const zip = newZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>');
  zip.file('3D/3dmodel.model', model);
  zip.file('Metadata/project_settings.config', JSON.stringify({ filament_colour: CMYKW }, null, 4));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// Deterministic PRNG (mulberry32) so the dithered fixture is reproducible
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Plain core-spec 3MF (no slicer metadata, no paint_color, no materials), unit = centimeter
async function plain3mf() {
  const { v, tris } = box(1, 2, 3);
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="centimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
  <object id="2"><mesh>
   <vertices>${v.map((p) => `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join('')}</vertices>
   <triangles>${tris.map((t) => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"/>`).join('')}</triangles>
  </mesh></object>
 </resources>
 <build><item objectid="2"/></build>
</model>
`;
  const zip = newZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>');
  zip.file('3D/3dmodel.model', model);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// GLB: unit cube (indexed), node scale 0.02 -> 20 mm cube
function glb() {
  const { v, tris } = box(1, 1, 1);
  const pos = Buffer.alloc(v.length * 12);
  v.forEach((p, i) => p.forEach((c, j) => pos.writeFloatLE(c, i * 12 + j * 4)));
  const idx = Buffer.alloc(tris.length * 3 * 2);
  tris.flat().forEach((n, i) => idx.writeUInt16LE(n, i * 2));
  const bin = Buffer.concat([pos, idx]);
  const json = {
    asset: { version: '2.0', generator: '3mf-cabinet fixtures' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, scale: [0.02, 0.02, 0.02], translation: [1, 0, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.length },
      { buffer: 0, byteOffset: pos.length, byteLength: idx.length },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: v.length, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] },
      { bufferView: 1, componentType: 5123, count: tris.length * 3, type: 'SCALAR' },
    ],
  };
  return glbContainer(json, bin);
}

function glbContainer(json, bin) {
  const pad = (b, ch) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, ch)]);
  const jsonBuf = pad(Buffer.from(JSON.stringify(json)), 0x20);
  const binBuf = pad(bin, 0);
  const header = Buffer.alloc(12);
  header.write('glTF', 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
  const chunk = (b, type) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(b.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, b]);
  };
  return Buffer.concat([header, chunk(jsonBuf, 0x4e4f534a), chunk(binBuf, 0x004e4942)]);
}

// Minimal RGBA PNG encoder (for the GLB texture fixture)
function png(w, h, pixel) {
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0; // filter: none
    for (let x = 0; x < w; x++) Buffer.from(pixel(x, y)).copy(raw, y * (1 + w * 4) + 1 + x * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Textured GLB: unit cube, 24 vertices with per-face UVs, embedded PNG
// baseColorTexture whose left half is red and right half green.
function texturedGlb() {
  const { v, quads } = box(1, 1, 1);
  const pos = [];
  const uv = [];
  const idx = [];
  quads.forEach((q, f) => {
    q.forEach((i, k) => {
      pos.push(...v[i]);
      uv.push(...[[0, 1], [1, 1], [1, 0], [0, 0]][k]);
    });
    idx.push(f * 4, f * 4 + 1, f * 4 + 2, f * 4, f * 4 + 2, f * 4 + 3);
  });
  const f32 = (a) => Buffer.from(new Float32Array(a).buffer);
  const posBuf = f32(pos);
  const uvBuf = f32(uv);
  const idxBuf = Buffer.from(new Uint16Array(idx).buffer);
  const img = png(8, 8, (x) => (x < 4 ? [255, 0, 0, 255] : [0, 200, 0, 255]));
  const pad4 = (b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
  const parts = [posBuf, uvBuf, idxBuf, img].map(pad4);
  let off = 0;
  const views = parts.map((b, i) => {
    const view = { buffer: 0, byteOffset: off, byteLength: [posBuf, uvBuf, idxBuf, img][i].length };
    off += b.length;
    return view;
  });
  const json = {
    asset: { version: '2.0', generator: '3mf-cabinet fixtures' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 } }],
    textures: [{ source: 0, sampler: 0 }],
    samplers: [{ magFilter: 9728, minFilter: 9728 }],
    images: [{ bufferView: 3, mimeType: 'image/png' }],
    buffers: [{ byteLength: off }],
    bufferViews: views,
    accessors: [
      { bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] },
      { bufferView: 1, componentType: 5126, count: uv.length / 2, type: 'VEC2' },
      { bufferView: 2, componentType: 5123, count: idx.length, type: 'SCALAR' },
    ],
  };
  return glbContainer(json, Buffer.concat(parts));
}

function amf() {
  const { v, tris } = box(5, 6, 7);
  return `<?xml version="1.0" encoding="UTF-8"?>
<amf unit="millimeter">
 <object id="0">
  <mesh>
   <vertices>
${v.map((p) => `    <vertex><coordinates><x>${p[0]}</x><y>${p[1]}</y><z>${p[2]}</z></coordinates></vertex>`).join('\n')}
   </vertices>
   <volume>
${tris.map((t) => `    <triangle><v1>${t[0]}</v1><v2>${t[1]}</v2><v3>${t[2]}</v3></triangle>`).join('\n')}
   </volume>
  </mesh>
 </object>
</amf>
`;
}

// Minimal ISO-10303-21 file; STEP is B-rep so only size/format are indexed.
const step = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('fixture'),'2;1');
FILE_NAME('fixture.step','2026-10-01T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#1=CARTESIAN_POINT('',(0.,0.,0.));
ENDSEC;
END-ISO-10303-21;
`;

const pyramid = {
  v: [[0, 0, 0], [4, 0, 0], [4, 4, 0], [0, 4, 0], [2, 2, 3]],
  tris: [[0, 2, 1], [0, 3, 2], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]],
};

await fs.mkdir(OUT, { recursive: true });
await fs.writeFile(path.join(OUT, 'cube.stl'), stlBinary(box(10, 10, 10)));
await fs.writeFile(path.join(OUT, 'pyramid_ascii.stl'), stlAscii(pyramid));
await fs.writeFile(path.join(OUT, 'box.obj'), obj(box(20, 10, 5)));
await fs.writeFile(path.join(OUT, 'painted.3mf'), await painted3mf(['#00FFFF', '#FF00FF', '#FFFF00', '#000000']));
// Same cube with non-CMYK filament colours, to exercise filament mapping
await fs.writeFile(path.join(OUT, 'offpalette.3mf'), await painted3mf(['#1E90FF', '#E0457B', '#FFD700', '#333333']));
await fs.writeFile(path.join(OUT, 'textured.glb'), texturedGlb());
// Colours a single U1 slot cannot print (M8): green, saturated orange (not
// reachable by CMYK halftone either), purple, skin tone
await fs.writeFile(path.join(OUT, 'mixneeded.3mf'), await painted3mf(['#4CAF50', '#FF8C00', '#800080', '#E0AC69']));
await fs.writeFile(path.join(OUT, 'materials.3mf'), await materials3mf());
await fs.writeFile(path.join(OUT, 'multiplate.3mf'), await multiplate3mf());
// Full Spectrum style: every face an independent random filament with
// Lizard-like shares (C 15 %, M 21 %, Y 45 %, K 9 %, W 10 %) -> dithered.
{
  const r = rng(20261001);
  const cum = [0.15, 0.36, 0.81, 0.9, 1];
  await fs.writeFile(path.join(OUT, 'dithered.3mf'), await grid3mf(() => {
    const v = r();
    return cum.findIndex((c) => v < c) + 1;
  }));
}
// Same grid painted in 5 vertical bands (16 columns each) -> region painting.
await fs.writeFile(path.join(OUT, 'regions.3mf'), await grid3mf((_, x) => Math.floor(x / 16) + 1));
// paint_color + basematerials in one file: 6 painted faces cyan, 2 magenta,
// 4 unpainted -> material orange (not the part's default extruder 4).
await fs.writeFile(
  path.join(OUT, 'mixed.3mf'),
  await painted3mf(['#00FFFF', '#FF00FF', '#FFFF00', '#000000'], ['4', '4', '4', '4', '4', '4', '8', '8', null, null, null, null], ['#FF8800']),
);
// 6 colours, two near-identical yellows splitting 58% of the faces (4 + 3 of 12):
// suspected dither pair + "more than 4 colours" warning.
await fs.writeFile(
  path.join(OUT, 'dither.3mf'),
  await painted3mf(['#FFD000', '#FFDC20', '#00FFFF', '#FF00FF', '#000000', '#FFFFFF'], ['4', '4', '4', '4', '8', '8', '8', '0C', '0C', '1C', '2C', '3C']),
);
await fs.writeFile(path.join(OUT, 'plain.3mf'), await plain3mf());
await fs.writeFile(path.join(OUT, 'cube.glb'), glb());
await fs.writeFile(path.join(OUT, 'box.amf'), amf());
await fs.writeFile(path.join(OUT, 'fixture.step'), step);
console.log('fixtures written to', OUT);
