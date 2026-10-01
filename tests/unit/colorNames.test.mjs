// M17 (SPEC 3.5d): colour labels, colour search/filter, cabinet purchase suggestions.
import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import Database from 'better-sqlite3';
import { labelFor, modelLabels, labelInQuery, LABELS, OTHER, COLOR_NAMES } from '../../src/core/colorNames.mjs';
import { cabinetColors, purchaseSuggestions } from '../../src/core/purchase.mjs';
import { openDb, insertModel, listModels, getModel, sidebarCounts, cabinetColorRows, backfillColorLabels, migrateLegacyLabels } from '../../src/core/db.mjs';
import { parseFile } from '../../src/core/parse/index.mjs';
import { FIXTURES, tmpDir } from './helpers.mjs';

describe('labelFor: fixed colour label keys by nearest Lab prototype', () => {
  it('names the basic colours', () => {
    const cases = {
      '#000000': 'black', '#FFFFFF': 'white', '#808080': 'gray', '#FF0000': 'red', '#FF8C00': 'orange', '#FFFF00': 'yellow',
      '#4CAF50': 'green', '#00FFFF': 'cyan', '#1E90FF': 'blue', '#0A2989': 'blue', '#800080': 'purple', '#8000FF': 'purple',
      '#FF69B4': 'pink', '#8B4513': 'brown', '#E0AC69': 'skin', '#D4AF37': 'gold',
    };
    for (const [hex, name] of Object.entries(cases)) expect([hex, labelFor(hex)]).toEqual([hex, name]);
  });

  it('magenta has no own name in the table and counts as pink', () => {
    expect(labelFor('#FF00FF')).toBe('pink');
  });

  it('is case-insensitive and every label is from the fixed list', () => {
    expect(labelFor('#ff0000')).toBe('red');
    expect(LABELS).toEqual([...COLOR_NAMES.map((c) => c.key), OTHER]);
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
      { label: 'cyan', pct: 60 },
      { label: 'red', pct: 25 },
      { label: 'yellow', pct: 11 },
    ]);
  });
});

