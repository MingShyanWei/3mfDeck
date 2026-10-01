// SPEC 3.6: multi-plate 3MF (one file = one library entry).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse3mf } from '../../src/core/parse/threemf.mjs';
import { openDb, insertModel, getModel, listModels, deleteModels } from '../../src/core/db.mjs';
import { parseFile } from '../../src/core/parse/index.mjs';
import { loadPreviewData, previewPlate } from '../../src/core/preview.mjs';
import { FIXTURES } from './helpers.mjs';

const fixture = (f) => fs.readFile(path.join(FIXTURES, f));

describe('parse3mf plates (multiplate.3mf)', () => {
  it('plate list = model_settings plates ∪ plate_N.json, sorted, with names', async () => {
    const r = await parse3mf(await fixture('multiplate.3mf'));
    expect(r.plates.map((p) => [p.plate, p.name, p.tri_count])).toEqual([
      [1, 'Cyan plate', 12],
      [2, 'Mixed', 24],
      [3, '', 12], // no plate_3.json, known from model_settings
      [4, '', 0], // only plate_4.json: empty plate
    ]);
  });

  it('per-plate colour stats; instance_id maps the 2nd build item of an object to its own plate', async () => {
    const r = await parse3mf(await fixture('multiplate.3mf'));
    const stats = Object.fromEntries(r.plates.map((p) => [p.plate, p.colorStats]));
    expect(stats[1]).toEqual([{ color: '#00FFFF', faces: 12, pct: 100 }]);
    expect(stats[2]).toEqual([
      { color: '#FF00FF', faces: 12, pct: 50 },
      { color: '#FFFF00', faces: 12, pct: 50 },
    ]);
    expect(stats[3]).toEqual([{ color: '#FFFF00', faces: 12, pct: 100 }]);
    expect(stats[4]).toBeNull();
  });

  it('whole-file totals still cover every plate (colour badge = file total)', async () => {
    const r = await parse3mf(await fixture('multiplate.3mf'));
    expect(r.tri_count).toBe(48);
    expect(r.color_count).toBe(3);
    expect(r.colorStats).toEqual([
      { color: '#FFFF00', faces: 24, pct: 50 },
      { color: '#00FFFF', faces: 12, pct: 25 },
      { color: '#FF00FF', faces: 12, pct: 25 },
    ]);
  });

  it('geometry can be limited to one plate (only its objects, only its colours)', async () => {
    const buf = await fixture('multiplate.3mf');
    const xRange = (g) => {
      const xs = [...g.positions].filter((_, i) => i % 3 === 0);
      return [Math.min(...xs), Math.max(...xs)];
    };
    const p2 = (await parse3mf(buf, { geometry: true, plate: 2 })).geometry;
    expect(p2.faceColor.length).toBe(24);
    expect(xRange(p2)).toEqual([400, 440]);
    expect(p2.palette.sort()).toEqual(['#FF00FF', '#FFFF00']);
    const p3 = (await parse3mf(buf, { geometry: true, plate: 3 })).geometry;
    expect(xRange(p3)).toEqual([700, 710]);
    expect(p3.palette).toEqual(['#FFFF00']);
    expect((await parse3mf(buf, { geometry: true, plate: 4 })).geometry.faceColor.length).toBe(0);
    expect((await parse3mf(buf, { geometry: true })).geometry.faceColor.length).toBe(48);
  });

  it('files without plate info have plates = null', async () => {
    expect((await parse3mf(await fixture('painted.3mf'))).plates).toBeNull();
    expect((await parse3mf(await fixture('materials.3mf'))).plates).toBeNull();
  });
});

