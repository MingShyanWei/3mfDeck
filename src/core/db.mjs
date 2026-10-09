// SQLite index (better-sqlite3). Schema per SPEC.md §4.
// The file system is the source of truth; this is only an index.
import Database from 'better-sqlite3';
import { labelFor, labelInQuery, MODEL_LABEL_MIN_PCT, LEGACY_LABELS } from './colorNames.mjs';
import { U1_MODEL } from './orcaProfiles.mjs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS models (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  rel_path      TEXT NOT NULL UNIQUE,
  format        TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  tri_count     INTEGER,
  bbox_mm       TEXT,
  color_count   INTEGER,
  thumb         BLOB,
  provenance_type TEXT,
  platform      TEXT,
  url           TEXT,
  prompt        TEXT,
  retrieved_at  TEXT,
  notes         TEXT,
  imported_at   TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  source_printer TEXT,           -- M18: printer_model of the 3MF project ('' = none / not a project)
  source_process TEXT,           -- M18: its print_settings_id
  embedded_images TEXT,          -- M19: JSON {cover, images} of product images inside the 3MF
  cover          BLOB,           -- M19: bytes of that cover image
  thumb_dark     INTEGER         -- M21: 1 = the rendered thumbnail is nearly all black (not shown)
);
CREATE TABLE IF NOT EXISTS tags (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS model_tags (
  model_id INTEGER REFERENCES models(id) ON DELETE CASCADE,
  tag_id   INTEGER REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (model_id, tag_id)
);
CREATE TABLE IF NOT EXISTS color_stats (
  model_id INTEGER REFERENCES models(id) ON DELETE CASCADE,
  color    TEXT,
  faces    INTEGER,
  pct      REAL,
  label    TEXT,                -- colour name (M17, colorNames.mjs)
  PRIMARY KEY (model_id, color)
);
-- Multi-plate 3MF (SPEC 3.6). Additive: §4 has no plate storage.
CREATE TABLE IF NOT EXISTS plates (
  model_id  INTEGER REFERENCES models(id) ON DELETE CASCADE,
  plate     INTEGER,
  name      TEXT,
  tri_count INTEGER,
  PRIMARY KEY (model_id, plate)
);
-- Full Spectrum (dithered) detection (SPEC 3.4 M6). Additive: §4 has no place for it.
CREATE TABLE IF NOT EXISTS color_mixing (
  model_id         INTEGER PRIMARY KEY REFERENCES models(id) ON DELETE CASCADE,
  vertex_mixed_pct REAL,
  full_spectrum    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS plate_color_stats (
  model_id INTEGER REFERENCES models(id) ON DELETE CASCADE,
  plate    INTEGER,
  color    TEXT,
  faces    INTEGER,
  pct      REAL,
  PRIMARY KEY (model_id, plate, color)
);
`;

export const PROVENANCE_TYPES = ['ai_generated', 'downloaded', 'self_made', 'unknown'];
// Fields the user may edit after import
const EDITABLE = ['name', 'provenance_type', 'platform', 'url', 'prompt', 'retrieved_at', 'notes'];

const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

export function openDb(file) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  // Columns added after a database may have been created (M17 colour labels, M18 source printer)
  const addColumn = (table, column, type = 'TEXT') => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  };
  addColumn('color_stats', 'label');
  addColumn('models', 'source_printer');
  addColumn('models', 'source_process');
  addColumn('models', 'embedded_images');
  addColumn('models', 'cover', 'BLOB');
  addColumn('models', 'thumb_dark', 'INTEGER');
  // M33 (SPEC 3.1b): content fingerprint (SHA-256 hex; NULL = not computed yet) and the U1 conversion source
  addColumn('models', 'content_hash');
  addColumn('models', 'converted_from', 'INTEGER');
  db.exec('CREATE INDEX IF NOT EXISTS models_content_hash ON models(content_hash)');
  migrateLegacyLabels(db);
  backfillColorLabels(db);
  return db;
}

/**
 * M24: colour labels stored before i18n were Traditional Chinese names (黑, 膚,
 * 其他, ...); turn them into the language-neutral keys in place. Idempotent,
 * touches only color_stats.label. Returns the rows changed.
 */
export function migrateLegacyLabels(db) {
  const set = db.prepare('UPDATE color_stats SET label = ? WHERE label = ?');
  let changed = 0;
  db.transaction(() => {
    for (const [legacy, key] of Object.entries(LEGACY_LABELS)) changed += set.run(key, legacy).changes;
  })();
  return changed;
}

/** One-time fill of colour labels for rows imported before M17 (label IS NULL). Returns the rows updated. */
export function backfillColorLabels(db) {
  const rows = db.prepare('SELECT model_id, color FROM color_stats WHERE label IS NULL').all();
  if (!rows.length) return 0;
  const set = db.prepare('UPDATE color_stats SET label = ? WHERE model_id = ? AND color = ?');
  db.transaction(() => {
    for (const r of rows) set.run(labelFor(r.color), r.model_id, r.color);
  })();
  return rows.length;
}

/**
 * Insert a freshly imported model. `parsed` is the parseFile() result.
 * Provenance defaults to `unknown` (shown as 未標) unless the file itself
 * carries a hint (e.g. MakerWorld metadata in a Bambu 3MF).
 */
export function insertModel(db, { name, relPath, parsed }) {
  const ts = nowIso();
  const hint = parsed.provenanceHint || {};
  const run = db.transaction(() => {
    const { lastInsertRowid: id } = db
      .prepare(
        `INSERT INTO models (name, rel_path, format, size_bytes, tri_count, bbox_mm, color_count,
           provenance_type, platform, retrieved_at, notes, imported_at, updated_at, source_printer, source_process, embedded_images, cover)
         VALUES (@name, @rel_path, @format, @size_bytes, @tri_count, @bbox_mm, @color_count,
           @provenance_type, @platform, @retrieved_at, @notes, @ts, @ts, @source_printer, @source_process, @embedded_images, @cover)`,
      )
      .run({
        name,
        rel_path: relPath,
        format: parsed.format,
        size_bytes: parsed.size_bytes,
        tri_count: parsed.tri_count,
        bbox_mm: parsed.bbox_mm ? JSON.stringify(parsed.bbox_mm) : null,
        color_count: parsed.color_count,
        provenance_type: hint.provenance_type || 'unknown',
        platform: hint.platform || null,
        retrieved_at: today(),
        notes: hint.notes || null,
        ts,
        source_printer: parsed.sourcePrinter?.printer ?? '',
        source_process: parsed.sourcePrinter?.process ?? '',
        ...embeddedColumns(parsed),
      });
    insertDerivedRows(db, Number(id), parsed);
    return Number(id);
  });
  return run();
}

// M19: embedded image list ('{"cover":null,"images":[]}' when none — known, unlike NULL) and cover bytes
const embeddedColumns = (parsed) => ({
  embedded_images: JSON.stringify(parsed.embedded ?? { cover: null, images: [] }),
  cover: parsed.coverBytes ?? null,
});

// Per-model rows derived from the file: colour stats, plates, mixing
function insertDerivedRows(db, id, parsed) {
  const ins = db.prepare('INSERT INTO color_stats (model_id, color, faces, pct, label) VALUES (?, ?, ?, ?, ?)');
  for (const c of parsed.colorStats || []) ins.run(id, c.color, c.faces, c.pct, labelFor(c.color));
  const insPlate = db.prepare('INSERT INTO plates (model_id, plate, name, tri_count) VALUES (?, ?, ?, ?)');
  const insPlateColor = db.prepare('INSERT INTO plate_color_stats (model_id, plate, color, faces, pct) VALUES (?, ?, ?, ?, ?)');
  if (parsed.mixing) {
    db.prepare('INSERT INTO color_mixing (model_id, vertex_mixed_pct, full_spectrum) VALUES (?, ?, ?)').run(id, parsed.mixing.vertexMixedPct, parsed.mixing.fullSpectrum ? 1 : 0);
  }
  for (const p of parsed.plates || []) {
    insPlate.run(id, p.plate, p.name, p.tri_count);
    for (const c of p.colorStats || []) insPlateColor.run(id, p.plate, c.color, c.faces, c.pct);
  }
}

/**
 * Re-read file-derived data after a record was pointed at another file
 * (relocation). User metadata (name, provenance, tags, notes) is kept; the
 * thumbnail is cleared so it gets rendered again.
 */
export function replaceDerived(db, id, parsed) {
  db.transaction(() => {
    db.prepare(
      `UPDATE models SET format = @format, size_bytes = @size_bytes, tri_count = @tri_count, bbox_mm = @bbox_mm,
         color_count = @color_count, thumb = NULL, updated_at = @ts, source_printer = @source_printer, source_process = @source_process,
         embedded_images = @embedded_images, cover = @cover WHERE id = @id`,
    ).run({
      ...embeddedColumns(parsed),
      source_printer: parsed.sourcePrinter?.printer ?? '',
      source_process: parsed.sourcePrinter?.process ?? '',
      id,
      format: parsed.format,
      size_bytes: parsed.size_bytes,
      tri_count: parsed.tri_count,
      bbox_mm: parsed.bbox_mm ? JSON.stringify(parsed.bbox_mm) : null,
      color_count: parsed.color_count,
      ts: nowIso(),
    });
    for (const t of ['color_stats', 'plate_color_stats', 'plates', 'color_mixing']) db.prepare(`DELETE FROM ${t} WHERE model_id = ?`).run(id);
    insertDerivedRows(db, id, parsed);
  })();
}

export function updateModel(db, id, fields) {
  const keys = Object.keys(fields).filter((k) => EDITABLE.includes(k));
  if (fields.provenance_type !== undefined && !PROVENANCE_TYPES.includes(fields.provenance_type)) {
    throw new Error(`invalid provenance_type: ${fields.provenance_type}`);
  }
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = @${k}`).join(', ');
  const params = { id, updated_at: nowIso() };
  for (const k of keys) params[k] = fields[k] === '' ? null : fields[k];
  db.prepare(`UPDATE models SET ${sets}, updated_at = @updated_at WHERE id = @id`).run(params);
}

