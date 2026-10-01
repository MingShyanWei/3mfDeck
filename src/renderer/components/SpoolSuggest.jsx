// M11: recommend spool colours for this model (area-weighted k-means, SPEC 3.5d).
import { useMemo, useState } from 'react';
import { suggestSpools } from '../../core/spoolSuggest.mjs';
import { useSetSpools } from '../slots.js';

export default function SpoolSuggest({ colors }) {
  const setSpools = useSetSpools();
  const [result, setResult] = useState(null);
  const [applied, setApplied] = useState(false);
  // use the whole-file distribution when the panel shows a plate
  const suggestion = useMemo(() => (result ? result.results.find((r) => r.k === result.picked) : null), [result]);
  const run = (picked) => {
    setApplied(false);
    setResult({ ...suggestSpools(colors, 4), picked });
  };

  if (!colors.length || colors.length < 2) return null;
  const rec = result?.recommended;
  return (
    <div className="spool-suggest" data-testid="spool-suggest">
      <div className="row">
        <button data-testid="suggest-spools" onClick={() => run(result?.recommended?.k || 4)}>
          <i className="mdi mdi-palette" /> 建議捲色{result ? '' : '（依面積＋色準）'}
        </button>
        {result && (
          <span className="small muted" data-testid="suggest-recommended">
            建議 {rec.k} 捲即可達 {rec.mixPct}% 覆蓋率
          </span>
        )}
      </div>
      {result && (
        <div className="row wrap" data-testid="suggest-results">
          {result.results.map((r) => (
            <label key={r.k} className="radio small">
              <input type="radio" name="suggestk" data-testid={`suggest-k${r.k}`} checked={r.k === result.picked} onChange={() => run(r.k)} />
              {r.k} 捲：單捲 {r.singlePct}%／含混色 {r.mixPct}%
            </label>
          ))}
        </div>
      )}
      {suggestion && (
        <div className="suggest-spools" data-testid="suggest-spools-list">
          {suggestion.spools.map((s) => (
            <span key={s.slot} className="suggest-spool" data-testid={`suggest-swatch-${s.slot}`}>
              <span className="swatch" style={{ background: s.hex }} />
              <code>{s.hex}</code>
              <span className="small muted">{s.pct}%</span>
            </span>
          ))}
          <div className="small muted" data-testid="suggest-note">
            單捲直印覆蓋 {suggestion.singlePct}% 的面積；計入兩捲顏料混色後 {suggestion.mixPct}%。
            {suggestion.worst.length > 0 && ` 無法覆蓋：${suggestion.worst.map(([c, v]) => `${c}（ΔE ${v.deltaE}）`).join('、')}。`}
            建議為理想色碼，採購時請對照線材色卡選最近色。
          </div>
          <button
            data-testid="suggest-apply"
            disabled={applied}
            onClick={async () => {
              const hexes = suggestion.spools.map((s) => s.hex);
              await window.api.setSpools(hexes);
              setSpools(hexes);
              setApplied(true);
            }}
          >
            {applied ? '已套用 ✓' : '套用到捲色設定'}
          </button>
        </div>
      )}
    </div>
  );
}