describe('labelInQuery', () => {
  it('accepts 「紅」 and 「紅色」, nothing else', () => {
    expect(labelInQuery('紅')).toBe('red');
    expect(labelInQuery(' 紅色 ')).toBe('red');
    expect(labelInQuery('紅龍')).toBe(null);
    expect(labelInQuery('duck')).toBe(null);
  });

  it('M24: names in every UI language, the key itself and a colour suffix', () => {
    for (const q of ['white', 'White', ' white colour ', 'white color', '白', '白色']) expect([q, labelInQuery(q)]).toEqual([q, 'white']);
    expect(labelInQuery('蓝')).toBe('blue'); // Simplified
    expect(labelInQuery('藍')).toBe('blue'); // Traditional
    expect(labelInQuery('Blue')).toBe('blue');
    expect(labelInQuery('肤色')).toBe('skin');
    expect(labelInQuery('other')).toBe('other');
    expect(labelInQuery('blueberry')).toBe(null);
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
      ['#00FFFF', 'cyan'], ['#FF00FF', 'pink'], ['#FFFF00', 'yellow'], ['#000000', 'black'],
    ]);
    expect(listModels(db)[0].color_labels).toEqual([
      { label: 'cyan', pct: 50 },
      { label: 'pink', pct: 25 },
      { label: 'yellow', pct: 16.67 },
    ]);
    expect(getModel(db, id).color_labels.map((l) => l.label)).toEqual(['cyan', 'pink', 'yellow']);
  });

  it('filters by colour labels (all selected must match) and counts models per label', async () => {
    await add('painted.3mf', 'painted'); // 青 粉 黃 黑
    await add('materials.3mf', 'materials'); // 橙 藍 白 綠
    await add('cube.stl', 'cube'); // no colours
    const names = (opts) => listModels(db, opts).map((m) => m.name).sort();
    expect(names({ colors: ['cyan'] })).toEqual(['painted']);
    expect(names({ colors: ['blue'] })).toEqual(['materials']);
    expect(names({ colors: ['cyan', 'blue'] })).toEqual([]);
    expect(names({ colors: ['black'] })).toEqual(['painted']); // 8.33 % >= 5 %
    expect(Object.fromEntries(sidebarCounts(db).colors.map((c) => [c.label, c.n]))).toEqual({ cyan: 1, pink: 1, yellow: 1, black: 1, orange: 1, blue: 1, white: 1, green: 1 });
  });

  it('search finds models by colour name (「藍」 or 「藍色」) as well as by text', async () => {
    await add('painted.3mf', 'painted');
    await add('materials.3mf', 'materials');
    expect(listModels(db, { q: '藍' }).map((m) => m.name)).toEqual(['materials']);
    expect(listModels(db, { q: '藍色' }).map((m) => m.name)).toEqual(['materials']);
    expect(listModels(db, { q: 'paint' }).map((m) => m.name)).toEqual(['painted']);
    // M24: the same model is found whatever language the query is in
    for (const q of ['blue', 'Blue', '蓝', '蓝色']) expect([q, listModels(db, { q }).map((m) => m.name)]).toEqual([q, ['materials']]);
  });

  it('M24: migrates labels stored as Traditional Chinese names to keys, once, touching nothing else', async () => {
    await add('painted.3mf', 'painted');
    db.exec(`UPDATE color_stats SET label = CASE label WHEN 'cyan' THEN '青' WHEN 'pink' THEN '粉' WHEN 'yellow' THEN '黃' WHEN 'black' THEN '黑' END`);
    db.prepare("INSERT INTO color_stats (model_id, color, faces, pct, label) VALUES (1, '#123456', 1, 0.1, '其他')").run();
    const before = db.prepare('SELECT model_id, color, faces, pct FROM color_stats ORDER BY color').all();
    expect(migrateLegacyLabels(db)).toBe(5);
    expect(db.prepare('SELECT color, label FROM color_stats ORDER BY color').all()).toEqual([
      { color: '#000000', label: 'black' }, { color: '#00FFFF', label: 'cyan' }, { color: '#123456', label: 'other' },
      { color: '#FF00FF', label: 'pink' }, { color: '#FFFF00', label: 'yellow' },
    ]);
    expect(db.prepare('SELECT model_id, color, faces, pct FROM color_stats ORDER BY color').all()).toEqual(before);
    expect(migrateLegacyLabels(db)).toBe(0); // idempotent
    expect(listModels(db, { colors: ['cyan'] }).map((m) => m.name)).toEqual(['painted']);
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
      { color: '#0000FF', label: 'blue' },
      { color: '#FF0000', label: 'red' },
    ]);
    expect(backfillColorLabels(db2)).toBe(0); // nothing left to fill
    expect(listModels(db2, { colors: ['red'] }).map((m) => m.name)).toEqual(['old']);
    db2.close();
    await fs.rm(file, { force: true });
  });
});

describe('purchase suggestions (cabinet level)', () => {
  const rows = [
    // model 1: 80 % red, 20 % blue; model 2: 100 % red (huge or tiny, it counts once)
    { model_id: 1, color: '#FF0000', pct: 80, label: 'red' },
    { model_id: 1, color: '#0000FF', pct: 20, label: 'blue' },
    { model_id: 2, color: '#E72F1D', pct: 100, label: 'red' },
    { model_id: 3, color: '#123456', pct: 100, label: OTHER },
  ];

  it('ranks labels by mean share per coloured model, with model counts and a representative colour', () => {
    const r = cabinetColors(rows);
    expect(r.map((x) => [x.label, x.share, x.models])).toEqual([
      ['red', 60, 2], // (80 + 100 + 0) / 3
      [OTHER, 33.33, 1],
      ['blue', 6.67, 1],
    ]);
    expect(labelFor(r[0].hex)).toBe('red');
    expect(r.find((x) => x.label === 'blue').hex).toBe('#0000FF');
  });

  it('suggests the labels the inventory lacks, never 「其他」', () => {
    const ranking = cabinetColors(rows);
    const none = purchaseSuggestions(ranking, []);
    expect(none.suggestions.map((s) => s.label)).toEqual(['red', 'blue']);
    const withRed = purchaseSuggestions(ranking, [{ name: 'Bambu Red', hex: '#C12E1F' }]);
    expect(withRed.suggestions.map((s) => s.label)).toEqual(['blue']);
    expect(withRed.ranking.find((r) => r.label === 'red').owned).toEqual([{ name: 'Bambu Red', hex: '#C12E1F' }]);
  });

  it('works on DB rows', async () => {
    const db = openDb(':memory:');
    insertModel(db, { name: 'painted', relPath: '2026/painted.3mf', parsed: await parseFile(path.join(FIXTURES, 'painted.3mf')) });
    expect(cabinetColors(cabinetColorRows(db)).map((x) => x.label)).toEqual(['cyan', 'pink', 'yellow', 'black']);
  });
});
