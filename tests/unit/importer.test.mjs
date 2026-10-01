import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openDb, getModel, listModels } from '../../src/core/db.mjs';
import { importPaths, indexNewFiles } from '../../src/core/importer.mjs';
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
});
