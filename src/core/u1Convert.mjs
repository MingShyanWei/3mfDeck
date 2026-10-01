// M18 (SPEC 3.9): Snapmaker U1 compatibility — detection and a self-written
// converter. The output is a copy (the source is never touched) that keeps
// the model, paint_color and the filament colour table exactly as they are;
// only the printer/process/filament presets, a few compatibility settings and
// the plate positions change. Preset names and bed geometry come from the
// locally installed Snapmaker Orca profiles (orcaProfiles.mjs).
import fs from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import JSZip from 'jszip';
import { U1_MODEL } from './orcaProfiles.mjs';
import { t } from './i18n/index.mjs';

/** Printer info of a project_settings object: { printer, settingsId, process, isU1 }, or null without one. */
export function detectPrinter(ps) {
  if (!ps || (!ps.printer_model && !ps.printer_settings_id)) return null;
  const printer = ps.printer_model || '';
  const settingsId = ps.printer_settings_id || '';
  return { printer, settingsId, process: ps.print_settings_id || '', isU1: printer === U1_MODEL || settingsId.startsWith(U1_MODEL) };
}

// ---- presets -----------------------------------------------------------------

const NOZZLES = [0.2, 0.4, 0.6, 0.8];
const nearestNozzle = (d) => NOZZLES.reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a));

/** U1 process for a nozzle: the closest layer height, 「Standard」 on ties. */
export function pickProcess(profiles, nozzle, layerHeight) {
  const list = profiles.processes.filter((p) => p.nozzle === nozzle);
  const score = (p) => Math.abs(p.layerHeight - layerHeight) * 100 + (p.name.includes('Standard') ? 0 : 0.5);
  return list.sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name))[0] || null;
}

// Words that name a filament sub-type in preset names (Bambu and Snapmaker alike)
const VARIANTS = ['Basic', 'Matte', 'Silk', 'Glow', 'Wood', 'Translucent', 'Rainbow', 'High Speed', 'HF', 'CF', 'GF', 'Tough', 'Support'];

/** U1 filament preset for one source filament: same type, same sub-type word when there is one. */
export function pickFilament(profiles, nozzle, type, sourceName = '') {
  const list = profiles.filaments.filter((f) => f.nozzle === nozzle && f.type.toUpperCase() === String(type || 'PLA').toUpperCase());
  const variant = VARIANTS.find((v) => sourceName.includes(` ${v}`));
  const score = (f) =>
    (variant && f.name.includes(variant) ? 4 : 0) +
    (f.name === `Generic ${type}` || f.name.startsWith(`Generic ${type} @U1`) ? 2 : 0) +
    (!variant && VARIANTS.some((v) => f.name.includes(` ${v}`)) ? -1 : 0);
  return list.sort((a, b) => score(b) - score(a) || a.name.length - b.name.length || a.name.localeCompare(b.name))[0] || null;
}

// Process settings the user changed on the source printer that mean the same on U1
const PROCESS_CARRY = [
  'enable_support', 'support_type', 'support_threshold_angle', 'support_on_build_plate_only', 'support_remove_small_overhang',
  'support_base_pattern', 'support_interface_top_layers', 'sparse_infill_density', 'sparse_infill_pattern', 'wall_loops',
  'top_shell_layers', 'bottom_shell_layers', 'top_surface_pattern', 'bottom_surface_pattern', 'ironing_type', 'seam_position',
  'wall_generator', 'raft_layers', 'infill_direction',
];
// Per-filament settings kept from the source (SPEC 3.9 item 4): flow limit, temperatures, cooling
const FILAMENT_CARRY = [
  'filament_max_volumetric_speed', 'filament_flow_ratio', 'nozzle_temperature', 'nozzle_temperature_initial_layer',
  'nozzle_temperature_range_low', 'nozzle_temperature_range_high', 'hot_plate_temp', 'hot_plate_temp_initial_layer',
  'textured_plate_temp', 'textured_plate_temp_initial_layer', 'cool_plate_temp', 'cool_plate_temp_initial_layer',
  'eng_plate_temp', 'eng_plate_temp_initial_layer', 'fan_min_speed', 'fan_max_speed', 'fan_cooling_layer_time',
  'slow_down_layer_time', 'slow_down_min_speed', 'overhang_fan_speed', 'overhang_fan_threshold',
  'close_fan_the_first_x_layers', 'full_fan_speed_layer', 'additional_cooling_fan_speed', 'reduce_fan_stop_start_freq',
];

