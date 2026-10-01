// Interactive 3D preview (SPEC 3.4): OrbitControls + three shading modes.
import { useEffect, useMemo, useRef, useState } from 'react';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Viewer } from '../viewer/Viewer.js';
import { buildModel } from '../viewer/buildModel.js';
import { mapToSlots } from '../../core/filament.mjs';

const MODE_LABELS = [
  ['original', '原始', 'mdi-palette-outline'],
  ['filament', '耗材映射', 'mdi-printer-3d-nozzle-outline'],
  ['wireframe', '線框', 'mdi-cube-scan'],
];

export default function ModelViewer({ model }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const viewerRef = useRef(null);
  const [status, setStatus] = useState('loading'); // loading | ready | unsupported | error
  const [error, setError] = useState('');
  const [hasPaint, setHasPaint] = useState(false);
  const [mode, setMode] = useState('original');

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
        const payload = await window.api.preview(model.id);
        performance.measure('preview:ipc', 'preview:start');
        if (cancelled) return;
        if (payload.unsupported) return setStatus('unsupported');
        performance.mark('preview:build');
        const built = await buildModel(payload);
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
        setError(/ENOENT/.test(err.message) ? '檔案遺失，無法預覽' : err.message);
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [model.id]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (status !== 'ready') return;
    viewer.setMode(mode);
    viewer.render();
  }, [mode, status]);

  const spools = useMemo(() => (model.colors?.length ? mapToSlots(model.colors) : null), [model.colors]);

  return (
    <div className="viewer">
      <div className="viewer-stage" ref={wrapRef} data-testid="viewer" data-status={status} data-mode={mode}>
        <canvas ref={canvasRef} data-testid="viewer-canvas" />
        {status === 'loading' && <div className="viewer-msg"><i className="mdi mdi-loading mdi-spin" /> 載入中…</div>}
        {status === 'unsupported' && <div className="viewer-msg">STEP 為 B-rep 格式，暫不支援預覽</div>}
        {status === 'error' && <div className="viewer-msg error"><i className="mdi mdi-alert-outline" /> {error}</div>}
      </div>
      <div className="seg-group modes">
        {MODE_LABELS.map(([k, label, icon]) => (
          <button
            key={k}
            data-testid={`mode-${k}`}
            className={mode === k ? 'seg on' : 'seg'}
            disabled={status !== 'ready' || (k === 'filament' && !hasPaint)}
            title={k === 'filament' && !hasPaint ? '只有含 paint_color 或材質色的 3MF 可做耗材映射' : undefined}
            onClick={() => setMode(k)}
          >
            <i className={`mdi ${icon}`} /> {label}
          </button>
        ))}
      </div>
      {mode === 'filament' && spools && (
        <div className="spools" data-testid="spools">
          <div className="small muted">U1 預設 CMYK 耗材槽 · 這檔案會用到 {spools.used.length} 捲</div>
          <div className="spool-row">
            {spools.used.map((u) => (
              <span key={u.slot} className="spool" data-testid="spool">
                <span className="swatch" style={{ background: u.hex }} />
                槽{u.slot} {u.name} {u.label} · {u.pct}%
              </span>
            ))}
          </div>
          {spools.mapping.some((m) => m.deltaE > 0) && (
            <ul className="mapping small">
              {spools.mapping.filter((m) => m.deltaE > 0).map((m) => (
                <li key={m.color}>
                  <span className="swatch" style={{ background: m.color }} /> {m.color} → 槽{m.slot}（ΔE {m.deltaE}）
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
