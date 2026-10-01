// M9 exports for a 3MF: mapping report (CSV) and quantized 3MF (SPEC 3.5b).
import { useState } from 'react';
import { useSlots } from '../slots.js';

export default function ExportMapping({ model }) {
  const slots = useSlots();
  const [overThreshold, setOverThreshold] = useState('nearest');
  const [result, setResult] = useState(null);
  const run = async (fn) => {
    const r = await fn(model.id, { overThreshold });
    if (r) setResult(r);
  };
  return (
    <section className="export-mapping" data-testid="export-mapping">
      <h3>匯出映射（{slots.length} 捲：{slots.map((s) => s.hex).join(' ')}）</h3>
      <div className="row wrap">
        <label className="radio">
          <input type="radio" name="over" data-testid="over-nearest" checked={overThreshold === 'nearest'} onChange={() => setOverThreshold('nearest')} />
          超出門檻的顏色：量化到最近捲（報告標 ΔE）
        </label>
        <label className="radio">
          <input type="radio" name="over" data-testid="over-skip" checked={overThreshold === 'skip'} onChange={() => setOverThreshold('skip')} />
          跳過該面（不指定捲，沿用零件預設捲）
        </label>
      </div>
      <div className="row">
        <button data-testid="export-csv" onClick={() => run(window.api.exportCsv)}>
          <i className="mdi mdi-file-delimited-outline" /> 映射報告 CSV…
        </button>
        <button data-testid="export-quantized" onClick={() => run(window.api.exportQuantized)}>
          <i className="mdi mdi-printer-3d-nozzle-outline" /> 量化 3MF…
        </button>
      </div>
      {result?.error && <div className="callout danger small" data-testid="export-error">{result.error}</div>}
      {result?.path && (
        <div className="small ok" data-testid="export-result">
          已匯出：{result.path}
          {result.summary && `（${result.summary.filter((s) => s.slot === null).length ? `跳過 ${result.summary.filter((s) => s.slot === null).length} 色，` : ''}原檔未變動）`}
        </div>
      )}
      <div className="small muted">需混色／需購買的顏色在 3MF 中只能指定單一捲（Orca 逐面只記一捲），詳見報告。</div>
    </section>
  );
}