/** Replace a model's tags. Tags no longer used by any model are dropped. */
export function setTags(db, modelId, names) {
  const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  db.transaction(() => {
    db.prepare('DELETE FROM model_tags WHERE model_id = ?').run(modelId);
    for (const n of clean) {
      db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(n);
      const { id } = db.prepare('SELECT id FROM tags WHERE name = ?').get(n);
      db.prepare('INSERT INTO model_tags (model_id, tag_id) VALUES (?, ?)').run(modelId, id);
    }
    db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM model_tags)').run();
    db.prepare('UPDATE models SET updated_at = ? WHERE id = ?').run(nowIso(), modelId);
  })();
}

const LIST_COLUMNS = `m.id, m.name, m.rel_path, m.format, m.size_bytes, m.tri_count, m.bbox_mm, m.color_count,
  m.provenance_type, m.platform, m.url, m.prompt, m.retrieved_at, m.notes, m.imported_at, m.updated_at,
  m.source_printer, m.source_process, m.embedded_images, m.content_hash, m.converted_from,
  m.thumb IS NOT NULL AS has_thumb, m.cover IS NOT NULL AS has_cover, m.thumb_dark,
  (SELECT COUNT(*) FROM plates p WHERE p.model_id = m.id) AS plate_count,
  (SELECT cm.full_spectrum FROM color_mixing cm WHERE cm.model_id = m.id) AS full_spectrum,
  (SELECT cm.vertex_mixed_pct FROM color_mixing cm WHERE cm.model_id = m.id) AS vertex_mixed_pct,
  (SELECT json_group_array(t.name) FROM model_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.model_id = m.id) AS tags,
  (SELECT json_group_array(json_object('label', l.label, 'pct', l.pct)) FROM (
     SELECT cs.label, ROUND(SUM(cs.pct), 2) AS pct FROM color_stats cs WHERE cs.model_id = m.id
     GROUP BY cs.label HAVING SUM(cs.pct) >= ${MODEL_LABEL_MIN_PCT} ORDER BY SUM(cs.pct) DESC LIMIT 3) l) AS color_labels`;

