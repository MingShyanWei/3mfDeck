// App settings (SPEC 3.8): stored in Electron userData, never in the library root.
import fs from 'node:fs';
import path from 'node:path';
import { indexNewFiles } from './importer.mjs';
import { listModels, getModel } from './db.mjs';
import { DEFAULT_SPOOLS } from './filament.mjs';

const file = (userDataDir) => path.join(userDataDir, 'config.json');

function readConfig(userDataDir) {
  try {
    return JSON.parse(fs.readFileSync(file(userDataDir), 'utf8'));
  } catch {
    return {}; // first run: no config yet
  }
}

export function loadSettings(userDataDir, defaultRoot) {
  const saved = readConfig(userDataDir);
  return {
    libraryRoot: saved.libraryRoot || defaultRoot,
    notifiedMissing: saved.notifiedMissing || [],
    spools: saved.spools || DEFAULT_SPOOLS,
    inventory: (Array.isArray(saved.inventory) ? saved.inventory : []),
  };
}

/**
 * Filament inventory (SPEC 3.5d): filaments the user owns, name + "#RRGGBB".
 * The suggestion picks spools from here first. Throws on invalid input.
 */
export function validateInventory(list) {
  if (!Array.isArray(list)) throw new Error('線材庫格式錯誤');
  const seen = new Set();
  return list.map((f) => {
    const hex = String(f?.hex || '').toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(hex)) throw new Error(`色碼格式錯誤：${f?.hex}（需為 #RRGGBB）`);
    if (seen.has(hex)) throw new Error(`線材庫有重複色碼：${hex}`);
    seen.add(hex);
    return { name: String(f?.name || '').trim().slice(0, 60), hex };
  });
}

/**
 * Spool colours of the user's printer (SPEC 3.5b): 1-4 "#RRGGBB" values, the
 * actual filaments loaded. Throws on invalid input; returns the normalized list.
 */
export function validateSpools(spools) {
  if (!Array.isArray(spools) || spools.length < 1 || spools.length > 4) throw new Error('捲數必須是 1–4');
  return spools.map((h) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(h)) throw new Error(`色碼格式錯誤：${h}（需為 #RRGGBB）`);
    return h.toUpperCase();
  });
}

/** Merge `settings` into config.json (other keys are kept). */
export function saveSettings(userDataDir, settings) {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(file(userDataDir), JSON.stringify({ ...readConfig(userDataDir), ...settings }, null, 2));
}

/** Absolute path of a model's file under the current root (Finder reveal, preview). */
export function modelPath(db, root, id) {
  const m = getModel(db, id);
  if (!m) throw new Error(`no model ${id}`);
  return path.join(root, m.rel_path);
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
