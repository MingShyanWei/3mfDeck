// Colour analysis panel (SPEC 3.5): distribution table + warnings.
import { useMemo } from 'react';
import { analyzeColors, mixedAverage } from '../../core/colorAnalysis.mjs';
import { U1_SLOTS, printPlan, recipeText, MIX_DELTA_E } from '../../core/filament.mjs';
import { FULL_SPECTRUM } from '../../core/fullSpectrum.mjs';

const ICONS = { dither: 'mdi-select-compare', 'few-colors': 'mdi-check-circle-outline', 'needs-mixing': 'mdi-palette-swatch-variant' };

function PrintCell({ plan }) {
  if (plan.mode === 'single') return <td className="small" data-testid="print-cell" data-mode="single">槽{plan.nearest.slot} {plan.nearest.name} 單捲</td>;
  return (
    <td className="small" data-testid="print-cell" data-mode={plan.mixable ? 'mix' : 'buy'}>
      <span className="swatch" style={{ background: plan.recipe.mixHex }} /> {recipeText(plan.recipe)}
      {plan.mixable ? (
        <span className="muted">（ΔE {plan.recipe.deltaE}）</span>
      ) : (
        <span className="badge badge-warn" title={`最佳混色仍差 ΔE ${plan.recipe.deltaE}`}>需買線材</span>
      )}
    </td>
  );
}

// Multi-plate files: `colors` is the selected plate's distribution, `totals`
// the whole file's (shown as an extra column), `title` names the plate.
// `mixing`: { vertexMixedPct } for Full Spectrum (dithered) files, else null.
export default function ColorAnalysis({ colors, totals = null, title = '', mixing = null }) {
  const warnings = useMemo(() => (colors.length ? analyzeColors(colors) : []), [colors]);
  const ditherColors = new Set(warnings.filter((w) => w.type === 'dither').flatMap((w) => w.colors));
  const max = Math.max(...colors.map((c) => c.pct), 0);
  const totalPct = new Map((totals || []).map((c) => [c.color, c.pct]));
  // How each colour prints on the U1 slots (not for Full Spectrum files: their colours ARE the spools)
  const plans = useMemo(() => (mixing ? null : new Map([...colors, ...(totals || [])].map((c) => [c.color, printPlan(c.color)]))), [colors, totals, mixing]);
  const needMix = plans ? colors.filter((c) => plans.get(c.color).mode === 'mix') : [];
  const unmixable = needMix.filter((c) => !plans.get(c.color).mixable);
  // Plate rows first, then colours used only on other plates (0 faces here)
  const rows = totals ? [...colors, ...totals.filter((t) => !colors.some((c) => c.color === t.color)).map((t) => ({ color: t.color, faces: 0, pct: 0 }))] : colors;

  return (
    <section className="color-analysis" data-testid="color-analysis">
      <h3 data-testid="color-analysis-title">
        顏色分析 · {title ? `${title}：` : ''}
        {colors.length} 色{totals ? ` ／ 全檔 ${totals.length} 色` : ''}
      </h3>
      {mixing && colors.length > 0 && (
        <div className="mixing" data-testid="mixing-stats">
          <div className="mixing-head">
            <i className="mdi mdi-blur" /> Full Spectrum 混色統計
          </div>
          <dl className="info">
            <dt>判定</dt>
            <dd data-testid="mixing-detect">
              抖色檔（頂點混色率 {mixing.vertexMixedPct}%，門檻 {FULL_SPECTRUM.minVertexMixedPct}%）
            </dd>
            <dt>參與捲</dt>
            <dd data-testid="mixing-spools">
              {colors.length} 捲
              {colors.length > U1_SLOTS.length ? `（超過 U1 的 ${U1_SLOTS.length} 個耗材槽）` : `（U1 ${U1_SLOTS.length} 槽可容納）`}
            </dd>
            <dt>估計整體色</dt>
            <dd data-testid="mixing-average">
              <span className="swatch" style={{ background: mixedAverage(colors) }} /> {mixedAverage(colors)}
              <span className="muted small">（估計值，實際以 Orca 渲染為準）</span>
            </dd>
          </dl>
        </div>
      )}
      {needMix.length > 0 && (
        <div className="callout warn" data-testid="needs-mix-summary">
          <i className="mdi mdi-palette-swatch-variant" />
          <span className="grow">
            {needMix.length} 色單捲印不出（與最近耗材槽 ΔE &gt; {MIX_DELTA_E}），需 CMYK 混色
            {unmixable.length > 0 ? `；其中 ${unmixable.length} 色 CMYK 也混不出，建議直接買該色線材` : ''}。配方見「列印方式」欄（估計值）。
          </span>
        </div>
      )}
      {totals && !colors.length && <div className="callout note"><i className="mdi mdi-information-outline" /><span className="grow">這個盤面沒有物件。</span></div>}
      {warnings.map((w, i) => (
        <div key={i} className={`callout ${w.type === 'few-colors' ? 'note' : 'warn'}`} data-testid={`warning-${w.type}`}>
          <i className={`mdi ${ICONS[w.type]}`} />
          <span className="grow">{w.message}</span>
        </div>
      ))}
      <table className="dist" data-testid="color-table">
        <thead>
          <tr>
            <th>顏色</th>
            <th className="num">面數</th>
            <th className="num">佔比</th>
            <th className="bar-col" />
            {plans && <th>列印方式</th>}
            {totals && <th className="num">全檔合計</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.color} data-testid="color-row" className={`${ditherColors.has(c.color) ? 'dither' : ''}${c.faces === 0 ? ' other-plate' : ''}`}>
              <td className="mono">
                <span className="swatch" style={{ background: c.color }} /> {c.color}
                {ditherColors.has(c.color) && <span className="badge badge-warn" title="疑似抖色配對">抖色？</span>}
              </td>
              <td className="num">{c.faces ? c.faces.toLocaleString('zh-TW') : '—'}</td>
              <td className="num">{c.faces ? `${c.pct}%` : '—'}</td>
              <td className="bar-col">
                {c.faces > 0 && <div className="bar" style={{ width: `${(c.pct / max) * 100}%`, background: c.color }} />}
              </td>
              {plans && <PrintCell plan={plans.get(c.color)} />}
              {totals && <td className="num total">{totalPct.get(c.color)}%</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
