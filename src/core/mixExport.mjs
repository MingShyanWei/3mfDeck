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
import { nearestSlot, deltaE2000, rgbToLab, hexToRgb, slotName, MIX_DELTA_E } from './filament.mjs';
import { mixFilamentHex } from './filamentMixer.mjs';

const mixCache = new Map();

/**
 * Best two-spool pigment mix for a colour: ordered spool pairs x mix_b_percent
 * 0..100 (1 % steps), minimising CIEDE2000 to the target.
 * Returns { compA, compB, mixB, mixHex, deltaE }.
 */
export function bestMix(hex, slots) {
  if (slots.length < 2) return null; // no pair to blend
  const key = hex + '|' + slots.map((s) => s.hex).join();
  if (mixCache.has(key)) return mixCache.get(key);
  const target = rgbToLab(hexToRgb(hex));
  let best = null;
  for (const A of slots) {
    for (const B of slots) {
      if (A.slot === B.slot) continue;
      for (let b = 0; b <= 100; b++) {
        const mixHex = mixFilamentHex(A.hex, B.hex, 1 - b / 100);
        const d = deltaE2000(target, rgbToLab(hexToRgb(mixHex)));
        if (!best || d < best.deltaE) best = { compA: A.slot, compB: B.slot, mixB: b, mixHex, deltaE: d };
      }
    }
  }
  best.deltaE = Math.round(best.deltaE * 10) / 10;
  best.text = `${slotName(slots.find((s) => s.slot === best.compA))} ${100 - best.mixB}%＋${slotName(slots.find((s) => s.slot === best.compB))} ${best.mixB}%`;
  mixCache.set(key, best);
  return best;
}

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
