// M34 (SPEC 3.15 draft): the user's nozzle and print presets for the 3MF export.
// Settings are written into the exported project_settings.config next to U1
// system preset names; Orca fills in everything else from those presets (as
// for the M9 export and the M18 conversion).
//
// 「公仔」 (miniature) follows r/PrintedMinis "FDM miniatures - How I support
// them and some updates" (u/HOHansen), scaled to the user's nozzle: lowest
// layer height, first layer 0.2, tree supports with Top Z distance = layer
// height and no interface layers, infill inside the supports (base pattern
// rectilinear, spacing 1.2 mm), a 10 mm brim (user's choice), Arachne with 30 % minimum
// feature size, line width = nozzle for the 0.2 nozzle, ~100 % cooling except
// the first layer. Orientation (tilt back 20-45°) cannot be set by a file.
// The support style is Tree Hybrid: U1's "default" style is Organic, which
// ignores the base pattern and keeps every branch hollow (Orca: smsDefault ->
// smsTreeOrganic; TreeSupport3D zeroes the tree density). User-sliced
// 2026-10-12 on the same model: Organic gave identical G-code with
// rectilinear and default; Tree Hybrid printed rectilinear lines inside.
// Sparse infill stays the U1 preset's (pattern and 15 % density): lightning
// infill was tried on 2026-10-12 to hollow the figure out and removed again
// on 2026-10-18 at the user's request (「不要這樣中空，預設的就好」).
// 「公仔＋熨燙」 adds ironing of all top surfaces (user's request; U1 defaults
// already match the usual speed 30 / flow 8 %), with a line spacing of 25 % of
// the nozzle instead of U1's 0.15 mm. Not "topmost": Orca irons only the
// object's last layer then (Fill.cpp: upper_layer == nullptr), i.e. the top
// of the head, never the base.
import { pickProcess, pickFilament } from './u1Convert.mjs';
import { t } from './i18n/index.mjs';
import { DEFAULT_NOZZLE } from './nozzle.mjs';

/** Lowest layer height a U1 nozzle allows (machine profile; 20 % of the nozzle when not known). */
const minLayer = (machine, nozzle) => (Number.isFinite(machine?.minLayerHeight) ? machine.minLayerHeight : Math.round(nozzle * 0.2 * 100) / 100);
const str = (v) => String(Math.round(v * 1000) / 1000);

/** The U1 machine preset and the export's default filament preset for a nozzle. */
function nozzlePresets(profiles, nozzle) {
  const machine = profiles.machines.find((m) => m.nozzle === nozzle);
  const filament =
    profiles.filaments.find((f) => f.nozzle === nozzle && f.name.startsWith('Snapmaker PLA SnapSpeed @U1')) || pickFilament(profiles, nozzle, 'PLA');
  if (!machine || !filament) throw new Error(t('u1.err.noNozzleProfile', { nozzle }));
  return { machine, filament };
}

/**
 * project_settings.config entries for an export with `preset` on `nozzle`
 * (n = number of filaments). Merged over the export's own settings.
 * - original on the 0.4 nozzle, or without local Orca profiles: {} (the
 *   export's fixed U1 0.4 presets, unchanged since M9)
 * - original on another nozzle: that nozzle's machine, process and filament presets
 * - miniature: the presets for the nozzle plus the miniature settings
 * - miniatureIroning: miniature plus ironing of the top surfaces
 */
export function exportPresetSettings(preset, profiles, nozzle, n) {
  const miniature = preset === 'miniature' || preset === 'miniatureIroning';
  if (!miniature && (nozzle === DEFAULT_NOZZLE || !profiles)) return {};
  if (!profiles) throw new Error(t('u1.err.noOrca'));
  const { machine, filament } = nozzlePresets(profiles, nozzle);
  if (!miniature) {
    const process = pickProcess(profiles, nozzle, 0.2);
    return {
      printer_settings_id: machine.name,
      printer_variant: String(nozzle),
      print_settings_id: process.name,
      filament_settings_id: Array(n).fill(filament.name),
    };
  }
  const layer = minLayer(machine, nozzle);
  const process = [...profiles.processes.filter((p) => p.nozzle === nozzle)].sort((a, b) => a.layerHeight - b.layerHeight || a.name.localeCompare(b.name))[0];
  const out = {
    printer_settings_id: machine.name,
    printer_variant: String(nozzle),
    print_settings_id: process.name,
    filament_settings_id: Array(n).fill(filament.name),
    layer_height: str(layer),
    initial_layer_print_height: str(Math.max(0.2, layer)),
    enable_support: '1',
    support_type: 'tree(auto)',
    support_style: 'tree_hybrid',
    support_top_z_distance: str(layer),
    support_interface_top_layers: '0',
    support_interface_bottom_layers: '0',
    support_base_pattern: 'rectilinear',
    support_base_pattern_spacing: '1.2',
    brim_type: 'outer_only',
    brim_width: '10',
    wall_generator: 'arachne',
    min_feature_size: '30%',
    fan_min_speed: Array(n).fill('100'),
    fan_max_speed: Array(n).fill('100'),
    close_fan_the_first_x_layers: Array(n).fill('1'),
  };
  if (nozzle === 0.2) {
    for (const k of ['line_width', 'outer_wall_line_width', 'inner_wall_line_width', 'top_surface_line_width', 'sparse_infill_line_width', 'internal_solid_infill_line_width']) out[k] = '0.2';
  }
  if (preset === 'miniatureIroning') {
    out.ironing_type = 'top';
    out.ironing_spacing = str(nozzle * 0.25);
  }
  // Orca keeps project values only for the keys listed as changed from the
  // system presets ([process; filament 1..n; printer], as the U1 conversion
  // writes it); unlisted keys fall back to the preset (user-checked in Orca:
  // supports and brim were ignored without this list, applied with it).
  const filamentKeys = ['fan_min_speed', 'fan_max_speed', 'close_fan_the_first_x_layers'];
  const processKeys = Object.keys(out).filter((k) => !k.endsWith('_settings_id') && k !== 'printer_variant' && !filamentKeys.includes(k));
  out.different_settings_to_system = [processKeys.join(';'), ...Array(n).fill(filamentKeys.join(';')), ''];
  return out;
}
