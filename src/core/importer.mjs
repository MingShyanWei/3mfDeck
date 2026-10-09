// Import pipeline: move into library → parse → index.
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectImportFiles, moveIntoLibrary, listLibraryFiles, listTrashFiles } from './library.mjs';
import { parseFile } from './parse/index.mjs';
import { insertModel, knownRelPaths, modelsWithHash, setContentHash } from './db.mjs';
import { hashFile } from './contentHash.mjs';

const stemOf = (p) => path.basename(p, path.extname(p));
const fileExists = (p) => fs.access(p).then(() => true, () => false);

/**
 * Import dropped/selected paths. Each file is moved first (SPEC D1: no move,
 * no import), then parsed and indexed. Returns { ids, skipped, errors, duplicates }.
 * M33 (SPEC 3.1b): a file whose contents (SHA-256) match a record already in
 * the library — or in the trash, or earlier in the same batch — is not moved
 * and not indexed; the source file stays where it is, untouched. Only records
 * whose file is really there count: a missing record (its file not under the
 * current root) does not block the import.
 * duplicates: [{ file, id, name, relPath, trashed }] (the existing record).
 */
export async function importPaths(db, root, paths, now = new Date()) {
  const { files, skipped } = await collectImportFiles(paths);
  const ids = [];
  const errors = [];
  const duplicates = [];
  for (const src of files) {
    let relPath;
    let hash;
    try {
      hash = await hashFile(src);
    } catch (err) {
      errors.push({ file: src, error: err.message });
      continue;
    }
    let existing = null; // live first, then trashed; a missing record does not count
    for (const m of modelsWithHash(db, hash)) {
      if (await fileExists(path.join(root, m.rel_path))) {
        existing = m;
        break;
      }
    }
    if (existing) {
      duplicates.push({ file: src, id: existing.id, name: existing.name, relPath: existing.rel_path, trashed: existing.trashed });
      continue;
    }
    try {
      relPath = await moveIntoLibrary(src, root, now);
    } catch (err) {
      errors.push({ file: src, error: err.message });
      continue;
    }
    const parsed = await parseFile(path.join(root, relPath));
    if (parsed.error) errors.push({ file: src, error: `parse: ${parsed.error}` });
    const id = insertModel(db, { name: stemOf(src), relPath, parsed });
    setContentHash(db, id, hash); // the moved file has the same bytes
    ids.push(id);
  }
  return { ids, skipped, errors, duplicates };
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
