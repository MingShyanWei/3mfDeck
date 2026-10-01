// M20: userData migration after the rename 「3MF 櫃」 -> 3mfDeck.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { migrateUserData, MARKER } from '../../src/core/userDataMigration.mjs';
import { openDb, insertModel, listModels } from '../../src/core/db.mjs';
import { parseFile } from '../../src/core/parse/index.mjs';
import { FIXTURES, tmpDir } from './helpers.mjs';

const hashDir = async (dir) => {
  const out = {};
  for (const f of (await fs.readdir(dir)).sort()) {
    const st = await fs.stat(path.join(dir, f));
    if (st.isDirectory()) continue;
    out[f] = [crypto.createHash('sha256').update(await fs.readFile(path.join(dir, f))).digest('hex'), st.mtimeMs];
  }
  return out;
};

// An old userData folder as the previous app leaves it: index with WAL files, settings, Chromium cache
async function oldFolder() {
  const dir = path.join(await tmpDir(), '3MF 櫃');
  await fs.mkdir(path.join(dir, 'Cache'), { recursive: true });
  await fs.writeFile(path.join(dir, 'Cache', 'data_0'), 'cache');
  const db = openDb(path.join(dir, 'library.db'));
  db.pragma('wal_autocheckpoint = 0'); // keep rows in the WAL, as a running app does
  insertModel(db, { name: 'painted', relPath: '2026/painted.3mf', parsed: await parseFile(path.join(FIXTURES, 'painted.3mf')) });
  insertModel(db, { name: 'materials', relPath: '2026/materials.3mf', parsed: await parseFile(path.join(FIXTURES, 'materials.3mf')) });
  await fs.writeFile(path.join(dir, 'config.json'), JSON.stringify({ libraryRoot: '/somewhere/3mf', spools: ['#FFFF00'] }));
  // copy the files while the connection is open, then close it: the copy has the rows only in its WAL
  const snapshot = path.join(path.dirname(dir), 'snapshot');
  await fs.mkdir(snapshot);
  for (const f of await fs.readdir(dir)) if (!f.startsWith('Cache')) await fs.copyFile(path.join(dir, f), path.join(snapshot, f));
  db.close();
  await fs.rm(dir, { recursive: true });
  await fs.rename(snapshot, dir);
  await fs.mkdir(path.join(dir, 'Cache'));
  return dir;
}

describe('migrateUserData', () => {
  it('copies index (with its WAL), settings; leaves the old folder untouched; writes a marker', async () => {
    const old = await oldFolder();
    expect(existsSync(path.join(old, 'library.db-wal'))).toBe(true);
    const before = await hashDir(old);
    const fresh = path.join(path.dirname(old), '3mfDeck');
    const r = migrateUserData(old, fresh, new Date('2026-10-02T00:00:00Z'));
    expect(r).toEqual({ migrated: true, copied: ['library.db', 'library.db-wal', 'library.db-shm', 'config.json'], reason: 'copied' });
    expect(await hashDir(old)).toEqual(before); // nothing in the old folder changed
    expect(existsSync(path.join(fresh, 'Cache'))).toBe(false); // caches are not app data
    expect(JSON.parse(await fs.readFile(path.join(fresh, 'config.json'), 'utf8')).libraryRoot).toBe('/somewhere/3mf');
    expect(JSON.parse(await fs.readFile(path.join(fresh, MARKER), 'utf8'))).toMatchObject({ from: old, at: '2026-10-02T00:00:00.000Z' });
    const db = openDb(path.join(fresh, 'library.db'));
    expect(listModels(db).map((m) => [m.name, m.color_labels.map((l) => l.label)])).toEqual([
      ['materials', ['orange', 'white', 'blue']], // white and blue tie at 25 %
      ['painted', ['cyan', 'pink', 'yellow']],
    ]);
    db.close();
  });

  it('runs once: never overwrites a new folder that already has data', async () => {
    const old = await oldFolder();
    const fresh = path.join(path.dirname(old), '3mfDeck');
    await fs.mkdir(fresh);
    await fs.writeFile(path.join(fresh, 'config.json'), '{"libraryRoot":"/new"}');
    expect(migrateUserData(old, fresh)).toMatchObject({ migrated: false, reason: 'new folder already has data' });
    expect(await fs.readFile(path.join(fresh, 'config.json'), 'utf8')).toBe('{"libraryRoot":"/new"}');
    expect(existsSync(path.join(fresh, 'library.db'))).toBe(false);
  });

  it('does nothing without old data (fresh install) or when both folders are the same', async () => {
    const dir = await tmpDir();
    expect(migrateUserData(path.join(dir, 'missing'), path.join(dir, 'new'))).toMatchObject({ migrated: false, reason: 'no old data' });
    expect(existsSync(path.join(dir, 'new'))).toBe(false);
    expect(migrateUserData(dir, dir)).toMatchObject({ migrated: false, reason: 'same folder' });
  });
});
