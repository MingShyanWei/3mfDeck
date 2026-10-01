// SPEC 3.1: embedded BambuStudio/Orca metadata prefills provenance on import.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { provenanceHint, parse3mf } from '../../src/core/parse/threemf.mjs';
import { openDb, getModel } from '../../src/core/db.mjs';
import { importPaths } from '../../src/core/importer.mjs';
import { tmpDir } from './helpers.mjs';

// User-provided reference document; copied, never moved.
const WINE = process.env.MF_WINE_3MF || path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/3mf/Wine-U1.3mf');
const haveWine = existsSync(WINE);

describe('provenanceHint', () => {
  it('MakerWorld via region-prefixed DesignModelId', () => {
    const h = provenanceHint({ Title: 'Wine Rack', Designer: '3Design', License: 'Standard Digital File License', Origin: 'original', DesignModelId: 'US4ac977a94622dc' });
    expect(h).toEqual({
      provenance_type: 'downloaded',
      platform: 'MakerWorld',
      notes: 'Title: Wine Rack\nDesigner: 3Design\nLicense: Standard Digital File License\nOrigin: original\nDesignModelId: US4ac977a94622dc',
    });
  });

  it('MakerWorld via DesignerUserId when DesignModelId is absent; includes slicer profile', () => {
    const h = provenanceHint({ Title: 'Dual Battery Dispenser', Designer: 'Matteo C.', DesignerUserId: '2275150077', Origin: 'original', ProfileTitle: '0.2mm layer' });
    expect(h.platform).toBe('MakerWorld');
    expect(h.provenance_type).toBe('downloaded');
    expect(h.notes).toBe('Title: Dual Battery Dispenser\nDesigner: Matteo C.\nOrigin: original\nProfile: 0.2mm layer');
  });

  it('numeric DesignModelId: downloaded, platform left for the user', () => {
    expect(provenanceHint({ Application: 'BambuStudio-2.3.6', DesignModelId: '31650' })).toEqual({
      provenance_type: 'downloaded',
      platform: null,
      notes: 'DesignModelId: 31650',
    });
  });

  it('no design metadata (e.g. Meshy export re-saved in BambuStudio): no hint', () => {
    expect(provenanceHint({ Application: 'BambuStudio-02.03.01.00' })).toBeNull();
    expect(provenanceHint({})).toBeNull();
  });
});

describe.skipIf(!haveWine)('Wine-U1.3mf (real file)', () => {
  it('parses metadata, 384 single-colour faces and the provenance hint', async () => {
    const r = await parse3mf(await fs.readFile(WINE));
    expect(r.metadata).toMatchObject({ Title: 'Wine Rack', Designer: '3Design', Origin: 'original', License: 'Standard Digital File License' });
    expect(r.tri_count).toBe(384);
    expect(r.color_count).toBe(1);
    expect(r.provenanceHint).toMatchObject({ provenance_type: 'downloaded', platform: 'MakerWorld' });
    expect(r.provenanceHint.notes).toContain('Title: Wine Rack');
  });

  it('importing it prefills the provenance fields in the DB', async () => {
    const base = await tmpDir();
    const src = path.join(base, 'in', 'Wine-U1.3mf');
    await fs.mkdir(path.dirname(src));
    await fs.copyFile(WINE, src);
    const db = openDb(':memory:');
    const { ids, errors } = await importPaths(db, path.join(base, 'lib'), [src]);
    expect(errors).toEqual([]);
    const m = getModel(db, ids[0]);
    expect(m.name).toBe('Wine-U1');
    expect(m.provenance_type).toBe('downloaded');
    expect(m.platform).toBe('MakerWorld');
    expect(m.url).toBeNull(); // left for the user to fill in
    expect(m.retrieved_at).toBe(new Date().toISOString().slice(0, 10));
    expect(m.notes).toContain('Designer: 3Design');
    expect(m.notes).toContain('Origin: original');
  });
});
