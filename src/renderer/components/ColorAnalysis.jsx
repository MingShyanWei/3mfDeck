// Colour analysis panel (SPEC 3.5): distribution table + warnings.
import { useMemo } from 'react';
import { analyzeColors } from '../../core/colorAnalysis.mjs';

const ICONS = { dither: 'mdi-select-compare', 'few-colors': 'mdi-check-circle-outline', 'needs-mixing': 'mdi-palette-swatch-variant' };

export default function ColorAnalysis({ colors }) {
  const warnings = useMemo(() => analyzeColors(colors), [colors]);
  const ditherColors = new Set(warnings.filter((w) => w.type === 'dither').flatMap((w) => w.colors));
  const max = Math.max(...colors.map((c) => c.pct));

  return (
    <section className="color-analysis" data-testid="color-analysis">
      <h3>顏色分析 · {colors.length} 色</h3>
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
          </tr>
        </thead>
        <tbody>
          {colors.map((c) => (
            <tr key={c.color} data-testid="color-row" className={ditherColors.has(c.color) ? 'dither' : ''}>
              <td className="mono">
                <span className="swatch" style={{ background: c.color }} /> {c.color}
                {ditherColors.has(c.color) && <span className="badge badge-warn" title="疑似抖色配對">抖色？</span>}
              </td>
              <td className="num">{c.faces.toLocaleString('zh-TW')}</td>
              <td className="num">{c.pct}%</td>
              <td className="bar-col">
                <div className="bar" style={{ width: `${(c.pct / max) * 100}%`, background: c.color }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
