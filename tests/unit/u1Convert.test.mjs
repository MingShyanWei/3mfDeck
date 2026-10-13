// M18 (SPEC 3.9) Snapmaker U1 detection; M35 (SPEC 3.16) every export is a
// U1 project (plates onto the U1 bed, fixes, carried source settings). The
// profile data below is synthetic test data in the local Orca profile layout
// (names and the few keys read), not copies of real profiles.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { loadU1Profiles } from '../../src/core/orcaProfiles.mjs';
import { detectPrinter, pickProcess, pickFilament, perFilament, sourceCarry, plateCols, bedRect } from '../../src/core/u1Convert.mjs';
import { exportQuantized3mf, carryToSlots, U1_PRESETS } from '../../src/core/exportMapping.mjs';
import { exportPresetSettings } from '../../src/core/printPreset.mjs';
import { U1_SLOTS } from '../../src/core/filament.mjs';
import { openDb, insertModel, listModels, sidebarCounts, idsNeedingSourcePrinter } from '../../src/core/db.mjs';
import { parseFile } from '../../src/core/parse/index.mjs';
import { FIXTURES, tmpDir } from './helpers.mjs';

const U1_AREA = ['0.5x1', '270.5x1', '270.5x271', '0.5x271'];
let profilesDir;
let profiles;

