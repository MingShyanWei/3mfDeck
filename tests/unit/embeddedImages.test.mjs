// M19 (SPEC 3.4b): product images embedded in a 3MF (cover, creator photos, plate renders).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import Database from 'better-sqlite3';
import { listEmbeddedImages, plateImage, mimeOf } from '../../src/core/embeddedImages.mjs';
import { parse3mf } from '../../src/core/parse/threemf.mjs';
import { openDb, insertModel, listModels, getModel, getCover, idsNeedingEmbedded, setEmbedded } from '../../src/core/db.mjs';
import { parseFile } from '../../src/core/parse/index.mjs';
import { FIXTURES, tmpDir } from './helpers.mjs';

// A MakerWorld-style project, in the shape of the user's real files
const MAKERWORLD = [
  '3D/3dmodel.model',
  'Metadata/plate_1.png', 'Metadata/plate_1_small.png', 'Metadata/plate_no_light_1.png', 'Metadata/top_1.png', 'Metadata/pick_1.png',
  'Metadata/plate_2.png', 'Metadata/plate_10.png',
  'Auxiliaries/Model Pictures/IMG_2.webp', 'Auxiliaries/Model Pictures/IMG_1.webp',
  'Auxiliaries/.thumbnails/thumbnail_3mf.png', 'Auxiliaries/.thumbnails/thumbnail_middle.png', 'Auxiliaries/.thumbnails/thumbnail_small.png',
  'Auxiliaries/Profile Pictures/IMG_2.webp',
];

describe('listEmbeddedImages', () => {
  it('lists cover, thumbnail, photos (archive order) and plate renders; drops small duplicates and masks', () => {
    const { cover, images } = listEmbeddedImages(MAKERWORLD);
    expect(cover).toBe('Auxiliaries/.thumbnails/thumbnail_middle.png');
    expect(images.map((i) => [i.path.split('/').pop(), i.kind, i.plate])).toEqual([
      ['thumbnail_middle.png', 'cover', undefined],
      ['thumbnail_3mf.png', 'thumb', undefined],
      ['IMG_2.webp', 'photo', undefined],
      ['IMG_1.webp', 'photo', undefined],
      ['plate_1.png', 'plate', 1],
      ['plate_2.png', 'plate', 2],
      ['plate_10.png', 'plate', 10],
    ]);
  });

  it('cover priority: middle -> thumbnail_3mf -> first model picture -> plate_1', () => {
    const without = (...drop) => MAKERWORLD.filter((n) => !drop.some((d) => n.includes(d)));
    expect(listEmbeddedImages(without('thumbnail_middle')).cover).toBe('Auxiliaries/.thumbnails/thumbnail_3mf.png');
    expect(listEmbeddedImages(without('thumbnail_')).cover).toBe('Auxiliaries/Model Pictures/IMG_2.webp');
    expect(listEmbeddedImages(without('thumbnail_', 'Model Pictures')).cover).toBe('Metadata/plate_1.png');
  });

  it('a Meshy export has none', () => {
    expect(listEmbeddedImages(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels'])).toEqual({ cover: null, images: [] });
  });

  it('plate render lookup and mime types', () => {
    const e = listEmbeddedImages(MAKERWORLD);
    expect([plateImage(e, 2), plateImage(e, 3), plateImage(null, 1)]).toEqual(['Metadata/plate_2.png', null, null]);
    expect(['a.png', 'b.WEBP', 'c.jpg'].map(mimeOf)).toEqual(['image/png', 'image/webp', 'image/jpeg']);
  });
});

// multiplate.3mf plus real (1x1) images
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
async function withImages(dir) {
  const zip = await JSZip.loadAsync(await fs.readFile(path.join(FIXTURES, 'multiplate.3mf')));
  const middle = Buffer.concat([PNG, Buffer.from('middle')]); // distinguishable bytes
  zip.file('Auxiliaries/.thumbnails/thumbnail_middle.png', middle);
  zip.file('Auxiliaries/Model Pictures/photo.png', PNG);
  zip.file('Metadata/plate_1.png', PNG);
  zip.file('Metadata/plate_2.png', PNG);
  const file = path.join(dir, 'pictures.3mf');
  await fs.writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }));
  return { file, middle };
}

describe('import: cover in the DB, the list on the record', () => {
  it('parse3mf returns the list and the cover bytes (not when loading geometry for the preview)', async () => {
    const { file, middle } = await withImages(await tmpDir());
    const r = await parse3mf(await fs.readFile(file));
    expect(r.embedded.images.map((i) => i.kind)).toEqual(['cover', 'photo', 'plate', 'plate']);
    expect(r.coverBytes).toEqual(middle);
    expect((await parse3mf(await fs.readFile(file), { geometry: true })).coverBytes).toBe(null);
  });

  it('stores the cover and the list; files without images get an empty list (known, not NULL)', async () => {
    const { file, middle } = await withImages(await tmpDir());
    const db = openDb(':memory:');
    const id = insertModel(db, { name: 'pictures', relPath: '2026/pictures.3mf', parsed: await parseFile(file) });
    const plain = insertModel(db, { name: 'painted', relPath: '2026/painted.3mf', parsed: await parseFile(path.join(FIXTURES, 'painted.3mf')) });
    expect(getModel(db, id).embedded_images.images).toHaveLength(4);
    expect(getCover(db, id)).toEqual({ path: 'Auxiliaries/.thumbnails/thumbnail_middle.png', bytes: middle });
    expect(listModels(db).find((m) => m.id === plain).embedded_images).toEqual({ cover: null, images: [] });
    expect(getCover(db, plain)).toBe(null);
    expect(idsNeedingEmbedded(db)).toEqual([]);
  });

  it('a pre-M19 database gets the columns; its 3MF rows are listed for the background fill', async () => {
    const file = path.join(await tmpDir(), 'old.db');
    const old = new Database(file);
    old.exec(`CREATE TABLE models (id INTEGER PRIMARY KEY, name TEXT NOT NULL, rel_path TEXT NOT NULL UNIQUE, format TEXT NOT NULL,
      size_bytes INTEGER NOT NULL, tri_count INTEGER, bbox_mm TEXT, color_count INTEGER, thumb BLOB, provenance_type TEXT,
      platform TEXT, url TEXT, prompt TEXT, retrieved_at TEXT, notes TEXT, imported_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO models (id, name, rel_path, format, size_bytes, imported_at, updated_at) VALUES (1, 'a', '2026/a.3mf', '3mf', 1, 'x', 'x'), (2, 'b', '2026/b.stl', 'stl', 1, 'x', 'x');`);
    old.close();
    const db = openDb(file);
    expect(idsNeedingEmbedded(db)).toEqual([1]);
    setEmbedded(db, 1, { cover: 'Metadata/plate_1.png', images: [{ path: 'Metadata/plate_1.png', kind: 'plate', plate: 1 }] }, PNG);
    expect(idsNeedingEmbedded(db)).toEqual([]);
    expect(getCover(db, 1).bytes).toEqual(PNG);
    db.close();
  });
});
