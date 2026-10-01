// Interactive 3D preview (SPEC 3.4): OrbitControls + shading modes.
// Full Spectrum (dithered) files get a mixed-colour estimate mode, and their
// filament summary lists the file's own spools instead of CMYK quantization.
import { useEffect, useMemo, useRef, useState } from 'react';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Viewer } from '../viewer/Viewer.js';
import { buildModel } from '../viewer/buildModel.js';
import { mapToSlots, MIX_DELTA_E, recipeText } from '../../core/filament.mjs';
import { useSlots, isDefaultSlots } from '../slots.js';
import { t, getLang } from '../../core/i18n/index.mjs';

const MODE_LABELS = [
  ['original', 'viewer.original', 'mdi-palette-outline'],
  ['filament', 'viewer.filament', 'mdi-printer-3d-nozzle-outline'],
  ['estimate', 'viewer.estimate', 'mdi-blur'],
];

// `plate`: show only that slicer plate (multi-plate 3MF); `colors`: the
// distribution the filament-mapping summary is based on (plate or file).
export default function ModelViewer({ model, plate = null, colors = model.colors }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const viewerRef = useRef(null);
  const [status, setStatus] = useState('loading'); // loading | ready | unsupported | error
  const [error, setError] = useState('');
  const [hasPaint, setHasPaint] = useState(false);
  const [mode, setMode] = useState('original');
  const [loaded, setLoaded] = useState(''); // "<id>:<plate>" the viewer currently shows
  const slots = useSlots();
  const slotsKey = slots.map((s) => s.hex).join();

  // One viewer (WebGL context) for the lifetime of the panel
  useEffect(() => {
    // preserveDrawingBuffer lets the smoke test read rendered pixels
    const viewer = new Viewer(canvasRef.current, { preserveDrawingBuffer: true });
    const controls = new OrbitControls(viewer.camera, canvasRef.current);
    controls.addEventListener('change', () => viewer.render());
    viewer.controls = controls;
    viewerRef.current = viewer;
    const ro = new ResizeObserver(() => {
      const { clientWidth: w, clientHeight: h } = wrapRef.current;
      if (!w || !h) return;
      viewer.setSize(w, h);
      viewer.render();
    });
    ro.observe(wrapRef.current);
    return () => {
      ro.disconnect();
      controls.dispose();
      viewer.dispose();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const viewer = viewerRef.current;
    viewer.clear();
    viewer.render();
    setStatus('loading');
    setMode('original');
    (async () => {
      try {
        // performance.measure entries let tests break down where load time goes
        performance.mark('preview:start');
        const payload = await window.api.preview(model.id, plate);
        performance.measure('preview:ipc', 'preview:start');
        if (cancelled) return;
        setLoaded(`${model.id}:${plate ?? ''}`);
        if (payload.missing) {
          setError(t('viewer.missing'));
          return setStatus('error');
        }
        if (payload.unsupported) return setStatus('unsupported');
        if (payload.format === '3mf' && !payload.indices.length) return setStatus('empty');
        performance.mark('preview:build');
        const built = await buildModel(payload, { estimate: model.full_spectrum, slots });
        performance.measure('preview:buildModel', 'preview:build');
        if (cancelled) return;
        performance.mark('preview:render');
        viewer.setModel(built);
        viewer.controls.target.copy(viewer.target);
        viewer.controls.update();
        viewer.setMode('original');
        await viewer.reveal();
        if (cancelled) return;
        performance.measure('preview:reveal', 'preview:render');
        setHasPaint(Boolean(built.paint));
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        setError(err.message);
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
    // rel_path: a relocated / restored record points at a new file under the same id
    // slotsKey: the filament-mapping colours depend on the user's spools
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.id, model.rel_path, plate, slotsKey]);

  const fs = model.full_spectrum;
  useEffect(() => {
    const viewer = viewerRef.current;
    if (status !== 'ready') return;
    // Full Spectrum: the faces already carry the spools' own colours
    viewer.setMode(fs && mode === 'filament' ? 'original' : mode);
    viewer.render();
  }, [mode, status, fs]);

  const lang = getLang(); // slot names in the mapping are translated
  const spools = useMemo(() => (colors?.length && !fs ? mapToSlots(colors, slots) : null), [colors, fs, slots, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const modes = MODE_LABELS.filter(([k]) => k !== 'estimate' || fs);

  return (
    <div className="viewer">
      <div className="viewer-stage" ref={wrapRef} data-testid="viewer" data-status={status} data-mode={mode} data-loaded={loaded}>
        <canvas ref={canvasRef} data-testid="viewer-canvas" />
        {status === 'loading' && <div className="viewer-msg"><i className="mdi mdi-loading mdi-spin" /> {t('viewer.loading')}</div>}
        {status === 'unsupported' && <div className="viewer-msg">{t('viewer.step')}</div>}
        {status === 'empty' && <div className="viewer-msg">{t('viewer.emptyPlate')}</div>}
        {status === 'error' && <div className="viewer-msg error"><i className="mdi mdi-alert-outline" /> {error}</div>}
      <div className="seg-group modes">
        {modes.map(([k, label, icon]) => (
          <button
            key={k}
            data-testid={`mode-${k}`}
            className={mode === k ? 'seg on' : 'seg'}
            disabled={status !== 'ready' || (k === 'filament' && !hasPaint)}
            title={k === 'filament' && !hasPaint ? t('viewer.noPaint') : undefined}
            onClick={() => setMode(k)}
          >
            <i className={`mdi ${icon}`} /> {t(label)}
          </button>
        ))}
      </div>
      </div>
      {mode === 'estimate' && (
        <div className="callout warn estimate-note" data-testid="estimate-note">
          <i className="mdi mdi-information-outline" />
          <span className="grow">{t('viewer.estimateNote')}</span>
        </div>
      )}
      {mode === 'filament' && fs && colors?.length > 0 && (
        <div className="spools" data-testid="spools">
          <div className="small muted" data-testid="fs-spools-title">
            {t('viewer.fsSpools', { n: colors.length })}
          </div>
          <div className="spool-row">
            {colors.map((c) => (
              <span key={c.color} className="spool" data-testid="spool">
                <span className="swatch" style={{ background: c.color }} />
                {c.color} · {c.pct}%
              </span>
            ))}
          </div>
          {colors.length > slots.length && (
            <div className="small warn-text" data-testid="fs-slots-warning">
              {t('viewer.fsOver', { n: colors.length, slots: slots.length })}
            </div>
          )}
        </div>
      )}
      {mode === 'filament' && spools && (
        <div className="spools" data-testid="spools">
          <div className="small muted" data-testid="slots-title">
            {isDefaultSlots(slots) ? t('viewer.defaultSlots') : t('viewer.customSlots', { n: slots.length })}{t('viewer.uses', { n: spools.used.length })}
          </div>
          <div className="spool-row">
            {spools.used.map((u) => (
              <span key={u.slot} className="spool" data-testid="spool">
                <span className="swatch" style={{ background: u.hex }} />
                {t('slot.n', { n: u.slot })} {u.name} {u.label} · {u.pct}%
              </span>
            ))}
          </div>
          {spools.mapping.some((m) => m.deltaE > 0) && (
            <ul className="mapping small">
              {spools.mapping.filter((m) => m.deltaE > 0).map((m) => (
                <li key={m.color} data-testid="mapping-row" data-mode={m.mode}>
                  <span className="swatch" style={{ background: m.color }} /> {m.color} →{' '}
                  {m.mode === 'single' ? (
                    <>{t('viewer.single', { slot: m.slot, dE: m.deltaE })}</>
                  ) : (
                    <>
                      {t('viewer.mix', { recipe: recipeText(m.recipe) })} <span className="swatch" style={{ background: m.recipe.mixHex }} /> {t('viewer.mixDetail', { hex: m.recipe.mixHex, dE: m.recipe.deltaE, nearest: m.nearest.name, nearestDE: m.deltaE })}
                      {!m.mixable && <span className="badge badge-warn">{t('viewer.unmixable')}</span>}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          {spools.mapping.some((m) => m.mode === 'mix') && (
            <div className="small muted" data-testid="mix-note">
              {t('viewer.mixNote', { dE: MIX_DELTA_E })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
