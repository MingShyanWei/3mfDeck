// M17 (SPEC 3.5d): colour labels, colour search/filter, cabinet purchase suggestions.
import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import Database from 'better-sqlite3';
import { labelFor, modelLabels, labelInQuery, LABELS, OTHER, COLOR_NAMES } from '../../src/core/colorNames.mjs';
import { cabinetColors, purchaseSuggestions } from '../../src/core/purchase.mjs';
import { openDb, insertModel, listModels, getModel, sidebarCounts, cabinetColorRows, backfillColorLabels } from '../../src/core/db.mjs';
import { parseFile } from '../../src/core/parse/index.mjs';
import { FIXTURES, tmpDir } from './helpers.mjs';

describe('labelFor: fixed Chinese colour names by nearest Lab prototype', () => {
  it('names the basic colours', () => {
    const cases = {
      '#000000': '黑', '#FFFFFF': '白', '#808080': '灰', '#FF0000': '紅', '#FF8C00': '橙', '#FFFF00': '黃',
      '#4CAF50': '綠', '#00FFFF': '青', '#1E90FF': '藍', '#0A2989': '藍', '#800080': '紫', '#8000FF': '紫',
      '#FF69B4': '粉', '#8B4513': '棕', '#E0AC69': '膚', '#D4AF37': '金',
    };
    for (const [hex, name] of Object.entries(cases)) expect([hex, labelFor(hex)]).toEqual([hex, name]);
  });

  it('magenta has no own name in the table and counts as 粉', () => {
    expect(labelFor('#FF00FF')).toBe('粉');
  });

  it('is case-insensitive and every label is from the fixed list', () => {
    expect(labelFor('#ff0000')).toBe('紅');
    expect(LABELS).toEqual([...COLOR_NAMES.map((c) => c.name), OTHER]);
    for (const hex of ['#123456', '#ABCDEF', '#7F7F00', '#00FF80']) expect(LABELS).toContain(labelFor(hex));
  });
});

describe('modelLabels: top labels by area', () => {
  it('sums palette shares per label, drops labels under 5 %, keeps the top 3', () => {
    const labels = modelLabels([
      { color: '#00FFFF', pct: 40 },
      { color: '#00BCD4', pct: 20 }, // also 青
      { color: '#FF0000', pct: 25 },
      { color: '#FFFF00', pct: 11 },
      { color: '#000000', pct: 4 }, // under 5 %
    ]);
    expect(labels).toEqual([
      { label: '青', pct: 60 },
      { label: '紅', pct: 25 },
      { label: '黃', pct: 11 },
    ]);
  });
});

describe('labelInQuery', () => {
  it('accepts 「紅」 and 「紅色」, nothing else', () => {
    expect(labelInQuery('紅')).toBe('紅');
    expect(labelInQuery(' 紅色 ')).toBe('紅');
    expect(labelInQuery('紅龍')).toBe(null);
    expect(labelInQuery('duck')).toBe(null);
  });
});

