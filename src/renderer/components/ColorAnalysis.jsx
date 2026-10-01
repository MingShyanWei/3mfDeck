// Colour analysis panel (SPEC 3.5): distribution table + warnings.
import { useMemo } from 'react';
import { analyzeColors, mixedAverage } from '../../core/colorAnalysis.mjs';
import { printPlan, recipeText, MIX_DELTA_E, slotName } from '../../core/filament.mjs';
import { useSlots } from '../slots.js';
import { FULL_SPECTRUM } from '../../core/fullSpectrum.mjs';
import SpoolSuggestDialog from './SpoolSuggestDialog.jsx';
import { useState } from 'react';
import { t, getLang, locale } from '../../core/i18n/index.mjs';

const ICONS = { dither: 'mdi-select-compare', 'few-colors': 'mdi-check-circle-outline', 'needs-mixing': 'mdi-palette-swatch-variant' };

function PrintCell({ plan }) {
  if (plan.mode === 'single') return <td className="small" data-testid="print-cell" data-mode="single">{t('analysis.single', { slot: plan.nearest.name ? `${t('slot.n', { n: plan.nearest.slot })} ${plan.nearest.name}` : slotName(plan.nearest) })}</td>;
  return (
    <td className="small" data-testid="print-cell" data-mode={plan.mixable ? 'mix' : 'buy'}>
      <span className="swatch" style={{ background: plan.recipe.mixHex }} /> {recipeText(plan.recipe)}
      {plan.mixable ? (
        <span className="muted">（ΔE {plan.recipe.deltaE}）</span>
      ) : (
        <span className="badge badge-warn" title={t('analysis.buyTitle', { dE: plan.recipe.deltaE })}>{t('analysis.buy')}</span>
      )}
    </td>
  );
}

// Multi-plate files: `colors` is the selected plate's distribution, `totals`
// the whole file's (shown as an extra column), `title` names the plate.
// `mixing`: { vertexMixedPct } for Full Spectrum (dithered) files, else null.
export default function ColorAnalysis({ colors, totals = null, title = '', mixing = null }) {
  const slots = useSlots();
  const [suggestOpen, setSuggestOpen] = useState(false);
  const lang = getLang(); // warning texts are written in the current language
  const warnings = useMemo(() => (colors.length ? analyzeColors(colors) : []), [colors, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const ditherColors = new Set(warnings.filter((w) => w.type === 'dither').flatMap((w) => w.colors));
  const max = Math.max(...colors.map((c) => c.pct), 0);
  const totalPct = new Map((totals || []).map((c) => [c.color, c.pct]));
  // How each colour prints on the U1 slots (not for Full Spectrum files: their colours ARE the spools)
  const plans = useMemo(() => (mixing ? null : new Map([...colors, ...(totals || [])].map((c) => [c.color, printPlan(c.color, slots)]))), [colors, totals, mixing, slots]);
  const needMix = plans ? colors.filter((c) => plans.get(c.color).mode === 'mix') : [];
  const unmixable = needMix.filter((c) => !plans.get(c.color).mixable);
  // Plate rows first, then colours used only on other plates (0 faces here)
  const rows = totals ? [...colors, ...totals.filter((x) => !colors.some((c) => c.color === x.color)).map((x) => ({ color: x.color, faces: 0, pct: 0 }))] : colors;

  return (
    <section className="color-analysis" data-testid="color-analysis">
      <h3 data-testid="color-analysis-title">
        {t('analysis.title', { plate: title ? t('analysis.titlePlate', { plate: title }) : '', n: colors.length, total: totals ? t('analysis.titleTotal', { n: totals.length }) : '' })}
        {!mixing && colors.length >= 1 && (
          <button className="small right" data-testid="suggest-open" onClick={() => setSuggestOpen(true)}>
            <i className="mdi mdi-palette" /> {t('analysis.suggest')}
          </button>
        )}
      </h3>
      {colors.length > 0 && (
        <>
          <div className="spectrum" title={t('analysis.spectrumTitle')}>
            {colors.map((c) => <i key={c.color} style={{ width: `${c.pct}%`, background: c.color }} title={`${c.color} ${c.pct}%`} />)}
          </div>
          <div className="spectrum-cap"><span>{t('analysis.spectrum')}</span><span>{t('detail.faces', { n: colors.reduce((n, c) => n + c.faces, 0).toLocaleString(locale()) })}</span></div>
        </>
      )}
      {mixing && colors.length > 0 && (
        <div className="mixing" data-testid="mixing-stats">
          <div className="mixing-head">
            <i className="mdi mdi-blur" /> {t('fs.title')}
          </div>
          <dl className="info">
            <dt>{t('fs.verdict')}</dt>
            <dd data-testid="mixing-detect">
              {t('fs.dithered', { pct: mixing.vertexMixedPct, min: FULL_SPECTRUM.minVertexMixedPct })}
            </dd>
            <dt>{t('fs.spools')}</dt>
            <dd data-testid="mixing-spools">
              {t('fs.spoolCount', { n: colors.length })}
              {colors.length > slots.length ? t('fs.overSlots', { n: slots.length }) : t('fs.fits', { n: slots.length })}
            </dd>
            <dt>{t('fs.average')}</dt>
            <dd data-testid="mixing-average">
              <span className="swatch" style={{ background: mixedAverage(colors) }} /> {mixedAverage(colors)}
              <span className="muted small">{t('fs.estimateNote')}</span>
            </dd>
          </dl>
        </div>
      )}
      {needMix.length > 0 && (
        <div className="callout warn" data-testid="needs-mix-summary">
          <i className="mdi mdi-palette-swatch-variant" />
          <span className="grow">
            {t('analysis.needMix', { n: needMix.length, dE: MIX_DELTA_E, unmixable: unmixable.length > 0 ? t('analysis.unmixable', { n: unmixable.length }) : '' })}
          </span>
        </div>
      )}
      {totals && !colors.length && <div className="callout note"><i className="mdi mdi-information-outline" /><span className="grow">{t('analysis.emptyPlate')}</span></div>}
      {warnings.map((w, i) => (
        <div key={i} className={`callout ${w.type === 'few-colors' ? 'note' : 'warn'}`} data-testid={`warning-${w.type}`}>
          <i className={`mdi ${ICONS[w.type]}`} />
          <span className="grow">{w.message}</span>
        </div>
      ))}
      <table className="dist" data-testid="color-table">
        <thead>
          <tr>
            <th>{t('analysis.colColor')}</th>
            <th className="num">{t('csv.faces')}</th>
            <th className="num">{t('csv.share')}</th>
            <th className="bar-col" />
            {plans && <th>{t('analysis.colPrint')}</th>}
            {totals && <th className="num">{t('analysis.colTotal')}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.color} data-testid="color-row" className={`${ditherColors.has(c.color) ? 'dither' : ''}${c.faces === 0 ? ' other-plate' : ''}`}>
              <td className="mono">
                <span className="swatch" style={{ background: c.color }} /> {c.color}
                {ditherColors.has(c.color) && <span className="badge badge-warn" title={t('analysis.ditherTitle')}>{t('analysis.ditherBadge')}</span>}
              </td>
              <td className="num">{c.faces ? c.faces.toLocaleString(locale()) : '—'}</td>
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
      {!mixing && suggestOpen && <SpoolSuggestDialog colors={totals || colors} onClose={() => setSuggestOpen(false)} />}
    </section>
  );
}
