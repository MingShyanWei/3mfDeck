import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { decodePaintColor } from '../../src/core/paintColor.mjs';
import { parse3mf } from '../../src/core/parse/threemf.mjs';
import { FIXTURES } from './helpers.mjs';

describe('decodePaintColor', () => {
  it('decodes single-state leaves (states 1-2 in one nibble, >=3 with an extra nibble)', () => {
    expect(decodePaintColor('4')).toEqual({ 1: 1 });
    expect(decodePaintColor('8')).toEqual({ 2: 1 });
    expect(decodePaintColor('0C')).toEqual({ 3: 1 });
    expect(decodePaintColor('1C')).toEqual({ 4: 1 });
    expect(decodePaintColor('2C')).toEqual({ 5: 1 });
    expect(decodePaintColor('DC')).toEqual({ 16: 1 });
  });

  it('splits weight equally across children of a split triangle', () => {
    // read backwards: "1" = split into 2 children, then leaves "4" (s1) and "8" (s2)
    expect(decodePaintColor('841')).toEqual({ 1: 0.5, 2: 0.5 });
    // "3" = split into 4 children: s1, s2, s3 ("0C"), s1
    expect(decodePaintColor('40C843')).toEqual({ 1: 0.5, 2: 0.25, 3: 0.25 });
    // nested: root split in 2; first child split in 2 (s1, s2), second child s2
    // read order 1,1,4,8,8 -> string "88411"
    expect(decodePaintColor('88411')).toEqual({ 1: 0.25, 2: 0.75 });
  });

  it('throws on truncated input', () => {
    expect(() => decodePaintColor('1')).toThrow(/truncated/);
  });
});

describe('parse3mf', () => {
  it('resolves paint_color to filament colours with per-face distribution', async () => {
    const r = await parse3mf(await fs.readFile(path.join(FIXTURES, 'painted.3mf')));
    expect(r.tri_count).toBe(12);
    expect(r.color_count).toBe(4);
    // unpainted face takes the part extruder (4 -> #000000), not the object's (1)
    expect(r.colorStats).toEqual([
      { color: '#00FFFF', faces: 6, pct: 50 },
      { color: '#FF00FF', faces: 3, pct: 25 },
      { color: '#FFFF00', faces: 2, pct: 16.67 },
      { color: '#000000', faces: 1, pct: 8.33 },
    ]);
    // 10 mm cube scaled x2 by the build item transform
    expect(r.bbox_mm).toEqual({ x: 20, y: 20, z: 20 });
  });

  it('extracts MakerWorld provenance hints from BambuStudio metadata', async () => {
    const r = await parse3mf(await fs.readFile(path.join(FIXTURES, 'painted.3mf')));
    expect(r.metadata.Title).toBe('Fixture & Cube');
    expect(r.provenanceHint).toEqual({
      provenance_type: 'downloaded',
      platform: 'MakerWorld',
      notes: 'Title: Fixture & Cube\nDesigner: Fixture Maker\nLicense: CC BY\nDesignModelId: US0f1e2d3c4b5a69',
    });
  });

  it('plain 3MF without slicer config: no colour stats, unit conversion applied', async () => {
    const r = await parse3mf(await fs.readFile(path.join(FIXTURES, 'plain.3mf')));
    expect(r.tri_count).toBe(12);
    expect(r.color_count).toBeNull();
    expect(r.colorStats).toBeNull();
    expect(r.provenanceHint).toBeNull();
    expect(r.bbox_mm).toEqual({ x: 10, y: 20, z: 30 }); // centimeter -> mm
  });
});
