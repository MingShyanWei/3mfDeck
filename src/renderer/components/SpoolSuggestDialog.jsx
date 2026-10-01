// M13/M14: spool-colour suggestion modal (SPEC 3.5d). Left rail: every option
// (ideal colours, own inventory, standard presets) with its coverage; right:
// the selected option enlarged — coverage ring, spool colours, gaps, apply.
import { useEffect, useMemo, useState } from 'react';
import { suggestSpools, STANDARD_PRESETS } from '../../core/spoolSuggest.mjs';
import { suggestFromInventory, coverageOf } from '../../core/inventorySuggest.mjs';
import { useSetSpools, useSlots } from '../slots.js';

// conic coverage ring: single-spool share, + mixing share, rest uncovered
const ring = (c) => `conic-gradient(var(--text) 0 ${c.singlePct}%, var(--accent) ${c.singlePct}% ${c.mixPct}%, var(--ring-track) ${c.mixPct}% 100%)`;
// suggestSpools' worst entries are [hex, {deltaE}], coverageOf's are {color, deltaE}
const gap = (w) => (Array.isArray(w) ? { color: w[0], deltaE: w[1]?.deltaE } : { color: w.color, deltaE: w.deltaE });
const one = (n) => Math.round(n * 10) / 10; // headline numbers: 1 decimal
const inkOn = (hex) => {
  const n = parseInt(hex.slice(1, 7), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.6 ? 'rgba(0,0,0,.75)' : 'rgba(255,255,255,.9)';
};

function Option({ on, rec, cov, hexes, title, testid, onClick, children }) {
  return (
    <button className={`sg-opt${on ? ' on' : ''}${rec ? ' rec' : ''}`} data-testid={testid} onClick={onClick}>
      <span className="mini-ring" style={{ background: cov ? ring(cov) : 'var(--ring-track)' }} />
      <span>
        <div className="t">{title}</div>
        {children}
        {hexes?.length > 0 && <div className="dots">{hexes.map((h, i) => <i key={`${h}-${i}`} style={{ background: h }} />)}</div>}
      </span>
      <span className="v">{cov ? <>{one(cov.mixPct)}<small>%</small></> : '—'}</span>
    </button>
  );
}

export default function SpoolSuggestDialog({ colors, onClose }) {
  const setSpools = useSetSpools();
  const slots = useSlots();
  const ideal = useMemo(() => suggestSpools(colors, 4), [colors]);
  const [idealK, setIdealK] = useState(ideal.recommended?.k ?? 1);
  const [inv, setInv] = useState(null); // suggestFromInventory() result, or { empty: true }
  const [invK, setInvK] = useState(null);
  const [sel, setSel] = useState('ideal'); // 'ideal' | 'inventory' | preset id
  const [applied, setApplied] = useState(null); // key of the applied option

  useEffect(() => {
    let cancelled = false;
    window.api.getSettings().then((s) => {
      if (cancelled) return;
      if (!s.inventory?.length) return setInv({ empty: true });
      const out = suggestFromInventory(colors, s.inventory, 4);
      setInv(out);
      setInvK(out.recommended?.k ?? out.results[out.results.length - 1]?.k);
    });
    return () => {
      cancelled = true;
    };
  }, [colors]);
  // empty inventory: fall back to ideal colours (4 spools)
  useEffect(() => {
    if (sel === 'inventory' && inv?.empty) {
      setSel('ideal');
      setIdealK(4);
    }
  }, [sel, inv]);

  const presets = useMemo(() => STANDARD_PRESETS.map((p) => ({ ...p, cov: coverageOf(colors, p.hexes, { maxColours: 60 }) })), [colors]);
  const current = useMemo(() => coverageOf(colors, slots.map((s) => s.hex), { maxColours: 60 }), [colors, slots]);
  const idealPick = ideal.results.find((r) => r.k === idealK);
  const invPick = inv?.results?.find((r) => r.k === invK) || null;
  const preset = presets.find((p) => p.id === sel);

  if (!colors.length) return null;

  const apply = async (key, hexes) => {
    await window.api.setSpools(hexes);
    setSpools(hexes);
    setApplied(key);
  };

  // what the stage shows
  let stage;
  if (preset) {
    stage = { kicker: ['mdi-palette-outline', '標準配置'], title: preset.name, desc: '不必想，直接裝；覆蓋率供比較。', cov: preset.cov, hexes: preset.hexes, names: preset.hexes.map(() => ''), worst: preset.cov.worst.map(gap), key: `preset:${preset.id}` };
  } else if (sel === 'inventory') {
    stage = invPick && { kicker: ['mdi-library', '從我的線材挑'], title: `線材庫 ${invPick.k} 捲`, desc: `從線材庫挑最合適的 ${invPick.k} 捲組合，裝上即可印。`, cov: invPick, hexes: invPick.spools.map((s) => s.hex), names: invPick.spools.map((s) => s.name || ''), worst: invPick.worst.map(gap), key: `inventory:${invPick.k}`, results: inv.results, k: invK, rec: inv.recommended, setK: setInvK };
  } else {
    stage = idealPick && { kicker: ['mdi-star-four-points', '理想建議'], title: `理想 ${idealPick.k} 捲`, desc: '依模型顏色算出的最佳捲色。色碼是理想值，採購時對照色卡選最近色。', cov: idealPick, hexes: idealPick.spools.map((s) => s.hex), names: idealPick.spools.map((s) => `佔 ${s.pct}%`), worst: idealPick.worst.map(gap), key: `ideal:${idealPick.k}`, results: ideal.results, k: idealK, rec: ideal.recommended, setK: setIdealK, flag: '需採購' };
  }
  const isSuggestion = stage && !preset;

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal spool-suggest" role="dialog" aria-label="建議捲色" data-testid="spool-suggest">
        <nav className="sg-rail">
          <h2>建議捲色</h2>
          <div className="sub">{colors.length} 色 · 依面積加權</div>
          <h4><i className="mdi mdi-star-four-points" />理想建議（需採購）</h4>
          <Option testid="suggest-spools" on={sel === 'ideal'} rec cov={idealPick} hexes={idealPick?.spools.map((s) => s.hex)} title={`理想 ${idealK} 捲`} onClick={() => setSel('ideal')} />
          <h4><i className="mdi mdi-library" />從我的線材挑</h4>
          <Option testid="suggest-inventory" on={sel === 'inventory'} cov={invPick} hexes={invPick?.spools.map((s) => s.hex)} title={invPick ? `線材庫 ${invPick.k} 捲` : '我的線材'} onClick={() => setSel('inventory')}>
            {!inv && <div className="cov">計算中…</div>}
            {inv?.empty && <div className="cov">線材庫是空的（設定頁登記）</div>}
          </Option>
          <h4><i className="mdi mdi-palette-outline" />標準配置</h4>
          <div data-testid="standard-presets">
            {presets.map((p) => (
              <Option key={p.id} testid={`preset-${p.id}`} on={sel === p.id} cov={p.cov} hexes={p.hexes} title={p.name} onClick={() => setSel(p.id)}>
                <div className="cov">覆蓋率：單捲 {p.cov.singlePct}%／含混色 {p.cov.mixPct}%</div>
              </Option>
            ))}
          </div>
          <div className="sg-now" title="設定頁目前的捲色">
            <span className="mini-ring" style={{ background: ring(current) }} />
            <span>目前捲色 <b>{one(current.mixPct)}%</b><br />設定頁現況 · 比較基準</span>
          </div>
        </nav>
        <section className="sg-stage">
          <button className="icon x" onClick={onClose} title="關閉"><i className="mdi mdi-close" /></button>
          {!stage && <div className="muted"><i className="mdi mdi-loading mdi-spin" /> 計算中…</div>}
          {stage && (
            <>
              <div className="sg-kicker"><i className={`mdi ${stage.kicker[0]}`} />{stage.kicker[1]}{stage.flag && <span className="sg-flag">{stage.flag}</span>}</div>
              <div className="sg-headline">{stage.title}</div>
              <div className="sg-desc">{stage.desc}</div>
              <div className="sg-show">
                <div className="sg-ring" style={{ background: ring(stage.cov) }}>
                  <div className="c"><b>{one(stage.cov.mixPct)}<small>%</small></b><span>含混色覆蓋</span><em>單捲直印 {one(stage.cov.singlePct)}%</em></div>
                </div>
                <div>
                  <div className="suggest-spools" data-testid={isSuggestion ? 'suggest-spools-list' : undefined}>
                    {stage.hexes.map((h, i) => (
                      <div key={`${h}-${i}`} className="suggest-spool" data-testid={isSuggestion ? `suggest-swatch-${i}` : undefined} title={stage.names[i]}>
                        <div className="disc" style={{ backgroundColor: h }}><span className="no" style={{ color: inkOn(h) }}>{i + 1}</span></div>
                        <code>{h}</code>
                        <div className="nm">{stage.names[i] || ' '}</div>
                      </div>
                    ))}
                  </div>
                  <div className="row" style={{ marginTop: 14, gap: 14 }}>
                    <div className="sg-legend"><span><i style={{ background: 'var(--text)' }} />單捲直印</span><span><i style={{ background: 'var(--accent)' }} />加上混色</span><span><i style={{ background: 'var(--ring-track)' }} />印不出</span></div>
                  </div>
                  <div className="small muted" style={{ marginTop: 8 }}>
                    比目前捲色 {stage.cov.mixPct >= current.mixPct ? '+' : ''}{one(stage.cov.mixPct - current.mixPct)} 個百分點
                    {isSuggestion && stage.rec && <span data-testid="suggest-recommended"> · 建議 {stage.rec.k} 捲即可達 {stage.rec.mixPct}% 覆蓋率</span>}
                  </div>
                </div>
              </div>
              {isSuggestion && (
                <div className="sg-ks" data-testid="suggest-results">
                  {stage.results.map((r) => (
                    <label key={r.k} className={`sg-k${r.k === stage.k ? ' on' : ''}`}>
                      <input type="radio" name="suggestk" data-testid={`suggest-k${r.k}`} checked={r.k === stage.k} onChange={() => stage.setK(r.k)} />
                      <b>{r.k} 捲：</b>
                      <span>單捲 {r.singlePct}%／含混色 {r.mixPct}%</span>
                      {r.k === stage.rec?.k && <span className="rec">建議</span>}
                    </label>
                  ))}
                </div>
              )}
              <div className="sg-gap">
                <div className="h">印不出的顏色 · {stage.worst.length} 色</div>
                {stage.worst.length > 0 && (
                  <div className="chips">
                    {stage.worst.slice(0, 8).map((w) => (
                      <span key={w.color} className="sg-chip"><span className="swatch" style={{ background: w.color }} /><span className="mono">{w.color}</span><span className="d">ΔE {w.deltaE}</span></span>
                    ))}
                  </div>
                )}
                {isSuggestion && (
                  <div className="note" data-testid="suggest-note">
                    單捲直印覆蓋 {stage.cov.singlePct}% 的面積；計入兩捲顏料混色後 {stage.cov.mixPct}%。
                    {sel === 'ideal' ? ' 建議為理想色碼，採購時請對照線材色卡選最近色。' : ' 從線材庫挑選，裝上即可印。'}
                  </div>
                )}
              </div>
              {sel === 'inventory' && inv?.buy && (
                <div className="callout warn small" data-testid="suggest-buy">
                  <i className="mdi mdi-cart-plus" />
                  <span className="grow">
                    線材庫蓋不到的顏色，建議採購：
                    {inv.buy.spools.map((s) => (
                      <span key={s.hex} style={{ marginLeft: 8 }}>
                        <span className="swatch" style={{ background: s.hex }} /> <span className="mono">{s.hex}</span>（{s.pct}%）
                      </span>
                    ))}
                  </span>
                </div>
              )}
            </>
          )}
          <div className="sg-foot">
            <span className="spacer" />
            <button data-testid="suggest-close" onClick={onClose}>關閉</button>
            {preset ? (
              <button className="primary" data-testid={`preset-apply-${preset.id}`} disabled={applied === stage.key} onClick={() => apply(stage.key, preset.hexes)}>
                {applied === stage.key ? '已套用 ✓' : '套用到捲色設定'}
              </button>
            ) : (
              <button className="primary" data-testid="suggest-apply" disabled={!stage || applied === stage.key} onClick={() => apply(stage.key, stage.hexes)}>
                {stage && applied === stage.key ? '已套用 ✓' : '套用到捲色設定'}
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
