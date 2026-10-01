// Recycle bin and export (SPEC 3.7).
import fs from 'node:fs/promises';
import path from 'node:path';
import { TRASH_DIR, moveWithinRoot, copyInto } from './library.mjs';
import { getModel, listModels, setRelPath, deleteModels } from './db.mjs';
import { modelPath } from './settings.mjs';

export const isTrashed = (rel) => rel.startsWith(`${TRASH_DIR}/`);

// Remove now-empty directories from `relDir` up to (not including) .trash
async function pruneEmptyDirs(root, relDir) {
  for (let d = relDir; isTrashed(d + '/') && d !== TRASH_DIR; d = path.dirname(d)) {
    try {
      await fs.rmdir(path.join(root, d));
    } catch (err) {
      if (err.code === 'ENOTEMPTY' || err.code === 'EEXIST') return;
      if (err.code !== 'ENOENT') throw err;
    }
  }
}

/**
 * Move a model's file to <root>/.trash/<id>/<original rel path>. The row is
 * kept (tags, provenance) so the model can be restored. Returns the new rel path.
 */
export async function trashModel(db, root, id) {
  const m = getModel(db, id);
  if (isTrashed(m.rel_path)) return m.rel_path;
  const rel = await moveWithinRoot(root, m.rel_path, path.join(TRASH_DIR, String(id), m.rel_path));
  setRelPath(db, id, rel);
  return rel;
}

/**
 * Move a trashed model back to its original location; if that path is taken
 * by now, the file gets a -2/-3 suffix instead of overwriting. Returns the rel path.
 */
export async function restoreModel(db, root, id, now = new Date()) {
  const m = getModel(db, id);
  if (!isTrashed(m.rel_path)) throw new Error(`model ${id} is not in the trash`);
  const parts = m.rel_path.split('/');
  // .trash/<id>/<original>; a file dropped straight into .trash goes to this year's folder
  const original = parts.length > 2 ? parts.slice(2).join('/') : path.join(String(now.getFullYear()), parts[1]);
  const rel = await moveWithinRoot(root, m.rel_path, original);
  setRelPath(db, id, rel);
  await pruneEmptyDirs(root, path.dirname(m.rel_path));
  return rel;
}

/** Permanently delete everything in the trash (files and rows). Returns the number of models removed. */
export async function emptyTrash(db, root) {
  const ids = listModels(db, { filter: 'trash' }).map((m) => m.id);
  deleteModels(db, ids);
  await fs.rm(path.join(root, TRASH_DIR), { recursive: true, force: true });
  return ids.length;
}

/** Copy (never move) a model's file into `destDir`. Returns the copy's path. */
export function exportModel(db, root, id, destDir) {
  return copyInto(modelPath(db, root, id), destDir);
}
