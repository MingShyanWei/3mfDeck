// SPEC 3.7 (trash, export) and §4 consistency check / index rebuild.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openDb, getModel, listModels, setTags, updateModel, sidebarCounts } from '../../src/core/db.mjs';
import { importPaths, indexNewFiles } from '../../src/core/importer.mjs';
import { trashModel, restoreModel, emptyTrash, exportModel, checkConsistency, isTrashed } from '../../src/core/trash.mjs';
import { FIXTURES, tmpDir, stage, exists } from './helpers.mjs';

const NOW = new Date(2026, 9, 1);
let base, root, db, ids;
const fixture = (f) => fs.readFile(path.join(FIXTURES, f));

beforeEach(async () => {
  base = await tmpDir();
  root = path.join(base, 'lib');
  db = openDb(':memory:');
  ({ ids } = await importPaths(db, root, [await stage(path.join(base, 'in'), 'cube.stl'), await stage(path.join(base, 'in'), 'painted.3mf')], NOW));
  setTags(db, ids[0], ['keep-me']);
  updateModel(db, ids[0], { provenance_type: 'self_made', notes: 'n1' });
});

describe('trash', () => {
  it('moves the file to .trash/<id>/<original path>, keeps the row out of the library views', async () => {
    const rel = await trashModel(db, root, ids[0]);
    expect(rel).toBe(`.trash/${ids[0]}/2026/cube.stl`);
    expect(isTrashed(rel)).toBe(true);
    expect(await exists(path.join(root, '2026', 'cube.stl'))).toBe(false);
    expect(await fs.readFile(path.join(root, rel))).toEqual(await fixture('cube.stl'));
    expect(listModels(db).map((m) => m.name)).toEqual(['painted']);
    expect(listModels(db, { filter: 'trash' }).map((m) => m.name)).toEqual(['cube']);
    expect(listModels(db, { filter: 'tag:keep-me' })).toEqual([]);
    expect(sidebarCounts(db)).toMatchObject({ all: 1, trash: 1, tags: [] });
  });

  it('restores to the original path with metadata intact and prunes the empty trash folder', async () => {
    await trashModel(db, root, ids[0]);
    expect(await restoreModel(db, root, ids[0])).toBe('2026/cube.stl');
    const m = getModel(db, ids[0]);
    expect([m.rel_path, m.provenance_type, m.notes, m.tags]).toEqual(['2026/cube.stl', 'self_made', 'n1', ['keep-me']]);
    expect(await fs.readFile(path.join(root, '2026', 'cube.stl'))).toEqual(await fixture('cube.stl'));
    expect(await exists(path.join(root, '.trash', String(ids[0])))).toBe(false);
    expect(sidebarCounts(db)).toMatchObject({ all: 2, trash: 0 });
  });

  it('never overwrites on restore: an occupied original path gets -2', async () => {
    await trashModel(db, root, ids[0]);
    await fs.writeFile(path.join(root, '2026', 'cube.stl'), 'newer file'); // something took its place
    expect(await restoreModel(db, root, ids[0])).toBe('2026/cube-2.stl');
    expect(await fs.readFile(path.join(root, '2026', 'cube.stl'), 'utf8')).toBe('newer file');
    expect(await fs.readFile(path.join(root, '2026', 'cube-2.stl'))).toEqual(await fixture('cube.stl'));
  });

  it('trashing is idempotent; restoring a live model is an error', async () => {
    const rel = await trashModel(db, root, ids[0]);
    expect(await trashModel(db, root, ids[0])).toBe(rel);
    await expect(restoreModel(db, root, ids[1])).rejects.toThrow(/not in the trash/);
  });

  it('a file dropped straight into .trash restores into the current year folder', async () => {
    await stage(path.join(root, '.trash'), 'box.obj');
    const [id] = await indexNewFiles(db, root);
    expect(await restoreModel(db, root, id, NOW)).toBe('2026/box.obj');
  });

  it('emptyTrash deletes trashed files and rows only', async () => {
    await trashModel(db, root, ids[0]);
    expect(await emptyTrash(db, root)).toBe(1);
    expect(getModel(db, ids[0])).toBeNull();
    expect(await exists(path.join(root, '.trash'))).toBe(false);
    expect(listModels(db).map((m) => m.name)).toEqual(['painted']);
    expect(await exists(path.join(root, '2026', 'painted.3mf'))).toBe(true);
    expect(sidebarCounts(db).tags).toEqual([]); // orphan tag dropped
    expect(await emptyTrash(db, root)).toBe(0); // nothing left, no error
  });
});

describe('exportModel', () => {
  it('copies (never moves) into the chosen folder, suffixing on clashes', async () => {
    const out = path.join(base, 'export');
    expect(await exportModel(db, root, ids[1], out)).toBe(path.join(out, 'painted.3mf'));
    expect(await exportModel(db, root, ids[1], out)).toBe(path.join(out, 'painted-2.3mf'));
    expect(await exists(path.join(root, '2026', 'painted.3mf'))).toBe(true); // source untouched
    expect(await fs.readFile(path.join(out, 'painted-2.3mf'))).toEqual(await fixture('painted.3mf'));
  });
});

describe('consistency check and index rebuild', () => {
  it('a consistent library reports nothing', async () => {
    expect(await checkConsistency(db, root)).toEqual({ untracked: [], missing: 0 });
  });

  it('DB lost: every file (incl. trash) is untracked, and a rebuild restores the index', async () => {
    await trashModel(db, root, ids[0]);
    const fresh = openDb(':memory:'); // "pull the DB"
    const check = await checkConsistency(fresh, root);
    expect(check).toEqual({ untracked: ['2026/painted.3mf', `.trash/${ids[0]}/2026/cube.stl`], missing: 0 });
    expect(await indexNewFiles(fresh, root)).toHaveLength(2);
    expect(await checkConsistency(fresh, root)).toEqual({ untracked: [], missing: 0 });
    const painted = listModels(fresh)[0];
    expect([painted.name, painted.color_count, painted.platform]).toEqual(['painted', 4, 'MakerWorld']);
    // the trashed file is still restorable after the rebuild
    const [cube] = listModels(fresh, { filter: 'trash' });
    expect(await restoreModel(fresh, root, cube.id)).toBe('2026/cube.stl');
  });

  it('files deleted behind the app’s back are reported missing', async () => {
    await fs.unlink(path.join(root, '2026', 'cube.stl'));
    expect(await checkConsistency(db, root)).toEqual({ untracked: [], missing: 1 });
  });
});
