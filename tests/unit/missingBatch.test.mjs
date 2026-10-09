// Batch handling of missing records (遺失): remove several at once, and
// recover by file name after the library root moved.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openDb, getModel, setTags } from '../../src/core/db.mjs';
import { importPaths } from '../../src/core/importer.mjs';
import { switchRoot } from '../../src/core/settings.mjs';
import { missingIds, removeMissingRecords, findByFilename, applyRelocations } from '../../src/core/missing.mjs';
import { tmpDir, stage, exists } from './helpers.mjs';

const NOW = new Date(2026, 9, 1);
let base, rootA, rootB, db, ids;
const byName = (rows) => Object.fromEntries(rows.map((r) => [r.name, r]));

beforeEach(async () => {
  base = await tmpDir();
  rootA = path.join(base, '3mf-library');
  rootB = path.join(base, 'iCloud');
  db = openDb(':memory:');
  const inbox = path.join(base, 'inbox');
  const files = [
    await stage(inbox, 'cube.stl'),
    await stage(inbox, 'painted.3mf'),
    await stage(inbox, 'box.obj'),
    await stage(inbox, 'materials.3mf'),
    await stage(path.join(inbox, 'b'), 'pyramid_ascii.stl', 'Pyramid.STL'),
  ];
  ids = (await importPaths(db, rootA, files, NOW)).ids; // cube, painted, box, materials, Pyramid
  setTags(db, ids[1], ['keep']);
  await switchRoot(db, path.join(base, 'userData'), rootB);
});

describe('findByFilename', () => {
  it('classifies each missing record: unique match (any depth), ambiguous, none', async () => {
    await stage(path.join(rootB, 'old', 'deep', 'er'), 'painted.3mf'); // unique, nested
    await stage(path.join(rootB, 'a'), 'box.obj'); // two candidates -> ambiguous
    await stage(path.join(rootB, 'b'), 'box.obj');
    await stage(path.join(rootB, 'x'), 'pyramid_ascii.stl', 'pyramid.stl'); // case-insensitive name match
    const rows = byName(await findByFilename(db, rootB));
    expect(rows.painted).toMatchObject({ status: 'match', match: path.join('old', 'deep', 'er', 'painted.3mf'), sameSize: true });
    expect(rows.box).toMatchObject({ status: 'ambiguous', candidates: [path.join('a', 'box.obj'), path.join('b', 'box.obj')] });
    expect(rows.Pyramid).toMatchObject({ status: 'match', match: path.join('x', 'pyramid.stl') });
    expect(rows.cube.status).toBe('none');
    expect(rows.materials.status).toBe('none');
  });

  it('flags a different-size file with the same name', async () => {
    await stage(path.join(rootB, 'y'), 'box.obj', 'cube.stl'); // same name, other content
    expect(byName(await findByFilename(db, rootB)).cube).toMatchObject({ status: 'match', sameSize: false });
  });

  it('ignores files already used by a record and files in .trash', async () => {
    // (not 2026/materials.3mf: the same rel path would simply make the old record resolve again)
    await stage(path.join(rootB, 'new'), 'materials.3mf');
    await switchRoot(db, path.join(base, 'userData'), rootB); // indexes rootB/new/materials.3mf as a new record
    await stage(path.join(rootB, '.trash', '9'), 'cube.stl');
    const rows = await findByFilename(db, rootB);
    const row = (id) => rows.find((r) => r.id === id);
    expect(row(ids[3]).status).toBe('none'); // its only namesake belongs to another record
    expect(row(ids[0]).status).toBe('none'); // .trash is for 「從回收桶還原」
  });

  it('one file wanted by two missing records is ambiguous for both', async () => {
    // a second cube.stl with other bytes (binary STL header byte), so it is not skipped as a duplicate (M33)
    const other = await stage(path.join(base, 'in2'), 'cube.stl');
    const bytes = await fs.readFile(other);
    bytes[0] ^= 0xff;
    await fs.writeFile(other, bytes);
    const [second] = (await importPaths(db, rootA, [other], NOW)).ids; // rootA/2026/cube-2.stl
    await fs.rename(path.join(rootA, '2026', 'cube-2.stl'), path.join(rootA, '2026', 'tmp.stl'));
    db.prepare('UPDATE models SET rel_path = ? WHERE id = ?').run(path.join('2025', 'cube.stl'), second); // same file name, other folder
    await stage(path.join(rootB, 'z'), 'cube.stl');
    const rows = (await findByFilename(db, rootB)).filter((r) => r.relPath.endsWith('cube.stl'));
    expect(rows.map((r) => r.status)).toEqual(['ambiguous', 'ambiguous']);
  });
});

describe('applyRelocations', () => {
  it('relinks confirmed pairs in place, keeps metadata, reports failures per record', async () => {
    await stage(path.join(rootB, 'old'), 'painted.3mf');
    await stage(path.join(rootB, 'old'), 'box.obj');
    const r = await applyRelocations(db, rootB, [
      { id: ids[1], relPath: path.join('old', 'painted.3mf') },
      { id: ids[2], relPath: path.join('old', 'box.obj') },
      { id: ids[0], relPath: path.join('old', 'box.obj') }, // already taken by the previous pair
    ]);
    expect(r.done.map((d) => d.id)).toEqual([ids[1], ids[2]]);
    expect(r.errors).toEqual([{ id: ids[0], error: expect.stringMatching(/已經在櫃中/) }]);
    expect(getModel(db, ids[1])).toMatchObject({ rel_path: path.join('old', 'painted.3mf'), tags: ['keep'], color_count: 4 });
    expect(missingIds(db, rootB)).toEqual([ids[0], ids[3], ids[4]]);
    expect(await exists(path.join(rootB, 'old', 'box.obj'))).toBe(true); // used in place, not moved
  });
});

describe('removeMissingRecords', () => {
  it('removes only records that are missing; files stay where they are', async () => {
    await stage(path.join(rootB, '2026'), 'painted.3mf');
    await applyRelocations(db, rootB, [{ id: ids[1], relPath: path.join('2026', 'painted.3mf') }]); // ids[1] no longer missing
    const removed = removeMissingRecords(db, rootB, [ids[0], ids[1], ids[2], 9999]);
    expect(removed).toEqual([ids[0], ids[2]]);
    expect(getModel(db, ids[0])).toBeNull();
    expect(getModel(db, ids[1])).not.toBeNull(); // live record ignored
    expect(await exists(path.join(rootA, '2026', 'cube.stl'))).toBe(true);
    expect(await exists(path.join(rootA, '2026', 'box.obj'))).toBe(true);
    expect(missingIds(db, rootB)).toEqual([ids[3], ids[4]]);
  });
});
