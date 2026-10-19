// M9 (SPEC 3.5b): export the filament mapping. Since M35 (SPEC 3.16) every
// export is a Snapmaker U1 project: non-U1 plates move onto the U1 bed and
// the source's allow-listed settings come along (u1Convert.mjs).
// - exportQuantized3mf(): a NEW 3MF whose faces carry paint_color pointing at
//   the user's slots, so Snapmaker Orca opens it with the colours assigned.
//
// Format facts (Snapmaker/OrcaSlicer v2.4.0, tag b1831e5, the version installed
// here; same scheme as SoftFever/OrcaSlicer, see paintColor.mjs):
// - bbs_3mf.cpp reads the per-triangle attribute "paint_color" (MMU_SEGMENTATION_ATTR)
//   and FacetsAnnotation::set_triangle_from_string() decodes it; extruder N is
//   written as CONST_FILAMENTS[N] = "4","8","0C","1C",... (Model.cpp, up to 16).
// - Filament colours come from Metadata/project_settings.config "filament_colour".
// - The loader's and GUI's 3MF version checks are disabled in this build
//   (bbs_3mf.cpp "Orca: skip version check", Plater.cpp `else if (false)`); only
//   a project-schema check remains, which keys we never write.
// - The exported project_settings holds only the spool table on U1 system
//   presets (see exportProjectSettings); the source's slicing settings are dropped.
import JSZip from 'jszip';
import { StringDecoder } from 'node:string_decoder';
import { Readable, PassThrough } from 'node:stream';
import fs from 'node:fs';
import { decodePaintColor } from './paintColor.mjs';
import { printPlan, U1_SLOTS, MIX_DELTA_E } from './filament.mjs';
import { mixPrintPlan, mixedFilamentDefinitions, MIXED_PROJECT_DEFAULTS } from './mixExport.mjs';
import { detectPrinter, sourceCarry, convertPlates, modelStream, bedRect } from './u1Convert.mjs';
import { t } from './i18n/index.mjs';

// Orca's paint_color string for extruder n (Model.cpp CONST_FILAMENTS). The
// string is read from its end: 1-2 one nibble; 3-17 "C" then n-3; 18 and up
// "C", "F", then n-18 (as remapPaintColor writes it; M37: 16 spools plus a
// second mix reach 18).
export function encodeExtruder(n) {
  if (n <= 0) return '';
  if (n <= 2) return (n << 2).toString(16).toUpperCase();
  if (n <= 17) return (n - 3).toString(16).toUpperCase() + 'C';
  return (n - 18).toString(16).toUpperCase() + 'FC';
}

/**
 * Re-map every leaf state of a paint_color tree through `map` (state -> new
 * state; 0 = unpainted) keeping the split structure. Returns the new string,
 * or '' when the whole triangle ends up unpainted and unsplit.
 */
export function remapPaintColor(str, map) {
  let pos = str.length - 1;
  const next = () => parseInt(str[pos--], 16);
  const out = []; // nibbles in read order
  const leaf = (s) => {
    if (s <= 2) out.push(s << 2);
    else if (s <= 17) out.push(0b1100, s - 3);
    else out.push(0b1100, 0b1111, s - 18);
  };
  const walk = () => {
    const code = next();
    const sides = code & 0b11;
    if (sides === 0) {
      let s = code >> 2;
      if (s === 3) {
        const n = next();
        s = n === 0b1111 ? next() + 18 : n + 3;
      }
      leaf(s === 0 ? 0 : (map.get(s) ?? s));
      return;
    }
    out.push(code);
    for (let i = 0; i <= sides; i++) walk();
  };
  walk();
  if (out.length === 1 && out[0] === 0) return '';
  return out.reverse().map((n) => n.toString(16).toUpperCase()).join('');
}

// Exported projects never carry the source file's printer / layer settings
// (layer height, nozzle, ...): those caused e.g.
// "Too large layer height. Reset to 0.320" when a 0.8 mm-nozzle project was
// opened. Verified in Snapmaker Orca 2.4.0 GUI (Wine-U1 export):
//   - no project_settings at all: Orca keeps its current profile, but the
//     spool colours cannot travel with the file;
//   - only filament_colour: Orca fills every missing key with factory
//     defaults (Plater.cpp: config = FullPrintConfig::defaults() + loaded)
//     and creates "(file.3mf)" presets — wrong printer and bed;
//   - spool keys + the U1 system preset names (below): Snapmaker U1, 0.4 mm,
//     0.20 Standard, the slots' colours, no dialog, project not modified.
// M35: plus the allow-listed source settings (sourceCarry) and two
// compatibility fixes, every override listed in different_settings_to_system
// (Orca drops unlisted project values).
export const U1_PRESETS = {
  printer_model: 'Snapmaker U1',
  printer_settings_id: 'Snapmaker U1 (0.4 nozzle)',
  print_settings_id: '0.20 Standard @Snapmaker U1 (0.4 nozzle)',
  filament_settings_id: 'Snapmaker PLA SnapSpeed @U1',
  filament_type: 'PLA',
};

