// M33 (SPEC 3.1b): duplicate detection by content fingerprint.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { importPaths } from '../../src/core/importer.mjs';
import { trashModel } from '../../src/core/trash.mjs';
import { openDb, listModels, sidebarCounts, idsNeedingHash, setContentHash, modelsWithHash, conversionsOf, setConvertedFrom } from '../../src/core/db.mjs';
import { hashFile, isDataless, SF_DATALESS } from '../../src/core/contentHash.mjs';
import { tmpDir, stage, exists, FIXTURES } from './helpers.mjs';

const NOW = new Date(2026, 9, 10);
const sha = async (file) => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');

describe('import: identical contents are not imported again', () => {
  let base, root, db;
  beforeEach(async () => {
    base = await tmpDir();
    root = path.join(base, 'lib');
    db = openDb(':memory:');
  });

  it('a second copy (other name, other folder) is skipped; the source stays where it was, untouched', async () => {
    const first = await importPaths(db, root, [await stage(path.join(base, 'a'), 'painted.3mf')], NOW);
    expect(first.ids).toHaveLength(1);
    expect(first.duplicates).toEqual([]);
    const again = await stage(path.join(base, 'b'), 'painted.3mf', 'renamed copy.3mf');
    const before = await fs.readFile(again);
    const r = await importPaths(db, root, [again], NOW);
    expect(r.ids).toEqual([]);
    expect(r.duplicates).toEqual([{ file: again, id: first.ids[0], name: 'painted', relPath: '2026/painted.3mf', trashed: false }]);
    expect(await fs.readFile(again)).toEqual(before); // not moved, not changed
    expect(listModels(db)).toHaveLength(1);
  });

  it('two identical files in one batch: only the first is imported', async () => {
    const a = await stage(path.join(base, 'in'), 'cube.stl', 'one.stl');
    const b = await stage(path.join(base, 'in'), 'cube.stl', 'two.stl');
    const r = await importPaths(db, root, [a, b], NOW);
    expect(r.ids).toHaveLength(1);
    expect(r.duplicates.map((d) => [path.basename(d.file), d.relPath])).toEqual([['two.stl', '2026/one.stl']]);
    expect(await exists(b)).toBe(true);
  });

  it('same name, other contents: imported as "-2" as before', async () => {
    await importPaths(db, root, [await stage(path.join(base, 'a'), 'cube.stl')], NOW);
    const other = await stage(path.join(base, 'b'), 'cube.stl');
    const bytes = await fs.readFile(other);
    bytes[0] ^= 0xff; // binary STL header byte: same model, other bytes
    await fs.writeFile(other, bytes);
    const r = await importPaths(db, root, [other], NOW);
    expect(r.duplicates).toEqual([]);
    expect(listModels(db).map((m) => m.rel_path).sort()).toEqual(['2026/cube-2.stl', '2026/cube.stl']);
  });

  it('the identical file is in the trash: skipped and reported as trashed (restore from the trash)', async () => {
    const { ids } = await importPaths(db, root, [await stage(path.join(base, 'a'), 'cube.stl')], NOW);
    await trashModel(db, root, ids[0]);
    const r = await importPaths(db, root, [await stage(path.join(base, 'b'), 'cube.stl')], NOW);
    expect(r.ids).toEqual([]);
    expect(r.duplicates[0]).toMatchObject({ id: ids[0], trashed: true });
  });

  it('a missing record (file not under the current root) does not block the import', async () => {
    const { ids } = await importPaths(db, root, [await stage(path.join(base, 'a'), 'cube.stl')], NOW);
    // as after switching the library root: the record stays, its file is not under this root
    db.prepare('UPDATE models SET rel_path = ? WHERE id = ?').run('elsewhere/cube.stl', ids[0]);
    const r = await importPaths(db, root, [await stage(path.join(base, 'b'), 'cube.stl')], NOW);
    expect(r.duplicates).toEqual([]);
    expect(r.ids).toHaveLength(1);
    // both share the fingerprint: the 重複 filter shows them, the user removes the missing record
    expect(listModels(db, { filter: 'duplicates' }).map((m) => m.id).sort()).toEqual([ids[0], r.ids[0]].sort());
  });

  it('every imported record carries its SHA-256', async () => {
    const src = await stage(path.join(base, 'a'), 'box.obj');
    const want = await sha(src);
    const { ids } = await importPaths(db, root, [src], NOW);
    expect(listModels(db).find((m) => m.id === ids[0]).content_hash).toBe(want);
  });
});

