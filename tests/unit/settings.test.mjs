import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openDb, listModels, getModel, updateModel, setTags } from '../../src/core/db.mjs';
import { importPaths } from '../../src/core/importer.mjs';
import { loadSettings, saveSettings, switchRoot, markMissing, modelPath, validateSpools } from '../../src/core/settings.mjs';
import { tmpDir, stage, exists } from './helpers.mjs';

describe('settings storage (SPEC 3.8)', () => {
  it('defaults to the given root when no config exists', async () => {
    const userData = await tmpDir();
    expect(loadSettings(userData, '/Users/x/3mf-library')).toEqual({ libraryRoot: '/Users/x/3mf-library',
      inventory: [], notifiedMissing: [], spools: ['#00FFFF', '#FF00FF', '#FFFF00', '#000000'] });
  });

  it('persists the root in userData/config.json', async () => {
    const userData = await tmpDir();
    saveSettings(userData, { libraryRoot: '/Volumes/ext/models' });
    expect(JSON.parse(await fs.readFile(path.join(userData, 'config.json'), 'utf8'))).toEqual({ libraryRoot: '/Volumes/ext/models' });
    expect(loadSettings(userData, '/default')).toMatchObject({ libraryRoot: '/Volumes/ext/models', notifiedMissing: [] });
  });

  it('saving merges: switching root keeps other settings (e.g. already-notified missing ids)', async () => {
    const userData = await tmpDir();
    saveSettings(userData, { libraryRoot: '/a', notifiedMissing: [3, 4] });
    saveSettings(userData, { libraryRoot: '/b' });
    expect(loadSettings(userData, '/default')).toMatchObject({ libraryRoot: '/b', notifiedMissing: [3, 4] });
  });
});

describe('switchRoot', () => {
  it('does not move files, indexes the new root and marks old records missing', async () => {
    const base = await tmpDir();
    const userData = path.join(base, 'userData');
    const rootA = path.join(base, 'A');
    const rootB = path.join(base, 'B');
    const db = openDb(':memory:');
    const now = new Date(2026, 9, 1);

    // Two models imported into root A, one with provenance + tags
    const { ids } = await importPaths(db, rootA, [await stage(path.join(base, 'in'), 'cube.stl'), await stage(path.join(base, 'in'), 'box.obj')], now);
    updateModel(db, ids[0], { provenance_type: 'self_made' });
    setTags(db, ids[0], ['keep']);
    // Root B already holds one file (e.g. an iCloud folder)
    await stage(path.join(rootB, '2025'), 'painted.3mf');

    const res = await switchRoot(db, userData, rootB);
    expect(res).toEqual({ libraryRoot: rootB, indexed: 1, missing: 2 });
    expect(loadSettings(userData, '/default').libraryRoot).toBe(rootB);
    expect(await exists(path.join(rootB, 'config.json'))).toBe(false); // config lives in userData only
    // Nothing moved
    expect(await exists(path.join(rootA, '2026', 'cube.stl'))).toBe(true);
    expect(await exists(path.join(rootA, '2026', 'box.obj'))).toBe(true);
    expect(await fs.readdir(rootB)).toEqual(['2025']);

    const view = (root) => Object.fromEntries(markMissing(listModels(db, { sort: 'name' }), root).map((m) => [m.rel_path, m.missing]));
    expect(view(rootB)).toEqual({ '2026/box.obj': true, '2026/cube.stl': true, '2025/painted.3mf': false });

    // The new root's file got parsed (incl. embedded provenance)
    const painted = listModels(db).find((m) => m.rel_path === '2025/painted.3mf');
    expect([painted.format, painted.color_count, painted.platform]).toEqual(['3mf', 4, 'MakerWorld']);

    // Switching back: old records are valid again, their metadata intact
    const back = await switchRoot(db, userData, rootA);
    expect(back).toEqual({ libraryRoot: rootA, indexed: 0, missing: 1 });
    expect(view(rootA)).toEqual({ '2026/box.obj': false, '2026/cube.stl': false, '2025/painted.3mf': true });
    const cube = getModel(db, ids[0]);
    expect([cube.provenance_type, cube.tags]).toEqual(['self_made', ['keep']]);
  });

  it('creates a new empty root folder', async () => {
    const base = await tmpDir();
    const res = await switchRoot(openDb(':memory:'), path.join(base, 'ud'), path.join(base, 'new', 'lib'));
    expect(res).toEqual({ libraryRoot: path.join(base, 'new', 'lib'), indexed: 0, missing: 0 });
    expect(await exists(path.join(base, 'new', 'lib'))).toBe(true);
  });
});

describe('modelPath (Finder reveal / preview)', () => {
  it('resolves a record against the current root', async () => {
    const base = await tmpDir();
    const db = openDb(':memory:');
    const { ids } = await importPaths(db, path.join(base, 'A'), [await stage(path.join(base, 'in'), 'cube.stl')], new Date(2026, 9, 1));
    expect(modelPath(db, path.join(base, 'A'), ids[0])).toBe(path.join(base, 'A', '2026', 'cube.stl'));
    expect(modelPath(db, '/Volumes/other', ids[0])).toBe(path.join('/Volumes/other', '2026', 'cube.stl'));
    expect(() => modelPath(db, base, 999)).toThrow(/no model 999/);
  });
});

describe('spool colours (SPEC 3.5b)', () => {
  it('default to ideal CMYK; saved custom colours survive other saves', async () => {
    const userData = await tmpDir();
    expect(loadSettings(userData, '/r').spools).toEqual(['#00FFFF', '#FF00FF', '#FFFF00', '#000000']);
    saveSettings(userData, { spools: ['#0A9ED8', '#000000'] });
    saveSettings(userData, { libraryRoot: '/r2' });
    expect(loadSettings(userData, '/r').spools).toEqual(['#0A9ED8', '#000000']);
  });

  it('validateSpools: 1-4 colours, #RRGGBB, normalized to upper case', () => {
    expect(validateSpools(['#0a9ed8'])).toEqual(['#0A9ED8']);
    expect(() => validateSpools([])).toThrow(/1–4/);
    expect(() => validateSpools(['#000000', '#111111', '#222222', '#333333', '#444444'])).toThrow(/1–4/);
    expect(() => validateSpools(['red'])).toThrow(/#RRGGBB/);
    expect(() => validateSpools(['#12345'])).toThrow(/#RRGGBB/);
  });
});
