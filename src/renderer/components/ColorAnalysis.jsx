// Colour analysis panel (SPEC 3.5): distribution table + warnings.
import { useMemo } from 'react';
import { analyzeColors } from '../../core/colorAnalysis.mjs';

const ICONS = { dither: 'mdi-select-compare', 'few-colors': 'mdi-check-circle-outline', 'needs-mixing': 'mdi-palette-swatch-variant' };

// Multi-plate files: `colors` is the selected plate's distribution, `totals`
// the whole file's (shown as an extra column), `title` names the plate.
export default function ColorAnalysis({ colors, totals = null, title = '' }) {
  const warnings = useMemo(() => (colors.length ? analyzeColors(colors) : []), [colors]);
  const ditherColors = new Set(warnings.filter((w) => w.type === 'dither').flatMap((w) => w.colors));
  const max = Math.max(...colors.map((c) => c.pct), 0);
  const totalPct = new Map((totals || []).map((c) => [c.color, c.pct]));
  // Plate rows first, then colours used only on other plates (0 faces here)
  const rows = totals ? [...colors, ...totals.filter((t) => !colors.some((c) => c.color === t.color)).map((t) => ({ color: t.color, faces: 0, pct: 0 }))] : colors;

  return (
    <section className="color-analysis" data-testid="color-analysis">
      <h3 data-testid="color-analysis-title">
        顏色分析 · {title ? `${title}：` : ''}
        {colors.length} 色{totals ? ` ／ 全檔 ${totals.length} 色` : ''}
      </h3>
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
              {totals && <td className="num total">{totalPct.get(c.color)}%</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