describe('DB: color_stats.label, colour filter and colour search', () => {
  let db;
  const add = async (fixture, name) => insertModel(db, { name, relPath: `2026/${fixture}`, parsed: await parseFile(path.join(FIXTURES, fixture)) });
  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('labels are stored at import; models carry their top-3 colour labels', async () => {
    const id = await add('painted.3mf', 'painted'); // #00FFFF 50 % #FF00FF 25 % #FFFF00 16.67 % #000000 8.33 %
    expect(getModel(db, id).colors.map((c) => [c.color, c.label])).toEqual([
      ['#00FFFF', '青'], ['#FF00FF', '粉'], ['#FFFF00', '黃'], ['#000000', '黑'],
    ]);
    expect(listModels(db)[0].color_labels).toEqual([
      { label: '青', pct: 50 },
      { label: '粉', pct: 25 },
      { label: '黃', pct: 16.67 },
    ]);
    expect(getModel(db, id).color_labels.map((l) => l.label)).toEqual(['青', '粉', '黃']);
  });

  it('filters by colour labels (all selected must match) and counts models per label', async () => {
    await add('painted.3mf', 'painted'); // 青 粉 黃 黑
    await add('materials.3mf', 'materials'); // 橙 藍 白 綠
    await add('cube.stl', 'cube'); // no colours
    const names = (opts) => listModels(db, opts).map((m) => m.name).sort();
    expect(names({ colors: ['青'] })).toEqual(['painted']);
    expect(names({ colors: ['藍'] })).toEqual(['materials']);
    expect(names({ colors: ['青', '藍'] })).toEqual([]);
    expect(names({ colors: ['黑'] })).toEqual(['painted']); // 8.33 % >= 5 %
    expect(Object.fromEntries(sidebarCounts(db).colors.map((c) => [c.label, c.n]))).toEqual({ 青: 1, 粉: 1, 黃: 1, 黑: 1, 橙: 1, 藍: 1, 白: 1, 綠: 1 });
  });

  it('search finds models by colour name (「藍」 or 「藍色」) as well as by text', async () => {
    await add('painted.3mf', 'painted');
    await add('materials.3mf', 'materials');
    expect(listModels(db, { q: '藍' }).map((m) => m.name)).toEqual(['materials']);
    expect(listModels(db, { q: '藍色' }).map((m) => m.name)).toEqual(['materials']);
    expect(listModels(db, { q: 'paint' }).map((m) => m.name)).toEqual(['painted']);
  });

  it('migrates a pre-M17 database: adds the column and backfills missing labels once', async () => {
    const file = path.join(await tmpDir(), 'old.db');
    const old = new Database(file);
    old.exec(`CREATE TABLE models (id INTEGER PRIMARY KEY, name TEXT NOT NULL, rel_path TEXT NOT NULL UNIQUE, format TEXT NOT NULL,
      size_bytes INTEGER NOT NULL, tri_count INTEGER, bbox_mm TEXT, color_count INTEGER, thumb BLOB, provenance_type TEXT,
      platform TEXT, url TEXT, prompt TEXT, retrieved_at TEXT, notes TEXT, imported_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE color_stats (model_id INTEGER REFERENCES models(id) ON DELETE CASCADE, color TEXT, faces INTEGER, pct REAL, PRIMARY KEY (model_id, color));
      INSERT INTO models (id, name, rel_path, format, size_bytes, imported_at, updated_at) VALUES (1, 'old', '2026/old.3mf', '3mf', 1, 'x', 'x');
      INSERT INTO color_stats VALUES (1, '#FF0000', 60, 60), (1, '#0000FF', 40, 40);`);
    old.close();
    const db2 = openDb(file);
    expect(db2.prepare('SELECT color, label FROM color_stats ORDER BY color').all()).toEqual([
      { color: '#0000FF', label: '藍' },
      { color: '#FF0000', label: '紅' },
    ]);
    expect(backfillColorLabels(db2)).toBe(0); // nothing left to fill
    expect(listModels(db2, { colors: ['紅'] }).map((m) => m.name)).toEqual(['old']);
    db2.close();
    await fs.rm(file, { force: true });
  });
});

describe('purchase suggestions (cabinet level)', () => {
  const rows = [
    // model 1: 80 % red, 20 % blue; model 2: 100 % red (huge or tiny, it counts once)
    { model_id: 1, color: '#FF0000', pct: 80, label: '紅' },
    { model_id: 1, color: '#0000FF', pct: 20, label: '藍' },
    { model_id: 2, color: '#E72F1D', pct: 100, label: '紅' },
    { model_id: 3, color: '#123456', pct: 100, label: OTHER },
  ];

  it('ranks labels by mean share per coloured model, with model counts and a representative colour', () => {
    const r = cabinetColors(rows);
    expect(r.map((x) => [x.label, x.share, x.models])).toEqual([
      ['紅', 60, 2], // (80 + 100 + 0) / 3
      [OTHER, 33.33, 1],
      ['藍', 6.67, 1],
    ]);
    expect(labelFor(r[0].hex)).toBe('紅');
    expect(r.find((x) => x.label === '藍').hex).toBe('#0000FF');
  });

  it('suggests the labels the inventory lacks, never 「其他」', () => {
    const ranking = cabinetColors(rows);
    const none = purchaseSuggestions(ranking, []);
    expect(none.suggestions.map((s) => s.label)).toEqual(['紅', '藍']);
    const withRed = purchaseSuggestions(ranking, [{ name: 'Bambu Red', hex: '#C12E1F' }]);
    expect(withRed.suggestions.map((s) => s.label)).toEqual(['藍']);
    expect(withRed.ranking.find((r) => r.label === '紅').owned).toEqual([{ name: 'Bambu Red', hex: '#C12E1F' }]);
  });

  it('works on DB rows', async () => {
    const db = openDb(':memory:');
    insertModel(db, { name: 'painted', relPath: '2026/painted.3mf', parsed: await parseFile(path.join(FIXTURES, 'painted.3mf')) });
    expect(cabinetColors(cabinetColorRows(db)).map((x) => x.label)).toEqual(['青', '粉', '黃', '黑']);
  });
});
