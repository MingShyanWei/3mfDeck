// M12b: import a 3dfilamentprofiles.com "My Spools" export into the inventory.
// Format (verified against a real export, 2026-10-01): a JSON array of
//   { brand, material, material_type, color, rgb, ... }
// The same columns also ship as CSV (Export dropdown), so both are accepted.
// Name is built as "Brand Material Type Color" (e.g. "Bambu Lab PLA Basic Cyan (10603)").

const HEX = /^#[0-9A-F]{6}$/;
const nameOf = (s) => [s.brand, s.material, s.material_type, s.color].map((v) => String(v ?? '').trim()).filter(Boolean).join(' ').trim().slice(0, 60);

/** Minimal CSV parse: quoted fields, comma separator, first row is the header. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name) => header.findIndex((h) => h === name);
  return rows.slice(1).map((r) => {
    const o = {};
    for (const key of ['brand', 'material', 'material_type', 'color', 'rgb']) {
      const i = col(key);
      if (i >= 0) o[key] = r[i] ?? '';
    }
    return o;
  });
}

/**
 * Parse an export file into inventory entries.
 * Returns { items: [{name, hex}], skipped: [{raw, why}] }; hexes are
 * upper-cased and deduplicated (first occurrence wins).
 */
export function import3dfpInventory(text) {
  const t = String(text ?? '').trim();
  let rows;
  if (t.startsWith('[') || t.startsWith('{')) {
    const data = JSON.parse(t);
    rows = Array.isArray(data) ? data : Array.isArray(data.spools) ? data.spools : null;
    if (!rows) throw new Error('無法辨識的匯出格式（預期為陣列）');
  } else {
    rows = parseCsv(t);
  }
  const items = [];
  const skipped = [];
  const seen = new Set();
  for (const s of rows) {
    const hex = String(s.rgb ?? '').trim().toUpperCase();
    if (!HEX.test(hex)) {
      skipped.push({ raw: JSON.stringify(s).slice(0, 80), why: '缺少有效 rgb 色碼' });
      continue;
    }
    if (seen.has(hex)) continue; // duplicate colour: keep the first
    seen.add(hex);
    items.push({ name: nameOf(s), hex });
  }
  return { items, skipped };
}
