// App settings (SPEC 3.7): stored in Electron userData, never in the library root.
import fs from 'node:fs';
import path from 'node:path';
import { indexNewFiles } from './importer.mjs';
import { listModels } from './db.mjs';

const file = (userDataDir) => path.join(userDataDir, 'config.json');

export function loadSettings(userDataDir, defaultRoot) {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(file(userDataDir), 'utf8'));
  } catch {
    // first run: no config yet
  }
  return { libraryRoot: saved.libraryRoot || defaultRoot };
}

export function saveSettings(userDataDir, settings) {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(file(userDataDir), JSON.stringify(settings, null, 2));
}

/** Annotate rows with `missing`: the indexed file no longer exists under root. */
export function markMissing(rows, root) {
  return rows.map((r) => ({ ...r, missing: !fs.existsSync(path.join(root, r.rel_path)) }));
}

/**
 * Switch the library root. Files are never moved: the setting is saved, the
 * new root is indexed, and records whose file is not under the new root show
 * up as missing (遺失). Returns { libraryRoot, indexed, missing }.
 */
export async function switchRoot(db, userDataDir, newRoot) {
  fs.mkdirSync(newRoot, { recursive: true });
  saveSettings(userDataDir, { libraryRoot: newRoot });
  const indexed = await indexNewFiles(db, newRoot);
  const missing = markMissing(listModels(db), newRoot).filter((m) => m.missing).length;
  return { libraryRoot: newRoot, indexed: indexed.length, missing };
}
