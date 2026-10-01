// M20: the app was renamed 「3MF 櫃」 -> 3mfDeck, which moves Electron's
// userData folder (~/Library/Application Support/<productName>). On the first
// launch under the new name the index and settings are COPIED from the old
// folder; the old folder is never modified, so the previous app keeps working
// and the move can be undone.
import fs from 'node:fs';
import path from 'node:path';

export const OLD_APP_NAME = '3MF 櫃';
// The SQLite database with its WAL companions (copied together so no committed
// page is lost) and the settings file; nothing else in the folder is app data
// (the rest is Chromium cache, rebuilt on demand).
export const MIGRATED_FILES = ['library.db', 'library.db-wal', 'library.db-shm', 'config.json'];
export const MARKER = 'migrated-from.json';

/**
 * Copy the app data from `oldDir` to `newDir` when the new folder has none yet
 * and the old one has some. Returns { migrated, copied: [names], reason }.
 * Never overwrites: a file already in `newDir` stops the migration.
 */
export function migrateUserData(oldDir, newDir, now = new Date()) {
  const has = (dir, f) => fs.existsSync(path.join(dir, f));
  if (path.resolve(oldDir) === path.resolve(newDir)) return { migrated: false, copied: [], reason: 'same folder' };
  if (has(newDir, 'library.db') || has(newDir, 'config.json')) return { migrated: false, copied: [], reason: 'new folder already has data' };
  const present = MIGRATED_FILES.filter((f) => has(oldDir, f));
  if (!present.includes('library.db') && !present.includes('config.json')) return { migrated: false, copied: [], reason: 'no old data' };
  fs.mkdirSync(newDir, { recursive: true });
  for (const f of present) fs.copyFileSync(path.join(oldDir, f), path.join(newDir, f), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(newDir, MARKER), JSON.stringify({ from: oldDir, files: present, at: now.toISOString() }, null, 2));
  return { migrated: true, copied: present, reason: 'copied' };
}
