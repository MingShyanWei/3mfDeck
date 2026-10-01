// M10 (SPEC 3.5c): Full Spectrum mixed-filament export planning.
// A "mix" is a virtual extruder defined in project_settings.config
// mixed_filament_definitions: a pigment blend of TWO physical spools, with
// mix_b_percent = component B's share. The printed colour follows Orca's
// FilamentMixer pigment model (port: filamentMixer.mjs), NOT an RGB average.
//
// Row grammar (modern dialect, verified against the user's ground-truth file
// Filament+Swatch+Sample+Card-U1-量化4捲_mix.3mf and the reverse-engineered
// spec in SamiSalah221/3mf-to-glb docs / ratdoux MixedFilament.cpp):
//   compA, compB, enabled, custom, mix_b_percent, pointillism,
//   g<ids>, w<wts>, m<distMode>, z<N>, xa<off>, xb<off>, d<deleted>,
//   o<origin>, u<stableId> [, cm<N>]
// Virtual extruder id = baseCount + (1-based ordinal among enabled,
// non-deleted rows). filament_colour stays physical-only; Orca derives the
// swatch colour of a mix from the definition itself.
import { nearestSlot, bestMix, MIX_DELTA_E } from './filament.mjs';

// bestMix (the two-spool pigment search) lives in filament.mjs so printPlan can
// use it without an import cycle; re-exported here for existing callers.
export { bestMix };

/**
 * How a colour is printed when mixed filaments are available (M10):
 * - 'single': nearest spool within threshold
 * - 'mix':    best two-spool pigment blend (mixable false when even that
 *             stays > threshold: cannot be printed from these spools)
 * `extruder` is the id paint_color/model_settings must carry.
 */
export function mixPrintPlan(hex, slots, threshold = MIX_DELTA_E) {
  const near = nearestSlot(hex, slots);
  if (near.deltaE <= threshold) return { mode: 'single', extruder: near.slot, hex: near.hex, deltaE: Math.round(near.deltaE * 10) / 10 };
  const mix = bestMix(hex, slots);
  if (!mix) return { mode: 'mix', mix, mixable: false, extruder: near, hex: near.hex, deltaE: Math.round(near.deltaE * 10) / 10, nearest: near };
  const mixable = mix.deltaE <= threshold;
  return { mode: 'mix', mix, mixable, extruder: mix, hex: mix.mixHex, deltaE: mix.deltaE, nearest: near };
}

/**
 * mixed_filament_definitions string for the given mix plans (first-appearance
 * order): one enabled, non-deleted, non-gradient row each. `u` ids are 1-based
 * ordinals matching the enumeration the slicer performs.
 */
export function mixedFilamentDefinitions(mixes) {
  return mixes
    .map((m, i) => `${m.compA},${m.compB},1,1,${m.mixB},0,g,w,m0,z0,xa0,xb0,d0,o0,u${i + 1},cm2`)
    .join(';');
}

/** Extra project_settings keys a mixed-filament project carries (defaults, from the ground-truth file). Values are STRINGS — Orca's load_from_json rejects numeric types ("invalid json type for ..."). */
export const MIXED_PROJECT_DEFAULTS = {
  mixed_color_layer_height_a: '0',
  mixed_color_layer_height_b: '0',
  mixed_filament_gradient_mode: '0',
  mixed_filament_advanced_dithering: '0',
  mixed_filament_component_bias_enabled: '0',
  mixed_filament_height_lower_bound: '0.04',
  mixed_filament_height_upper_bound: '0.16',
  mixed_filament_pointillism_line_gap: '0',
  mixed_filament_pointillism_pixel_size: '0',
  mixed_filament_region_collapse: '1',
  mixed_filament_surface_indentation: '0',
};