beforeAll(async () => {
  profilesDir = await tmpDir('mfcab-profiles-');
  const put = async (kind, json) => {
    const dir = path.join(profilesDir, 'Snapmaker', kind);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${json.name}.json`), JSON.stringify(json));
  };
  await put('machine', { name: 'fdm_U1', instantiation: 'false', nozzle_diameter: ['0.4'] });
  for (const n of ['0.4', '0.6']) {
    await put('machine', { name: `Snapmaker U1 (${n} nozzle)`, inherits: 'fdm_U1', instantiation: 'true', printer_model: 'Snapmaker U1', nozzle_diameter: [n, n, n, n], printable_area: U1_AREA });
  }
  await put('process', { name: 'fdm_process_U1_common', instantiation: 'false', layer_height: '0.2' });
  await put('process', { name: '0.20mm Standard @Snapmaker U1 (0.4 nozzle)', inherits: 'fdm_process_U1_common', instantiation: 'true', compatible_printers: ['Snapmaker U1 (0.4 nozzle)'] });
  await put('process', { name: '0.20mm High Quality @Snapmaker U1 (0.4 nozzle)', inherits: 'fdm_process_U1_common', instantiation: 'true', compatible_printers: ['Snapmaker U1 (0.4 nozzle)'] });
  await put('process', { name: '0.12mm Standard @Snapmaker U1 (0.4 nozzle)', instantiation: 'true', layer_height: '0.12', compatible_printers: ['Snapmaker U1 (0.4 nozzle)'] });
  await put('process', { name: '0.30mm Standard @Snapmaker U1 (0.6 nozzle)', instantiation: 'true', layer_height: '0.3', compatible_printers: ['Snapmaker U1 (0.6 nozzle)'] });
  await put('filament', { name: 'fdm_filament_pla', instantiation: 'false', filament_type: ['PLA'] });
  for (const name of ['Snapmaker PLA Basic @U1', 'Snapmaker PLA Matte @U1', 'Generic PLA', 'Generic PLA Silk']) {
    await put('filament', { name, inherits: 'fdm_filament_pla', instantiation: 'true', compatible_printers: ['Snapmaker U1 (0.4 nozzle)'] });
  }
  await put('filament', { name: 'Generic PETG', instantiation: 'true', filament_type: ['PETG'], compatible_printers: ['Snapmaker U1 (0.4 nozzle)'] });
  profiles = loadU1Profiles(profilesDir);
});

// A Bambu P1S project (256 x 256 bed) in the shape the user's files have
const p1s = (over = {}) => ({
  printer_model: 'Bambu Lab P1S',
  printer_settings_id: 'Bambu Lab P1S 0.4 nozzle',
  print_settings_id: '0.16mm High Quality @BBL X1C',
  nozzle_diameter: ['0.4'],
  printable_area: ['0x0', '256x0', '256x256', '0x256'],
  layer_height: '0.12',
  filament_colour: ['#00FFFF', '#FF00FF', '#FFFF00', '#000000'],
  filament_type: ['PLA', 'PLA', 'PLA', 'PETG'],
  filament_settings_id: ['Bambu PLA Matte @BBL P1S 0.4 nozzle', 'Bambu PLA Basic @BBL P1S', 'Bambu PLA Silk @BBL X1C', 'Bambu PETG Basic @BBL X1C'],
  nozzle_volume_type: ['Standard'],
  filament_extruder_variant: Array.from({ length: 8 }, (_, i) => (i % 2 ? 'Direct Drive High Flow' : 'Direct Drive Standard')),
  filament_self_index: ['1', '1', '2', '2', '3', '3', '4', '4'],
  filament_max_volumetric_speed: ['22', '29', '22', '29', '12', '18', '16', '20'],
  fan_max_speed: ['100', '100', '80', '40'],
  enable_support: '1',
  support_type: 'tree(auto)',
  sparse_infill_density: '12%',
  skeleton_infill_density: '15%', // Bambu-only: must not be carried
  brim_type: 'auto_brim',
  exclude_object: '0',
  different_settings_to_system: ['enable_support;layer_height;skeleton_infill_density;sparse_infill_density', '', '', '', '', ''],
  ...over,
});

describe('detectPrinter', () => {
  it('reads printer_model / print_settings_id and flags U1', () => {
    expect(detectPrinter(p1s())).toEqual({ printer: 'Bambu Lab P1S', settingsId: 'Bambu Lab P1S 0.4 nozzle', process: '0.16mm High Quality @BBL X1C', isU1: false });
    expect(detectPrinter({ printer_model: 'Snapmaker U1', printer_settings_id: 'Snapmaker U1 (0.4 nozzle)' }).isU1).toBe(true);
    expect(detectPrinter({ filament_colour: ['#FFFFFF'] })).toBe(null); // e.g. our own M9 exports before M18? no printer keys
    expect(detectPrinter(null)).toBe(null);
  });
});

describe('U1 presets from the local profiles', () => {
  it('loads machines / processes / filaments, resolving inherits', () => {
    expect(profiles.machines.map((m) => [m.name, m.nozzle])).toEqual(expect.arrayContaining([['Snapmaker U1 (0.4 nozzle)', 0.4], ['Snapmaker U1 (0.6 nozzle)', 0.6]]));
    expect(profiles.processes.find((p) => p.name.startsWith('0.20mm Standard')).layerHeight).toBe(0.2); // from the parent
    expect(profiles.filaments.find((f) => f.name === 'Generic PLA').type).toBe('PLA');
    expect(loadU1Profiles(path.join(profilesDir, 'nope'))).toBe(null);
  });

  it('process: nozzle family, closest layer height, Standard on ties', () => {
    expect(pickProcess(profiles, 0.4, 0.12).name).toBe('0.12mm Standard @Snapmaker U1 (0.4 nozzle)');
    expect(pickProcess(profiles, 0.4, 0.2).name).toBe('0.20mm Standard @Snapmaker U1 (0.4 nozzle)');
    expect(pickProcess(profiles, 0.6, 0.28).name).toBe('0.30mm Standard @Snapmaker U1 (0.6 nozzle)');
  });

  it('filament: same type, same sub-type word, else Generic', () => {
    expect(pickFilament(profiles, 0.4, 'PLA', 'Bambu PLA Matte @BBL P1S').name).toBe('Snapmaker PLA Matte @U1');
    expect(pickFilament(profiles, 0.4, 'PLA', 'Bambu PLA Basic @BBL H2S').name).toBe('Snapmaker PLA Basic @U1');
    expect(pickFilament(profiles, 0.4, 'PLA', 'Bambu PLA Silk @BBL X1C').name).toBe('Generic PLA Silk');
    expect(pickFilament(profiles, 0.4, 'PLA', 'Some PLA').name).toBe('Generic PLA');
    expect(pickFilament(profiles, 0.4, 'PETG', 'Bambu PETG Basic').name).toBe('Generic PETG');
  });
});

describe('source settings carried into a U1 export', () => {
  it('per-filament values: the source nozzle volume type entry of Bambu variant arrays', () => {
    expect(perFilament(p1s(), 'filament_max_volumetric_speed', 4)).toEqual(['22', '22', '12', '16']);
    expect(perFilament(p1s({ nozzle_volume_type: ['High Flow'] }), 'filament_max_volumetric_speed', 4)).toEqual(['29', '29', '18', '20']);
    expect(perFilament(p1s(), 'fan_max_speed', 4)).toEqual(['100', '100', '80', '40']);
    expect(perFilament(p1s(), 'missing_key', 4)).toBe(null);
  });

  it('process keys the user changed (allow-list), supports keep their kind; per-filament settings', () => {
    const c = sourceCarry(p1s());
    expect(c.process).toEqual({ enable_support: '1', support_type: 'tree(auto)', sparse_infill_density: '12%' }); // not skeleton_infill_density, not layer_height
    expect(c.filament.filament_max_volumetric_speed).toEqual(['22', '22', '12', '16']);
    expect(c.filament.fan_max_speed).toEqual(['100', '100', '80', '40']);
  });

  it('each slot takes the settings of the source filament with the most area quantized to it; an unused slot keeps the preset', () => {
    const carry = { process: {}, filament: { nozzle_temperature: ['200', '210', '220', '230'] } };
    const colours = ['#A', '#B', '#C', '#D'];
    const slotOf = (h) => ({ '#A': 1, '#B': 1, '#C': 2, '#D': 5 })[h]; // #D -> a Mix (virtual extruder 5)
    const area = { '#A': 10, '#B': 30, '#C': 5, '#D': 99 };
    const r = carryToSlots(carry, colours, slotOf, 4, (h) => area[h]);
    expect(r.filament.nozzle_temperature).toEqual(['210', '220', '210', '210']); // slot 1 <- #B (30 > 10); 3, 4: placeholder, not listed
    expect(r.listed).toEqual([['nozzle_temperature'], ['nozzle_temperature'], [], []]);
    expect(carryToSlots(carry, colours, slotOf, 4).filament.nozzle_temperature[0]).toBe('200'); // no areas: the first filament
  });
});

describe('plate grid', () => {
  it("follows Orca's column rule and bed rectangle", () => {
    expect([1, 2, 3, 4, 5, 7, 8, 9, 10].map(plateCols)).toEqual([1, 2, 2, 2, 3, 3, 3, 3, 4]);
    expect(bedRect(U1_AREA)).toMatchObject({ w: 270, h: 270, cx: 135.5, cy: 136 });
  });
});

describe('export = U1 project (M35)', () => {
  // multiplate.3mf: plate 1 (100,100), plate 2 (400,100)+(430,100), plate 3 (700,100) — not where
  // a 4-plate grid puts plate 3 — and an empty plate 4; give it a P1S project
  const p1sProject = async (dir, over = {}, edit = (x) => x) => {
    const zip = await JSZip.loadAsync(await fs.readFile(path.join(FIXTURES, 'multiplate.3mf')));
    zip.file('Metadata/project_settings.config', JSON.stringify(p1s(over)));
    zip.file('3D/3dmodel.model', edit(await zip.file('3D/3dmodel.model').async('string')));
    const file = path.join(dir, 'p1s.3mf');
    await fs.writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }));
    return file;
  };
  const items = async (file) => [...(await (await JSZip.loadAsync(await fs.readFile(file))).file('3D/3dmodel.model').async('string')).matchAll(/transform="([^"]+)"/g)].map((m) => m[1].split(' ').slice(9, 11).map(Number));
  const settings = async (file) => JSON.parse(await (await JSZip.loadAsync(await fs.readFile(file))).file('Metadata/project_settings.config').async('string'));
  const exportU1 = (src, dest, opts = {}) => exportQuantized3mf(src, dest, U1_SLOTS, { mix: true, u1Area: U1_AREA, ...opts });

  it('moves each plate onto the U1 bed, keeps an unsafe plate, writes U1 presets, fixes and the carried settings; source untouched', async () => {
    const dir = await tmpDir();
    const src = await p1sProject(dir, { nozzle_diameter: ['0.2'] }); // the source nozzle does not matter (M34: Settings decide)
    const before = await fs.readFile(src);
    const dest = path.join(dir, 'p1s-U1.3mf');
    const weights = new Map([['#00FFFF', 4], ['#FF00FF', 3], ['#FFFF00', 2], ['#000000', 1]]);
    const r = await exportU1(src, dest, { colorWeights: weights });
    expect(r.plates).toEqual([
      { plate: 1, status: 'moved', dx: 7.5, dy: 8 }, // bed centre (128,128) -> (135.5,136)
      { plate: 2, status: 'moved', dx: 24.3, dy: 8 }, // + grid stride 324 - 307.2
      { plate: 3, status: 'kept', reason: '物件不在來源盤面範圍內，無法安全換算' },
    ]);
    expect(await items(dest)).toEqual([[107.5, 108], [424.3, 108], [454.3, 108], [700, 100]]);
    expect(await fs.readFile(src)).toEqual(before);
    const cfg = await settings(dest);
    expect([cfg.printer_model, cfg.printer_settings_id, cfg.print_settings_id]).toEqual([U1_PRESETS.printer_model, U1_PRESETS.printer_settings_id, U1_PRESETS.print_settings_id]);
    expect([cfg.exclude_object, cfg.brim_type]).toEqual(['1', 'no_brim']);
    expect([cfg.enable_support, cfg.support_type, cfg.sparse_infill_density, cfg.skeleton_infill_density]).toEqual(['1', 'tree(auto)', '12%', undefined]);
    // CMYK source filaments land on the CMYK slots one to one
    expect(cfg.filament_max_volumetric_speed).toEqual(['22', '22', '12', '16']);
    expect(cfg.fan_max_speed).toEqual(['100', '100', '80', '40']);
    const [proc, ...rest] = cfg.different_settings_to_system;
    expect(proc.split(';')).toEqual(expect.arrayContaining(['enable_support', 'support_type', 'sparse_infill_density', 'exclude_object', 'brim_type']));
    expect(rest).toHaveLength(4 + 1);
    expect(rest[0].split(';')).toEqual(['filament_max_volumetric_speed', 'fan_max_speed']); // the source's per-filament keys (p1s has these two)
    const b = await JSZip.loadAsync(await fs.readFile(dest));
    expect(Object.keys(b.files).filter((f) => /plate_\d+\.json/.test(f))).toEqual([]); // stale slicer data dropped
    await expect(exportU1(src, dest)).rejects.toThrow(); // never overwrites unless told to
  });

  it('a print preset wins over the source settings; the rest of the source stays', async () => {
    const dir = await tmpDir();
    const src = await p1sProject(dir);
    const dest = path.join(dir, 'mini.3mf');
    await exportU1(src, dest, { presetSettings: exportPresetSettings('miniature', profiles, 0.4, 4) });
    const cfg = await settings(dest);
    expect([cfg.brim_type, cfg.brim_width, cfg.support_style, cfg.sparse_infill_pattern]).toEqual(['outer_only', '10', 'tree_hybrid', 'lightning']);
    expect(cfg.fan_max_speed).toEqual(['100', '100', '100', '100']); // preset, not the source's 80 / 40
    expect([cfg.sparse_infill_density, cfg.filament_max_volumetric_speed]).toEqual(['12%', ['22', '22', '12', '16']]); // source, no conflict
    expect(cfg.different_settings_to_system[0].split(';')).toEqual(expect.arrayContaining(['sparse_infill_density', 'brim_width', 'support_style', 'exclude_object']));
  });

  it('a U1 source keeps its plate positions but gets the fixes and carried settings too', async () => {
    const dir = await tmpDir();
    const src = await p1sProject(dir, { printer_model: 'Snapmaker U1', printer_settings_id: 'Snapmaker U1 (0.4 nozzle)', printable_area: U1_AREA });
    const dest = path.join(dir, 'u1.3mf');
    const r = await exportU1(src, dest, { u1Area: null }); // no Orca profiles needed
    expect(r.plates).toEqual([]);
    expect(await items(dest)).toEqual(await items(src));
    const cfg = await settings(dest);
    expect([cfg.exclude_object, cfg.brim_type, cfg.sparse_infill_density]).toEqual(['1', 'no_brim', '12%']);
  });

  it('leaves a plate whose objects exceed 270 x 270 where it was', async () => {
    const dir = await tmpDir();
    // the 10 mm cube scaled to 300 mm, still centred on the P1S bed (128,128)
    const huge = (xml) => xml.replace('transform="1 0 0 0 1 0 0 0 1 100 100 0"', 'transform="30 0 0 0 30 0 0 0 1 -22 -22 0"');
    const r = await exportU1(await p1sProject(dir, {}, huge), path.join(dir, 'out.3mf'));
    expect(r.plates[0]).toMatchObject({ plate: 1, status: 'kept' });
    expect(r.plates[0].reason).toMatch(/超過 U1 270×270 mm/);
  });

  it('a huge root model with inline meshes is never read as one string; only <build> changes', async () => {
    // 兔子警官拆件单色.3mf: 1.16 GB of mesh XML in 3D/3dmodel.model itself (no Objects/ files)
    // failed with "Invalid string length" (V8's maximum string length).
    const dir = await tmpDir();
    const cube = (id, x, y) => {
      const v = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], [0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10]];
      return `<object id="${id}" type="model"><mesh><vertices>${v.map(([a, b, c]) => `<vertex x="${a + x}" y="${b + y}" z="${c}"/>`).join('')}</vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>`;
    };
    const model = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>${cube(1, 0, 0)}${cube(2, 0, 0)}</resources>`
      + `<build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 120 120 0"/><item objectid="2" transform="1 0 0 0 1 0 0 0 1 444 120 0"/></build></model>`;
    const plates = [1, 2].map((p) => `<plate><metadata key="plater_id" value="${p}"/><model_instance><metadata key="object_id" value="${p}"/><metadata key="instance_id" value="0"/></model_instance></plate>`).join('');
    const zip = new JSZip();
    zip.file('_rels/.rels', '<Relationships><Relationship Target="/3D/3dmodel.model"/></Relationships>');
    zip.file('3D/3dmodel.model', model);
    zip.file('Metadata/model_settings.config', `<config>${plates}</config>`);
    zip.file('Metadata/project_settings.config', JSON.stringify(p1s()));
    const src = path.join(dir, 'inline.3mf');
    await fs.writeFile(src, await zip.generateAsync({ type: 'nodebuffer' }));
    // any whole-string read of the root model fails, as it does for a 1.16 GB file
    const proto = Object.getPrototypeOf(zip.file('3D/3dmodel.model'));
    const original = proto.async;
    proto.async = function (type, ...rest) {
      if (type === 'string' && this.name === '3D/3dmodel.model') throw new RangeError('Invalid string length');
      return original.call(this, type, ...rest);
    };
    let r;
    try {
      r = await exportU1(src, path.join(dir, 'inline-U1.3mf'));
    } finally {
      proto.async = original;
    }
    expect(r.plates).toEqual([
      { plate: 1, status: 'moved', dx: 7.5, dy: 8 },
      { plate: 2, status: 'moved', dx: 24.3, dy: 8 },
    ]);
    const out = await (await JSZip.loadAsync(await fs.readFile(path.join(dir, 'inline-U1.3mf')))).file('3D/3dmodel.model').async('string');
    const at = model.lastIndexOf('<build');
    expect(out.slice(0, out.lastIndexOf('<build'))).toBe(model.slice(0, at)); // meshes byte-identical
    expect([...out.matchAll(/transform="([^"]+)"/g)].map((m) => m[1].split(' ').slice(9, 11).map(Number))).toEqual([[127.5, 128], [468.3, 128]]);
  });

  it('a non-U1 source needs the local Orca profiles and a bed; nothing is written then', async () => {
    const dir = await tmpDir();
    const src = await p1sProject(dir);
    await expect(exportU1(src, path.join(dir, 'a.3mf'), { u1Area: null })).rejects.toThrow(/Snapmaker Orca/);
    const noBed = await p1sProject(await tmpDir(), { printable_area: undefined });
    await expect(exportU1(noBed, path.join(dir, 'b.3mf'))).rejects.toThrow(/盤面尺寸/);
    await expect(fs.access(path.join(dir, 'a.3mf'))).rejects.toThrow();
  });
});

