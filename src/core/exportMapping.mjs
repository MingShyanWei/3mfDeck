// M9 (SPEC 3.5b): export the filament mapping.
// - mappingCsv(): report of colour -> slot / recipe
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
import { printPlan, recipeText, U1_SLOTS, MIX_DELTA_E } from './filament.mjs';

// Orca's paint_color string for extruder n (Model.cpp CONST_FILAMENTS; 1..17)
export function encodeExtruder(n) {
  if (n <= 0) return '';
  if (n <= 2) return (n << 2).toString(16).toUpperCase();
  return (n - 3).toString(16).toUpperCase() + 'C';
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

const pctText = (v) => `${v}%`;
const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/**
 * Mapping report (CSV, UTF-8 with BOM for Excel). One row per colour:
 * 原始色, 面數, 佔比, 指定捲槽 (the slot the quantized export uses), ΔE 或配方, 備註.
 */
export function mappingCsv(colors, slots = U1_SLOTS, { threshold = MIX_DELTA_E, overThreshold = 'nearest' } = {}) {
  const rows = [['原始色', '面數', '佔比', '指定捲槽', 'ΔE 或配方', '備註']];
  for (const c of colors) {
    const plan = printPlan(c.color, slots, threshold);
    const slot = [`槽${plan.nearest.slot}`, plan.nearest.name, plan.nearest.hex].filter(Boolean).join(' ');
    if (plan.mode === 'single') {
      rows.push([c.color, c.faces, pctText(c.pct), slot, `ΔE ${plan.nearest.deltaE}`, '單捲']);
      continue;
    }
    const skipped = overThreshold === 'skip';
    rows.push([
      c.color,
      c.faces,
      pctText(c.pct),
      skipped ? '（跳過，不指定）' : slot,
      `配方 ${recipeText(plan.recipe)}（ΔE ${plan.recipe.deltaE}）；量化到最近捲 ΔE ${plan.nearest.deltaE}`,
      `${plan.mixable ? '需混色' : '需購買'}；量化匯出：${skipped ? '跳過該面' : `量化到最近捲（ΔE ${plan.nearest.deltaE}）`}`,
    ]);
  }
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// Exported projects carry ONLY the spool table, never the source file's
// print/printer settings (layer height, nozzle, ...): those caused e.g.
// "Too large layer height. Reset to 0.320" when a 0.8 mm-nozzle project was
// opened. Verified in Snapmaker Orca 2.4.0 GUI (Wine-U1 export):
//   - no project_settings at all: Orca keeps its current profile, but the
//     spool colours cannot travel with the file;
//   - only filament_colour: Orca fills every missing key with factory
//     defaults (Plater.cpp: config = FullPrintConfig::defaults() + loaded)
//     and creates "(file.3mf)" presets — wrong printer and bed;
//   - spool keys + the U1 system preset names (below): Snapmaker U1, 0.4 mm,
//     0.20 Standard, the slots' colours, no dialog, project not modified.
export const U1_PRESETS = {
  printer_model: 'Snapmaker U1',
  printer_settings_id: 'Snapmaker U1 (0.4 nozzle)',
  print_settings_id: '0.20 Standard @Snapmaker U1 (0.4 nozzle)',
  filament_settings_id: 'Snapmaker PLA SnapSpeed @U1',
  filament_type: 'PLA',
};

/** project_settings.config for an export: the slots as filaments on U1 system presets, nothing else. */
export function exportProjectSettings(slots) {
  const n = slots.length;
  return JSON.stringify(
    {
      filament_colour: slots.map((s) => s.hex.toUpperCase() + 'FF'),
      filament_settings_id: Array(n).fill(U1_PRESETS.filament_settings_id),
      filament_type: Array(n).fill(U1_PRESETS.filament_type),
      printer_model: U1_PRESETS.printer_model,
      printer_settings_id: U1_PRESETS.printer_settings_id,
      print_settings_id: U1_PRESETS.print_settings_id,
      from: 'project',
      name: 'project_settings',
    },
    null,
    4,
  );
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

// Stream-transform one .model part: rewrite triangle paint_color per `plan`.
function transformModel(zipFile, faceSlot, stateMap) {
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
      for await (const chunk of new Readable().wrap(zipFile.nodeStream('nodebuffer'))) {
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
 * Returns { slots, summary: [{color, slot | null, deltaE, mode}], stats }.
 */
export async function exportQuantized3mf(srcPath, destPath, slots = U1_SLOTS, { threshold = MIX_DELTA_E, overThreshold = 'nearest', overwrite = false } = {}) {
  const zip = await JSZip.loadAsync(await fs.promises.readFile(srcPath));
  const text = async (p) => (zip.file(p) ? zip.file(p).async('string') : null);
  const project = await text('Metadata/project_settings.config');
  const colours = project ? (JSON.parse(project).filament_colour || []).map((c) => c.slice(0, 7).toUpperCase()) : [];

  const summary = new Map();
  const slotOf = (hex) => {
    if (!summary.has(hex)) {
      const p = printPlan(hex, slots, threshold);
      const skip = p.mode === 'mix' && overThreshold === 'skip';
      summary.set(hex, { color: hex, slot: skip ? null : p.nearest.slot, deltaE: p.nearest.deltaE, mode: p.mode, mixable: p.mixable ?? true });
    }
    return summary.get(hex).slot;
  };
  // old filament state n (colour colours[n-1]) -> new slot; states without a known
  // colour become unassigned rather than pointing past the new slot count
  const stateMap = new Map(Array.from({ length: 32 }, (_, i) => [i + 1, colours[i] ? (slotOf(colours[i]) ?? 0) : 0]));

  const allStats = { painted: 0, materials: 0, skipped: 0 };
  const pending = [];
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir || !/\.model$/i.test(name)) continue;
    const { stream, stats } = transformModel(file, slotOf, stateMap);
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
  zip.file('Metadata/project_settings.config', exportProjectSettings(slots));
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
  return { slots, summary: [...summary.values()], stats: allStats };
}
