// Import pipeline: move into library → parse → index.
import path from 'node:path';
import { collectImportFiles, moveIntoLibrary, listLibraryFiles } from './library.mjs';
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

/** Index files under root that the DB does not know yet (used after switching root). */
export async function indexNewFiles(db, root) {
  const known = knownRelPaths(db);
  const ids = [];
  for (const rel of await listLibraryFiles(root)) {
    if (known.has(rel)) continue;
    const parsed = await parseFile(path.join(root, rel));
    ids.push(insertModel(db, { name: stemOf(rel), relPath: rel, parsed }));
  }
  return ids;
}
