// SQLite index (better-sqlite3). Schema per SPEC.md §4.
// The file system is the source of truth; this is only an index.
import Database from 'better-sqlite3';

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
  updated_at    TEXT NOT NULL
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
  PRIMARY KEY (model_id, color)
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
  return db;
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
           provenance_type, platform, retrieved_at, notes, imported_at, updated_at)
         VALUES (@name, @rel_path, @format, @size_bytes, @tri_count, @bbox_mm, @color_count,
           @provenance_type, @platform, @retrieved_at, @notes, @ts, @ts)`,
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
      });
    const ins = db.prepare('INSERT INTO color_stats (model_id, color, faces, pct) VALUES (?, ?, ?, ?)');
    for (const c of parsed.colorStats || []) ins.run(id, c.color, c.faces, c.pct);
    return Number(id);
  });
  return run();
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
  m.thumb IS NOT NULL AS has_thumb,
  (SELECT json_group_array(t.name) FROM model_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.model_id = m.id) AS tags`;

const SORTS = {
  imported: 'm.imported_at DESC, m.id DESC',
  name: 'm.name COLLATE NOCASE ASC',
  colors: 'm.color_count IS NULL, m.color_count DESC, m.name COLLATE NOCASE',
};

const rowOut = (r) => ({ ...r, has_thumb: Boolean(r.has_thumb), tags: JSON.parse(r.tags), bbox_mm: r.bbox_mm ? JSON.parse(r.bbox_mm) : null });

/**
 * List models.
 * - q: substring match on name, notes, tags (case-insensitive)
 * - filter: 'all' | 'unlabeled' | 'type:<provenance_type>' | 'platform:<name>' | 'tag:<name>'
 * - sort: 'imported' | 'name' | 'colors'
 */
export function listModels(db, { q = '', filter = 'all', sort = 'imported' } = {}) {
  const where = [];
  const params = {};
  if (q.trim()) {
    params.q = `%${q.trim()}%`;
    where.push(`(m.name LIKE @q OR m.notes LIKE @q OR EXISTS (
      SELECT 1 FROM model_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.model_id = m.id AND t.name LIKE @q))`);
  }
  if (filter === 'unlabeled') where.push(`(m.provenance_type IS NULL OR m.provenance_type = 'unknown')`);
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
  const sql = `SELECT ${LIST_COLUMNS} FROM models m ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${SORTS[sort] || SORTS.imported}`;
  return db.prepare(sql).all(params).map(rowOut);
}

export function getModel(db, id) {
  const row = db.prepare(`SELECT ${LIST_COLUMNS} FROM models m WHERE m.id = ?`).get(id);
  if (!row) return null;
  const colors = db.prepare('SELECT color, faces, pct FROM color_stats WHERE model_id = ? ORDER BY faces DESC').all(id);
  return { ...rowOut(row), colors };
}

/** Sidebar data: counts per filter, platforms and tags in use. */
export function sidebarCounts(db) {
  const one = (sql) => db.prepare(sql).pluck().get();
  return {
    all: one('SELECT COUNT(*) FROM models'),
    unlabeled: one(`SELECT COUNT(*) FROM models WHERE provenance_type IS NULL OR provenance_type = 'unknown'`),
    types: Object.fromEntries(
      db.prepare('SELECT provenance_type AS k, COUNT(*) AS n FROM models GROUP BY provenance_type').all().map((r) => [r.k, r.n]),
    ),
    platforms: db
      .prepare(`SELECT platform AS name, COUNT(*) AS n FROM models WHERE platform IS NOT NULL AND platform != '' GROUP BY platform ORDER BY platform COLLATE NOCASE`)
      .all(),
    tags: db
      .prepare('SELECT t.name, COUNT(*) AS n FROM tags t JOIN model_tags mt ON mt.tag_id = t.id GROUP BY t.id ORDER BY t.name COLLATE NOCASE')
      .all(),
  };
}

export function knownRelPaths(db) {
  return new Set(db.prepare('SELECT rel_path FROM models').pluck().all());
}

// Thumbnails (512px PNG, SPEC 3.4). Not part of updated_at: they are derived data.
export function setThumb(db, id, png) {
  db.prepare('UPDATE models SET thumb = ? WHERE id = ?').run(png, id);
}

export function getThumb(db, id) {
  return db.prepare('SELECT thumb FROM models WHERE id = ?').pluck().get(id) ?? null;
}

/** Models still lacking a thumbnail (STEP cannot be rendered). */
export function idsNeedingThumb(db) {
  return db.prepare(`SELECT id FROM models WHERE thumb IS NULL AND format != 'step' ORDER BY id`).pluck().all();
}
