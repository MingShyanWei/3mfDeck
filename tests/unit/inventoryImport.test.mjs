// M12b: import a 3dfilamentprofiles "My Spools" export.
// The JSON below is the user's real export (trimmed to the fields we read).
import { describe, it, expect } from 'vitest';
import { import3dfpInventory } from '../../src/core/inventoryImport.mjs';

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
