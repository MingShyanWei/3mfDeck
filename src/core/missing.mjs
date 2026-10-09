// Missing records (遺失): DB rows whose file is not under the current root,
// typically after switching the library root. They can be relocated to a
// file, removed from the index (the file is never touched), or restored when
// their file sits in <root>/.trash.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { TRASH_DIR, moveIntoLibrary, moveWithinRoot, listLibraryFiles } from './library.mjs';
import { getModel, listModels, setRelPath, deleteModels, knownRelPaths, replaceDerived, setContentHash } from './db.mjs';
import { hashFile } from './contentHash.mjs';
import { parseFile, SUPPORTED_EXTS } from './parse/index.mjs';
import { loadSettings, saveSettings } from './settings.mjs';
import { untrackedFiles } from './importer.mjs';
import { t } from './i18n/index.mjs';

/** Ids of all records (library and trash) whose file does not exist under root. */
export function missingIds(db, root) {
  return [...listModels(db), ...listModels(db, { filter: 'trash' })]
    .filter((m) => !existsSync(path.join(root, m.rel_path)))
    .map((m) => m.id)
    .sort((a, b) => a - b);
}

/** Ids missing now that were not missing (notified) before: notify once. */
export const newlyMissing = (notified, current) => {
  const seen = new Set(notified);
  return current.filter((id) => !seen.has(id));
};

/**
 * Startup / post-change consistency report. Missing records are reported as
 * `newlyMissing` only the first time they go missing: the current missing set
 * is remembered in config.json, so the same records do not raise a notice on
 * every launch (they stay visible through the 遺失 filter and card badges).
 * `untracked`: files on disk the index does not know (offer a rebuild).
 */
export async function consistencyReport(db, root, userDataDir) {
  const ids = missingIds(db, root);
  const fresh = newlyMissing(loadSettings(userDataDir, root).notifiedMissing, ids);
  saveSettings(userDataDir, { notifiedMissing: ids });
  return { untracked: await untrackedFiles(db, root), missing: ids.length, newlyMissing: fresh.length };
}

