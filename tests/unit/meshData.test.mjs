// Preview mesh preparation that runs in the renderer's Web Worker.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { quantizeFaces, faceColours, prepareMesh, linearBytes } from '../../src/renderer/viewer/meshData.js';
import { parse3mf } from '../../src/core/parse/threemf.mjs';
import { FIXTURES } from './helpers.mjs';

describe('quantizeFaces', () => {
  it('de-indexes and quantizes to Int16 around the centre, restorable to ~0.002 mm on a 120 mm model', () => {
    const positions = new Float32Array([0, 0, 0, 120, 0, 0, 0, 60, 0, 120, 60, 30.123]);
    const indices = new Uint32Array([0, 1, 2, 1, 3, 2]);
    const q = quantizeFaces(positions, indices);
    expect(q.positions).toBeInstanceOf(Int16Array);
    expect(q.positions.length).toBe(18);
    [60, 30, 15.0615].forEach((c, k) => expect(q.center[k]).toBeCloseTo(c, 4)); // Float32 input
    const restore = (i, k) => (q.positions[i * 3 + k] / 32767) * q.half[k] + q.center[k];
    for (let i = 0; i < 6; i++) {
      for (let k = 0; k < 3; k++) expect(Math.abs(restore(i, k) - positions[indices[i] * 3 + k])).toBeLessThan(0.002);
    }
    // extremes map to ±32767
    expect(Math.max(...q.positions)).toBe(32767);
    expect(Math.min(...q.positions)).toBe(-32767);
  });

  it('a flat axis does not divide by zero', () => {
    const q = quantizeFaces(new Float32Array([0, 0, 5, 1, 0, 5, 0, 1, 5]), new Uint32Array([0, 1, 2]));
    expect([...q.positions].every(Number.isFinite)).toBe(true);
    expect(q.center[2]).toBe(5);
  });
});

describe('faceColours', () => {
  it('writes the same linear colour to all 3 vertices of a face; index 0 / unknown -> grey', () => {
    const out = faceColours(new Uint16Array([1, 2, 0, 9]), ['#FF0000', '#808080']);
    expect(out.length).toBe(4 * 9);
    expect([...out.subarray(0, 9)]).toEqual([255, 0, 0, 255, 0, 0, 255, 0, 0]);
    const g = linearBytes('#808080');
    expect([...out.subarray(9, 12)]).toEqual(g);
    expect(g).toEqual([55, 55, 55]); // sRGB 128 -> linear ~0.216
    expect([...out.subarray(18, 21)]).toEqual(linearBytes('#b4b4b0'));
    expect([...out.subarray(27, 30)]).toEqual(linearBytes('#b4b4b0'));
  });
});

describe('prepareMesh', () => {
  it('painted.3mf: original colours and nearest-slot colours per face', async () => {
    const { geometry } = await parse3mf(await fs.readFile(path.join(FIXTURES, 'offpalette.3mf')), { geometry: true });
    const r = prepareMesh(geometry);
    expect(r.positions.length).toBe(12 * 9);
    const first = (arr) => [...arr.subarray(0, 3)];
    expect(first(r.original)).toEqual(linearBytes('#1E90FF'));
    expect(first(r.filament)).toEqual(linearBytes('#00FFFF')); // nearest U1 slot: C
  });

  it('no palette: geometry only', async () => {
    const { geometry } = await parse3mf(await fs.readFile(path.join(FIXTURES, 'plain.3mf')), { geometry: true });
    const r = prepareMesh(geometry);
    expect([r.original, r.filament]).toEqual([null, null]);
    expect(r.positions.length).toBe(12 * 9);
  });
});