/**
 * One value per filament from a source array. Bambu 2.x projects store some
 * filament settings once per extruder variant (Direct Drive Standard / High
 * Flow): `filament_extruder_variant` names each entry and `filament_self_index`
 * its filament; the entry for the source's nozzle volume type is kept.
 */
export function perFilament(ps, key, n) {
  const v = ps[key];
  if (!Array.isArray(v)) return null;
  if (v.length === n) return v.map(String);
  const variants = ps.filament_extruder_variant;
  const owners = ps.filament_self_index;
  if (!Array.isArray(variants) || !Array.isArray(owners) || variants.length !== v.length) return null;
  const want = `Direct Drive ${(ps.nozzle_volume_type || ['Standard'])[0]}`;
  const out = [];
  for (let i = 1; i <= n; i++) {
    const idx = owners.map((o, j) => (Number(o) === i ? j : -1)).filter((j) => j >= 0);
    const pick = idx.find((j) => variants[j] === want) ?? idx[0];
    if (pick === undefined) return null;
    out.push(String(v[pick]));
  }
  return out;
}

/**
 * project_settings.config for the converted project: U1 system preset names
 * (Orca loads those presets, as verified for the M9 export) plus the settings
 * that must survive the move — the source's own process tweaks, per-filament
 * overrides, the colour table — and the compatibility fixes.
 */
export function u1ProjectSettings(ps, profiles, { variableLayerHeight = false } = {}) {
  const nozzle = nearestNozzle(Number([].concat(ps.nozzle_diameter ?? 0.4)[0]));
  const machine = profiles.machines.find((m) => m.nozzle === nozzle);
  const process = pickProcess(profiles, nozzle, Number(ps.layer_height ?? 0.2));
  if (!machine || !process) throw new Error(t('u1.err.noNozzleProfile', { nozzle }));
  const colours = ps.filament_colour || [];
  const n = colours.length;
  const types = (ps.filament_type || []).slice(0, n);
  const sourceNames = [].concat(ps.filament_settings_id || []);
  const filaments = colours.map((_, i) => pickFilament(profiles, nozzle, types[i] || 'PLA', sourceNames[i] || '') || pickFilament(profiles, nozzle, 'PLA'));

  const out = {
    printer_model: U1_MODEL,
    printer_settings_id: machine.name,
    printer_variant: String(nozzle),
    print_settings_id: process.name,
    filament_settings_id: filaments.map((f) => f.name),
    filament_colour: colours,
    filament_type: filaments.map((f, i) => types[i] || f.type),
  };
  const processKeys = [];
  const userChanged = new Set(String([].concat(ps.different_settings_to_system || [''])[0]).split(';').filter(Boolean));
  // supports the source prints with keep their kind (tree/normal), not the U1 preset's
  if (String(ps.enable_support) === '1') userChanged.add('support_type');
  for (const k of PROCESS_CARRY) {
    if (userChanged.has(k) && ps[k] !== undefined) {
      out[k] = ps[k];
      processKeys.push(k);
    }
  }
  // Compatibility fixes
  const fixes = [];
  // Always written (the U1 preset might differ); listed as a fix only when the source had it otherwise
  const set = (k, v, note) => {
    out[k] = v;
    if (!processKeys.includes(k)) processKeys.push(k);
    if (String(ps[k]) !== v) fixes.push(note);
  };
  set('exclude_object', '1', t('u1.fix.excludeObject'));
  set('brim_type', 'no_brim', t('u1.fix.noBrim'));
  const supportType = String(out.support_type ?? ps.support_type ?? '');
  const supportsOn = String(out.enable_support ?? ps.enable_support ?? '0') === '1';
  if (variableLayerHeight && supportsOn && supportType.startsWith('tree')) {
    // Orca: "Variable layer height is not supported with Organic supports" (Tree default = Organic)
    out.support_type = supportType;
    set('support_style', 'tree_hybrid', t('u1.fix.treeHybrid'));
  }
  const filamentKeys = colours.map(() => []);
  for (const k of FILAMENT_CARRY) {
    const vals = perFilament(ps, k, n);
    if (!vals) continue;
    out[k] = vals;
    filamentKeys.forEach((list) => list.push(k));
  }
  out.different_settings_to_system = [processKeys.join(';'), ...filamentKeys.map((l) => l.join(';')), ''];
  out.from = 'project';
  out.name = 'project_settings';
  return { settings: out, nozzle, machine: machine.name, process: process.name, filaments: filaments.map((f) => f.name), fixes, carried: { process: processKeys.filter((k) => !['exclude_object', 'brim_type', 'support_style'].includes(k)), filament: filamentKeys[0] || [] } };
}

