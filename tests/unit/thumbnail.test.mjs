import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import path from 'node:path';
import { openDb, insertModel, listModels, getThumb, idsNeedingThumb } from '../../src/core/db.mjs';
import { parseFile } from '../../src/core/parse/index.mjs';
import { loadPreviewData, pngSize, storeThumb } from '../../src/core/preview.mjs';
import { fitDistance } from '../../src/renderer/viewer/fit.js';
import { FIXTURES } from './helpers.mjs';

// Minimal valid PNG of the given size (solid colour)
function png(w, h) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc(h * (1 + w * 4), 0x7f);
  for (let y = 0; y < h; y++) raw[y * (1 + w * 4)] = 0;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function dbWith(...fixtures) {
  const db = openDb(':memory:');
  const ids = [];
  for (const f of fixtures) ids.push(insertModel(db, { name: f, relPath: `2026/${f}`, parsed: await parseFile(path.join(FIXTURES, f)) }));
  return { db, ids };
}

describe('pngSize', () => {
  it('reads IHDR dimensions', () => {
    expect(pngSize(png(512, 512))).toEqual({ width: 512, height: 512 });
    expect(pngSize(png(3, 7))).toEqual({ width: 3, height: 7 });
  });
  it('rejects non-PNG data', () => {
    expect(pngSize(Buffer.from('not a png at all, definitely not'))).toBeNull();
    expect(pngSize(Buffer.alloc(0))).toBeNull();
  });
});

describe('thumbnail storage', () => {
  it('stores a 512px PNG, lists has_thumb and drops it from the backlog', async () => {
    const { db, ids } = await dbWith('painted.3mf', 'cube.stl', 'fixture.step');
    // STEP cannot be rendered, so it never enters the backlog
    expect(idsNeedingThumb(db)).toEqual([ids[0], ids[1]]);
    const thumb = png(512, 512);
    storeThumb(db, ids[0], new Uint8Array(thumb)); // as received over IPC
    expect(getThumb(db, ids[0])).toEqual(thumb);
    expect(idsNeedingThumb(db)).toEqual([ids[1]]);
    expect(listModels(db, { sort: 'name' }).map((m) => [m.name, m.has_thumb])).toEqual([
      ['cube.stl', false],
      ['fixture.step', false],
      ['painted.3mf', true],
    ]);
  });

  it('rejects wrong sizes and non-PNG data', async () => {
    const { db, ids } = await dbWith('cube.stl');
    expect(() => storeThumb(db, ids[0], png(256, 256))).toThrow(/512px PNG, got 256x256/);
    expect(() => storeThumb(db, ids[0], Buffer.from('<svg/>'))).toThrow(/non-PNG/);
    expect(getThumb(db, ids[0])).toBeNull();
  });

  it('does not touch updated_at (thumbnails are derived data)', async () => {
    const { db, ids } = await dbWith('cube.stl');
    const before = listModels(db)[0].updated_at;
    await new Promise((r) => setTimeout(r, 5));
    storeThumb(db, ids[0], png(512, 512));
    expect(listModels(db)[0].updated_at).toBe(before);
  });
});

describe('loadPreviewData', () => {
  it('3MF: geometry with per-face filament state', async () => {
    const p = await loadPreviewData(path.join(FIXTURES, 'painted.3mf'), '3mf');
    expect(p.format).toBe('3mf');
    expect(p.indices.length).toBe(36);
    expect([...p.faceState]).toEqual([1, 1, 1, 1, 2, 2, 3, 4, 3, 1, 1, 1]);
    expect(p.colours).toHaveLength(4);
  });

  it('other meshes: exact raw bytes for three.js loaders', async () => {
    for (const [f, fmt] of [['textured.glb', 'glb'], ['cube.stl', 'stl'], ['box.obj', 'obj'], ['box.amf', 'amf']]) {
      const p = await loadPreviewData(path.join(FIXTURES, f), fmt);
      expect(Buffer.from(p.bytes)).toEqual(await fs.readFile(path.join(FIXTURES, f)));
    }
  });

  it('STEP: unsupported', async () => {
    expect(await loadPreviewData(path.join(FIXTURES, 'fixture.step'), 'step')).toEqual({ format: 'step', unsupported: true });
  });
});

describe('fitDistance (camera framing)', () => {
  it('fits a sphere using the narrower field of view', () => {
    expect(fitDistance(1, 90, 1, 1)).toBeCloseTo(Math.SQRT2, 6);
    // wide viewport: vertical fov limits
    expect(fitDistance(1, 90, 2, 1)).toBeCloseTo(Math.SQRT2, 6);
    // tall viewport: horizontal fov is narrower -> camera further away
    expect(fitDistance(1, 90, 0.5, 1)).toBeGreaterThan(Math.SQRT2);
    expect(fitDistance(10, 35, 1)).toBeCloseTo(10 / Math.sin((17.5 * Math.PI) / 180) * 1.05, 6);
  });
});
