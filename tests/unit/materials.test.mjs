// SPEC 3.4: basematerials / colorgroup material colours merged with paint_color.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse3mf } from '../../src/core/parse/threemf.mjs';
import { openDb, getModel, listModels } from '../../src/core/db.mjs';
import { importPaths } from '../../src/core/importer.mjs';
import { mapToSlots } from '../../src/core/filament.mjs';
import { FIXTURES, tmpDir, stage } from './helpers.mjs';

const read = (f) => fs.readFile(path.join(FIXTURES, f));

describe('material colours (basematerials + colorgroup)', () => {
  it('object default pindex, per-triangle pid/p1, p1 without pid, colorgroup alpha stripped', async () => {
    const r = await parse3mf(await read('materials.3mf'));
    expect(r.color_count).toBe(4);
    expect(r.colorStats).toEqual([
      { color: '#FF8800', faces: 4, pct: 33.33 },
      { color: '#3355DD', faces: 3, pct: 25 }, // ties ordered by colour
      { color: '#FFFFFF', faces: 3, pct: 25 }, // "#ffffffff" normalised
      { color: '#22AA44', faces: 2, pct: 16.67 },
    ]);
  });

  it('preview geometry carries material colours per face', async () => {
    const { geometry: g } = await parse3mf(await read('materials.3mf'), { geometry: true });
    expect(g.palette).toEqual(['#FF8800', '#FFFFFF', '#22AA44', '#3355DD']);
    expect([...g.faceColor]).toEqual([1, 1, 1, 1, 2, 2, 3, 3, 4, 4, 4, 2]);
  });

  it('paint_color wins per face; unpainted faces use the material colour, not the default extruder', async () => {
    const r = await parse3mf(await read('mixed.3mf'), { geometry: true });
    expect(r.colorStats).toEqual([
      { color: '#00FFFF', faces: 6, pct: 50 },
      { color: '#FF8800', faces: 4, pct: 33.33 },
      { color: '#FF00FF', faces: 2, pct: 16.67 },
    ]);
    expect(r.colorStats.map((c) => c.color)).not.toContain('#000000'); // part extruder 4
    expect(r.geometry.palette).toEqual(['#00FFFF', '#FF00FF', '#FF8800']);
    expect([...r.geometry.faceColor]).toEqual([1, 1, 1, 1, 1, 1, 2, 2, 3, 3, 3, 3]);
  });

  it('files without paint_color, materials or slicer config have no colour data', async () => {
    const r = await parse3mf(await read('plain.3mf'));
    expect([r.color_count, r.colorStats]).toEqual([null, null]);
  });

  it('feeds filament mapping and the colour badge (color_count) on import', async () => {
    const base = await tmpDir();
    const db = openDb(':memory:');
    const { ids } = await importPaths(db, path.join(base, 'lib'), [await stage(path.join(base, 'in'), 'materials.3mf')]);
    const m = getModel(db, ids[0]);
    expect(listModels(db)[0].color_count).toBe(4);
    expect(m.colors.map((c) => c.color)).toEqual(['#FF8800', '#3355DD', '#FFFFFF', '#22AA44']);
    const { used } = mapToSlots(m.colors);
    expect(used.length).toBeGreaterThan(0);
    expect(used.reduce((s, u) => s + u.faces, 0)).toBe(12);
  });
});

const MESHY = path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/3mf/Meshy_AI_Playful_Gym_Moment_0930123819_generate.3mf');
describe.skipIf(!existsSync(MESHY))('real Meshy export (object-level basematerials)', () => {
  it('reads two material colours instead of nothing', async () => {
    const r = await parse3mf(await fs.readFile(MESHY));
    expect(r.tri_count).toBe(869634);
    expect(r.colorStats.map((c) => c.color)).toEqual(['#FFFFFF', '#CCCCCC']);
    expect(r.colorStats.reduce((s, c) => s + c.faces, 0)).toBe(869634);
  });
});
