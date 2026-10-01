// Right-hand panel: edit metadata of the selected model + file info.
import { useCallback, useEffect, useState } from 'react';
import MetadataForm, { toDraft, saveDraft } from './MetadataForm.jsx';
import ModelViewer from './ModelViewer.jsx';
import ColorAnalysis from './ColorAnalysis.jsx';
import { ProvenanceBadge, PlateBadge } from './Badges.jsx';
import { isUnlabeled, formatBytes, formatInt, formatBbox, formatDate } from '../format.js';

export default function DetailPanel({ id, platforms, onSaved, onRemoved, onClose }) {
  const [model, setModel] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState(false);
  const [exported, setExported] = useState(null);
  const [plate, setPlate] = useState(null); // selected plate of a multi-plate file

  const [inTrash, setInTrash] = useState(false); // missing record whose file is in .trash
  const [actionError, setActionError] = useState('');
  const load = useCallback(async () => {
    const m = await window.api.get(id);
    setModel(m);
    setDraft(toDraft(m));
    setSaved(false);
    setExported(null);
    setActionError('');
    setPlate(m.plates.length > 1 ? m.plates[0].plate : null);
    setInTrash(m.missing ? await window.api.missingInTrash(id) : false);
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  if (!model || !draft) return <aside className="detail" />;
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(model));
  const save = async () => {
    await saveDraft(id, draft);
    const m = await window.api.get(id);
    setModel(m);
    setDraft(toDraft(m));
    setSaved(true);
    onSaved();
  };

  const trashed = model.rel_path.startsWith('.trash/');
  const mixing = model.full_spectrum ? { vertexMixedPct: model.vertex_mixed_pct } : null;
  const plateInfo = model.plates.length > 1 ? model.plates.find((p) => p.plate === plate) : null;
  // Delete / restore move the model out of the current list view
  const trash = async () => {
    await window.api.trash(id);
    onRemoved();
  };
  const restore = async () => {
    await window.api.restore(id);
    onRemoved();
  };
  // Missing-record actions; the list and counts refresh through onSaved / onRemoved
  const relocate = async () => {
    const r = await window.api.relocate(id);
    if (!r) return;
    if (r.error) return setActionError(r.error);
    await load();
    onSaved();
  };
  const removeRecord = async () => {
    if (await window.api.removeRecord(id)) onRemoved();
  };
  const restoreMissing = async () => {
    const r = await window.api.restoreMissing(id);
    if (r.error) return setActionError(r.error);
    await load();
    onSaved();
  };
  // M13d: the only export action, top right (Mix mode is always on now)
  const export3mf = async () => {
    const r = await window.api.exportQuantized(id, { overThreshold: 'nearest', mix: true });
    if (r?.error) setActionError(r.error);
    else if (r) setExported({ path: r.path, summary: r.summary, mixes: r.mixes });
  };

  return (
    <aside className="detail" data-testid="detail-panel">
      <header className="detail-top">
        <ProvenanceBadge model={model} />
        <PlateBadge model={model} />
        <span className="spacer" />
        {trashed ? (
          <button className="icon" data-testid="restore" onClick={restore} disabled={model.missing} title="還原">
            <i className="mdi mdi-restore" />
          </button>
        ) : (
          <button className="icon" data-testid="trash" onClick={trash} disabled={model.missing} title="刪除（移到回收桶）">
            <i className="mdi mdi-delete-outline" />
          </button>
        )}
        <button className="icon" data-testid="reveal" onClick={() => window.api.reveal(id)} disabled={model.missing} title="在 Finder 顯示">
          <i className="mdi mdi-folder-search-outline" />
        </button>
        <button className="icon" onClick={onClose} title="關閉"><i className="mdi mdi-close" /></button>
      </header>
      {model.missing && (
        <div className="callout danger missing-actions" data-testid="missing-actions">
          <i className="mdi mdi-file-alert-outline" />
          <div className="grow">
            <div>遺失：目前的根目錄下找不到這個檔案（{model.rel_path}）。</div>
            <div className="row">
              <button data-testid="relocate" onClick={relocate}>重新定位…</button>
              <button data-testid="remove-record" onClick={removeRecord}>移除記錄</button>
              {inTrash && (
                <button className="primary" data-testid="restore-missing" onClick={restoreMissing}>
                  從回收桶還原
                </button>
              )}
            </div>
            {actionError && <div className="small" data-testid="missing-error">{actionError}</div>}
          </div>
        </div>
      )}
      {exported && (
        <div className="callout note" data-testid="export-message">
          <i className="mdi mdi-check" />
          <span className="grow">
            已匯出：{exported.path}
            {exported.summary && `（${exported.summary.filter((x) => x.slot === null).length ? `跳過 ${exported.summary.filter((x) => x.slot === null).length} 色，` : ''}${exported.mixes ? `Mix ${exported.mixes} 組，` : ''}原檔未變動）`}
          </span>
        </div>
      )}
      {trashed && (
        <div className="callout warn"><i className="mdi mdi-delete-outline" /> <span className="grow">此檔案在回收桶中，可按「還原」放回原位置。</span></div>
      )}
      {plateInfo && (
        <div className="plates" data-testid="plate-switcher">
          <div className="seg-group wrap">
            {model.plates.map((p) => (
              <button
                key={p.plate}
                className={p.plate === plate ? 'seg on' : 'seg'}
                data-testid={`plate-${p.plate}`}
                title={p.name || `盤 ${p.plate}`}
                onClick={() => setPlate(p.plate)}
              >
                盤 {p.plate}
              </button>
            ))}
          </div>
          <div className="small muted" data-testid="plate-caption">
            {plateInfo.name ? `「${plateInfo.name}」 · ` : ''}
            {formatInt(plateInfo.tri_count)} 面
          </div>
        </div>
      )}
      <ModelViewer model={model} plate={plate} colors={plateInfo ? plateInfo.colors : model.colors} />
      <div className="detail-title">
        <h2 title={model.name}>{model.name}</h2>
        {!model.missing && model.format === '3mf' && (
          <button className="primary" data-testid="export-quantized" onClick={export3mf} title="匯出 3MF：顏色量化到捲色，單捲印不出的寫成混合耗材 Mix（原檔不動）">
            <i className="mdi mdi-cube-send" /> 匯出 3MF…
          </button>
        )}
      </div>
      {model.format === '3mf' && model.colors.length > 0 && (
        <div className="panel-card">
          {plateInfo ? (
            <ColorAnalysis colors={plateInfo.colors} totals={model.colors} title={`盤 ${plateInfo.plate}`} mixing={mixing} />
          ) : (
            <ColorAnalysis colors={model.colors} mixing={mixing} />
          )}
        </div>
      )}
      {isUnlabeled(model) && (
        <div className="callout warn"><i className="mdi mdi-alert-outline" /> 來源未標，請補上來源類型。</div>
      )}
      <div className="panel-card">
        <h3>來源與備註</h3>
        <MetadataForm draft={draft} onChange={(d) => { setDraft(d); setSaved(false); }} platforms={platforms} />
        <div className="row end">
          {saved && !dirty && <span className="ok small"><i className="mdi mdi-check" /> 已儲存</span>}
          <button className="primary" data-testid="detail-save" disabled={!dirty} onClick={save}>儲存</button>
        </div>
      </div>
      <div className="panel-card">
      <h3>檔案資訊</h3>
      <dl className="info">
        <dt>路徑</dt><dd className="mono">{model.rel_path}</dd>
        <dt>格式</dt><dd>{model.format.toUpperCase()}</dd>
        <dt>大小</dt><dd>{formatBytes(model.size_bytes)}</dd>
        <dt>三角數</dt><dd>{formatInt(model.tri_count)}</dd>
        <dt>尺寸</dt><dd>{formatBbox(model.bbox_mm)}</dd>
        <dt>色數</dt><dd>{model.color_count ?? '—'}</dd>
        <dt>匯入</dt><dd>{formatDate(model.imported_at)}</dd>
      </dl>
      </div>
    </aside>
  );
}