// A model "has" colour label @x when that label covers >= MODEL_LABEL_MIN_PCT of its area
const hasLabel = (param) => `EXISTS (SELECT 1 FROM color_stats cs WHERE cs.model_id = m.id AND cs.label = @${param}
  GROUP BY cs.label HAVING SUM(cs.pct) >= ${MODEL_LABEL_MIN_PCT})`;

const SORTS = {
  imported: 'm.imported_at DESC, m.id DESC',
  name: 'm.name COLLATE NOCASE ASC',
  colors: 'm.color_count IS NULL, m.color_count DESC, m.name COLLATE NOCASE',
};

const rowOut = (r) => ({
  ...r,
  has_thumb: Boolean(r.has_thumb),
  has_cover: Boolean(r.has_cover),
  thumb_dark: Boolean(r.thumb_dark),
  full_spectrum: Boolean(r.full_spectrum),
  tags: JSON.parse(r.tags),
  color_labels: JSON.parse(r.color_labels),
  bbox_mm: r.bbox_mm ? JSON.parse(r.bbox_mm) : null,
  embedded_images: r.embedded_images ? JSON.parse(r.embedded_images) : null,
});

// M18: projects set up for another printer (a 3MF without project settings is not flagged)
const NON_U1 = `(m.source_printer IS NOT NULL AND m.source_printer != '' AND m.source_printer != '${U1_MODEL}')`;

