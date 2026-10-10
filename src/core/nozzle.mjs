// M34 (SPEC 3.15 draft): the nozzle sizes a Snapmaker U1 has system profiles
// for, and the print presets of the 3MF export. No Node APIs: shared by main
// and the renderer (settings page, export dropdown).
export const NOZZLES = [0.2, 0.4, 0.6, 0.8];
export const DEFAULT_NOZZLE = 0.4;
export const PRINT_PRESETS = ['original', 'miniature', 'miniatureIroning'];

/** Validated nozzle size from settings input (null when not one of NOZZLES). */
export function parseNozzle(v) {
  const n = Number(v);
  return NOZZLES.includes(n) ? n : null;
}