// ---- plates --------------------------------------------------------------------

/** Orca's plate grid: columns for `count` plates (round sqrt, one more when it falls short). */
export function plateCols(count) {
  const v = Math.sqrt(count);
  const r = Math.round(v);
  return v > r ? r + 1 : r;
}
/** Printable area rectangle from Orca's "XxY" point list. */
export function bedRect(area) {
  const pts = area.map((s) => s.split('x').map(Number));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const r = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  return { ...r, w: r.maxX - r.minX, h: r.maxY - r.minY, cx: (r.minX + r.maxX) / 2, cy: (r.minY + r.maxY) / 2 };
}
// Plate i (0-based) origin: plates sit in a grid spaced by the bed size plus a fifth
const plateOrigin = (i, cols, bed) => [(i % cols) * bed.w * 1.2, -Math.floor(i / cols) * bed.h * 1.2];

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const parseTransform = (s) => (s ? s.trim().split(/\s+/).map(Number) : IDENTITY.slice());
// 3MF transforms are row-vector affine: p' = p * M + t
const apply = (m, [x, y, z]) => [x * m[0] + y * m[3] + z * m[6] + m[9], x * m[1] + y * m[4] + z * m[7] + m[10], x * m[2] + y * m[5] + z * m[8] + m[11]];
function boxTransform(box, m) {
  if (!box) return null;
  const out = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const x of [box.min[0], box.max[0]]) for (const y of [box.min[1], box.max[1]]) for (const z of [box.min[2], box.max[2]]) {
    const p = apply(m, [x, y, z]);
    for (let k = 0; k < 3; k++) {
      out.min[k] = Math.min(out.min[k], p[k]);
      out.max[k] = Math.max(out.max[k], p[k]);
    }
  }
  return out;
}
const union = (a, b) => (!a ? b : !b ? a : { min: a.min.map((v, k) => Math.min(v, b.min[k])), max: a.max.map((v, k) => Math.max(v, b.max[k])) });
const attr = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/**
 * Vertex bounding box of every <object> with a mesh in one model file. Read
 * as a stream: object files of big models exceed V8's maximum string length
 * (one real file holds 541 MB of XML).
 */
async function meshBoxes(zipFile) {
  const boxes = new Map();
  let cur = null;
  const re = /<object\b[^>]*?\sid="(\d+)"|<vertex\b([^>]*)\/>/g;
  const scan = (text) => {
    re.lastIndex = 0;
    for (let m; (m = re.exec(text)); ) {
      if (m[1] !== undefined) {
        cur = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
        boxes.set(m[1], cur);
        continue;
      }
      if (!cur) continue;
      const a = m[2];
      const p = [Number(attr(a, 'x')), Number(attr(a, 'y')), Number(attr(a, 'z'))];
      for (let k = 0; k < 3; k++) {
        if (p[k] < cur.min[k]) cur.min[k] = p[k];
        if (p[k] > cur.max[k]) cur.max[k] = p[k];
      }
    }
  };
  const decoder = new StringDecoder('utf8');
  let rest = '';
  await new Promise((resolve, reject) => {
    zipFile
      .internalStream('uint8array')
      .on('data', (chunk) => {
        const text = rest + decoder.write(Buffer.from(chunk));
        const cut = text.lastIndexOf('<'); // keep a tag split across chunks for the next round
        scan(text.slice(0, cut));
        rest = text.slice(cut);
      })
      .on('error', reject)
      .on('end', () => {
        scan(rest + decoder.end());
        resolve();
      })
      .resume();
  });
  for (const [id, b] of boxes) if (b.min[0] === Infinity) boxes.delete(id);
  return boxes;
}

/**
 * Plates from model_settings.config: { map: "objectId#instanceIndex" -> plate
 * number, count: plates in the project (empty ones included: they still take
 * a place in Orca's grid) }.
 */
