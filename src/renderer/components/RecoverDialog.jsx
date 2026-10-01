// 「依檔名找回」: preview name matches for missing records, apply the confirmed ones.
import { useEffect, useState } from 'react';
import { t } from '../../core/i18n/index.mjs';

const STATUS = { match: 'recover.match', ambiguous: 'recover.ambiguous', none: 'recover.none' };

export default function RecoverDialog({ onClose, onApplied }) {
  const [rows, setRows] = useState(null);
  const [checked, setChecked] = useState(new Set());
  const [result, setResult] = useState(null);

  useEffect(() => {
    window.api.findByFilename().then((r) => {
      setRows(r);
      // Pre-select unique matches whose size matches what the record remembers
      setChecked(new Set(r.filter((x) => x.status === 'match' && x.sameSize).map((x) => x.id)));
    });
  }, []);

  const toggle = (id) => {
    const next = new Set(checked);
    next.has(id) ? next.delete(id) : next.add(id);
    setChecked(next);
  };
  const apply = async () => {
    const pairs = rows.filter((r) => checked.has(r.id)).map((r) => ({ id: r.id, relPath: r.match }));
    setResult(await window.api.applyRelocations(pairs));
    onApplied();
  };

  const count = (s) => rows?.filter((r) => r.status === s).length ?? 0;
  return (
    <div className="modal-backdrop">
      <div className="modal wide" role="dialog" aria-label={t('recover.title')} data-testid="recover-dialog">
        <header>
          <h2><i className="mdi mdi-file-find-outline" /> {t('recover.title')}</h2>
          <div className="muted small">{t('recover.intro')}</div>
        </header>
        {!rows && <p className="muted"><i className="mdi mdi-loading mdi-spin" /> {t('recover.searching')}</p>}
        {rows && (
          <>
            <p className="small" data-testid="recover-summary">
              {t('recover.summary', { match: count('match'), ambiguous: count('ambiguous'), none: count('none') })}
            </p>
            <table className="dist recover">
              <thead>
                <tr>
                  <th />
                  <th>{t('recover.record')}</th>
                  <th>{t('recover.oldPath')}</th>
                  <th>{t('recover.found')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.filter((r) => r.status !== 'none').map((r) => (
                  <tr key={r.id} data-testid="recover-row" data-status={r.status} data-name={r.name}>
                    <td>
                      {r.status === 'match' && !result && (
                        <input type="checkbox" data-testid="recover-check" checked={checked.has(r.id)} onChange={() => toggle(r.id)} />
                      )}
                    </td>
                    <td>{r.name}</td>
                    <td className="mono small">{r.relPath}</td>
                    <td className="mono small">
                      {r.status === 'match' ? (
                        <>
                          {r.match}
                          {!r.sameSize && <span className="badge badge-warn" title={t('recover.sizeDiffTitle')}>{t('recover.sizeDiff')}</span>}
                        </>
                      ) : (
                        <span className="muted">{t('recover.candidates', { status: t(STATUS[r.status]), list: r.candidates.join(t('common.listSep')) })}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {result && (
          <p className="small ok" data-testid="recover-result">
            {t('recover.done', { n: result.done.length })}{result.errors.length ? t('recover.failed', { n: result.errors.length, errors: result.errors.map((e) => e.error).join(t('common.errorSep')) }) : ''}
          </p>
        )}
        <footer>
          <span className="spacer" />
          <button onClick={onClose} data-testid="recover-close">{result ? t('common.done') : t('dlg.cancel')}</button>
          {!result && (
            <button className="primary" data-testid="recover-apply" disabled={!checked.size} onClick={apply}>
              {t('recover.apply', { n: checked.size })}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
