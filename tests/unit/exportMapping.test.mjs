// M9: mapping report CSV and quantized 3MF export.
// Format verified against Snapmaker/OrcaSlicer v2.4.0 (the installed Snapmaker Orca):
// paint_color per triangle = CONST_FILAMENTS[extruder] ("4","8","0C","1C",...),
// filament colours from Metadata/project_settings.config filament_colour.
//   https://github.com/Snapmaker/OrcaSlicer/blob/b1831e5dcb464172de33783142425aafda834fbc/src/libslic3r/Model.cpp#L48-L50
//   https://github.com/Snapmaker/OrcaSlicer/blob/b1831e5dcb464172de33783142425aafda834fbc/src/libslic3r/Format/bbs_3mf.cpp#L280
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { encodeExtruder, remapPaintColor, mappingCsv, exportProjectSettings, stripModelSettings, exportQuantized3mf, U1_PRESETS } from '../../src/core/exportMapping.mjs';
import { decodePaintColor } from '../../src/core/paintColor.mjs';
import { parse3mf } from '../../src/core/parse/threemf.mjs';
import { U1_SLOTS, slotsFromColours } from '../../src/core/filament.mjs';
import { FIXTURES, tmpDir } from './helpers.mjs';

const SNAPMAKER_CONST_FILAMENTS = ['', '4', '8', '0C', '1C', '2C', '3C', '4C', '5C', '6C', '7C', '8C', '9C', 'AC', 'BC', 'CC', 'DC'];
const fixture = (f) => path.join(FIXTURES, f);
const statsOf = async (p) => Object.fromEntries((await parse3mf(await fs.readFile(p))).colorStats.map((c) => [c.color, c.faces]));

describe('paint_color writing', () => {
  it('encodeExtruder matches Snapmaker Orca CONST_FILAMENTS 1..16 and decodes back', () => {
    for (let n = 1; n <= 16; n++) {
      expect(encodeExtruder(n)).toBe(SNAPMAKER_CONST_FILAMENTS[n]);
      expect(decodePaintColor(encodeExtruder(n))).toEqual({ [n]: 1 });
    }
    expect(encodeExtruder(0)).toBe('');
  });

  it('remapPaintColor keeps the split structure and maps every leaf', () => {
    const map = new Map([[1, 3], [2, 1], [3, 4]]);
    expect(remapPaintColor('4', map)).toBe('0C');
    expect(remapPaintColor('0C', map)).toBe('1C');
    expect(decodePaintColor(remapPaintColor('841', map))).toEqual({ 3: 0.5, 1: 0.5 }); // 2 children
    expect(decodePaintColor(remapPaintColor('40C843', map))).toEqual({ 3: 0.5, 1: 0.25, 4: 0.25 }); // 4 children
    expect(remapPaintColor('4', new Map([[1, 0]]))).toBe(''); // fully unassigned -> attribute dropped
    expect(decodePaintColor(remapPaintColor('841', new Map([[1, 0], [2, 2]])))).toEqual({ 0: 0.5, 2: 0.5 });
  });
});

