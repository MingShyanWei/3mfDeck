// 「依檔名找回」: preview name matches for missing records, apply the confirmed ones.
import { useEffect, useState } from 'react';

const STATUS = { match: '找到', ambiguous: '多個候選', none: '找不到' };

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
      <div className="modal wide" role="dialog" aria-label="依檔名找回" data-testid="recover-dialog">
        <header>
          <h2><i className="mdi mdi-file-find-outline" /> 依檔名找回</h2>
          <div className="muted small">在目前根目錄（含子資料夾）尋找與遺失記錄同名、尚未被使用的檔案；確認後原地重新定位，不搬檔。</div>
        </header>
        {!rows && <p className="muted"><i className="mdi mdi-loading mdi-spin" /> 搜尋中…</p>}
        {rows && (
          <>
            <p className="small" data-testid="recover-summary">
              找到 {count('match')} 筆 · 多個候選 {count('ambiguous')} 筆（請逐筆重新定位）· 找不到 {count('none')} 筆
            </p>
            <table className="dist recover">
              <thead>
                <tr>
                  <th />
                  <th>記錄</th>
                  <th>原路徑</th>
                  <th>→ 找到的檔案</th>
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
                          {!r.sameSize && <span className="badge badge-warn" title="檔案大小與記錄不同，可能不是同一個檔案">大小不同</span>}
                        </>
                      ) : (
                        <span className="muted">{STATUS[r.status]}：{r.candidates.join('、')}</span>
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
            已重新定位 {result.done.length} 筆{result.errors.length ? `，失敗 ${result.errors.length} 筆：${result.errors.map((e) => e.error).join('；')}` : ''}
          </p>
        )}
        <footer>
          <span className="spacer" />
          <button onClick={onClose} data-testid="recover-close">{result ? '完成' : '取消'}</button>
          {!result && (
            <button className="primary" data-testid="recover-apply" disabled={!checked.size} onClick={apply}>
              套用 {checked.size} 筆
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
