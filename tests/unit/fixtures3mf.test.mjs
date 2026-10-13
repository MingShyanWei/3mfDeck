// Every 3MF this project generates must open in Snapmaker Orca: Orca
// (bbs_3mf.cpp) loads 3D/Objects/*.model only when 3D/_rels/3dmodel.model.rels
// lists them; otherwise p:path components point at nothing and the plate is empty.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { FIXTURES } from './helpers.mjs';

const DEMO = path.join(FIXTURES, '..', '..', 'demo', 'models');
const files = [FIXTURES, DEMO].flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.3mf')).map((f) => path.join(d, f)));

describe('generated 3MF packages', () => {
  it.each(files.map((f) => [path.relative(path.join(FIXTURES, '..', '..'), f), f]))('%s lists every p:path sub-model in 3D/_rels/3dmodel.model.rels', async (_name, file) => {
    const zip = await JSZip.loadAsync(fs.readFileSync(file));
    const root = await zip.file('3D/3dmodel.model').async('string');
    const used = [...new Set([...root.matchAll(/p:path="\/?([^"]+)"/g)].map((m) => m[1]))];
    const rels = (await zip.file('3D/_rels/3dmodel.model.rels')?.async('string')) ?? '';
    const listed = [...rels.matchAll(/Target="\/?([^"]+)"/g)].map((m) => m[1]);
    for (const p of used) {
      expect(zip.file(p), `${p} exists`).not.toBeNull();
      expect(listed, `${p} listed in the rels`).toContain(p);
    }
  });
});
