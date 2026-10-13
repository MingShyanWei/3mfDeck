// M33 (SPEC 3.1b): duplicate detection by content fingerprint.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { importPaths } from '../../src/core/importer.mjs';
import { trashModel } from '../../src/core/trash.mjs';
import { openDb, listModels, sidebarCounts, idsNeedingHash, setContentHash, modelsWithHash } from '../../src/core/db.mjs';
import { hashFile, fingerprintFile, zipEntries, isDataless, SF_DATALESS, ZIP_PREFIX } from '../../src/core/contentHash.mjs';
import JSZip from 'jszip';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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
    for (const [id, h] of [[1, 'zip1:a'], [2, 'zip1:a'], [3, 'zip1:b'], [4, 'zip1:a']]) setContentHash(db, id, h);
    expect(idsNeedingHash(db)).toEqual([]);
    // live records sharing a fingerprint, grouped; the trashed copy is not listed
    expect(listModels(db, { filter: 'duplicates' }).map((m) => m.id).sort()).toEqual([1, 2]);
    expect(sidebarCounts(db)).toMatchObject({ duplicates: 2, hashPending: 0 });
    // a fingerprint that only a trashed record and one live record share is not a duplicate group
    setContentHash(db, 2, 'zip1:c');
    expect(listModels(db, { filter: 'duplicates' })).toEqual([]);
    expect(modelsWithHash(db, 'zip1:a').map((m) => [m.id, m.trashed])).toEqual([[1, false], [4, true]]); // live first
    // M36: a 3MF with an M33 whole-file fingerprint is fingerprinted again; other formats keep theirs
    setContentHash(db, 3, 'f'.repeat(64));
    db.exec(`INSERT INTO models (id, name, rel_path, format, size_bytes, imported_at, updated_at, content_hash) VALUES (5, 's', '2026/s.stl', 'stl', 1, 'x', 'x', '${'e'.repeat(64)}')`);
    expect(idsNeedingHash(db)).toEqual([3]);
    expect(sidebarCounts(db)).toMatchObject({ hashPending: 1 });
    db.close();
  });
});

describe('M36: 3MF fingerprint = ZIP contents, not packing time', () => {
  // the same entries packed at another time / with other compression / without folder entries
  const pack = async (dir, name, { date = new Date(Date.UTC(2026, 8, 29, 13, 47)), compression = 'DEFLATE', folders = true, tweak = null } = {}) => {
    const z = await JSZip.loadAsync(await fs.readFile(path.join(FIXTURES, 'painted.3mf')));
    const out = new JSZip();
    for (const [n, f] of Object.entries(z.files)) {
      if (f.dir) continue;
      let data = await f.async('nodebuffer');
      if (tweak === n) data = Buffer.concat([data, Buffer.from(' ')]);
      out.file(n, data, { date, createFolders: folders });
    }
    const file = path.join(dir, name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, await out.generateAsync({ type: 'nodebuffer', compression }));
    return file;
  };

  it('same contents packed at another time, compressed differently or without folder entries: same fingerprint; whole-file SHA-256 differs', async () => {
    const dir = await tmpDir();
    const a = await pack(dir, 'a.3mf');
    const b = await pack(dir, 'b.3mf', { date: new Date(Date.UTC(2026, 9, 6, 15, 0)) });
    const c = await pack(dir, 'c.3mf', { compression: 'STORE', folders: false });
    expect(await hashFile(a)).not.toBe(await hashFile(b));
    const fa = await fingerprintFile(a);
    expect(fa.startsWith(ZIP_PREFIX)).toBe(true);
    expect([await fingerprintFile(b), await fingerprintFile(c)]).toEqual([fa, fa]);
  });

  it('one changed byte inside any entry: another fingerprint', async () => {
    const dir = await tmpDir();
    expect(await fingerprintFile(await pack(dir, 'a.3mf'))).not.toBe(await fingerprintFile(await pack(dir, 'b.3mf', { tweak: 'Metadata/project_settings.config' })));
  });

  it('not a ZIP, or a broken one: the SHA-256 of the bytes, as before', async () => {
    const stl = path.join(FIXTURES, 'cube.stl');
    expect(await fingerprintFile(stl)).toBe(await sha(stl));
    const broken = path.join(await tmpDir(), 'broken.3mf');
    await fs.writeFile(broken, Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), Buffer.alloc(64, 7)]));
    expect(await fingerprintFile(broken)).toBe(await sha(broken));
  });

  it('reads only the central directory: entry names, CRC-32 and sizes', async () => {
    const entries = await zipEntries(path.join(FIXTURES, 'painted.3mf'));
    const z = await JSZip.loadAsync(await fs.readFile(path.join(FIXTURES, 'painted.3mf')));
    expect(entries.map((e) => e.name.toString()).sort()).toEqual(Object.keys(z.files).sort());
    const model = entries.find((e) => e.name.toString() === '3D/Objects/object_1.model');
    expect(model.size).toBe((await z.file('3D/Objects/object_1.model').async('nodebuffer')).length);
  });

  it.skipIf(!existsSync('/usr/bin/zip'))('ZIP64 archives (zip -fz) give the same fingerprint as the plain ZIP', async () => {
    const dir = await tmpDir();
    const plain = await pack(dir, 'plain.3mf', { folders: false });
    const unpacked = path.join(dir, 'x');
    await fs.mkdir(unpacked);
    const z = await JSZip.loadAsync(await fs.readFile(plain));
    for (const [n, f] of Object.entries(z.files)) {
      await fs.mkdir(path.join(unpacked, path.dirname(n)), { recursive: true });
      await fs.writeFile(path.join(unpacked, n), await f.async('nodebuffer'));
    }
    const z64 = path.join(dir, 'z64.3mf');
    execFileSync('/usr/bin/zip', ['-q', '-r', '-D', '-fz', z64, ...Object.keys(z.files)], { cwd: unpacked });
    expect(await fingerprintFile(z64)).toBe(await fingerprintFile(plain));
  });

  it('import: a 3MF packed again at another time is skipped as a duplicate', async () => {
    const base = await tmpDir();
    const root = path.join(base, 'lib');
    const db = openDb(':memory:');
    const first = await importPaths(db, root, [await pack(path.join(base, 'a'), 'Fast NO FUZZY-U1.3mf')], NOW);
    const again = await pack(path.join(base, 'b'), 'Fast NO FUZZY-U1.3mf', { date: new Date(Date.UTC(2026, 9, 6, 15, 0)) });
    const r = await importPaths(db, root, [again], NOW);
    expect(r.ids).toEqual([]);
    expect(r.duplicates[0]).toMatchObject({ id: first.ids[0], relPath: '2026/Fast NO FUZZY-U1.3mf' });
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
