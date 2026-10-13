// M34 (SPEC 3.15 draft): the user's nozzle and the 公仔 (miniature) export preset.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { exportPresetSettings } from '../../src/core/printPreset.mjs';
import { NOZZLES, DEFAULT_NOZZLE, parseNozzle } from '../../src/core/nozzle.mjs';
import { exportProjectSettings, U1_PRESETS } from '../../src/core/exportMapping.mjs';
import { loadU1Profiles, DEFAULT_PROFILES_DIR } from '../../src/core/orcaProfiles.mjs';
import { U1_SLOTS } from '../../src/core/filament.mjs';
import { tmpDir } from './helpers.mjs';
import en from '../../src/core/i18n/en.mjs';
import zhTW from '../../src/core/i18n/zh-TW.mjs';
import zhCN from '../../src/core/i18n/zh-CN.mjs';

// synthetic profiles in the shape loadU1Profiles returns (not copies of real presets)
const machine = (n, minLayerHeight) => ({ name: `Snapmaker U1 (${n} nozzle)`, nozzle: n, printableArea: ['0.5x1', '270.5x1', '270.5x271', '0.5x271'], minLayerHeight });
const profiles = {
  machines: [machine(0.2, 0.04), machine(0.4, 0.08), machine(0.6, NaN)],
  processes: [
    { name: '0.08mm High Quality @Snapmaker U1 (0.2 nozzle)', nozzle: 0.2, layerHeight: 0.08 },
    { name: '0.12mm Standard @Snapmaker U1 (0.2 nozzle)', nozzle: 0.2, layerHeight: 0.12 },
    { name: '0.08mm Standard @Snapmaker U1 (0.4 nozzle)', nozzle: 0.4, layerHeight: 0.08 },
    { name: '0.20mm Standard @Snapmaker U1 (0.4 nozzle)', nozzle: 0.4, layerHeight: 0.2 },
    { name: '0.18mm Standard @Snapmaker U1 (0.6 nozzle)', nozzle: 0.6, layerHeight: 0.18 },
  ],
  filaments: [
    { name: 'Snapmaker PLA SnapSpeed @U1', nozzle: 0.4, type: 'PLA' },
    { name: 'Snapmaker PLA SnapSpeed @U1 0.2 nozzle', nozzle: 0.2, type: 'PLA' },
    { name: 'Generic PLA @U1 0.6 nozzle', nozzle: 0.6, type: 'PLA' },
  ],
};

describe('nozzle setting', () => {
  it('U1 nozzles only; 0.4 by default', () => {
    expect(NOZZLES).toEqual([0.2, 0.4, 0.6, 0.8]);
    expect(DEFAULT_NOZZLE).toBe(0.4);
    expect([parseNozzle('0.2'), parseNozzle(0.6), parseNozzle(0.5), parseNozzle('x')]).toEqual([0.2, 0.6, null, null]);
  });
});

describe('原檔設定 (original)', () => {
  it('0.4 nozzle (or no local profiles): the export stays exactly as before', () => {
    expect(exportPresetSettings('original', profiles, 0.4, 4)).toEqual({});
    expect(exportPresetSettings('original', null, 0.2, 4)).toEqual({});
    const cfg = JSON.parse(exportProjectSettings(U1_SLOTS, null, exportPresetSettings('original', profiles, 0.4, 4)));
    expect([cfg.printer_settings_id, cfg.print_settings_id, cfg.filament_settings_id[0]]).toEqual([U1_PRESETS.printer_settings_id, U1_PRESETS.print_settings_id, U1_PRESETS.filament_settings_id]);
  });
  it('another nozzle: that nozzle’s machine, closest-to-0.2 process and filament presets', () => {
    expect(exportPresetSettings('original', profiles, 0.2, 2)).toEqual({
      printer_settings_id: 'Snapmaker U1 (0.2 nozzle)',
      printer_variant: '0.2',
      print_settings_id: '0.12mm Standard @Snapmaker U1 (0.2 nozzle)',
      filament_settings_id: ['Snapmaker PLA SnapSpeed @U1 0.2 nozzle', 'Snapmaker PLA SnapSpeed @U1 0.2 nozzle'],
    });
  });
});

