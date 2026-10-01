// Import pipeline: move into library → parse → index.
import path from 'node:path';
import { collectImportFiles, moveIntoLibrary, listLibraryFiles, listTrashFiles } from './library.mjs';
import { parseFile } from './parse/index.mjs';
import { insertModel, knownRelPaths } from './db.mjs';

const stemOf = (p) => path.basename(p, path.extname(p));

/**
 * Import dropped/selected paths. Each file is moved first (SPEC D1: no move,
 * no import), then parsed and indexed. Returns { ids, skipped, errors }.
 */
export async function importPaths(db, root, paths, now = new Date()) {
  const { files, skipped } = await collectImportFiles(paths);
  const ids = [];
  const errors = [];
  for (const src of files) {
    let relPath;
    try {
      relPath = await moveIntoLibrary(src, root, now);
    } catch (err) {
      errors.push({ file: src, error: err.message });
      continue;
    }
    const parsed = await parseFile(path.join(root, relPath));
    if (parsed.error) errors.push({ file: src, error: `parse: ${parsed.error}` });
    ids.push(insertModel(db, { name: stemOf(src), relPath, parsed }));
  }
  return { ids, skipped, errors };
}

/** Files under root (library and .trash) that the DB does not know, as rel paths. */
export async function untrackedFiles(db, root) {
  const known = knownRelPaths(db);
  return [...(await listLibraryFiles(root)), ...(await listTrashFiles(root))].filter((rel) => !known.has(rel));
}

/**
 * Index files under root that the DB does not know yet (switching root,
 * rebuilding a lost DB). Files in .trash are indexed as trashed models so
 * they stay restorable.
 */
export async function indexNewFiles(db, root) {
  const ids = [];
  for (const rel of await untrackedFiles(db, root)) {
    const parsed = await parseFile(path.join(root, rel));
    ids.push(insertModel(db, { name: stemOf(rel), relPath: rel, parsed }));
  }
  return ids;
}