// Trashed models keep their row (metadata survives a restore); their file
// lives under <root>/.trash/, so rel_path tells them apart.
const TRASHED = `m.rel_path LIKE '.trash/%'`;

// M33: a live model whose content fingerprint another live model shares (the trash is not counted)
const DUPLICATE = `(m.content_hash IS NOT NULL AND EXISTS (SELECT 1 FROM models d WHERE d.content_hash = m.content_hash AND d.id != m.id AND d.rel_path NOT LIKE '.trash/%'))`;

/**
 * List models.
 * - q: substring match on name, notes, tags (case-insensitive); a colour name
 *   (「紅」/「紅色」) also matches models carrying that colour label
 * - filter: 'all' | 'unlabeled' | 'type:<provenance_type>' | 'platform:<name>' | 'tag:<name>' | 'trash'
 *   | 'duplicates' (M33: live models sharing a content fingerprint, grouped)
 *   (every filter except 'trash' excludes trashed models)
 * - colors: colour labels; a model must carry every one of them (M17)
 * - sort: 'imported' | 'name' | 'colors'
 */
export function listModels(db, { q = '', filter = 'all', sort = 'imported', colors = [] } = {}) {
  const where = [filter === 'trash' ? TRASHED : `NOT ${TRASHED}`];
  const params = {};
  if (q.trim()) {
    params.q = `%${q.trim()}%`;
    const qLabel = labelInQuery(q);
    if (qLabel) params.qlabel = qLabel;
    where.push(`(m.name LIKE @q OR m.notes LIKE @q OR EXISTS (
      SELECT 1 FROM model_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.model_id = m.id AND t.name LIKE @q)${qLabel ? ` OR ${hasLabel('qlabel')}` : ''})`);
  }
  colors.forEach((c, i) => {
    params[`c${i}`] = c;
    where.push(hasLabel(`c${i}`));
  });
  if (filter === 'unlabeled') where.push(`(m.provenance_type IS NULL OR m.provenance_type = 'unknown')`);
  else if (filter === 'nonu1') where.push(NON_U1);
  else if (filter === 'duplicates') where.push(DUPLICATE);
  else if (filter.startsWith('type:')) {
    where.push('m.provenance_type = @ftype');
    params.ftype = filter.slice(5);
  } else if (filter.startsWith('platform:')) {
    where.push('m.platform = @fplatform');
    params.fplatform = filter.slice(9);
  } else if (filter.startsWith('tag:')) {
    where.push('EXISTS (SELECT 1 FROM model_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.model_id = m.id AND t.name = @ftag)');
    params.ftag = filter.slice(4);
  }
  // duplicates: each group together, then the chosen order inside it
  const order = filter === 'duplicates' ? `m.content_hash, ${SORTS[sort] || SORTS.imported}` : SORTS[sort] || SORTS.imported;
  const sql = `SELECT ${LIST_COLUMNS} FROM models m WHERE ${where.join(' AND ')}
    ORDER BY ${order}`;
  return db.prepare(sql).all(params).map(rowOut);
}

