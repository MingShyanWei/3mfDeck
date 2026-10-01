// M17 (SPEC 3.5d): cabinet-level purchase suggestions. Colour names ranked by
// their share of the whole cabinet, matched against the filament inventory;
// a missing colour can be added to the inventory directly.
import { useEffect, useState } from 'react';
import { purchaseSuggestions } from '../../core/purchase.mjs';
import { swatchOf, labelName } from '../../core/colorNames.mjs';
import { t } from '../../core/i18n/index.mjs';

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
    const r = await window.api.setInventory([...(s.inventory || []), { name: t('purchase.suggestedName', { color: labelName(row.label) }), hex: row.hex }]);
    if (r.error) return setError(r.error);
    setError('');
    setInventory(r.inventory);
    setAdded(new Set([...added, row.label]));
  };

  const { ranking: rows, suggestions } = ranking ? purchaseSuggestions(ranking, inventory) : { ranking: [], suggestions: [] };
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide purchase" role="dialog" aria-label={t('purchase.title')} data-testid="purchase-dialog">
        <header>
          <h2><i className="mdi mdi-cart-outline" /> {t('purchase.title')}</h2>
          <div className="muted small">{t('purchase.intro')}</div>
        </header>
        {!ranking && <p className="muted"><i className="mdi mdi-loading mdi-spin" /> {t('purchase.counting')}</p>}
        {ranking && !rows.length && <p className="muted">{t('purchase.empty')}</p>}
        {ranking && rows.length > 0 && (
          <>
            <div className="purchase-top" data-testid="purchase-suggestions">
              {suggestions.length ? (
                <>
                  <span className="muted small">{t('purchase.buyFirst')}</span>
                  {suggestions.slice(0, 5).map((r) => (
                    <span key={r.label} className="ctag big"><i className="dot" style={{ background: r.hex }} />{labelName(r.label)}</span>
                  ))}
                </>
              ) : (
                <span className="small ok"><i className="mdi mdi-check" /> {t('purchase.covered')}</span>
              )}
            </div>
            <table className="dist purchase-table">
              <thead>
                <tr>
                  <th>{t('purchase.colColor')}</th>
                  <th className="num">{t('csv.share')}</th>
                  <th className="bar-col" />
                  <th className="num">{t('purchase.colModels')}</th>
                  <th>{t('purchase.colInventory')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} data-testid="purchase-row" data-label={r.label} data-suggest={r.suggest ? '1' : '0'}>
                    <td>
                      <span className="swatch" style={{ background: r.hex }} title={t('purchase.repColor', { hex: r.hex })} /> {labelName(r.label)}
                      <span className="mono muted small"> {r.hex}</span>
                    </td>
                    <td className="num">{r.share}%</td>
                    <td className="bar-col"><div className="bar" style={{ width: `${(r.share / rows[0].share) * 100}%`, background: swatchOf(r.label) || r.hex }} /></td>
                    <td className="num">{r.models}</td>
                    <td className="small">
                      {r.owned.length ? (
                        <span className="ok"><i className="mdi mdi-check" /> {r.owned.map((f) => f.name || f.hex).join('、')}</span>
                      ) : r.suggest ? (
                        <span className="warn-text">{t('purchase.suggest')}</span>
                      ) : (
                        <span className="muted">{t('purchase.notSingle')}</span>
                      )}
                    </td>
                    <td>
                      {added.has(r.label) ? (
                        <span className="small ok" data-testid={`purchase-added-${r.label}`}>{t('purchase.added')}</span>
                      ) : r.suggest && (
                        <button className="small" data-testid={`purchase-add-${r.label}`} onClick={() => add(r)}>
                          <i className="mdi mdi-plus" /> {t('purchase.add')}
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
          <span className="muted small">{t('purchase.footer')}</span>
          <span className="spacer" />
          <button className="primary" data-testid="purchase-close" onClick={onClose}>{t('common.done')}</button>
        </footer>
      </div>
    </div>
  );
}