// Written into every export (M35, SPEC 3.16): objects can be skipped while
// printing; no brim unless a print preset asks for one (公仔: 10 mm).
export const U1_FIXES = { exclude_object: '1', brim_type: 'no_brim' };

/**
 * project_settings.config for an export: the slots as filaments on U1 system
 * presets. M35: `carry` = { process: {key: value}, filament: {key: [value per
 * slot]}, listed: [[keys] per slot] } from the source project, then U1_FIXES.
 * M34: `presetSettings` (printPreset.mjs: the user's nozzle, the 公仔
 * settings) is merged last, so it wins over the source. Every override is
 * listed in different_settings_to_system ([process; filament 1..n; printer]).
 */
export function exportProjectSettings(slots, mixedDefs = null, presetSettings = {}, carry = null) {
  const n = slots.length;
  const cfg = {
    filament_colour: slots.map((s) => s.hex.toUpperCase() + 'FF'),
    filament_settings_id: Array(n).fill(U1_PRESETS.filament_settings_id),
    filament_type: Array(n).fill(U1_PRESETS.filament_type),
    printer_model: U1_PRESETS.printer_model,
    printer_settings_id: U1_PRESETS.printer_settings_id,
    print_settings_id: U1_PRESETS.print_settings_id,
    from: 'project',
    name: 'project_settings',
  };
  const processKeys = new Set();
  const filamentKeys = slots.map(() => new Set());
  if (carry) {
    Object.assign(cfg, carry.process);
    for (const k of Object.keys(carry.process)) processKeys.add(k);
    Object.assign(cfg, carry.filament);
    carry.listed.forEach((keys, i) => keys.forEach((k) => filamentKeys[i].add(k)));
  }
  Object.assign(cfg, U1_FIXES);
  for (const k of Object.keys(U1_FIXES)) processKeys.add(k);
  const { different_settings_to_system: presetListed, ...preset } = presetSettings;
  Object.assign(cfg, preset);
  if (presetListed) {
    for (const k of String(presetListed[0] || '').split(';').filter(Boolean)) processKeys.add(k);
    filamentKeys.forEach((set, i) => String(presetListed[i + 1] || '').split(';').filter(Boolean).forEach((k) => set.add(k)));
  }
  cfg.different_settings_to_system = [[...processKeys].join(';'), ...filamentKeys.map((set) => [...set].join(';')), ''];
  if (mixedDefs) Object.assign(cfg, MIXED_PROJECT_DEFAULTS, { mixed_filament_definitions: mixedDefs });
  return JSON.stringify(cfg, null, 4);
}

/**
 * The source's per-filament settings on the export's slots (M35, SPEC 3.16):
 * each physical slot takes the settings of the source filament with the most
 * area quantized to it (`weightOf(hex)`, ties: the first filament); a slot no
 * source filament maps to keeps the U1 preset (value written but not listed,
 * so Orca uses the preset's). Mixes (virtual extruders) carry nothing.
 */
export function carryToSlots(carry, colours, slotOf, n, weightOf = () => 0) {
  const best = Array(n).fill(null);
  colours.forEach((hex, i) => {
    const slot = slotOf(hex);
    if (!slot || slot > n) return;
    const cur = best[slot - 1];
    if (cur === null || weightOf(hex) > weightOf(colours[cur])) best[slot - 1] = i;
  });
  const used = best.filter((i) => i !== null);
  const filament = {};
  if (used.length) {
    for (const [k, vals] of Object.entries(carry.filament)) filament[k] = best.map((i) => vals[i ?? used[0]]);
  }
  const keys = Object.keys(filament);
  return { process: carry.process, filament, listed: best.map((i) => (i === null ? [] : keys)) };
}

// Source-project files that carry slicing settings or results: embedded
// presets (Orca loads them with the project), adaptive layer heights, slice
// info / per-plate slice results.
const SLICER_FILES =
  /^Metadata\/((filament|process|machine)_settings_\d+\.config|print_profile\.config|layer_heights_profile\.txt|layer_config_ranges\.xml|slice_info\.config|filament_sequence\.json|plate_\d+\.json)$/;

// model_settings.config metadata that describes geometry, placement and plates;
// everything else (object/part/plate print overrides such as layer_height,
// wall_loops, support, filament_maps) is slicing configuration and dropped.
const MODEL_SETTINGS_KEEP = new Set([
  'name', 'matrix', 'extruder', 'source_file', 'source_object_id', 'source_volume_id',
  'source_offset_x', 'source_offset_y', 'source_offset_z', 'source_in_inches',
  'object_id', 'instance_id', 'identify_id', 'plater_id', 'plater_name', 'locked',
  'thumbnail_file', 'thumbnail_no_light_file', 'top_file', 'pick_file',
]);