describe('mappingCsv', () => {
  it('lists colour, faces, share, slot, ΔE or recipe and a note; UTF-8 BOM for Excel', async () => {
    const { colorStats } = await parse3mf(await fs.readFile(fixture('mixneeded.3mf')));
    const csv = mappingCsv(colorStats);
    expect(csv.startsWith('﻿原始色,面數,佔比,指定捲槽,ΔE 或配方,備註\r\n')).toBe(true);
    const lines = csv.trim().split('\r\n').slice(1);
    expect(lines).toHaveLength(4);
    const row = (hex) => lines.find((l) => l.startsWith(hex));
    // recipes are the two-spool pigment blends the export writes (M15)
    expect(row('#800080')).toMatch(/^#800080,2,16\.67%,槽2 M #FF00FF,配方 M 52%＋K 48%（ΔE 7\.1）；量化到最近捲 ΔE 30\.3,需混色；量化匯出：量化到最近捲（ΔE 30\.3）$/);
    expect(row('#FF8C00')).toMatch(/,配方 Y 72%＋M 28%（ΔE 7\.3）；.*,需混色；/);
    expect(mappingCsv([{ color: '#947B71', faces: 1, pct: 100 }])).toMatch(/,需購買；/);
    const single = mappingCsv([{ color: '#FFD700', faces: 5, pct: 100 }]);
    expect(single.trim().split('\r\n')[1]).toBe('#FFD700,5,100%,槽3 Y #FFFF00,ΔE 11.6,單捲');
  });

  it('skip option and custom slots are reflected', async () => {
    const csv = mappingCsv([{ color: '#4CAF50', faces: 10, pct: 100 }], U1_SLOTS, { overThreshold: 'skip' });
    expect(csv).toMatch(/（跳過，不指定）/);
    expect(csv).toMatch(/量化匯出：跳過該面/);
    const own = mappingCsv([{ color: '#4CAF50', faces: 10, pct: 100 }], slotsFromColours(['#4CAF50', '#000000']));
    expect(own.trim().split('\r\n')[1]).toBe('#4CAF50,10,100%,槽1 #4CAF50,ΔE 0,單捲');
  });
});

describe('exported project settings: spool table only', () => {
  // Carrying the source's print/printer settings made Snapmaker Orca warn
  // "Too large layer height. Reset to 0.320" (0.8 mm-nozzle project). GUI-verified
  // alternatives are documented at exportProjectSettings().
  it('holds the slots as filaments on the U1 system presets and nothing else', () => {
    const cfg = JSON.parse(exportProjectSettings(slotsFromColours(['#FF0000', '#00FF00'])));
    expect(cfg).toEqual({
      filament_colour: ['#FF0000FF', '#00FF00FF'],
      filament_settings_id: [U1_PRESETS.filament_settings_id, U1_PRESETS.filament_settings_id],
      filament_type: ['PLA', 'PLA'],
      printer_model: 'Snapmaker U1',
      printer_settings_id: 'Snapmaker U1 (0.4 nozzle)',
      print_settings_id: '0.20 Standard @Snapmaker U1 (0.4 nozzle)',
      from: 'project',
      name: 'project_settings',
    });
  });

  it('model_settings keeps geometry/placement/plates, drops print overrides, remaps extruders', () => {
    const src = `<config>
  <object id="2">
    <metadata key="name" value="Body"/>
    <metadata key="extruder" value="5"/>
    <metadata key="layer_height" value="0.4"/>
    <metadata key="wall_loops" value="6"/>
    <part id="1" subtype="normal_part">
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
      <metadata key="extruder" value="2"/>
      <metadata key="sparse_infill_density" value="5%"/>
    </part>
  </object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="filament_maps" value="1 1 1 1 1"/>
    <model_instance>
      <metadata key="object_id" value="2"/>
    </model_instance>
  </plate>
</config>`;
    const out = stripModelSettings(src, (n) => (n === 5 ? 4 : 1));
    expect(out).not.toMatch(/layer_height|wall_loops|sparse_infill_density|filament_maps/);
    expect(out).toMatch(/key="name" value="Body"/);
    expect(out).toMatch(/key="matrix"/);
    expect(out).toMatch(/key="plater_id" value="1"/);
    expect(out).toMatch(/key="object_id" value="2"/);
    expect([...out.matchAll(/key="extruder" value="(\d)"/g)].map((m) => m[1])).toEqual(['4', '1']);
  });
});

describe('exportQuantized3mf', () => {
  it('offpalette.3mf -> CMYK: every face points at its nearest slot, split faces kept, source untouched', async () => {
    const dir = await tmpDir();
    const dest = path.join(dir, 'q.3mf');
    const before = await fs.readFile(fixture('offpalette.3mf'));
    const r = await exportQuantized3mf(fixture('offpalette.3mf'), dest);
    expect(await fs.readFile(fixture('offpalette.3mf'))).toEqual(before);
    expect(r.summary.map((s) => [s.color, s.slot, s.mode])).toEqual([
      ['#1E90FF', 1, 'mix'],
      ['#E0457B', 2, 'mix'],
      ['#FFD700', 3, 'single'],
      ['#333333', 4, 'single'],
    ]);
    // same faces, now in the slot colours: C 6 (5 + 2 halves), M 3, Y 2, K 1 (unpainted face -> part extruder 4 -> K)
    expect(await statsOf(dest)).toEqual({ '#00FFFF': 6, '#FF00FF': 3, '#FFFF00': 2, '#000000': 1 });
    const out = await parse3mf(await fs.readFile(dest), { geometry: true });
    const src = await parse3mf(before, { geometry: true });
    expect(out.tri_count).toBe(src.tri_count);
    expect([...out.geometry.positions]).toEqual([...src.geometry.positions]);
    const z = await JSZip.loadAsync(await fs.readFile(dest));
    const mesh = await z.file('3D/Objects/object_1.model').async('string');
    expect(mesh.match(/paint_color="([^"]*)"/g).map((a) => a.slice(13, -1))).toEqual(['4', '4', '4', '4', '8', '8', '0C', '0C', '4', '841', '841']);
  });

  it('skip option leaves over-threshold colours unassigned (they fall back to the part filament)', async () => {
    const dest = path.join(await tmpDir(), 'q.3mf');
    const r = await exportQuantized3mf(fixture('offpalette.3mf'), dest, U1_SLOTS, { overThreshold: 'skip' });
    expect(r.summary.filter((s) => s.slot === null).map((s) => s.color)).toEqual(['#1E90FF', '#E0457B']);
    const mesh = await (await JSZip.loadAsync(await fs.readFile(dest))).file('3D/Objects/object_1.model').async('string');
    expect((mesh.match(/paint_color="/g) || []).length).toBe(4); // only the Y and K faces keep a paint_color
  });

  it('material-coloured file (no slicer config) gets paint_color per face and the spool table', async () => {
    const dest = path.join(await tmpDir(), 'q.3mf');
    await exportQuantized3mf(fixture('materials.3mf'), dest);
    const z = await JSZip.loadAsync(await fs.readFile(dest));
    expect(JSON.parse(await z.file('Metadata/project_settings.config').async('string')).printer_settings_id).toBe(U1_PRESETS.printer_settings_id);
    const s = await statsOf(dest);
    expect(Object.values(s).reduce((a, b) => a + b, 0)).toBe(12);
    expect(Object.keys(s).every((c) => U1_SLOTS.some((u) => u.hex === c))).toBe(true);
  });

  it('custom slots equal to the file colours map 1:1', async () => {
    const dest = path.join(await tmpDir(), 'q.3mf');
    await exportQuantized3mf(fixture('offpalette.3mf'), dest, slotsFromColours(['#1E90FF', '#E0457B', '#FFD700', '#333333']));
    expect(await statsOf(dest)).toEqual({ '#1E90FF': 6, '#E0457B': 3, '#FFD700': 2, '#333333': 1 });
  });

  it('two slots: colours collapse onto two filaments and the project shrinks to 2', async () => {
    const dest = path.join(await tmpDir(), 'q.3mf');
    await exportQuantized3mf(fixture('painted.3mf'), dest, slotsFromColours(['#00FFFF', '#000000']));
    const z = await JSZip.loadAsync(await fs.readFile(dest));
    expect(JSON.parse(await z.file('Metadata/project_settings.config').async('string')).filament_colour).toEqual(['#00FFFFFF', '#000000FF']);
    const ms = await z.file('Metadata/model_settings.config').async('string');
    expect([...ms.matchAll(/key="extruder" value="(\d+)"/g)].every((m) => Number(m[1]) <= 2)).toBe(true);
    expect(Object.keys(await statsOf(dest)).sort()).toEqual(['#000000', '#00FFFF']);
  });

  it('drops the source slicing settings: project config, object overrides, embedded presets, layer profiles, slice results', async () => {
    const dir = await tmpDir();
    const src = path.join(dir, 'src.3mf');
    const z = await JSZip.loadAsync(await fs.readFile(fixture('painted.3mf')));
    const cfg = JSON.parse(await z.file('Metadata/project_settings.config').async('string'));
    z.file('Metadata/project_settings.config', JSON.stringify({ ...cfg, layer_height: '0.4', nozzle_diameter: ['0.8'], printer_settings_id: 'Bambu Lab H2D 0.8 nozzle' }));
    const ms = await z.file('Metadata/model_settings.config').async('string');
    z.file('Metadata/model_settings.config', ms.replace('<metadata key="extruder" value="1"/>', '<metadata key="extruder" value="1"/>\n    <metadata key="layer_height" value="0.4"/>'));
    for (const f of ['Metadata/process_settings_1.config', 'Metadata/filament_settings_1.config', 'Metadata/machine_settings_1.config', 'Metadata/layer_heights_profile.txt', 'Metadata/slice_info.config', 'Metadata/plate_1.json']) z.file(f, 'x');
    await fs.writeFile(src, await z.generateAsync({ type: 'nodebuffer' }));
    const dest = path.join(dir, 'q.3mf');
    await exportQuantized3mf(src, dest);
    const out = await JSZip.loadAsync(await fs.readFile(dest));
    const outCfg = JSON.parse(await out.file('Metadata/project_settings.config').async('string'));
    expect(outCfg.layer_height).toBeUndefined();
    expect(outCfg.nozzle_diameter).toBeUndefined();
    expect(outCfg.printer_settings_id).toBe(U1_PRESETS.printer_settings_id);
    expect(await out.file('Metadata/model_settings.config').async('string')).not.toMatch(/layer_height/);
    expect(Object.keys(out.files).filter((n) => /settings_1\.config|layer_heights|slice_info|plate_1\.json/.test(n))).toEqual([]);
    expect(await statsOf(dest)).toEqual({ '#00FFFF': 6, '#FF00FF': 3, '#FFFF00': 2, '#000000': 1 }); // colours intact
  });

  it('refuses to overwrite an existing file unless asked', async () => {
    const dest = path.join(await tmpDir(), 'q.3mf');
    await fs.writeFile(dest, 'keep');
    await expect(exportQuantized3mf(fixture('painted.3mf'), dest)).rejects.toThrow(/EEXIST/);
    expect(await fs.readFile(dest, 'utf8')).toBe('keep');
    await exportQuantized3mf(fixture('painted.3mf'), dest, U1_SLOTS, { overwrite: true });
    expect((await fs.stat(dest)).size).toBeGreaterThan(100);
  });
});

const MESHY = path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/3mf/Meshy_AI_multi_color.3mf');
describe.skipIf(!existsSync(MESHY))('Meshy_AI_multi_color.3mf (real file, copied)', () => {
  it('quantized to CMYK and to its own 4 colours; face counts preserved', async () => {
    const dir = await tmpDir();
    const src = path.join(dir, 'src.3mf');
    await fs.copyFile(MESHY, src);
    const own = path.join(dir, 'own.3mf');
    await exportQuantized3mf(src, own, slotsFromColours(['#EA7A51', '#140D0B', '#FBB4AD', '#947B71']));
    expect(await statsOf(own)).toEqual(await statsOf(src));
    const cmyk = path.join(dir, 'cmyk.3mf');
    const r = await exportQuantized3mf(src, cmyk);
    const s = await statsOf(cmyk);
    expect(Object.values(s).reduce((a, b) => a + b, 0)).toBe(262197);
    expect(r.summary.find((x) => x.color === '#140D0B')).toMatchObject({ slot: 4, mode: 'single' });
  }, 60000);
});