export function getModel(db, id) {
  const row = db.prepare(`SELECT ${LIST_COLUMNS} FROM models m WHERE m.id = ?`).get(id);
  if (!row) return null;
  const colors = db.prepare('SELECT color, faces, pct, label FROM color_stats WHERE model_id = ? ORDER BY faces DESC, color').all(id);
  const plateColors = db.prepare('SELECT color, faces, pct FROM plate_color_stats WHERE model_id = ? AND plate = ? ORDER BY faces DESC, color');
  const plates = db
    .prepare('SELECT plate, name, tri_count FROM plates WHERE model_id = ? ORDER BY plate')
    .all(id)
    .map((p) => ({ ...p, colors: plateColors.all(id, p.plate) }));
  return { ...rowOut(row), colors, plates };
}

/** Sidebar data: counts per filter, platforms and tags in use (trash counted separately). */
export function sidebarCounts(db) {
  const one = (sql) => db.prepare(sql).pluck().get();
  const live = `NOT ${TRASHED}`;
  return {
    all: one(`SELECT COUNT(*) FROM models m WHERE ${live}`),
    unlabeled: one(`SELECT COUNT(*) FROM models m WHERE ${live} AND (provenance_type IS NULL OR provenance_type = 'unknown')`),
    nonU1: one(`SELECT COUNT(*) FROM models m WHERE ${live} AND ${NON_U1}`),
    duplicates: one(`SELECT COUNT(*) FROM models m WHERE ${live} AND ${DUPLICATE}`),
    hashPending: one(`SELECT COUNT(*) FROM models m WHERE ${live} AND m.content_hash IS NULL`),
    types: Object.fromEntries(
      db.prepare(`SELECT provenance_type AS k, COUNT(*) AS n FROM models m WHERE ${live} GROUP BY provenance_type`).all().map((r) => [r.k, r.n]),
    ),
    platforms: db
      .prepare(`SELECT platform AS name, COUNT(*) AS n FROM models m WHERE ${live} AND platform IS NOT NULL AND platform != '' GROUP BY platform ORDER BY platform COLLATE NOCASE`)
      .all(),
    tags: db
      .prepare(`SELECT t.name, COUNT(*) AS n FROM tags t JOIN model_tags mt ON mt.tag_id = t.id JOIN models m ON m.id = mt.model_id WHERE ${live} GROUP BY t.id ORDER BY t.name COLLATE NOCASE`)
      .all(),
    trash: one(`SELECT COUNT(*) FROM models m WHERE ${TRASHED}`),
    // models per colour label (M17); same rule as the list filter
    colors: db
      .prepare(
        `SELECT label, COUNT(*) AS n FROM (
           SELECT cs.model_id, cs.label FROM color_stats cs JOIN models m ON m.id = cs.model_id WHERE ${live}
           GROUP BY cs.model_id, cs.label HAVING SUM(cs.pct) >= ${MODEL_LABEL_MIN_PCT})
         GROUP BY label`,
      )
      .all(),
  };
}

/** 3MF records indexed before M19, whose embedded images are still unknown (NULL). */
export function idsNeedingEmbedded(db) {
  return db.prepare(`SELECT id FROM models WHERE format = '3mf' AND embedded_images IS NULL ORDER BY id`).pluck().all();
}
export function setEmbedded(db, id, embedded, coverBytes) {
  db.prepare('UPDATE models SET embedded_images = ?, cover = ? WHERE id = ?').run(JSON.stringify(embedded), coverBytes ?? null, id);
}
/** { path, bytes } of a model's stored cover image, or null. */
export function getCover(db, id) {
  const r = db.prepare('SELECT embedded_images, cover FROM models WHERE id = ?').get(id);
  if (!r?.cover || !r.embedded_images) return null;
  return { path: JSON.parse(r.embedded_images).cover, bytes: r.cover };
}

