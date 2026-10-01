// M18 (SPEC 3.9): Snapmaker U1 detection and conversion. The profile data
// below is synthetic test data in the local Orca profile layout (names and
// the few keys the converter reads), not copies of real profiles.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { loadU1Profiles } from '../../src/core/orcaProfiles.mjs';
import { detectPrinter, pickProcess, pickFilament, perFilament, u1ProjectSettings, plateCols, bedRect, convertToU1 } from '../../src/core/u1Convert.mjs';
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

describe('project settings for U1', () => {
  it('per-filament values: the source nozzle volume type entry of Bambu variant arrays', () => {
    expect(perFilament(p1s(), 'filament_max_volumetric_speed', 4)).toEqual(['22', '22', '12', '16']);
    expect(perFilament(p1s({ nozzle_volume_type: ['High Flow'] }), 'filament_max_volumetric_speed', 4)).toEqual(['29', '29', '18', '20']);
    expect(perFilament(p1s(), 'fan_max_speed', 4)).toEqual(['100', '100', '80', '40']);
    expect(perFilament(p1s(), 'missing_key', 4)).toBe(null);
  });

  it('U1 preset names, untouched colour table, carried settings and compatibility fixes', () => {
    const r = u1ProjectSettings(p1s(), profiles);
    const s = r.settings;
    expect([s.printer_model, s.printer_settings_id, s.print_settings_id, s.printer_variant]).toEqual(['Snapmaker U1', 'Snapmaker U1 (0.4 nozzle)', '0.12mm Standard @Snapmaker U1 (0.4 nozzle)', '0.4']);
    expect(s.filament_settings_id).toEqual(['Snapmaker PLA Matte @U1', 'Snapmaker PLA Basic @U1', 'Generic PLA Silk', 'Generic PETG']);
    expect(s.filament_colour).toEqual(['#00FFFF', '#FF00FF', '#FFFF00', '#000000']);
    expect(s.filament_max_volumetric_speed).toEqual(['22', '22', '12', '16']);
    expect([s.enable_support, s.support_type, s.sparse_infill_density]).toEqual(['1', 'tree(auto)', '12%']);
    expect(s.skeleton_infill_density).toBeUndefined();
    expect([s.exclude_object, s.brim_type, s.support_style]).toEqual(['1', 'no_brim', undefined]);
    expect(r.fixes).toEqual(['啟用 Exclude Object', '關閉 Brim']);
    expect(s.different_settings_to_system).toHaveLength(4 + 2);
    expect(s.different_settings_to_system[0].split(';')).toEqual(expect.arrayContaining(['enable_support', 'support_type', 'exclude_object', 'brim_type']));
  });

  it('variable layer height with tree supports -> Tree Hybrid; a fix already in the source is not reported', () => {
    const r = u1ProjectSettings(p1s({ exclude_object: '1' }), profiles, { variableLayerHeight: true });
    expect(r.settings.support_style).toBe('tree_hybrid');
    expect(r.fixes).toEqual(['關閉 Brim', '可變層高：Tree 支撐改為 Hybrid']);
    expect(u1ProjectSettings(p1s({ enable_support: '0' }), profiles, { variableLayerHeight: true }).settings.support_style).toBeUndefined();
  });
});

describe('plate grid', () => {
  it("follows Orca's column rule and bed rectangle", () => {
    expect([1, 2, 3, 4, 5, 7, 8, 9, 10].map(plateCols)).toEqual([1, 2, 2, 2, 3, 3, 3, 3, 4]);
    expect(bedRect(U1_AREA)).toMatchObject({ w: 270, h: 270, cx: 135.5, cy: 136 });
  });
});

describe('convertToU1', () => {
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

  it('moves each plate onto the U1 bed, keeps an unsafe plate, never touches paint/colours/source', async () => {
    const dir = await tmpDir();
    const src = await p1sProject(dir);
    const before = await fs.readFile(src);
    const dest = path.join(dir, 'p1s-U1.3mf');
    const r = await convertToU1(src, dest, profiles);
    expect(r.plates).toEqual([
      { plate: 1, status: 'moved', dx: 7.5, dy: 8 }, // bed centre (128,128) -> (135.5,136)
      { plate: 2, status: 'moved', dx: 24.3, dy: 8 }, // + grid stride 324 - 307.2
      { plate: 3, status: 'kept', reason: '物件不在來源盤面範圍內，無法安全換算' },
    ]);
    expect(await items(dest)).toEqual([[107.5, 108], [424.3, 108], [454.3, 108], [700, 100]]);
    expect(await fs.readFile(src)).toEqual(before); // source untouched
    const a = await JSZip.loadAsync(before);
    const b = await JSZip.loadAsync(await fs.readFile(dest));
    // meshes with paint_color and the per-object settings are byte-identical
    for (const f of ['3D/Objects/object_1.model', 'Metadata/model_settings.config']) expect(await b.file(f).async('string')).toBe(await a.file(f).async('string'));
    expect(JSON.parse(await b.file('Metadata/project_settings.config').async('string')).filament_colour).toEqual(p1s().filament_colour);
    expect(Object.keys(b.files).filter((f) => /plate_\d+\.json/.test(f))).toEqual([]); // stale slicer data dropped
    await expect(convertToU1(src, dest, profiles)).rejects.toThrow(); // never overwrites
  });

  it('leaves a plate whose objects exceed 270 x 270 where it was', async () => {
    const dir = await tmpDir();
    // the 10 mm cube scaled to 300 mm, still centred on the P1S bed (128,128)
    const huge = (xml) => xml.replace('transform="1 0 0 0 1 0 0 0 1 100 100 0"', 'transform="30 0 0 0 30 0 0 0 1 -22 -22 0"');
    const r = await convertToU1(await p1sProject(dir, {}, huge), path.join(dir, 'out.3mf'), profiles);
    expect(r.plates[0]).toMatchObject({ plate: 1, status: 'kept' });
    expect(r.plates[0].reason).toMatch(/超過 U1 270×270 mm/);
  });

  it('refuses U1 projects, projects without settings and missing profiles', async () => {
    const dir = await tmpDir();
    await expect(convertToU1(await p1sProject(dir, { printer_model: 'Snapmaker U1' }), path.join(dir, 'a.3mf'), profiles)).rejects.toThrow(/已經是 Snapmaker U1/);
    await expect(convertToU1(path.join(FIXTURES, 'multiplate.3mf'), path.join(dir, 'b.3mf'), null)).rejects.toThrow(/Snapmaker Orca/);
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
