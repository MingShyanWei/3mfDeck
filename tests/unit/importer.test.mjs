import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openDb, getModel, listModels } from '../../src/core/db.mjs';
import { importPaths, indexNewFiles } from '../../src/core/importer.mjs';
import { relocateModel, restoreMissingFromTrash } from '../../src/core/missing.mjs';
import { trashModel, restoreModel } from '../../src/core/trash.mjs';
import { tmpDir, stage, exists } from './helpers.mjs';

describe('importPaths', () => {
  it('moves, parses and indexes a mixed batch; same-name files get -2', async () => {
    const base = await tmpDir();
    const root = path.join(base, 'lib');
    const db = openDb(':memory:');
    const files = [
      await stage(path.join(base, 'in'), 'painted.3mf'),
      await stage(path.join(base, 'in'), 'cube.stl'),
      await stage(path.join(base, 'in'), 'box.obj'),
      await stage(path.join(base, 'in'), 'cube.glb'),
      await stage(path.join(base, 'in', 'other'), 'pyramid_ascii.stl', 'cube.stl'), // name clash
    ];
    await fs.writeFile(path.join(base, 'in', 'notes.txt'), 'skip me');
    const now = new Date(2026, 9, 1);
    const res = await importPaths(db, root, [path.join(base, 'in')], now);
    expect(res.errors).toEqual([]);
    expect(res.skipped.map((p) => path.basename(p))).toEqual(['notes.txt']);
    expect(res.ids).toHaveLength(5);
    for (const f of files) expect(await exists(f)).toBe(false);

    const rows = res.ids.map((id) => getModel(db, id));
    expect(rows.map((r) => [r.name, r.rel_path, r.format, r.tri_count])).toEqual([
      ['box', '2026/box.obj', 'obj', 12],
      ['cube', '2026/cube.glb', 'glb', 12],
      ['cube', '2026/cube.stl', 'stl', 12],
      ['cube', '2026/cube-2.stl', 'stl', 6], // in/other/ sorts before painted.3mf
      ['painted', '2026/painted.3mf', '3mf', 12],
    ]);
    for (const r of rows) expect(await exists(path.join(root, r.rel_path))).toBe(true);
  });

  it('indexNewFiles picks up files already in a (new) root; .trash files come back as trashed', async () => {
    const root = await tmpDir();
    await stage(path.join(root, '2025'), 'cube.stl');
    await stage(path.join(root, '.trash', '7', '2025'), 'box.obj');
    await stage(path.join(root, '.hidden'), 'box.amf'); // other dot dirs are ignored
    const db = openDb(':memory:');
    expect(await indexNewFiles(db, root)).toHaveLength(2);
    expect(await indexNewFiles(db, root)).toHaveLength(0);
    expect(listModels(db).map((m) => m.rel_path)).toEqual(['2025/cube.stl']);
    expect(listModels(db, { filter: 'trash' }).map((m) => m.rel_path)).toEqual(['.trash/7/2025/box.obj']);
  });

  it('a name whose file was deleted by hand (record now missing) is not reused: the new file gets -2, nothing is left unindexed', async () => {
    const base = await tmpDir();
    const root = path.join(base, 'lib');
    const db = openDb(':memory:');
    const now = new Date(2026, 9, 1);
    const first = await importPaths(db, root, [await stage(path.join(base, 'a'), 'cube.stl')], now);
    await fs.unlink(path.join(root, '2026/cube.stl')); // removed in Finder: the record stays, missing
    const other = await stage(path.join(base, 'b'), 'pyramid_ascii.stl', 'cube.stl'); // same name, other contents
    const r = await importPaths(db, root, [other], now);
    expect(r.errors).toEqual([]);
    expect(r.ids).toHaveLength(1);
    expect(getModel(db, r.ids[0]).rel_path).toBe('2026/cube-2.stl');
    expect(getModel(db, first.ids[0]).rel_path).toBe('2026/cube.stl'); // the missing record keeps its path
    expect(await indexNewFiles(db, root)).toEqual([]); // no orphan file in the library
  });
});

describe('paths held by missing records are not handed out again', () => {
  const now = new Date(2026, 9, 1);
  async function setup() {
    const base = await tmpDir();
    const root = path.join(base, 'lib');
    const db = openDb(':memory:');
    const ids = (await importPaths(db, root, [await stage(path.join(base, 'a'), 'cube.stl'), await stage(path.join(base, 'a'), 'box.obj')], now)).ids;
    return { base, root, db, ids };
  }

  it('relocating to a file outside the library does not take another missing record’s path', async () => {
    const { base, root, db, ids } = await setup();
    const [cube, box] = ids;
    await fs.unlink(path.join(root, '2026/cube.stl')); // both missing
    await fs.unlink(path.join(root, '2026/box.obj'));
    const outside = await stage(path.join(base, 'elsewhere'), 'pyramid_ascii.stl', 'cube.stl');
    expect(await relocateModel(db, root, box, outside, now)).toBe('2026/cube-2.stl'); // 2026/cube.stl belongs to the cube record
    expect(getModel(db, cube).rel_path).toBe('2026/cube.stl');
  });

  it('relocating a record to a same-named file keeps its own path', async () => {
    const { base, root, db, ids } = await setup();
    await fs.unlink(path.join(root, '2026/cube.stl'));
    const outside = await stage(path.join(base, 'elsewhere'), 'cube.stl');
    expect(await relocateModel(db, root, ids[0], outside, now)).toBe('2026/cube.stl');
  });

  it('restoring from the trash skips an original path a missing record holds', async () => {
    const { base, root, db, ids } = await setup();
    await trashModel(db, root, ids[0]); // cube -> .trash
    const again = (await importPaths(db, root, [await stage(path.join(base, 'b'), 'pyramid_ascii.stl', 'cube.stl')], now)).ids[0];
    expect(getModel(db, again).rel_path).toBe('2026/cube.stl');
    await fs.unlink(path.join(root, '2026/cube.stl')); // the newer one deleted by hand: missing, still holds the path
    expect(await restoreModel(db, root, ids[0], now)).toBe('2026/cube-2.stl');
    expect(await indexNewFiles(db, root)).toEqual([]);
  });

  it('a missing record’s own file restored from the trash goes back to its own path', async () => {
    const { root, db, ids } = await setup();
    await fs.mkdir(path.join(root, '.trash/9/2026'), { recursive: true });
    await fs.rename(path.join(root, '2026/cube.stl'), path.join(root, '.trash/9/2026/cube.stl'));
    expect(await restoreMissingFromTrash(db, root, ids[0])).toBe('2026/cube.stl');
  });
});
