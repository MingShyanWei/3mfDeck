// Missing records (遺失): DB rows whose file is not under the current root,
// typically after switching the library root. They can be relocated to a
// file, removed from the index (the file is never touched), or restored when
// their file sits in <root>/.trash.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { TRASH_DIR, moveIntoLibrary, moveWithinRoot } from './library.mjs';
import { getModel, listModels, setRelPath, deleteModels, knownRelPaths, replaceDerived } from './db.mjs';
import { parseFile, SUPPORTED_EXTS } from './parse/index.mjs';
import { loadSettings, saveSettings } from './settings.mjs';
import { untrackedFiles } from './importer.mjs';

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
  if (!SUPPORTED_EXTS.includes(path.extname(absPath).toLowerCase())) throw new Error(`不支援的格式：${path.basename(absPath)}`);
  if (isInside(root, absPath)) {
    const rel = path.relative(root, absPath);
    if (knownRelPaths(db).has(rel)) throw new Error(`這個檔案已經在櫃中（${rel}）`);
    await apply(db, root, id, rel);
    return rel;
  }
  const rel = await moveIntoLibrary(absPath, root, now);
  await apply(db, root, id, rel);
  return rel;
}

async function apply(db, root, id, rel) {
  const parsed = await parseFile(path.join(root, rel));
  db.transaction(() => {
    setRelPath(db, id, rel);
    replaceDerived(db, id, parsed);
  })();
}

/** Remove the index record only; whatever file it pointed to is left alone. */
export function removeRecord(db, id) {
  deleteModels(db, [id]);
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
  if (!found) throw new Error(`回收桶裡找不到 ${m.rel_path}`);
  const rel = await moveWithinRoot(root, found, m.rel_path);
  setRelPath(db, id, rel);
  return rel;
}
