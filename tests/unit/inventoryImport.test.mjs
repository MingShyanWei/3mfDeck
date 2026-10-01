// M12b: import a 3dfilamentprofiles "My Spools" export.
// The JSON below is the user's real export (trimmed to the fields we read).
import { describe, it, expect } from 'vitest';
import { import3dfpInventory, FILAMENT_PROFILES_URL } from '../../src/core/inventoryImport.mjs';
import { DICTS, LANGS } from '../../src/core/i18n/index.mjs';

const realExport = JSON.stringify([
  { brand: 'Bambu Lab', material: 'PLA', material_type: 'Basic', color: 'Blue (10601)', rgb: '#0A2989', remaining_grams: 1000, filament_id: 14920 },
  { brand: 'Bambu Lab', material: 'PLA', material_type: 'Basic', color: 'Cyan (10603)', rgb: '#0086D6', td_value: 8, filament_id: 68 },
  { brand: 'Bambu Lab', material: 'PLA', material_type: 'Basic', color: 'Yellow (10400)', rgb: '#F4EE2A', filament_id: 42 },
]);

describe('import3dfpInventory', () => {
  it('reads the real 3dfilamentprofiles JSON export', () => {
    const { items, skipped } = import3dfpInventory(realExport);
    expect(items).toEqual([
      { name: 'Bambu Lab PLA Basic Blue (10601)', hex: '#0A2989' },
      { name: 'Bambu Lab PLA Basic Cyan (10603)', hex: '#0086D6' },
      { name: 'Bambu Lab PLA Basic Yellow (10400)', hex: '#F4EE2A' },
    ]);
    expect(skipped).toHaveLength(0);
  });

  it('skips entries without a valid rgb and dedupes repeated colours', () => {
    const r = import3dfpInventory(
      JSON.stringify([
        { brand: 'X', color: 'Red', rgb: '#FF0000' },
        { brand: 'Y', color: 'Red again', rgb: '#FF0000' },
        { brand: 'Z', color: 'No rgb here' },
      ]),
    );
    expect(r.items).toEqual([{ name: 'X Red', hex: '#FF0000' }]);
    expect(r.skipped).toHaveLength(1);
  });

  it('accepts the CSV export with the same columns', () => {
    const csv = 'brand,material,material_type,color,rgb\r\nBambu Lab,PLA,Basic,Cyan (10603),#0086D6\r\nSUNLU,PLA,,White,#FFFFFF\r\n';
    const { items } = import3dfpInventory(csv);
    expect(items).toEqual([
      { name: 'Bambu Lab PLA Basic Cyan (10603)', hex: '#0086D6' },
      { name: 'SUNLU PLA White', hex: '#FFFFFF' },
    ]);
  });

  it('throws on unrecognised content', () => {
    expect(() => import3dfpInventory(JSON.stringify({ nope: 1 }))).toThrow();
  });
});

describe('M26: export instructions in Settings', () => {
  it('the site is one fixed https URL', () => {
    expect(FILAMENT_PROFILES_URL).toBe('https://3dfilamentprofiles.com');
  });

  it('every language explains login → My Spools → Export (JSON or CSV) and names the import button by its source', () => {
    for (const lang of LANGS) {
      const d = DICTS[lang];
      expect([lang, d['settings.import3dfp']]).toEqual([lang, expect.stringContaining('3dfilamentprofiles')]);
      expect([lang, d['settings.inv3dfpStep1']]).toEqual([lang, expect.stringContaining('3dfilamentprofiles.com')]);
      expect([lang, d['settings.inv3dfpStep2']]).toEqual([lang, expect.stringContaining('My Spools')]);
      expect([lang, d['settings.inv3dfpStep3']]).toEqual([lang, expect.stringMatching(/Export.*JSON.*CSV/)]);
      // the last step quotes the import button exactly as it is labelled
      expect([lang, d['settings.inv3dfpStep4']]).toEqual([lang, expect.stringContaining(d['settings.import3dfp'])]);
    }
  });
});