describe('DB: source printer and the 非 U1 filter', () => {
  it('records the printer at import and filters / counts non-U1 projects', async () => {
    const dir = await tmpDir();
    const zip = await JSZip.loadAsync(await fs.readFile(path.join(FIXTURES, 'multiplate.3mf')));
    zip.file('Metadata/project_settings.config', JSON.stringify(p1s()));
    await fs.writeFile(path.join(dir, 'p1s.3mf'), await zip.generateAsync({ type: 'nodebuffer' }));
    const db = openDb(':memory:');
    const add = async (file, name) => insertModel(db, { name, relPath: `2026/${name}.3mf`, parsed: await parseFile(file) });
    await add(path.join(dir, 'p1s.3mf'), 'bambu');
    await add(path.join(FIXTURES, 'painted.3mf'), 'painted'); // filament colours only: not flagged
    const rows = Object.fromEntries(listModels(db).map((m) => [m.name, [m.source_printer, m.source_process]]));
    expect(rows).toEqual({ bambu: ['Bambu Lab P1S', '0.16mm High Quality @BBL X1C'], painted: ['', ''] });
    expect(listModels(db, { filter: 'nonu1' }).map((m) => m.name)).toEqual(['bambu']);
    expect(sidebarCounts(db).nonU1).toBe(1);
    expect(idsNeedingSourcePrinter(db)).toEqual([]); // set at import
  });
});