describe('公仔 (miniature)', () => {
  it('the in-app hint names what the preset writes (Tree Hybrid with infill, lightning infill), in every language', () => {
    const s = exportPresetSettings('miniature', profiles, 0.4, 1);
    expect([s.support_style, s.sparse_infill_pattern]).toEqual(['tree_hybrid', 'lightning']);
    for (const dict of [en, zhTW, zhCN]) {
      expect(dict['printPreset.miniatureHint']).toMatch(/Tree Hybrid/);
      expect(dict['printPreset.miniatureHint']).toMatch(/lightning|閃電|闪电/);
    }
  });
  it('0.4 nozzle: lowest layer 0.08, first layer 0.2, tree supports with Top Z = layer, no interface, infill in supports, 10 mm brim, Arachne 30 %, cooling', () => {
    const s = exportPresetSettings('miniature', profiles, 0.4, 3);
    expect(s).toMatchObject({
      printer_settings_id: 'Snapmaker U1 (0.4 nozzle)',
      print_settings_id: '0.08mm Standard @Snapmaker U1 (0.4 nozzle)',
      layer_height: '0.08',
      initial_layer_print_height: '0.2',
      enable_support: '1',
      support_type: 'tree(auto)',
      support_style: 'tree_hybrid', // Organic (U1's default style) ignores the base pattern
      support_top_z_distance: '0.08',
      support_interface_top_layers: '0',
      support_interface_bottom_layers: '0',
      support_base_pattern: 'rectilinear',
      support_base_pattern_spacing: '1.2',
      brim_type: 'outer_only',
      brim_width: '10',
      wall_generator: 'arachne',
      min_feature_size: '30%',
      sparse_infill_pattern: 'lightning', // interior mostly hollow; tops still carried
      fan_min_speed: ['100', '100', '100'],
      fan_max_speed: ['100', '100', '100'],
      close_fan_the_first_x_layers: ['1', '1', '1'],
    });
    expect(s.line_width).toBeUndefined(); // the 0.4 nozzle keeps U1's line widths
  });
  it('lists every changed key in different_settings_to_system (Orca ignores unlisted project values)', () => {
    const s = exportPresetSettings('miniature', profiles, 0.4, 2);
    const [proc, f1, f2, printer] = s.different_settings_to_system;
    expect(proc.split(';')).toEqual(expect.arrayContaining(['layer_height', 'enable_support', 'support_style', 'support_top_z_distance', 'brim_type', 'brim_width', 'wall_generator', 'min_feature_size', 'sparse_infill_pattern', 'support_base_pattern_spacing']));
    expect(proc).not.toMatch(/settings_id|printer_variant|fan_/);
    expect([f1, f2, printer]).toEqual(['fan_min_speed;fan_max_speed;close_fan_the_first_x_layers', 'fan_min_speed;fan_max_speed;close_fan_the_first_x_layers', '']);
    expect(s.different_settings_to_system).toHaveLength(4);
    expect(exportPresetSettings('miniature', profiles, 0.2, 1).different_settings_to_system[0]).toContain('outer_wall_line_width');
  });
  it('0.2 nozzle: the post’s own setup — 0.04 layers, Top Z 0.04, line width 0.2 (supports untouched)', () => {
    const s = exportPresetSettings('miniature', profiles, 0.2, 1);
    expect(s).toMatchObject({ print_settings_id: '0.08mm High Quality @Snapmaker U1 (0.2 nozzle)', layer_height: '0.04', initial_layer_print_height: '0.2', support_top_z_distance: '0.04', line_width: '0.2', outer_wall_line_width: '0.2' });
    expect(s.support_line_width).toBeUndefined();
  });
  it('a machine profile without min_layer_height: 20 % of the nozzle', () => {
    expect(exportPresetSettings('miniature', profiles, 0.6, 1)).toMatchObject({ layer_height: '0.12', initial_layer_print_height: '0.2', support_top_z_distance: '0.12' });
  });
  it('公仔＋熨燙: the miniature settings plus ironing of all top surfaces, spacing 25 % of the nozzle, listed as changed', () => {
    const mini = exportPresetSettings('miniature', profiles, 0.4, 2);
    const s = exportPresetSettings('miniatureIroning', profiles, 0.4, 2);
    expect(s).toMatchObject({ ...mini, different_settings_to_system: expect.any(Array), ironing_type: 'top', ironing_spacing: '0.1' });
    expect(s.different_settings_to_system[0].split(';')).toEqual([...mini.different_settings_to_system[0].split(';'), 'ironing_type', 'ironing_spacing']);
    expect(mini.ironing_type).toBeUndefined();
    expect(exportPresetSettings('miniatureIroning', profiles, 0.2, 1).ironing_spacing).toBe('0.05');
  });
  it('needs the local Orca profiles', () => {
    expect(() => exportPresetSettings('miniature', null, 0.4, 1)).toThrow(/Snapmaker Orca/);
  });
  it('is merged over the export’s presets; mixed filaments stay', () => {
    const cfg = JSON.parse(exportProjectSettings(U1_SLOTS, '1,2,1,1,50', exportPresetSettings('miniature', profiles, 0.4, 4)));
    expect([cfg.print_settings_id, cfg.layer_height, cfg.mixed_filament_definitions, cfg.filament_colour.length]).toEqual(['0.08mm Standard @Snapmaker U1 (0.4 nozzle)', '0.08', '1,2,1,1,50', 4]);
  });
});

describe('profiles: min_layer_height', () => {
  it('loadU1Profiles reads each machine’s lowest layer height', async () => {
    const dir = await tmpDir('mfcab-profiles-');
    const put = (kind, j) => { fs.mkdirSync(path.join(dir, 'Snapmaker', kind), { recursive: true }); fs.writeFileSync(path.join(dir, 'Snapmaker', kind, `${j.name}.json`), JSON.stringify(j)); };
    put('machine', { name: 'fdm_U1', instantiation: 'false', min_layer_height: ['0.08'] });
    put('machine', { name: 'Snapmaker U1 (0.4 nozzle)', inherits: 'fdm_U1', instantiation: 'true', printer_model: 'Snapmaker U1', nozzle_diameter: ['0.4'] });
    expect(loadU1Profiles(dir).machines[0]).toMatchObject({ nozzle: 0.4, minLayerHeight: 0.08 });
  });

  const real = fs.existsSync(path.join(DEFAULT_PROFILES_DIR, 'Snapmaker'));
  it.skipIf(!real)('with the installed Snapmaker Orca: the real preset names and layer limits', () => {
    const p = loadU1Profiles(DEFAULT_PROFILES_DIR);
    expect(exportPresetSettings('miniature', p, 0.4, 1)).toMatchObject({ print_settings_id: '0.08mm Standard @Snapmaker U1 (0.4 nozzle)', layer_height: '0.08', filament_settings_id: ['Snapmaker PLA SnapSpeed @U1'] });
    expect(exportPresetSettings('miniature', p, 0.2, 1)).toMatchObject({ print_settings_id: '0.08mm High Quality @Snapmaker U1 (0.2 nozzle)', layer_height: '0.04', filament_settings_id: ['Snapmaker PLA SnapSpeed @U1 0.2 nozzle'] });
  });
});