describe('the 重複 filter and older databases', () => {
  it('an older database gets the columns; records without a fingerprint wait for the background fill', async () => {
    const file = path.join(await tmpDir(), 'old.db');
    const old = new Database(file);
    old.exec(`CREATE TABLE models (id INTEGER PRIMARY KEY, name TEXT NOT NULL, rel_path TEXT NOT NULL UNIQUE, format TEXT NOT NULL,
      size_bytes INTEGER NOT NULL, tri_count INTEGER, bbox_mm TEXT, color_count INTEGER, thumb BLOB, provenance_type TEXT,
      platform TEXT, url TEXT, prompt TEXT, retrieved_at TEXT, notes TEXT, imported_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO models (id, name, rel_path, format, size_bytes, imported_at, updated_at) VALUES
        (1, 'a', '2026/a.3mf', '3mf', 10, 'x', 'x'), (2, 'a copy', 'other/a.3mf', '3mf', 10, 'x', 'x'),
        (3, 'b', '2026/b.3mf', '3mf', 20, 'x', 'x'), (4, 'a old', '.trash/4/2026/a.3mf', '3mf', 10, 'x', 'x');`);
    old.close();
    const db = openDb(file);
    expect(idsNeedingHash(db)).toEqual([1, 2, 3, 4]);
    expect(sidebarCounts(db)).toMatchObject({ duplicates: 0, hashPending: 3 }); // the trash is not counted
    for (const [id, h] of [[1, 'h-a'], [2, 'h-a'], [3, 'h-b'], [4, 'h-a']]) setContentHash(db, id, h);
    expect(idsNeedingHash(db)).toEqual([]);
    // live records sharing a fingerprint, grouped; the trashed copy is not listed
    expect(listModels(db, { filter: 'duplicates' }).map((m) => m.id).sort()).toEqual([1, 2]);
    expect(sidebarCounts(db)).toMatchObject({ duplicates: 2, hashPending: 0 });
    // a fingerprint that only a trashed record and one live record share is not a duplicate group
    setContentHash(db, 2, 'h-c');
    expect(listModels(db, { filter: 'duplicates' })).toEqual([]);
    expect(modelsWithHash(db, 'h-a').map((m) => [m.id, m.trashed])).toEqual([[1, false], [4, true]]); // live first
    db.close();
  });

  it('records which record a U1 conversion came from', () => {
    const db = openDb(':memory:');
    db.exec(`INSERT INTO models (id, name, rel_path, format, size_bytes, imported_at, updated_at) VALUES
      (1, 'src', '2026/src.3mf', '3mf', 1, 'x', 'x'), (2, 'src-U1', '2026/src-U1.3mf', '3mf', 1, 'x', 'x'), (3, 'old', '.trash/3/2026/src-U1-2.3mf', '3mf', 1, 'x', 'x')`);
    expect(conversionsOf(db, 1)).toEqual([]);
    setConvertedFrom(db, 2, 1);
    setConvertedFrom(db, 3, 1); // trashed conversions do not count
    expect(conversionsOf(db, 1)).toEqual([{ id: 2, name: 'src-U1', rel_path: '2026/src-U1.3mf' }]);
  });
});

describe('fingerprint and the iCloud "not downloaded" check', () => {
  it('hashFile is the SHA-256 of the bytes', async () => {
    const f = path.join(FIXTURES, 'painted.3mf');
    expect(await hashFile(f)).toBe(await sha(f));
  });

  it('isDataless reads the SF_DATALESS file flag only (stat -f %f), never the contents', async () => {
    const calls = [];
    const run = (flags) => (cmd, args, cb) => {
      calls.push([cmd, ...args]);
      cb(null, `${flags}\n`);
    };
    expect(await isDataless('/x.3mf', { platform: 'darwin', run: run(SF_DATALESS | 0x20) })).toBe(true);
    expect(await isDataless('/x.3mf', { platform: 'darwin', run: run(0x20) })).toBe(false);
    expect(await isDataless('/x.3mf', { platform: 'darwin', run: (c, a, cb) => cb(new Error('EPERM')) })).toBe(false);
    expect(await isDataless('/x.3mf', { platform: 'linux', run: run(SF_DATALESS) })).toBe(false);
    expect(calls[0]).toEqual(['/usr/bin/stat', '-f', '%f', '/x.3mf']);
    expect(SF_DATALESS).toBe(0x40000000);
  });

  it('a local file is not dataless (real stat on this machine)', async () => {
    expect(await isDataless(path.join(FIXTURES, 'cube.stl'))).toBe(false);
  });
});