/**
 * Keep geometry/placement/plate metadata only; remap object/part default
 * filaments ("extruder", used by unpainted faces) through `mapExtruder`.
 */
export function stripModelSettings(text, mapExtruder) {
  return text.replace(/[ \t]*<metadata key="([^"]+)" value="([^"]*)"\s*\/>\r?\n?/g, (line, key, value) => {
    if (!MODEL_SETTINGS_KEEP.has(key)) return '';
    if (key === 'extruder') return line.replace(`value="${value}"`, `value="${mapExtruder(Number(value))}"`);
    return line;
  });
}

// Stream-transform one .model part (a zip entry, or a Readable of its bytes):
// rewrite triangle paint_color per `plan`.
function transformModel(source, faceSlot, stateMap) {
  const out = new PassThrough();
  const decoder = new StringDecoder('utf8');
  const tagRe = /<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"]|"[^"]*")*?)(\/?)>/g;
  const attr = (attrs, name) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs)?.[1];
  const stats = { painted: 0, materials: 0, skipped: 0 };
  let obj = null;
  let group = null;
  const groups = new Map();
  const handle = (text) => {
    let last = 0;
    let res = '';
    tagRe.lastIndex = 0;
    let m;
    while ((m = tagRe.exec(text))) {
      const [whole, close, rawName, attrs, selfClose] = m;
      const name = rawName.includes(':') ? rawName.slice(rawName.indexOf(':') + 1) : rawName;
      if (close) {
        if (name === 'object') obj = null;
        else if (name === 'basematerials' || name === 'colorgroup') group = null;
        continue;
      }
      if (name === 'basematerials' || name === 'colorgroup') groups.set(attr(attrs, 'id'), (group = []));
      else if ((name === 'base' || name === 'color') && group) group.push((attr(attrs, name === 'base' ? 'displaycolor' : 'color') || '').slice(0, 7).toUpperCase());
      else if (name === 'object') obj = { pid: attr(attrs, 'pid'), pindex: attr(attrs, 'pindex') };
      else if (name === 'triangle' && obj) {
        const pc = attr(attrs, 'paint_color');
        let next;
        if (pc) {
          next = remapPaintColor(pc, stateMap);
          stats.painted++;
        } else {
          // material colour (basematerials / colorgroup) -> paint it with its slot
          const tpid = attr(attrs, 'pid');
          const pid = tpid ?? obj.pid;
          const p1 = attr(attrs, 'p1') ?? (tpid === undefined ? obj.pindex : undefined);
          const hex = pid !== undefined ? groups.get(pid)?.[p1] : undefined;
          if (!hex) continue;
          const slot = faceSlot(hex);
          next = slot ? encodeExtruder(slot) : '';
          stats.materials++;
        }
        if (!next) stats.skipped++;
        const cleaned = attrs.replace(/\s+paint_color="[^"]*"/, '');
        res += text.slice(last, m.index) + `<${rawName}${cleaned}${next ? ` paint_color="${next}"` : ''}${selfClose}>`;
        last = m.index + whole.length;
      }
    }
    return res + text.slice(last);
  };
  (async () => {
    let rest = '';
    try {
      const input = typeof source.nodeStream === 'function' ? new Readable().wrap(source.nodeStream('nodebuffer')) : source;
      for await (const chunk of input) {
        const text = rest + decoder.write(chunk);
        const cut = text.lastIndexOf('>') + 1;
        out.write(handle(text.slice(0, cut)));
        rest = text.slice(cut);
      }
      out.end(handle(rest + decoder.end()));
    } catch (err) {
      out.destroy(err);
    }
  })();
  return { stream: out, stats };
}

/**
 * Write a quantized copy of a 3MF to `destPath` (the source is never touched).
 * The destination must not exist unless `overwrite` is set.
 * Every colour maps to the nearest slot (ΔE in the report); with
 * overThreshold = 'skip', colours beyond the threshold are left unassigned
 * (the face falls back to its part's default filament in Orca).
 * With `mix` (M10, SPEC 3.5c) colours that no single slot can print become
 * Full Spectrum mixed filaments: a mixed_filament_definitions row is added and
 * the faces point at the virtual extruder (base count + mix ordinal).
 * Returns { slots, summary: [{color, slot | null, deltaE, mode, mix?}], stats, mixes }.
 */
