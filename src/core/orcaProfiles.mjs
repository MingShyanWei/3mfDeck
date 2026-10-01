// M18 (SPEC 3.9): read the locally installed Snapmaker Orca system profiles —
// the only data source for U1 preset names and bed geometry. Nothing is
// bundled with the app and nothing is fetched: if Orca is not installed the
// conversion reports that instead.
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_PROFILES_DIR = '/Applications/Snapmaker Orca.app/Contents/Resources/profiles';
export const U1_MODEL = 'Snapmaker U1';

// name -> raw JSON for one vendor sub-directory (machine/process/filament)
function readKind(dir) {
  const out = new Map();
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return out;
  }
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (j.name) out.set(j.name, j);
    } catch {
      // a malformed profile is skipped, never fatal
    }
  }
  return out;
}

// Value of `key` following the inherits chain (Orca profile inheritance)
function resolver(map) {
  return (name, key) => {
    for (let p = map.get(name), guard = 0; p && guard < 20; p = map.get(p.inherits), guard++) {
      if (p[key] !== undefined) return p[key];
    }
    return undefined;
  };
}

const first = (v) => (Array.isArray(v) ? v[0] : v);

/**
 * U1 presets from the local Snapmaker vendor profiles:
 * { machines: [{name, nozzle, printableArea}], processes: [{name, nozzle, layerHeight}],
 *   filaments: [{name, nozzle, type}] } — instantiable presets only.
 * Returns null when the profiles are not installed.
 */
export function loadU1Profiles(dir = DEFAULT_PROFILES_DIR) {
  const base = path.join(dir, 'Snapmaker');
  const machines = readKind(path.join(base, 'machine'));
  if (!machines.size) return null;
  const processes = readKind(path.join(base, 'process'));
  const filaments = readKind(path.join(base, 'filament'));
  const m = resolver(machines);
  const p = resolver(processes);
  const f = resolver(filaments);
  const inst = (j) => String(j.instantiation) === 'true';

  const u1Machines = [...machines.values()]
    .filter((j) => inst(j) && m(j.name, 'printer_model') === U1_MODEL)
    .map((j) => ({ name: j.name, nozzle: Number(first(m(j.name, 'nozzle_diameter'))), printableArea: m(j.name, 'printable_area') }));
  const forMachine = (j, resolve) => {
    const compat = resolve(j.name, 'compatible_printers') || [];
    return u1Machines.find((x) => compat.includes(x.name));
  };
  const u1Processes = [...processes.values()]
    .filter((j) => inst(j) && forMachine(j, p))
    .map((j) => ({ name: j.name, nozzle: forMachine(j, p).nozzle, layerHeight: Number(p(j.name, 'layer_height')) }));
  const u1Filaments = [...filaments.values()]
    .filter((j) => inst(j) && forMachine(j, f))
    .map((j) => ({ name: j.name, nozzle: forMachine(j, f).nozzle, type: first(f(j.name, 'filament_type')) || '' }));
  return { machines: u1Machines, processes: u1Processes, filaments: u1Filaments };
}

/** printable_area of a non-U1 machine preset by name (any vendor), or null. */
export function machinePrintableArea(printerSettingsId, dir = DEFAULT_PROFILES_DIR) {
  let vendors = [];
  try {
    vendors = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return null;
  }
  for (const v of vendors) {
    const machines = readKind(path.join(dir, v, 'machine'));
    if (!machines.has(printerSettingsId)) continue;
    return resolver(machines)(printerSettingsId, 'printable_area') || null;
  }
  return null;
}
