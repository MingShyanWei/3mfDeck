import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { moveIntoLibrary, collectImportFiles, listLibraryFiles } from '../../src/core/library.mjs';
import { tmpDir, stage, exists } from './helpers.mjs';

const NOW = new Date(2026, 9, 1);

describe('moveIntoLibrary', () => {
  let root, inbox;
  beforeEach(async () => {
    const base = await tmpDir();
    root = path.join(base, 'library');
    inbox = path.join(base, 'inbox');
  });

  it('moves the file into <root>/<YYYY>/<name> and removes the source', async () => {
    const src = await stage(inbox, 'cube.stl');
    const rel = await moveIntoLibrary(src, root, NOW);
    expect(rel).toBe(path.join('2026', 'cube.stl'));
    expect(await exists(src)).toBe(false);
    expect(await fs.readFile(path.join(root, rel))).toEqual(await fs.readFile(path.join(import.meta.dirname, '..', 'fixtures', 'cube.stl')));
  });

  it('adds -2, -3 suffixes on name clashes and never overwrites', async () => {
    const a = await stage(path.join(inbox, 'a'), 'cube.stl', 'model.stl');
    const b = await stage(path.join(inbox, 'b'), 'box.obj', 'model.stl'); // different content, same name
    const c = await stage(path.join(inbox, 'c'), 'pyramid_ascii.stl', 'model.stl');
    const relA = await moveIntoLibrary(a, root, NOW);
    const relB = await moveIntoLibrary(b, root, NOW);
    const relC = await moveIntoLibrary(c, root, NOW);
    expect([relA, relB, relC]).toEqual([path.join('2026', 'model.stl'), path.join('2026', 'model-2.stl'), path.join('2026', 'model-3.stl')]);
    // Original first file untouched
    const fx = (f) => fs.readFile(path.join(import.meta.dirname, '..', 'fixtures', f));
    expect(await fs.readFile(path.join(root, relA))).toEqual(await fx('cube.stl'));
    expect(await fs.readFile(path.join(root, relB))).toEqual(await fx('box.obj'));
    expect(await fs.readFile(path.join(root, relC))).toEqual(await fx('pyramid_ascii.stl'));
  });

  it('keeps the extension and handles names with dots and no extension clash across years', async () => {
    const a = await stage(inbox, 'painted.3mf', 'my.model.v2.3mf');
    expect(await moveIntoLibrary(a, root, NOW)).toBe(path.join('2026', 'my.model.v2.3mf'));
    const b = await stage(inbox, 'painted.3mf', 'my.model.v2.3mf');
    expect(await moveIntoLibrary(b, root, NOW)).toBe(path.join('2026', 'my.model.v2-2.3mf'));
    const c = await stage(inbox, 'painted.3mf', 'my.model.v2.3mf');
    expect(await moveIntoLibrary(c, root, new Date(2027, 0, 1))).toBe(path.join('2027', 'my.model.v2.3mf'));
  });
});

describe('collectImportFiles / listLibraryFiles', () => {
  it('walks folders, keeps supported extensions (case-insensitive), skips hidden and unsupported', async () => {
    const dir = await tmpDir();
    await stage(path.join(dir, 'drop'), 'cube.stl', 'A.STL');
    await stage(path.join(dir, 'drop', 'sub'), 'box.obj');
    await stage(path.join(dir, 'drop', 'sub'), 'fixture.step', 'part.stp');
    await stage(path.join(dir, 'drop', '.hidden'), 'cube.stl');
    await fs.writeFile(path.join(dir, 'drop', 'readme.txt'), 'x');
    const { files, skipped } = await collectImportFiles([path.join(dir, 'drop')]);
    expect(files.map((f) => path.relative(dir, f))).toEqual([
      path.join('drop', 'A.STL'),
      path.join('drop', 'sub', 'box.obj'),
      path.join('drop', 'sub', 'part.stp'),
    ]);
    expect(skipped.map((f) => path.basename(f))).toEqual(['readme.txt']);
  });

  it('lists library files excluding .trash', async () => {
    const root = await tmpDir();
    await stage(path.join(root, '2026'), 'cube.stl');
    await stage(path.join(root, '.trash'), 'box.obj');
    expect(await listLibraryFiles(root)).toEqual([path.join('2026', 'cube.stl')]);
  });
});
