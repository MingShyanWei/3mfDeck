// M17 (SPEC 3.5d): cabinet-level purchase suggestions. Colour names ranked by
// their share of the whole cabinet, matched against the filament inventory;
// a missing colour can be added to the inventory directly.
import { useEffect, useState } from 'react';
import { purchaseSuggestions } from '../../core/purchase.mjs';
import { swatchOf } from '../../core/colorNames.mjs';

export default function PurchaseDialog({ onClose }) {
  const [ranking, setRanking] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [error, setError] = useState('');
  const [added, setAdded] = useState(new Set()); // labels added in this session

  useEffect(() => {
    Promise.all([window.api.colorRanking(), window.api.getSettings()]).then(([r, s]) => {
      setRanking(r);
      setInventory(s.inventory || []);
    });
  }, []);

  const add = async (row) => {
    const s = await window.api.getSettings(); // latest saved inventory, not a stale copy
    const r = await window.api.setInventory([...(s.inventory || []), { name: `${row.label}（建議色）`, hex: row.hex }]);
    if (r.error) return setError(r.error);
    setError('');
    setInventory(r.inventory);
    setAdded(new Set([...added, row.label]));
  };

  const { ranking: rows, suggestions } = ranking ? purchaseSuggestions(ranking, inventory) : { ranking: [], suggestions: [] };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide purchase" role="dialog" aria-label="採購建議" data-testid="purchase-dialog">
        <header>
          <h2><i className="mdi mdi-cart-outline" /> 採購建議</h2>
          <div className="muted small">整個檔案櫃的顏色排行（每個有顏色的模型權重相同），對照線材庫：缺的色名依佔比排序，建議優先購買。</div>
        </header>
        {!ranking && <p className="muted"><i className="mdi mdi-loading mdi-spin" /> 統計中…</p>}
        {ranking && !rows.length && <p className="muted">檔案櫃裡還沒有含顏色資料的 3MF。</p>}
        {ranking && rows.length > 0 && (
          <>
            <div className="purchase-top" data-testid="purchase-suggestions">
              {suggestions.length ? (
                <>
                  <span className="muted small">建議優先購買：</span>
                  {suggestions.slice(0, 5).map((r) => (
                    <span key={r.label} className="ctag big"><i className="dot" style={{ background: r.hex }} />{r.label}</span>
                  ))}
                </>
              ) : (
                <span className="small ok"><i className="mdi mdi-check" /> 線材庫已涵蓋檔案櫃裡的主要顏色。</span>
              )}
            </div>
            <table className="dist purchase-table">
              <thead>
                <tr>
                  <th>色名</th>
                  <th className="num">佔比</th>
                  <th className="bar-col" />
                  <th className="num">模型數</th>
                  <th>線材庫</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} data-testid="purchase-row" data-label={r.label} data-suggest={r.suggest ? '1' : '0'}>
                    <td>
                      <span className="swatch" style={{ background: r.hex }} title={`代表色 ${r.hex}`} /> {r.label}
                      <span className="mono muted small"> {r.hex}</span>
                    </td>
                    <td className="num">{r.share}%</td>
                    <td className="bar-col"><div className="bar" style={{ width: `${(r.share / rows[0].share) * 100}%`, background: swatchOf(r.label) || r.hex }} /></td>
                    <td className="num">{r.models}</td>
                    <td className="small">
                      {r.owned.length ? (
                        <span className="ok"><i className="mdi mdi-check" /> {r.owned.map((f) => f.name || f.hex).join('、')}</span>
                      ) : r.suggest ? (
                        <span className="warn-text">建議購買</span>
                      ) : (
                        <span className="muted">—（非單一色）</span>
                      )}
                    </td>
                    <td>
                      {added.has(r.label) ? (
                        <span className="small ok" data-testid={`purchase-added-${r.label}`}>已加入 ✓</span>
                      ) : r.suggest && (
                        <button className="small" data-testid={`purchase-add-${r.label}`} onClick={() => add(r)}>
                          <i className="mdi mdi-plus" /> 加入線材庫
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {error && <p className="small warn-text" data-testid="purchase-error">{error}</p>}
        <footer>
          <span className="muted small">加入的線材以代表色碼登記，可到「設定 › 線材庫」改名或調整色碼。</span>
          <span className="spacer" />
          <button className="primary" data-testid="purchase-close" onClick={onClose}>完成</button>
        </footer>
      </div>
    </div>
  );
}
