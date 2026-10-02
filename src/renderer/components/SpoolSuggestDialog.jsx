// M13/M14: spool-colour suggestion modal (SPEC 3.5d). Left rail: every option
// (ideal colours, own inventory, standard presets) with its coverage; right:
// the selected option enlarged — coverage ring, spool colours, gaps, apply.
import { useEffect, useMemo, useState } from 'react';
import { suggestSpools, STANDARD_PRESETS } from '../../core/spoolSuggest.mjs';
import { suggestFromInventory, coverageOf } from '../../core/inventorySuggest.mjs';
import { MUST_COVER_PCT } from '../../core/coverage.mjs';
import { useSetSpools, useSlots } from '../slots.js';
import { t, getLang } from '../../core/i18n/index.mjs';

// conic coverage ring: single-spool share, + mixing share, rest uncovered
const ring = (c) => `conic-gradient(var(--text) 0 ${c.singlePct}%, var(--accent) ${c.singlePct}% ${c.mixPct}%, var(--ring-track) ${c.mixPct}% 100%)`;
// M29: each spool's share is its usage split by mix recipe (coverage.mjs)
const shares = (cov, names = []) => cov.usage.map((u, i) => (names[i] ? `${names[i]} · ` : '') + t('suggest.share', { pct: u.pct }));
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

  const lang = getLang(); // preset names are translated getters, read when spread
  const presets = useMemo(() => STANDARD_PRESETS.map((p) => ({ ...p, cov: coverageOf(colors, p.hexes, { maxColours: 60 }) })), [colors, lang]); // eslint-disable-line react-hooks/exhaustive-deps
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
    stage = { kicker: ['mdi-palette-outline', t('suggest.presets')], title: preset.name, desc: t('suggest.presetDesc'), cov: preset.cov, hexes: preset.hexes, names: shares(preset.cov), worst: preset.cov.worst, key: `preset:${preset.id}` };
  } else if (sel === 'inventory') {
    stage = invPick && { kicker: ['mdi-library', t('suggest.fromInventory')], title: t('suggest.invTitle', { k: invPick.k }), desc: t('suggest.invDesc', { k: invPick.k }), cov: invPick, hexes: invPick.spools.map((s) => s.hex), names: shares({ usage: invPick.spools }, invPick.spools.map((s) => s.name)), worst: invPick.worst, key: `inventory:${invPick.k}`, results: inv.results, k: invK, rec: inv.recommended, setK: setInvK };
  } else {
    stage = idealPick && { kicker: ['mdi-star-four-points', t('suggest.ideal')], title: t('suggest.idealTitle', { k: idealPick.k }), desc: t('suggest.idealDesc'), cov: idealPick, hexes: idealPick.spools.map((s) => s.hex), names: shares({ usage: idealPick.spools }), worst: idealPick.worst, key: `ideal:${idealPick.k}`, results: ideal.results, k: idealK, rec: ideal.recommended, setK: setIdealK, flag: t('suggest.needBuy') };
  }
  const isSuggestion = stage && !preset;

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal spool-suggest" role="dialog" aria-label={t('suggest.title')} data-testid="spool-suggest">
        <nav className="sg-rail">
          <h2>{t('suggest.title')}</h2>
          <div className="sub">{t('suggest.sub', { n: colors.length })}</div>
          <h4><i className="mdi mdi-star-four-points" />{t('suggest.idealHead')}</h4>
          <Option testid="suggest-spools" on={sel === 'ideal'} rec cov={idealPick} hexes={idealPick?.spools.map((s) => s.hex)} title={t('suggest.idealTitle', { k: idealK })} onClick={() => setSel('ideal')} />
          <h4><i className="mdi mdi-library" />{t('suggest.fromInventory')}</h4>
          <Option testid="suggest-inventory" on={sel === 'inventory'} cov={invPick} hexes={invPick?.spools.map((s) => s.hex)} title={invPick ? t('suggest.invTitle', { k: invPick.k }) : t('suggest.myInventory')} onClick={() => setSel('inventory')}>
            {!inv && <div className="cov">{t('suggest.computing')}</div>}
            {inv?.empty && <div className="cov">{t('suggest.invEmpty')}</div>}
          </Option>
          <h4><i className="mdi mdi-palette-outline" />{t('suggest.presets')}</h4>
          <div data-testid="standard-presets">
            {presets.map((p) => (
              <Option key={p.id} testid={`preset-${p.id}`} on={sel === p.id} cov={p.cov} hexes={p.hexes} title={p.name} onClick={() => setSel(p.id)}>
                <div className="cov">{t('suggest.presetCov', { single: p.cov.singlePct, mix: p.cov.mixPct, bad: p.cov.unprintablePct })}</div>
              </Option>
            ))}
          </div>
          <div className="sg-now" title={t('suggest.nowTitle')}>
            <span className="mini-ring" style={{ background: ring(current) }} />
            <span>{t('suggest.now')} <b>{one(current.mixPct)}%</b><br />{t('suggest.nowSub')}</span>
          </div>
        </nav>
        <section className="sg-stage">
          <button className="icon x" onClick={onClose} title={t('common.close')}><i className="mdi mdi-close" /></button>
          {!stage && <div className="muted"><i className="mdi mdi-loading mdi-spin" /> {t('suggest.computing')}</div>}
          {stage && (
            <>
              <div className="sg-kicker"><i className={`mdi ${stage.kicker[0]}`} />{stage.kicker[1]}{stage.flag && <span className="sg-flag">{stage.flag}</span>}</div>
              <div className="sg-headline">{stage.title}</div>
              <div className="sg-desc">{stage.desc}</div>
              <div className="sg-show">
                <div className="sg-ring" style={{ background: ring(stage.cov) }}>
                  <div className="c"><b>{one(stage.cov.mixPct)}<small>%</small></b><span>{t('suggest.mixCov')}</span><em>{t('suggest.singleCov', { pct: one(stage.cov.singlePct) })}</em><em className={stage.cov.unprintablePct > 0 ? 'bad' : ''} data-testid={isSuggestion ? 'suggest-unprintable' : undefined}>{t('suggest.unprintableCov', { pct: stage.cov.unprintablePct })}</em></div>
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
                    <div className="sg-legend"><span><i style={{ background: 'var(--text)' }} />{t('suggest.legendSingle')}</span><span><i style={{ background: 'var(--accent)' }} />{t('suggest.legendMix')}</span><span><i style={{ background: 'var(--ring-track)' }} />{t('suggest.legendNone')}</span></div>
                  </div>
                  <div className="small muted" style={{ marginTop: 8 }}>
                    {t('suggest.vsNow', { diff: `${stage.cov.mixPct >= current.mixPct ? '+' : ''}${one(stage.cov.mixPct - current.mixPct)}` })}
                    {isSuggestion && stage.rec && (
                      <span data-testid="suggest-recommended" data-complete={stage.rec.complete ? '1' : '0'}>
                        {stage.rec.complete ? t('suggest.recommended', { k: stage.rec.k }) : t('suggest.recommendedIncomplete', { k: stage.rec.k, n: stage.rec.uncovered.length })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {isSuggestion && (
                <div className="sg-ks" data-testid="suggest-results">
                  {stage.results.map((r) => (
                    <label key={r.k} className={`sg-k${r.k === stage.k ? ' on' : ''}`}>
                      <input type="radio" name="suggestk" data-testid={`suggest-k${r.k}`} checked={r.k === stage.k} onChange={() => stage.setK(r.k)} />
                      <b>{t('suggest.kSpools', { k: r.k })}</b>
                      <span>{t('suggest.kCov', { single: r.singlePct, mix: r.mixPct, bad: r.unprintablePct })}</span>
                      {r.uncovered.length > 0 && <span className="miss" data-testid={`suggest-k${r.k}-missing`}>{t('suggest.kMissing', { n: r.uncovered.length })}</span>}
                      {r.k === stage.rec?.k && <span className="rec">{t('suggest.rec')}</span>}
                    </label>
                  ))}
                </div>
              )}
              <div className="sg-gap">
                <div className="h">{t('suggest.gaps', { n: stage.worst.length })}</div>
                {stage.worst.length > 0 && (
                  <div className="chips">
                    {stage.worst.slice(0, 8).map((w) => (
                      <span key={w.color} className="sg-chip"><span className="swatch" style={{ background: w.color }} /><span className="mono">{w.color}</span><span className="d">{w.pct}% · ΔE {w.deltaE}</span></span>
                    ))}
                  </div>
                )}
                {isSuggestion && (
                  <div className="note" data-testid="suggest-note">
                    {t('suggest.note', { single: stage.cov.singlePct, mix: stage.cov.mixPct, bad: stage.cov.unprintablePct, must: MUST_COVER_PCT })}
                    {sel === 'ideal' ? t('suggest.noteIdeal') : t('suggest.noteInv')}
                  </div>
                )}
              </div>
              {sel === 'inventory' && inv?.buy && (
                <div className="callout warn small" data-testid="suggest-buy">
                  <i className="mdi mdi-cart-plus" />
                  <span className="grow">
                    {t('suggest.buy')}
                    {inv.buy.spools.map((s) => (
                      <span key={s.hex} style={{ marginLeft: 8 }}>
                        <span className="swatch" style={{ background: s.hex }} /> <span className="mono">{s.hex}</span>{t('suggest.buyPct', { pct: s.pct })}
                      </span>
                    ))}
                  </span>
                </div>
              )}
            </>
          )}
          <div className="sg-foot">
            <span className="spacer" />
            <button data-testid="suggest-close" onClick={onClose}>{t('common.close')}</button>
            {preset ? (
              <button className="primary" data-testid={`preset-apply-${preset.id}`} disabled={applied === stage.key} onClick={() => apply(stage.key, preset.hexes)}>
                {applied === stage.key ? t('suggest.applied') : t('suggest.apply')}
              </button>
            ) : (
              <button className="primary" data-testid="suggest-apply" disabled={!stage || applied === stage.key} onClick={() => apply(stage.key, stage.hexes)}>
                {stage && applied === stage.key ? t('suggest.applied') : t('suggest.apply')}
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