describe('plates in the DB', () => {
  it('stores plates + per-plate colours, lists plate_count, cascades on delete', async () => {
    const db = openDb(':memory:');
    const id = insertModel(db, { name: 'mp', relPath: '2026/multiplate.3mf', parsed: await parseFile(path.join(FIXTURES, 'multiplate.3mf')) });
    const single = insertModel(db, { name: 'p', relPath: '2026/painted.3mf', parsed: await parseFile(path.join(FIXTURES, 'painted.3mf')) });
    expect(listModels(db, { sort: 'name' }).map((m) => [m.name, m.plate_count, m.color_count])).toEqual([
      ['mp', 4, 3],
      ['p', 0, 4],
    ]);
    const m = getModel(db, id);
    expect(m.plates.map((p) => [p.plate, p.name, p.tri_count, p.colors.map((c) => c.color)])).toEqual([
      [1, 'Cyan plate', 12, ['#00FFFF']],
      [2, 'Mixed', 24, ['#FF00FF', '#FFFF00']],
      [3, '', 12, ['#FFFF00']],
      [4, '', 0, []],
    ]);
    expect(getModel(db, single).plates).toEqual([]);
    deleteModels(db, [id]);
    expect(db.prepare('SELECT COUNT(*) FROM plates').pluck().get()).toBe(0);
    expect(db.prepare('SELECT COUNT(*) FROM plate_color_stats').pluck().get()).toBe(0);
  });
});

describe('previewPlate (preview default and thumbnail)', () => {
  const plates = (...tris) => tris.map((t, i) => ({ plate: i + 1, tri_count: t }));
  it('requested plate wins', () => expect(previewPlate({ plates: plates(5, 5) }, 2)).toBe(2));
  it('multi-plate: first plate by default (thumbnail uses it)', () => expect(previewPlate({ plates: plates(5, 5) })).toBe(1));
  it('skips an empty first plate', () => expect(previewPlate({ plates: plates(0, 5, 5) })).toBe(2));
  it('single plate or no plate info: whole file', () => {
    expect(previewPlate({ plates: plates(5) })).toBeNull();
    expect(previewPlate({ plates: [] })).toBeNull();
  });
  it('loadPreviewData passes the plate through', async () => {
    const p = await loadPreviewData(path.join(FIXTURES, 'multiplate.3mf'), '3mf', 1);
    expect(p.faceColor.length).toBe(12);
    expect(p.palette).toEqual(['#00FFFF']);
  });
});

const DIR = path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/3mf');
describe.skipIf(!existsSync(path.join(DIR, 'BOOK-U1.3mf')) || !existsSync(path.join(DIR, 'U1Cover-U1.3mf')) || !existsSync(path.join(DIR, 'Wine-U1.3mf')))('real plate files', () => {
  it('Wine-U1.3mf: a single plate -> plate_count 1, no plate UI, preview = whole file', async () => {
    const r = await parse3mf(await fs.readFile(path.join(DIR, 'Wine-U1.3mf')));
    expect(r.plates.map((p) => [p.plate, p.tri_count])).toEqual([[1, 384]]);
    expect(previewPlate({ plates: r.plates })).toBeNull();
  });

  it('BOOK-U1.3mf: 5 named plates whose faces add up to the file', async () => {
    const r = await parse3mf(await fs.readFile(path.join(DIR, 'BOOK-U1.3mf')));
    expect(r.plates.map((p) => p.name)).toEqual(['NO HOLDER FRONT', 'NO HOLDER BACK', 'SPINE + EXTENSION', 'BAND HOLDER FRONT', 'BAND HOLDER BACK']);
    expect(r.plates.map((p) => p.tri_count)).toEqual([2378, 1044, 7528, 2718, 1268]);
    expect(r.plates.reduce((s, p) => s + p.tri_count, 0)).toBe(r.tri_count);
    expect(r.color_count).toBe(2);
    expect(r.plates[1].colorStats.map((c) => c.color)).toEqual(['#D1D3D5']); // plate 2 is single-colour
  });

  it('U1Cover-U1.3mf: 8 plates, 40 pins on plate 8', async () => {
    const r = await parse3mf(await fs.readFile(path.join(DIR, 'U1Cover-U1.3mf')));
    expect(r.plates).toHaveLength(8);
    expect(r.plates.reduce((s, p) => s + p.tri_count, 0)).toBe(r.tri_count);
    expect(r.plates[7].tri_count).toBe(1513200);
    expect(r.color_count).toBe(2);
  });
});
