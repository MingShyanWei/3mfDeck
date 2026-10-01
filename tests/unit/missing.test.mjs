// M7: missing records (遺失) after switching the library root, as the user hit it:
// files imported under the default root, then the root moved to another folder.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openDb, getModel, listModels, setTags, updateModel } from '../../src/core/db.mjs';
import { importPaths, indexNewFiles } from '../../src/core/importer.mjs';
import { switchRoot, loadSettings } from '../../src/core/settings.mjs';
import { missingIds, newlyMissing, consistencyReport, relocateModel, removeRecord, findInTrash, restoreMissingFromTrash, isInside } from '../../src/core/missing.mjs';
import { FIXTURES, tmpDir, stage, exists } from './helpers.mjs';

const NOW = new Date(2026, 9, 1);
let base, rootA, rootB, userData, db, ids;

beforeEach(async () => {
  base = await tmpDir();
  rootA = path.join(base, '3mf-library'); // default root
  rootB = path.join(base, 'iCloud', '3mf'); // new root
  userData = path.join(base, 'userData');
});

// importPaths moves files, so stage copies first
async function importInto(root, files) {
  const inbox = path.join(base, 'inbox');
  const staged = [];
  for (const f of files) staged.push(await stage(inbox, f));
  return (await importPaths(db, root, staged, NOW)).ids;
}

