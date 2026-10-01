// M21 (SPEC 3.4c): card / row thumbnails — product cover, else the 3D render
// unless it is a black blob, else the format icon.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import { isNearlyBlack } from '../../src/core/thumbCheck.mjs';
import { thumbOf } from '../../src/renderer/thumbSource.js';
import { openDb, insertModel, listModels, thumbsToCheck, setThumb } from '../../src/core/db.mjs';
import { storeThumb } from '../../src/core/preview.mjs';
import { parseFile } from '../../src/core/parse/index.mjs';
import { FIXTURES, tmpDir } from './helpers.mjs';

// RGBA pixels: `model` opaque pixels of one colour, the rest transparent background
const image = (model, [r, g, b], total = 100) => {
  const px = new Uint8Array(total * 4);
  for (let i = 0; i < model; i++) px.set([r, g, b, 255], i * 4);
  return px;
};

describe('isNearlyBlack', () => {
  it('flags a black silhouette, not a dark-grey shaded part or a coloured model', () => {
    expect(isNearlyBlack(image(20, [0, 0, 0]))).toBe(true); // the pre-M21 咕咕嘎嘎-U1 thumbnail
    expect(isNearlyBlack(image(20, [42, 42, 42]))).toBe(false); // black filament drawn as Orca does
    expect(isNearlyBlack(image(20, [200, 30, 30]))).toBe(false);
    expect(isNearlyBlack(new Uint8Array(400))).toBe(false); // nothing drawn at all
  });
  it('needs 90 % of the model pixels to be black', () => {
    const px = image(20, [0, 0, 0]);
    px.set([255, 255, 255, 255], 0);
    px.set([255, 255, 255, 255], 4); // 18/20 black = 90 %
    expect(isNearlyBlack(px)).toBe(true);
    px.set([255, 255, 255, 255], 8); // 85 %
    expect(isNearlyBlack(px)).toBe(false);
  });
});

describe('thumbOf', () => {
  it('cover first, then a non-black render, then the icon', () => {
    expect(thumbOf({ id: 7, has_cover: true, has_thumb: true, thumb_dark: false })).toEqual({ src: 'mfimg://cover/7', source: 'cover' });
    expect(thumbOf({ id: 7, has_cover: false, has_thumb: true, thumb_dark: false })).toEqual({ src: 'mfthumb://thumb/7', source: 'render' });
    expect(thumbOf({ id: 7, has_cover: false, has_thumb: true, thumb_dark: true })).toBe(null);
    expect(thumbOf({ id: 7, has_cover: true, has_thumb: true, thumb_dark: true }).source).toBe('cover');
    expect(thumbOf({ id: 7, has_cover: false, has_thumb: false, thumb_dark: false })).toBe(null);
  });
});

describe('DB: has_cover, thumb_dark', () => {
  const PNG512 = () => {
    // smallest valid 512x512 PNG header for storeThumb's size check (content is not decoded there)
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.write('IHDR', 12, 'latin1');
    b.writeUInt32BE(512, 16);
    b.writeUInt32BE(512, 20);
    return b;
  };
  it('list rows carry has_cover and the black flag set when the thumbnail is stored', async () => {
    const db = openDb(':memory:');
    const dir = await tmpDir();
    const zip = await JSZip.loadAsync(await fs.readFile(path.join(FIXTURES, 'painted.3mf')));
    zip.file('Auxiliaries/.thumbnails/thumbnail_middle.png', PNG512());
    await fs.writeFile(path.join(dir, 'covered.3mf'), await zip.generateAsync({ type: 'nodebuffer' }));
    const a = insertModel(db, { name: 'covered', relPath: '2026/covered.3mf', parsed: await parseFile(path.join(dir, 'covered.3mf')) });
    const b = insertModel(db, { name: 'plain', relPath: '2026/painted.3mf', parsed: await parseFile(path.join(FIXTURES, 'painted.3mf')) });
    storeThumb(db, a, PNG512());
    storeThumb(db, b, PNG512(), true);
    const rows = Object.fromEntries(listModels(db).map((m) => [m.name, [m.has_cover, m.has_thumb, m.thumb_dark, thumbOf(m)?.source ?? null]]));
    expect(rows).toEqual({ covered: [true, true, false, 'cover'], plain: [false, true, true, null] });
    expect(thumbsToCheck(db)).toEqual([]); // both flags known
  });
  it('thumbnails stored before M21 are listed once for the black check', async () => {
    const db = openDb(':memory:');
    const id = insertModel(db, { name: 'old', relPath: '2026/painted.3mf', parsed: await parseFile(path.join(FIXTURES, 'painted.3mf')) });
    db.prepare('UPDATE models SET thumb = ?, thumb_dark = NULL WHERE id = ?').run(PNG512(), id); // as an older version left it
    expect(thumbsToCheck(db).map((r) => r.id)).toEqual([id]);
    setThumb(db, id, null); // judged black: dropped so it renders again
    expect(listModels(db)[0]).toMatchObject({ has_thumb: false, thumb_dark: false });
    expect(thumbsToCheck(db)).toEqual([]);
  });
});
