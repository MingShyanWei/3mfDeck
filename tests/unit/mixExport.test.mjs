// M10 (SPEC 3.5c): Full Spectrum mixed-filament export.
// Ground truth: the user's Filament+Swatch+Sample+Card-U1-量化4捲_mix.3mf
// (mixed_filament_definitions rows "1,3,1,1,13,0,g134,w56/8/36,m0,z0,xa0,xb0,d0,o0,u1,cm2")
// and the row grammar decoded in SamiSalah221/3mf-to-glb
// (docs/SNAPMAKER_FULL_SPECTRUM.md, verified against ratdoux/OrcaSlicer-FullSpectrum
// MixedFilament.{hpp,cpp}): virtual extruder id = baseCount + ordinal among
// enabled non-deleted rows; mix_b_percent is component B's share.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { mixFilamentHex } from '../../src/core/filamentMixer.mjs';
import { bestMix, mixPrintPlan, mixedFilamentDefinitions } from '../../src/core/mixExport.mjs';
import { exportQuantized3mf } from '../../src/core/exportMapping.mjs';
import { decodePaintColor } from '../../src/core/paintColor.mjs';
import { U1_SLOTS, nearestSlot, slotsFromColours } from '../../src/core/filament.mjs';
import { FIXTURES, tmpDir } from './helpers.mjs';

describe('FilamentMixer pigment model (ported, MIT)', () => {
  it('mixes like pigment, not RGB average: navy + yellow -> green', () => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(mixFilamentHex('#000080', '#FFFF00', 0.5).slice(i, i + 2), 16));
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });
  it('self-mix round-trips exactly', () => {
    expect(mixFilamentHex('#00C3FF', '#00C3FF', 0.3)).toBe('#00C3FF');
  });
});