function plateOfInstances(text) {
  const map = new Map();
  let count = 0;
  for (const [, body] of (text || '').matchAll(/<plate>([\s\S]*?)<\/plate>/g)) {
    const plate = Number(/key="plater_id" value="(\d+)"/.exec(body)?.[1]);
    count = Math.max(count, plate);
    for (const [, inst] of body.matchAll(/<model_instance>([\s\S]*?)<\/model_instance>/g)) {
      const obj = /key="object_id" value="(\d+)"/.exec(inst)?.[1];
      const idx = /key="instance_id" value="(\d+)"/.exec(inst)?.[1] ?? '0';
      if (obj) map.set(`${obj}#${idx}`, plate);
    }
  }
  return { map, count };
}

/**
 * Move every plate's objects from the source bed onto the U1 bed. Each plate
 * shifts as a whole (layout, rotation, scale, Z untouched): its content is
 * re-centred from the source bed centre to the U1 bed centre, then nudged
 * inside the U1 printable area if needed. A plate is left as it is when its
 * objects do not sit on the plate the grid says (inconsistent data) or do not
 * fit on 270 x 270. Returns { xml, plates: [{plate, status, dx, dy, reason}] }.
 */
export async function convertPlates(zip, rootPath, srcBed, u1Bed) {
  let xml = await zip.file(rootPath).async('string');
  const rootBoxes = await meshBoxes(zip.file(rootPath));
  const subBoxes = new Map();
  const boxOf = async (pathName, id) => {
    if (!pathName || pathName === `/${rootPath}`) return rootBoxes.get(id);
    const p = pathName.replace(/^\//, '');
    if (!subBoxes.has(p)) subBoxes.set(p, zip.file(p) ? await meshBoxes(zip.file(p)) : new Map());
    return subBoxes.get(p).get(id);
  };
  // object id -> local bounding box (own mesh, or its components)
  const objectBox = new Map();
  for (const [, id, body] of xml.matchAll(/<object\b[^>]*?\sid="(\d+)"[^>]*>([\s\S]*?)<\/object>/g)) {
    let box = rootBoxes.get(id) || null;
    for (const [c] of body.matchAll(/<component\b[^>]*\/>/g)) {
      const b = await boxOf(attr(c, 'p:path'), attr(c, 'objectid'));
      box = union(box, boxTransform(b, parseTransform(attr(c, 'transform'))));
    }
    objectBox.set(id, box);
  }
  const { map: plateOf, count: plateCount } = plateOfInstances(await zip.file('Metadata/model_settings.config')?.async('string'));
  const items = [];
  const seen = new Map();
  for (const m of xml.matchAll(/<item\b[^>]*\/>/g)) {
    const objectId = attr(m[0], 'objectid');
    const idx = seen.get(objectId) || 0;
    seen.set(objectId, idx + 1);
    const t = parseTransform(attr(m[0], 'transform'));
    items.push({ tag: m[0], index: m.index, objectId, t, plate: plateOf.get(`${objectId}#${idx}`) ?? (plateOf.size ? null : 1), box: boxTransform(objectBox.get(objectId), t) });
  }
  const plateNumbers = [...new Set(items.map((i) => i.plate).filter((p) => p != null))].sort((a, b) => a - b);
  const count = Math.max(plateCount, ...plateNumbers, 1);
  const cols = plateCols(count);
  const report = [];
  const shift = new Map(); // plate -> [dx, dy]
  for (const plate of plateNumbers) {
    const its = items.filter((i) => i.plate === plate && i.box);
    if (!its.length) {
      report.push({ plate, status: 'empty' });
      continue;
    }
    const [ox, oy] = plateOrigin(plate - 1, cols, srcBed);
    const [ux, uy] = plateOrigin(plate - 1, cols, u1Bed);
    const box = its.reduce((b, i) => union(b, i.box), null);
    const local = { minX: box.min[0] - ox, maxX: box.max[0] - ox, minY: box.min[1] - oy, maxY: box.max[1] - oy };
    const cx = (local.minX + local.maxX) / 2;
    const cy = (local.minY + local.maxY) / 2;
    const tolX = srcBed.w * 0.1;
    const tolY = srcBed.h * 0.1;
    if (cx < srcBed.minX - tolX || cx > srcBed.maxX + tolX || cy < srcBed.minY - tolY || cy > srcBed.maxY + tolY) {
      report.push({ plate, status: 'kept', reason: t('u1.kept.offPlate') });
      continue;
    }
    const w = local.maxX - local.minX;
    const h = local.maxY - local.minY;
    if (w > u1Bed.w + 1e-6 || h > u1Bed.h + 1e-6) {
      report.push({ plate, status: 'kept', reason: t('u1.kept.tooLarge', { w: w.toFixed(1), h: h.toFixed(1), bw: u1Bed.w, bh: u1Bed.h }) });
      continue;
    }
    // re-centre, then nudge inside the U1 area
    let dx = u1Bed.cx - srcBed.cx;
    let dy = u1Bed.cy - srcBed.cy;
    dx += Math.max(0, u1Bed.minX - (local.minX + dx)) - Math.max(0, local.maxX + dx - u1Bed.maxX);
    dy += Math.max(0, u1Bed.minY - (local.minY + dy)) - Math.max(0, local.maxY + dy - u1Bed.maxY);
    const total = [ux - ox + dx, uy - oy + dy];
    shift.set(plate, total);
    report.push({ plate, status: 'moved', dx: Math.round(total[0] * 100) / 100, dy: Math.round(total[1] * 100) / 100 });
  }
  // rewrite item transforms (back to front so string offsets stay valid)
  for (const it of [...items].reverse()) {
    const s = shift.get(it.plate);
    if (!s) continue;
    const t = it.t.slice();
    t[9] += s[0];
    t[10] += s[1];
    const tf = t.map((v) => String(Number(v.toFixed(6)))).join(' ');
    const tag = /\stransform="[^"]*"/.test(it.tag) ? it.tag.replace(/\stransform="[^"]*"/, ` transform="${tf}"`) : it.tag.replace(/\s*\/>$/, ` transform="${tf}"/>`);
    xml = xml.slice(0, it.index) + tag + xml.slice(it.index + it.tag.length);
  }
  return { xml, plates: report, count };
}