describe('switching root makes old records missing', () => {
  beforeEach(async () => {
    db = openDb(':memory:');
    ids = await importInto(rootA, ['cube.stl', 'painted.3mf', 'box.obj']);
    setTags(db, ids[0], ['keep']);
    updateModel(db, ids[0], { provenance_type: 'self_made' });
    await stage(path.join(rootB, '2025'), 'box.amf'); // the new root already has a file
    await switchRoot(db, userData, rootB);
  });

  it('missingIds lists the old-root records', () => {
    expect(missingIds(db, rootB)).toEqual(ids);
  });

  it('notifies newly missing records once, not on every launch', async () => {
    const first = await consistencyReport(db, rootB, userData);
    expect([first.missing, first.newlyMissing]).toEqual([3, 3]);
    expect(loadSettings(userData, rootB).notifiedMissing).toEqual(ids);
    const second = await consistencyReport(db, rootB, userData); // next launch
    expect([second.missing, second.newlyMissing]).toEqual([3, 0]);
    // a record that goes missing later is reported again, alone
    const [extra] = await importInto(rootB, ['pyramid_ascii.stl']);
    await fs.unlink(path.join(rootB, getModel(db, extra).rel_path));
    const third = await consistencyReport(db, rootB, userData);
    expect([third.missing, third.newlyMissing]).toEqual([4, 1]);
    // a record that came back and goes missing again counts as new again
    expect(newlyMissing([1, 2, 3], [2, 3, 4])).toEqual([4]);
  });

  it('switchRoot keeps the notified list (settings are merged, not overwritten)', async () => {
    await consistencyReport(db, rootB, userData);
    await switchRoot(db, userData, rootB);
    expect(loadSettings(userData, '/x')).toEqual({ libraryRoot: rootB, notifiedMissing: ids });
  });

  it('relocate to a file inside the new root: uses it in place, keeps user metadata, refreshes file data', async () => {
    // the user copied the old file into the new root under another name
    await fs.mkdir(path.join(rootB, 'old'), { recursive: true });
    await fs.copyFile(path.join(rootA, '2026', 'cube.stl'), path.join(rootB, 'old', 'cube copy.stl'));
    const rel = await relocateModel(db, rootB, ids[0], path.join(rootB, 'old', 'cube copy.stl'), NOW);
    expect(rel).toBe(path.join('old', 'cube copy.stl'));
    const m = getModel(db, ids[0]);
    expect([m.rel_path, m.name, m.provenance_type, m.tags, m.tri_count, m.has_thumb]).toEqual([rel, 'cube', 'self_made', ['keep'], 12, false]);
    expect(missingIds(db, rootB)).toEqual(ids.slice(1));
    expect(await exists(path.join(rootB, 'old', 'cube copy.stl'))).toBe(true); // not moved
  });

  it('relocate to a different file re-reads its geometry/colours', async () => {
    await stage(path.join(rootB, 'x'), 'offpalette.3mf');
    await relocateModel(db, rootB, ids[1], path.join(rootB, 'x', 'offpalette.3mf'), NOW);
    const m = getModel(db, ids[1]);
    expect(m.colors.map((c) => c.color)).toEqual(['#1E90FF', '#E0457B', '#FFD700', '#333333']);
    expect(m.platform).toBe('MakerWorld'); // user metadata kept (it came from the original import)
  });

  it('relocate to a file outside the root moves it in like an import (no overwrite)', async () => {
    const outside = await stage(path.join(base, 'Downloads'), 'box.obj');
    const rel = await relocateModel(db, rootB, ids[2], outside, NOW);
    expect(rel).toBe(path.join('2026', 'box.obj'));
    expect(await exists(outside)).toBe(false);
    expect(await exists(path.join(rootB, rel))).toBe(true);
    expect(isInside(rootB, path.join(rootB, rel))).toBe(true);
    expect(isInside(rootB, outside)).toBe(false);
  });

  it('relocate refuses unsupported files and files another record already uses', async () => {
    await fs.writeFile(path.join(rootB, 'notes.txt'), 'x');
    await expect(relocateModel(db, rootB, ids[0], path.join(rootB, 'notes.txt'))).rejects.toThrow(/不支援的格式/);
    await expect(relocateModel(db, rootB, ids[0], path.join(rootB, '2025', 'box.amf'))).rejects.toThrow(/已經在櫃中/);
    expect(getModel(db, ids[0]).rel_path).toBe(path.join('2026', 'cube.stl'));
  });

  it('remove record deletes only the index entry; the file elsewhere stays', async () => {
    removeRecord(db, ids[0]);
    expect(getModel(db, ids[0])).toBeNull();
    expect(await exists(path.join(rootA, '2026', 'cube.stl'))).toBe(true);
    expect(missingIds(db, rootB)).toEqual(ids.slice(1));
  });

  it('restore when the file is in .trash (.trash/<n>/<rel> or .trash/<rel>)', async () => {
    await stage(path.join(rootB, '.trash', '42', '2026'), 'painted.3mf');
    expect(await findInTrash(rootB, path.join('2026', 'painted.3mf'))).toBe(path.join('.trash', '42', '2026', 'painted.3mf'));
    expect(await restoreMissingFromTrash(db, rootB, ids[1])).toBe(path.join('2026', 'painted.3mf'));
    expect(await exists(path.join(rootB, '2026', 'painted.3mf'))).toBe(true);
    expect(missingIds(db, rootB)).toEqual([ids[0], ids[2]]);

    await stage(path.join(rootB, '.trash', '2026'), 'box.obj');
    expect(await findInTrash(rootB, path.join('2026', 'box.obj'))).toBe(path.join('.trash', '2026', 'box.obj'));
    expect(await findInTrash(rootB, path.join('2026', 'cube.stl'))).toBeNull();
    await expect(restoreMissingFromTrash(db, rootB, ids[0])).rejects.toThrow(/回收桶裡找不到/);
  });
});

describe('files on disk but not in the index (startup rebuild prompt)', () => {
  it('a file added to the root while the app was closed is reported and indexed by a rebuild', async () => {
    db = openDb(':memory:');
    const root = path.join(base, 'lib');
    await importInto(root, ['cube.stl']);
    await stage(path.join(root, '2026'), 'box.obj'); // dropped in via Finder
    const r = await consistencyReport(db, root, userData);
    expect(r.untracked).toEqual([path.join('2026', 'box.obj')]);
    expect(await indexNewFiles(db, root)).toHaveLength(1);
    expect((await consistencyReport(db, root, userData)).untracked).toEqual([]);
    expect(listModels(db).map((m) => m.name).sort()).toEqual(['box', 'cube']);
  });
});