describe('bestMix', () => {
  it('finds a two-spool pigment blend closer than any single spool for green', () => {
    const hex = '#4CAF50';
    const m = bestMix(hex, U1_SLOTS);
    expect(m.compA).not.toBe(m.compB);
    expect(m.mixB).toBeGreaterThanOrEqual(0);
    expect(m.mixB).toBeLessThanOrEqual(100);
    expect(m.deltaE).toBeLessThan(nearestSlot(hex, U1_SLOTS).deltaE);
  });
  it('yellow+black blends toward olive-green, matching the duck observation', () => {
    const m = bestMix('#AAAA00', U1_SLOTS);
    expect(m.mixHex).toMatch(/^#[0-9A-F]{6}$/);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(m.mixHex.slice(i, i + 2), 16));
    // olive: green channel dominant over blue, not a muddy average
    expect(g).toBeGreaterThan(b);
  });
});

describe('mixedFilamentDefinitions', () => {
  it('emits rows in the ground-truth grammar with 1-based u ids', () => {
    const defs = mixedFilamentDefinitions([{ compA: 1, compB: 3, mixB: 13 }, { compA: 3, compB: 4, mixB: 32 }]);
    const rows = defs.split(';');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toBe('1,3,1,1,13,0,g,w,m0,z0,xa0,xb0,d0,o0,u1,cm2');
    expect(rows[1]).toBe('3,4,1,1,32,0,g,w,m0,z0,xa0,xb0,d0,o0,u2,cm2');
  });
});

describe('mixPrintPlan', () => {
  it('keeps single-spool printing for close colours and mixes the far ones', () => {
    const near = mixPrintPlan('#FFFF00', U1_SLOTS); // pure yellow -> slot 3
    expect(near.mode).toBe('single');
    expect(near.extruder).toBe(3);
    const far = mixPrintPlan('#4CAF50', U1_SLOTS);
    expect(far.mode).toBe('mix');
    expect(far.mixable).toBe(true);
    expect(far.mix.compA).toBeDefined();
  });
});

describe('exportQuantized3mf with mixed filaments', () => {
  it('writes mixed_filament_definitions and points faces at virtual extruders', async () => {
    const dest = path.join(await tmpDir(), 'mixneeded-mix.3mf');
    const r = await exportQuantized3mf(path.join(FIXTURES, 'mixneeded.3mf'), dest, U1_SLOTS, { mix: true });
    // every colour beyond the single-spool threshold became a mix
    const mixSummaries = r.summary.filter((s) => s.mix);
    expect(mixSummaries.length).toBeGreaterThan(0);
    // summary slots for mixes are virtual ids (5..)
    for (const s of mixSummaries) expect(s.slot).toBeGreaterThanOrEqual(5);
    // definitions present, one row per distinct mix
    const zip = await JSZip.loadAsync(await fs.readFile(dest));
    const cfg = JSON.parse(await zip.file('Metadata/project_settings.config').async('string'));
    expect(cfg.mixed_filament_definitions.split(';')).toHaveLength(r.mixes.length);
    for (const row of cfg.mixed_filament_definitions.split(';')) {
      expect(row).toMatch(/^([1-4]),([1-4]),1,1,([0-9]|[1-9][0-9]|100),0,g,w,m0,z0,xa0,xb0,d0,o0,u\d+,cm2$/);
    }
    expect(cfg.mixed_filament_region_collapse).toBe('1');
    // paint_color states reference the virtual extruders
    const states = new Set();
    for (const name of Object.keys(zip.files)) {
      if (/\.model$/i.test(name)) {
        const xml = await zip.file(name).async('string');
        for (const m of xml.matchAll(/paint_color="([^"]+)"/g)) {
          for (const s of Object.keys(decodePaintColor(m[1]))) states.add(Number(s));
        }
      }
    }
    expect([...states].some((s) => s >= 5)).toBe(true);
  });

  // M15 regression: the user's 2-spool export (blue #0A2989 + yellow #F4EE2A) opened in Orca as a
  // single colour with an empty Color Mixing list. #61C680 is unmixable by the halftone model
  // (ΔE 19.1) but the pigment model blends it (yellow 61 % + blue 39 %, ΔE 8.3), and the
  // export must follow the pigment model: one Mix row, every face on virtual extruder 3.
  it('blue + yellow spools: #61C680 is exported as one Mix on virtual extruder 3', async () => {
    const dir = await tmpDir();
    const src = path.join(dir, 'green.3mf');
    const zip = await JSZip.loadAsync(await fs.readFile(path.join(FIXTURES, 'mixneeded.3mf')));
    const cfg = JSON.parse(await zip.file('Metadata/project_settings.config').async('string'));
    cfg.filament_colour = ['#61C680', '#61C680', '#61C680', '#61C680'];
    zip.file('Metadata/project_settings.config', JSON.stringify(cfg));
    await fs.writeFile(src, await zip.generateAsync({ type: 'nodebuffer' }));

    const slots = slotsFromColours(['#0A2989', '#F4EE2A']);
    const dest = path.join(dir, 'green-mix.3mf');
    const r = await exportQuantized3mf(src, dest, slots, { mix: true });
    expect(r.mixes).toHaveLength(1);
    expect(r.summary).toEqual([expect.objectContaining({ color: '#61C680', slot: 3, deltaE: 8.3 })]);

    const out = await JSZip.loadAsync(await fs.readFile(dest));
    const outCfg = JSON.parse(await out.file('Metadata/project_settings.config').async('string'));
    expect(outCfg.mixed_filament_definitions).toBe('2,1,1,1,39,0,g,w,m0,z0,xa0,xb0,d0,o0,u1,cm2');
    expect(outCfg.filament_colour).toEqual(['#0A2989FF', '#F4EE2AFF']);
    const states = new Set();
    const xml = await out.file('3D/Objects/object_1.model').async('string');
    for (const m of xml.matchAll(/paint_color="([^"]+)"/g)) for (const st of Object.keys(decodePaintColor(m[1]))) states.add(Number(st));
    expect([...states]).toEqual([3]);
  });

  it('falls back to the nearest spool when even the pigment blend exceeds the threshold (需購買)', async () => {
    // #947B71: best two-spool pigment blend stays ΔE > 15 on CMYK
    const plan = mixPrintPlan('#947B71', U1_SLOTS);
    expect(plan.mode).toBe('mix');
    expect(plan.mixable).toBe(false);
    // orange cannot be blended from cyan + black: quantized to the nearest of the 2 spools, no Mix
    const slots = slotsFromColours(['#00FFFF', '#000000']);
    expect(mixPrintPlan('#FF8C00', slots).mixable).toBe(false);
    const dest = path.join(await tmpDir(), 'unmixable.3mf');
    const r = await exportQuantized3mf(path.join(FIXTURES, 'mixneeded.3mf'), dest, slots, { mix: true });
    const row = r.summary.find((s) => s.color === '#FF8C00');
    expect(row.slot).toBeLessThanOrEqual(2);
    expect(row.mix).toBeUndefined();
  });

  it('without mix, keeps M9 behaviour: nearest spool only, no mixed keys', async () => {
    const dest = path.join(await tmpDir(), 'mixneeded-nomix.3mf');
    const r = await exportQuantized3mf(path.join(FIXTURES, 'mixneeded.3mf'), dest, U1_SLOTS, {});
    expect(r.mixes).toHaveLength(0);
    const zip = await JSZip.loadAsync(await fs.readFile(dest));
    const cfg = JSON.parse(await zip.file('Metadata/project_settings.config').async('string'));
    expect(cfg.mixed_filament_definitions).toBeUndefined();
  });
});