/** 3MF records indexed before M18, whose source printer is still unknown (NULL). */
export function idsNeedingSourcePrinter(db) {
  return db.prepare(`SELECT id FROM models WHERE format = '3mf' AND source_printer IS NULL ORDER BY id`).pluck().all();
}
export function setSourcePrinter(db, id, info) {
  db.prepare('UPDATE models SET source_printer = ?, source_process = ? WHERE id = ?').run(info?.printer ?? '', info?.process ?? '', id);
}

/** Colour rows of every live model, for the cabinet-wide colour summary (M17). */
export function cabinetColorRows(db) {
  return db.prepare(`SELECT cs.model_id, cs.color, cs.pct, cs.label FROM color_stats cs JOIN models m ON m.id = cs.model_id WHERE NOT ${TRASHED}`).all();
}

// M33 (SPEC 3.1b): content fingerprints
/** Models (live and trashed) whose fingerprint is still unknown, oldest first. */
export function idsNeedingHash(db) {
  return db.prepare('SELECT id FROM models WHERE content_hash IS NULL ORDER BY id').pluck().all();
}
export function setContentHash(db, id, hash) {
  db.prepare('UPDATE models SET content_hash = ? WHERE id = ?').run(hash, id);
}
/** Records with this fingerprint: [{id, name, rel_path, trashed}], live ones first. */
export function modelsWithHash(db, hash) {
  return db
    .prepare(`SELECT id, name, rel_path, (rel_path LIKE '.trash/%') AS trashed FROM models WHERE content_hash = ? ORDER BY trashed, id`)
    .all(hash)
    .map((r) => ({ ...r, trashed: Boolean(r.trashed) }));
}
/** Live U1 conversions made from this record (M33: converted_from). */
export function conversionsOf(db, id) {
  return db.prepare(`SELECT id, name, rel_path FROM models WHERE converted_from = ? AND rel_path NOT LIKE '.trash/%' ORDER BY id`).all(id);
}
export function setConvertedFrom(db, id, sourceId) {
  db.prepare('UPDATE models SET converted_from = ? WHERE id = ?').run(sourceId, id);
}

export function setRelPath(db, id, relPath) {
  db.prepare('UPDATE models SET rel_path = ? WHERE id = ?').run(relPath, id);
}

/** Permanently drop rows (tags/colour stats cascade). */
export function deleteModels(db, ids) {
  const del = db.prepare('DELETE FROM models WHERE id = ?');
  db.transaction(() => {
    for (const id of ids) del.run(id);
    db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM model_tags)').run();
  })();
}

export function knownRelPaths(db) {
  return new Set(db.prepare('SELECT rel_path FROM models').pluck().all());
}

// Thumbnails (512px PNG, SPEC 3.4). Not part of updated_at: they are derived data.
export function setThumb(db, id, png, dark = false) {
  db.prepare('UPDATE models SET thumb = ?, thumb_dark = ? WHERE id = ?').run(png, png ? (dark ? 1 : 0) : null, id);
}

/** Thumbnails stored before M21 (thumb_dark unknown): [{id, thumb}]. */
export function thumbsToCheck(db) {
  return db.prepare('SELECT id, thumb FROM models WHERE thumb IS NOT NULL AND thumb_dark IS NULL').all();
}

export function getThumb(db, id) {
  return db.prepare('SELECT thumb FROM models WHERE id = ?').pluck().get(id) ?? null;
}

/** Models still lacking a thumbnail (STEP cannot be rendered). */
export function idsNeedingThumb(db) {
  return db.prepare(`SELECT id FROM models WHERE thumb IS NULL AND format != 'step' ORDER BY id`).pluck().all();
}
