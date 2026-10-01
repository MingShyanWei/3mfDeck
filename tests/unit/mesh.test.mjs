import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { parseFile, formatOf } from '../../src/core/parse/index.mjs';
import { FIXTURES } from './helpers.mjs';

describe('parseFile metadata per format', () => {
  const cases = [
    ['cube.stl', 'stl', 12, { x: 10, y: 10, z: 10 }],
    ['pyramid_ascii.stl', 'stl', 6, { x: 4, y: 4, z: 3 }],
    ['box.obj', 'obj', 12, { x: 20, y: 10, z: 5 }],
    ['cube.glb', 'glb', 12, { x: 20, y: 20, z: 20 }], // node scale 0.02 m
    ['box.amf', 'amf', 12, { x: 5, y: 6, z: 7 }],
    ['fixture.step', 'step', null, null],
  ];
  for (const [file, format, tris, bbox] of cases) {
    it(file, async () => {
      const r = await parseFile(path.join(FIXTURES, file));
      expect(r.error).toBeUndefined();
      expect(r.format).toBe(format);
      expect(r.size_bytes).toBeGreaterThan(0);
      expect(r.tri_count).toBe(tris);
      expect(r.bbox_mm).toEqual(bbox);
    });
  }

  it('maps .stp to step and lowercases extensions', () => {
    expect(formatOf('/x/a.STP')).toBe('step');
    expect(formatOf('/x/a.GLTF')).toBe('gltf');
  });
});
