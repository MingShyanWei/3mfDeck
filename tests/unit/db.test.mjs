import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { openDb, insertModel, updateModel, setTags, listModels, getModel, sidebarCounts } from '../../src/core/db.mjs';
import { parseFile } from '../../src/core/parse/index.mjs';
import { FIXTURES } from './helpers.mjs';

let db;
const add = async (fixture, name, relPath = `2026/${fixture}`) =>
  insertModel(db, { name, relPath, parsed: await parseFile(path.join(FIXTURES, fixture)) });

beforeEach(() => {
  db = openDb(':memory:');
});

describe('schema', () => {
  it('creates the SPEC §4 tables and columns', () => {
    const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    expect(cols('models')).toEqual([
      'id', 'name', 'rel_path', 'format', 'size_bytes', 'tri_count', 'bbox_mm', 'color_count', 'thumb',
      'provenance_type', 'platform', 'url', 'prompt', 'retrieved_at', 'notes', 'imported_at', 'updated_at',
      'source_printer', 'source_process', // M18 (SPEC 3.9)
      'embedded_images', 'cover', // M19 (SPEC 3.4b)
      'thumb_dark', // M21 (SPEC 3.4c)
      'content_hash', 'converted_from', // M33 (SPEC 3.1b)
    ]);
    expect(cols('tags')).toEqual(['id', 'name']);
    expect(cols('model_tags')).toEqual(['model_id', 'tag_id']);
    expect(cols('color_stats')).toEqual(['model_id', 'color', 'faces', 'pct', 'label']); // label: M17 (SPEC 3.5d)
  });
});

describe('provenance', () => {
  it('defaults to unknown (未標) with retrieved_at = import date', async () => {
    const id = await add('cube.stl', 'cube');
    const m = getModel(db, id);
    expect(m.provenance_type).toBe('unknown');
    expect(m.platform).toBeNull();
    expect(m.retrieved_at).toBe(new Date().toISOString().slice(0, 10));
    expect(m.tri_count).toBe(12);
    expect(m.bbox_mm).toEqual({ x: 10, y: 10, z: 10 });
  });

  it('prefills from 3MF MakerWorld metadata and stores colour stats', async () => {
    const id = await add('painted.3mf', 'painted');
    const m = getModel(db, id);
    expect(m.provenance_type).toBe('downloaded');
    expect(m.platform).toBe('MakerWorld');
    expect(m.notes).toContain('Designer: Fixture Maker');
    expect(m.color_count).toBe(4);
    expect(m.colors.map((c) => [c.color, c.faces])).toEqual([['#00FFFF', 6], ['#FF00FF', 3], ['#FFFF00', 2], ['#000000', 1]]);
  });

  it('writes all four provenance types with platform/url/prompt/retrieved_at', async () => {
    const id = await add('cube.stl', 'cube');
    const cases = [
      { provenance_type: 'ai_generated', platform: 'Meshy', url: 'https://www.meshy.ai/x', prompt: 'a yellow duck, low poly', retrieved_at: '2026-09-30' },
      { provenance_type: 'downloaded', platform: 'Printables', url: 'https://www.printables.com/model/1', prompt: '', retrieved_at: '2026-01-02' },
      { provenance_type: 'self_made', platform: '', url: '', prompt: '', retrieved_at: '2025-12-31' },
      { provenance_type: 'unknown', platform: '', url: '', prompt: '', retrieved_at: '2026-10-01' },
    ];
    for (const c of cases) {
      updateModel(db, id, c);
      const m = getModel(db, id);
      expect(m.provenance_type).toBe(c.provenance_type);
      // empty strings are stored as NULL
      for (const k of ['platform', 'url', 'prompt', 'retrieved_at']) expect(m[k]).toBe(c[k] === '' ? null : c[k]);
    }
  });

  it('rejects an invalid provenance type and ignores non-editable fields', async () => {
    const id = await add('cube.stl', 'cube');
    expect(() => updateModel(db, id, { provenance_type: 'stolen' })).toThrow(/invalid provenance_type/);
    updateModel(db, id, { rel_path: 'hacked', format: 'x', name: 'renamed' });
    const m = getModel(db, id);
    expect([m.rel_path, m.format, m.name]).toEqual(['2026/cube.stl', 'stl', 'renamed']);
  });
});

describe('tags, search, filters, sort', () => {
  let ids;
  beforeEach(async () => {
    ids = {
      duck: await add('painted.3mf', 'Duck painted'),
      cube: await add('cube.stl', 'Cube'),
      box: await add('box.obj', 'Box'),
    };
    updateModel(db, ids.cube, { provenance_type: 'ai_generated', platform: 'Meshy', notes: 'needs supports' });
    setTags(db, ids.duck, ['鴨子', 'gift', 'gift', ' ']);
    setTags(db, ids.box, ['gift']);
  });

  it('stores unique trimmed tags and removes unused ones', () => {
    expect(getModel(db, ids.duck).tags.sort()).toEqual(['gift', '鴨子']);
    setTags(db, ids.duck, ['gift']);
    expect(sidebarCounts(db).tags).toEqual([{ name: 'gift', n: 2 }]);
  });

  it('searches name, tags and notes', () => {
    const names = (q) => listModels(db, { q, sort: 'name' }).map((m) => m.name);
    expect(names('duck')).toEqual(['Duck painted']);
    expect(names('鴨')).toEqual(['Duck painted']);
    expect(names('gift')).toEqual(['Box', 'Duck painted']);
    expect(names('SUPPORTS')).toEqual(['Cube']);
    expect(names('nothing')).toEqual([]);
  });

  it('filters by unlabeled / type / platform / tag', () => {
    const names = (filter) => listModels(db, { filter, sort: 'name' }).map((m) => m.name);
    expect(names('unlabeled')).toEqual(['Box']);
    expect(names('type:ai_generated')).toEqual(['Cube']);
    expect(names('platform:MakerWorld')).toEqual(['Duck painted']);
    expect(names('tag:鴨子')).toEqual(['Duck painted']);
    expect(sidebarCounts(db)).toMatchObject({ all: 3, unlabeled: 1, types: { ai_generated: 1, downloaded: 1, unknown: 1 } });
  });

  it('sorts by name, colour count and import order', () => {
    expect(listModels(db, { sort: 'name' }).map((m) => m.name)).toEqual(['Box', 'Cube', 'Duck painted']);
    expect(listModels(db, { sort: 'colors' }).map((m) => m.name)).toEqual(['Duck painted', 'Box', 'Cube']);
    expect(listModels(db, { sort: 'imported' }).map((m) => m.name)).toEqual(['Box', 'Cube', 'Duck painted']);
  });
});
