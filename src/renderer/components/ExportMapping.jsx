// M9 exports for a 3MF: mapping report (CSV) and quantized 3MF (SPEC 3.5b).
import { useState } from 'react';
import { useSlots } from '../slots.js';

export default function ExportMapping({ model }) {
  const slots = useSlots();
  const [over, setOver] = useState('mix'); // 'nearest' | 'skip' | 'mix' (M10)
  const [result, setResult] = useState(null);
  const run = async (fn) => {
    const r = await fn(model.id, { overThreshold: over === 'skip' ? 'skip' : 'nearest', mix: over === 'mix' });
    if (r) setResult(r);
  };
  return (
    <section className="export-mapping" data-testid="export-mapping">
      <h3>匯出映射（{slots.length} 捲：{slots.map((s) => s.hex).join(' ')}）</h3>
      <div className="row wrap">
        <label className="radio">
          <input type="radio" name="over" data-testid="over-mix" checked={over === 'mix'} onChange={() => setOver('mix')} />
          超出門檻的顏色：寫成混合耗材 Mix（Full Spectrum，單捲印不出的顏色用兩捲混）
        </label>
        <label className="radio">
          <input type="radio" name="over" data-testid="over-nearest" checked={over === 'nearest'} onChange={() => setOver('nearest')} />
          量化到最近捲（報告標 ΔE）
        </label>
        <label className="radio">
          <input type="radio" name="over" data-testid="over-skip" checked={over === 'skip'} onChange={() => setOver('skip')} />
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
          {result.summary && `（${result.summary.filter((s) => s.slot === null).length ? `跳過 ${result.summary.filter((s) => s.slot === null).length} 色，` : ''}${result.mixes ? `Mix ${result.mixes} 組，` : ''}原檔未變動）`}
        </div>
      )}
      <div className="small muted">Mix＝兩捲以 FilamentMixer 顏料模型算出的混合色（Orca 原生 Full Spectrum 混合耗材）；配方僅供參考，不回寫原檔。</div>
    </section>
  );
}