// Slicer output and source-printer presets that must not travel with the converted project
const DROP = /^Metadata\/(slice_info\.config|plate_\d+\.json|plate_\d+\.gcode(\.md5)?|(filament|process|machine)_settings_\d+\.config|filament_sequence\.json)$/;

/**
 * Convert a non-U1 3MF project into a U1 project at `destPath` (must not
 * exist). `profiles` = loadU1Profiles(). Returns a report:
 * { from, machine, process, filaments, fixes, carried, plates }.
 */
export async function convertToU1(srcPath, destPath, profiles) {
  if (!profiles) throw new Error(t('u1.err.noOrca'));
  const zip = await JSZip.loadAsync(await fs.promises.readFile(srcPath));
  const psText = await zip.file('Metadata/project_settings.config')?.async('string');
  if (!psText) throw new Error(t('u1.err.noProject'));
  const ps = JSON.parse(psText);
  const from = detectPrinter(ps);
  if (from?.isU1) throw new Error(t('u1.err.alreadyU1'));
  const variableLayerHeight = Boolean((await zip.file('Metadata/layer_heights_profile.txt')?.async('string'))?.trim());
  const conv = u1ProjectSettings(ps, profiles, { variableLayerHeight });
  const srcArea = ps.printable_area;
  if (!Array.isArray(srcArea) || srcArea.length < 3) throw new Error(t('u1.err.noBed'));
  const u1Area = profiles.machines.find((m) => m.name === conv.machine).printableArea;
  const rootPath = /Target="\/?([^"]+\.model)"/.exec((await zip.file('_rels/.rels')?.async('string')) || '')?.[1] || '3D/3dmodel.model';
  const plates = await convertPlates(zip, rootPath, bedRect(srcArea), bedRect(u1Area));

  zip.file(rootPath, plates.xml);
  zip.file('Metadata/project_settings.config', JSON.stringify(conv.settings, null, 4));
  for (const name of Object.keys(zip.files)) if (DROP.test(name)) zip.remove(name);
  await new Promise((resolve, reject) => {
    zip
      .generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'DEFLATE' })
      .pipe(fs.createWriteStream(destPath, { flags: 'wx' }))
      .on('finish', resolve)
      .on('error', reject);
  });
  return { from, machine: conv.machine, process: conv.process, filaments: conv.filaments, fixes: conv.fixes, carried: conv.carried, variableLayerHeight, plates: plates.plates };
}

/** Source printer of a 3MF file on disk (for records indexed before M18), or null. */
export async function readSourcePrinter(file) {
  const zip = await JSZip.loadAsync(await fs.promises.readFile(file));
  const text = await zip.file('Metadata/project_settings.config')?.async('string');
  return text ? detectPrinter(JSON.parse(text)) : null;
}