export async function exportQuantized3mf(srcPath, destPath, slots = U1_SLOTS, { threshold = MIX_DELTA_E, overThreshold = 'nearest', overwrite = false, mix = false, presetSettings = {}, u1Area = null, colorWeights = null } = {}) {
  const zip = await JSZip.loadAsync(await fs.promises.readFile(srcPath));
  const text = async (p) => (zip.file(p) ? zip.file(p).async('string') : null);
  const project = await text('Metadata/project_settings.config');
  const ps = project ? JSON.parse(project) : null;
  const colours = ps ? (ps.filament_colour || []).map((c) => c.slice(0, 7).toUpperCase()) : [];

  // M35: a non-U1 project's plates move onto the U1 bed (u1Area: the chosen
  // machine's printable_area); a U1 project or a plain 3MF keeps its positions
  const from = ps ? detectPrinter(ps) : null;
  const rootPath = /Target="\/?([^"]+\.model)"/.exec((await text('_rels/.rels')) || '')?.[1] || '3D/3dmodel.model';
  let root = null;
  if (from && !from.isU1) {
    if (!u1Area) throw new Error(t('u1.err.noOrca'));
    if (!Array.isArray(ps.printable_area) || ps.printable_area.length < 3) throw new Error(t('u1.err.noBed'));
    root = await convertPlates(zip, rootPath, bedRect(ps.printable_area), bedRect(u1Area));
  }

  const summary = new Map();
  const mixRows = []; // { compA, compB, mixB, ... } in first-appearance order
  const mixKey = (m) => `${m.compA}|${m.compB}|${m.mixB}`;
  const planFor = (hex) => {
    if (summary.has(hex)) return summary.get(hex);
    const p = printPlan(hex, slots, threshold);
    const out = { color: hex, mode: p.mode, mixable: p.mixable ?? true };
    if (p.mode === 'single') {
      out.slot = p.nearest.slot;
      out.deltaE = p.nearest.deltaE;
    } else if (!mix || !p.mixable) {
      // no mixed filaments requested, or not mixable from these spools: nearest slot
      const skip = overThreshold === 'skip';
      out.slot = skip ? null : p.nearest.slot;
      out.deltaE = p.nearest.deltaE;
    } else {
      const mpp = mixPrintPlan(hex, slots, threshold);
      if (!mpp.mixable) {
        // even the best pigment blend stays beyond the threshold: cannot be
        // printed from these spools -> nearest slot (or skip), noted 需購買
        out.slot = overThreshold === 'skip' ? null : p.nearest.slot;
        out.deltaE = p.nearest.deltaE;
      } else {
        const mp = mpp.mix;
        const k = mixKey(mp);
        let idx = mixRows.findIndex((r) => mixKey(r) === k);
        if (idx === -1) {
          mixRows.push(mp);
          idx = mixRows.length - 1;
        }
        out.slot = slots.length + idx + 1; // virtual extruder id
        out.deltaE = mp.deltaE;
        out.mix = mp;
      }
    }
    summary.set(hex, out);
    return out;
  };
  const slotOf = (hex) => planFor(hex).slot;
  // old filament state n (colour colours[n-1]) -> new extruder; states without a known
  // colour become unassigned rather than pointing past the new slot count
  const stateMap = new Map(Array.from({ length: 32 }, (_, i) => [i + 1, colours[i] ? (slotOf(colours[i]) ?? 0) : 0]));

  const allStats = { painted: 0, materials: 0, skipped: 0 };
  const pending = [];
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir || !/\.model$/i.test(name)) continue;
    const { stream, stats } = transformModel(root && name === rootPath ? modelStream(root) : file, slotOf, stateMap);
    zip.file(name, stream, { binary: true });
    pending.push(stats);
  }

  const ms = await text('Metadata/model_settings.config');
  if (ms) {
    zip.file(
      'Metadata/model_settings.config',
      stripModelSettings(ms, (n) => (colours[n - 1] ? slotOf(colours[n - 1]) : null) || Math.min(n, slots.length)),
    );
  }
  const weightOf = (hex) => colorWeights?.get(hex) ?? 0;
  const carry = ps ? carryToSlots(sourceCarry(ps), colours, slotOf, slots.length, weightOf) : null;
  zip.file('Metadata/project_settings.config', exportProjectSettings(slots, mix ? mixedFilamentDefinitions(mixRows) : null, presetSettings, carry));
  for (const name of Object.keys(zip.files)) if (SLICER_FILES.test(name)) zip.remove(name);

  await new Promise((resolve, reject) => {
    zip
      .generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'DEFLATE' })
      // never overwrite unless the caller says so (a save dialog's confirmed replace)
      .pipe(fs.createWriteStream(destPath, { flags: overwrite ? 'w' : 'wx' }))
      .on('finish', resolve)
      .on('error', reject);
  });
  for (const s of pending) for (const k of Object.keys(allStats)) allStats[k] += s[k];
  return { slots, summary: [...summary.values()], stats: allStats, mixes: mixRows, plates: root ? root.plates : [] };
}
