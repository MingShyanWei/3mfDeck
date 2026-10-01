// M13: spool-colour suggestion in its own modal (SPEC 3.5d) — the colour
// analysis panel stays clean; this window holds the inventory/ideal pickers.
import { useMemo, useState } from 'react';
import { suggestSpools, STANDARD_PRESETS } from '../../core/spoolSuggest.mjs';
import { suggestFromInventory, coverageOf } from '../../core/inventorySuggest.mjs';
import { useSetSpools } from '../slots.js';

export default function SpoolSuggestDialog({ colors, onClose }) {
  const setSpools = useSetSpools();
  const [ideal, setIdeal] = useState(null); // { ...suggestSpools(), picked }
  const [inv, setInv] = useState(null); // { ...suggestFromInventory(), picked }
  const [mode, setMode] = useState(null); // 'inventory' | 'ideal'
  const [applied, setApplied] = useState(false);

  const runIdeal = (picked) => {
    setApplied(false);
    setMode('ideal');
    setIdeal({ ...suggestSpools(colors, 4), picked });
  };
  const runInventory = async (picked) => {
    setApplied(false);
    const s = await window.api.getSettings();
    if (!s.inventory?.length) {
      // empty inventory: fall back to ideal colours
      setMode('ideal');
      setIdeal({ ...suggestSpools(colors, 4), picked: 4 });
      return;
    }
    const out = suggestFromInventory(colors, s.inventory, 4);
    // clamp picked to the ks the inventory can actually fill (2 filaments -> k 1..2)
    const ks = out.results.map((r) => r.k);
    const use = ks.includes(picked) ? picked : out.recommended?.k ?? ks[ks.length - 1];
    setMode('inventory');
    setInv({ ...out, picked: use });
  };

  const suggestion = useMemo(() => {
    if (mode === 'inventory') return inv?.results?.find((r) => r.k === inv.picked) || null;
    return ideal?.results?.find((r) => r.k === ideal.picked) || null;
  }, [mode, inv, ideal]);
  const rec = mode === 'inventory' ? inv?.recommended : ideal?.recommended;
  const hexes = suggestion?.spools.map((s) => s.hex) || [];

  if (!colors.length) return null; // single-colour models still get a 1-spool suggestion

  const [appliedPreset, setAppliedPreset] = useState(null);
  const presetCov = STANDARD_PRESETS.map((p) => ({ ...p, cov: coverageOf(colors, p.hexes, { maxColours: 60 }) }));
  const applyPreset = async (p) => {
    await window.api.setSpools(p.hexes);
    setSpools(p.hexes);
    setAppliedPreset(p.id);
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal spool-suggest" role="dialog" aria-label="建議捲色" data-testid="spool-suggest">
      <div className="row">
        <button data-testid="suggest-inventory" onClick={() => runInventory(4)}>
          <i className="mdi mdi-library" /> 從我的線材挑
        </button>
        <button data-testid="suggest-spools" onClick={() => runIdeal(ideal?.recommended?.k || 4)}>
          <i className="mdi mdi-palette" /> 建議捲色（理想色碼）
        </button>
      </div>
      <div className="presets" data-testid="standard-presets">
        <span className="small muted">標準配置覆蓋率：</span>
        {presetCov.map((p) => (
          <span key={p.id} className="preset small" data-testid={`preset-${p.id}`}>
            {p.hexes.map((h) => (
              <span key={h} className="swatch" style={{ background: h }} title={h} />
            ))}
            <span className="small muted">{p.name}：單捲 {p.cov.singlePct}%／含混色 {p.cov.mixPct}%</span>
            <button className="small" data-testid={`preset-apply-${p.id}`} onClick={() => applyPreset(p)}>
              {appliedPreset === p.id ? '已套用 ✓' : '套用'}
            </button>
          </span>
        ))}
      </div>
      {mode && rec && (
        <span className="small muted" data-testid="suggest-recommended">
          建議 {rec.k} 捲即可達 {rec.mixPct}% 覆蓋率
        </span>
      )}
      {mode && (mode === 'inventory' ? inv : ideal)?.results?.length > 0 && (
        <div className="row wrap" data-testid="suggest-results">
          {(mode === 'inventory' ? inv.results : ideal.results).map((r) => (
            <label key={r.k} className="radio small">
              <input
                type="radio"
                name="suggestk"
                data-testid={`suggest-k${r.k}`}
                checked={r.k === (mode === 'inventory' ? inv.picked : ideal.picked)}
                onChange={() => (mode === 'inventory' ? runInventory(r.k) : runIdeal(r.k))}
              />
              {r.k} 捲：單捲 {r.singlePct}%／含混色 {r.mixPct}%
            </label>
          ))}
        </div>
      )}
      {mode === 'inventory' && inv?.buy && (
        <div className="callout warn small" data-testid="suggest-buy">
          <i className="mdi mdi-cart-plus" />
          <span className="grow">
            線材庫蓋不到的顏色，建議採購：
            {inv.buy.spools.map((s) => (
              <span key={s.hex} style={{ marginLeft: 8 }}>
                <span className="swatch" style={{ background: s.hex }} />
                <code>{s.hex}</code>（{s.pct}%）
              </span>
            ))}
          </span>
        </div>
      )}
      {suggestion && (
        <div className="suggest-spools" data-testid="suggest-spools-list">
          {suggestion.spools.map((s, i) => (
            <span key={`${s.hex}-${i}`} className="suggest-spool" data-testid={`suggest-swatch-${i}`}>
              <span className="swatch" style={{ background: s.hex }} />
              <code>{s.hex}</code>
              {mode === 'inventory' && s.name ? <span className="small muted">{s.name}</span> : <span className="small muted">{s.pct}%</span>}
            </span>
          ))}
          <div className="small muted" data-testid="suggest-note">
            單捲直印覆蓋 {suggestion.singlePct}% 的面積；計入兩捲顏料混色後 {suggestion.mixPct}%。
            {suggestion.worst.length > 0 && ` 無法覆蓋：${suggestion.worst.map((w) => `${w.color || w[0]}（ΔE ${(w.deltaE ?? w[1]?.deltaE)}）`).join('、')}。`}
            {mode === 'ideal' ? ' 建議為理想色碼，採購時請對照線材色卡選最近色。' : ' 從線材庫挑選，裝上即可印。'}
          </div>
          <button
            data-testid="suggest-apply"
            disabled={applied || !hexes.length}
            onClick={async () => {
              await window.api.setSpools(hexes);
              setSpools(hexes);
              setApplied(true);
            }}
          >
            {applied ? '已套用 ✓' : '套用到捲色設定'}
          </button>
        </div>
      )}
        <footer>
          <span className="spacer" />
          <button data-testid="suggest-close" onClick={onClose}>關閉</button>
        </footer>
      </div>
    </div>
  );
}
