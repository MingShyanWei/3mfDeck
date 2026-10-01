// Generate deterministic test fixtures into tests/fixtures/.
// Run: npm run fixtures
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

const OUT = path.join(import.meta.dirname, '..', 'tests', 'fixtures');

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
async function painted3mf() {
  const { v, tris } = box(10, 10, 10);
  // 12 faces: 5x state1 ("4"), 2x state2 ("8"), 2x state3 ("0C"),
  // 2x split into 2 children state1/state2 ("841" read backwards: 1=split in 2, 4, 8),
  // 1x unpainted -> part extruder 4 from model_settings.config.
  // Expected per state: s1 = 5 + 1 = 6, s2 = 2 + 1 = 3, s3 = 2, s4 = 1.
  const paints = ['4', '4', '4', '4', '4', '8', '8', '0C', '0C', '841', '841', null];
  const mesh = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
  <object id="1" type="model">
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
  const projectSettings = JSON.stringify({ filament_colour: ['#00FFFF', '#FF00FF', '#FFFF00', '#000000'] }, null, 4);
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>');
  zip.file('3D/3dmodel.model', root);
  zip.file('3D/Objects/object_1.model', mesh);
  zip.file('Metadata/model_settings.config', modelSettings);
  zip.file('Metadata/project_settings.config', projectSettings);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// Plain core-spec 3MF (no slicer metadata, no paint_color), unit = centimeter
async function plain3mf() {
  const { v, tris } = box(1, 2, 3);
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="centimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
  <basematerials id="1"><base name="white" displaycolor="#FFFFFF"/></basematerials>
  <object id="2" pid="1" pindex="0"><mesh>
   <vertices>${v.map((p) => `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join('')}</vertices>
   <triangles>${tris.map((t) => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"/>`).join('')}</triangles>
  </mesh></object>
 </resources>
 <build><item objectid="2"/></build>
</model>
`;
  const zip = new JSZip();
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
await fs.writeFile(path.join(OUT, 'painted.3mf'), await painted3mf());
await fs.writeFile(path.join(OUT, 'plain.3mf'), await plain3mf());
await fs.writeFile(path.join(OUT, 'cube.glb'), glb());
await fs.writeFile(path.join(OUT, 'box.amf'), amf());
await fs.writeFile(path.join(OUT, 'fixture.step'), step);
console.log('fixtures written to', OUT);