/** Is `abs` a path inside the library root? */
export const isInside = (root, abs) => {
  const rel = path.relative(root, abs);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/**
 * Point a record at a file the user picked. A file inside the root is used in
 * place; a file elsewhere is moved into <root>/<YYYY>/ exactly like an import
 * (never overwriting). File-derived data (size, geometry, colours, plates,
 * thumbnail) is re-read from the file; user metadata (name, provenance, tags,
 * notes) is kept. Returns the new rel path.
 */
export async function relocateModel(db, root, id, absPath, now = new Date()) {
  if (!getModel(db, id)) throw new Error(`no model ${id}`);
  if (!SUPPORTED_EXTS.includes(path.extname(absPath).toLowerCase())) throw new Error(t('missing.err.unsupported', { file: path.basename(absPath) }));
  if (isInside(root, absPath)) {
    const rel = path.relative(root, absPath);
    if (knownRelPaths(db).has(rel)) throw new Error(t('missing.err.alreadyIndexed', { rel }));
    await apply(db, root, id, rel);
    return rel;
  }
  const rel = await moveIntoLibrary(absPath, root, now);
  await apply(db, root, id, rel);
  return rel;
}

async function apply(db, root, id, rel) {
  const parsed = await parseFile(path.join(root, rel));
  const hash = await hashFile(path.join(root, rel)); // M33: the file found need not be byte-identical to the lost one
  db.transaction(() => {
    setRelPath(db, id, rel);
    replaceDerived(db, id, parsed);
    setContentHash(db, id, hash);
  })();
}

/** Remove the index record only; whatever file it pointed to is left alone. */
export function removeRecord(db, id) {
  deleteModels(db, [id]);
}

/**
 * Batch remove: drops the index records of the given ids that are actually
 * missing right now (stale or live ids from the UI are ignored). Files are
 * never touched. Returns the removed ids.
 */
export function removeMissingRecords(db, root, ids) {
  const missing = new Set(missingIds(db, root));
  const removed = ids.filter((id) => missing.has(id));
  deleteModels(db, removed);
  return removed;
}

/**
 * Find missing records' files by name: for each missing library record, look
 * for files under root (recursively, hidden dirs such as .trash excluded) with
 * the same file name that no record uses yet. Names compare case-insensitively
 * (macOS volumes usually are). Result per record:
 *   status 'match'     exactly one candidate, claimed by no other missing record
 *   status 'ambiguous' several candidates, or the candidate is wanted by
 *                      several missing records -> left to manual relocation
 *   status 'none'      nothing found
 * `sameSize` tells whether the match has the size the record remembers.
 */
export async function findByFilename(db, root) {
  const known = knownRelPaths(db);
  const byName = new Map();
  for (const rel of await listLibraryFiles(root)) {
    if (known.has(rel)) continue;
    const key = path.basename(rel).toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(rel);
  }
  const ids = new Set(missingIds(db, root));
  const rows = listModels(db)
    .filter((m) => ids.has(m.id))
    .map((m) => ({ id: m.id, name: m.name, relPath: m.rel_path, sizeBytes: m.size_bytes, candidates: byName.get(path.basename(m.rel_path).toLowerCase()) || [] }));
  const claims = new Map(); // candidate rel -> number of missing records wanting it
  for (const r of rows) if (r.candidates.length === 1) claims.set(r.candidates[0], (claims.get(r.candidates[0]) || 0) + 1);
  const out = [];
  for (const r of rows) {
    const { candidates, ...rest } = r;
    if (!candidates.length) out.push({ ...rest, status: 'none', candidates });
    else if (candidates.length > 1 || claims.get(candidates[0]) > 1) out.push({ ...rest, status: 'ambiguous', candidates });
    else {
      const { size } = await fs.stat(path.join(root, candidates[0]));
      out.push({ ...rest, status: 'match', candidates, match: candidates[0], sameSize: size === r.sizeBytes });
    }
  }
  return out.sort((a, b) => a.id - b.id);
}

/**
 * Apply confirmed { id, relPath } pairs (paths inside root). Each goes through
 * relocateModel, so user metadata is kept and file data re-read. Failures are
 * collected per record instead of aborting the batch.
 */
export async function applyRelocations(db, root, pairs) {
  const done = [];
  const errors = [];
  for (const { id, relPath } of pairs) {
    try {
      done.push({ id, relPath: await relocateModel(db, root, id, path.join(root, relPath)) });
    } catch (err) {
      errors.push({ id, error: err.message });
    }
  }
  return { done, errors };
}

/**
 * A missing record's file found in <root>/.trash: either .trash/<n>/<rel_path>
 * (trashed by this app, possibly under another DB) or .trash/<rel_path>.
 * Returns the trash rel path or null.
 */
export async function findInTrash(root, relPath) {
  const trash = path.join(root, TRASH_DIR);
  if (existsSync(path.join(trash, relPath))) return path.join(TRASH_DIR, relPath);
  let dirs = [];
  try {
    dirs = await fs.readdir(trash, { withFileTypes: true });
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  for (const d of dirs) {
    if (d.isDirectory() && existsSync(path.join(trash, d.name, relPath))) return path.join(TRASH_DIR, d.name, relPath);
  }
  return null;
}

/** Move a missing record's file back from .trash to its path (suffix on clash). Returns the rel path. */
export async function restoreMissingFromTrash(db, root, id) {
  const m = getModel(db, id);
  const found = await findInTrash(root, m.rel_path);
  if (!found) throw new Error(t('missing.err.notInTrash', { rel: m.rel_path }));
  const rel = await moveWithinRoot(root, found, m.rel_path);
  setRelPath(db, id, rel);
  setContentHash(db, id, await hashFile(path.join(root, rel))); // M33: fingerprint of the file actually restored
  return rel;
}
