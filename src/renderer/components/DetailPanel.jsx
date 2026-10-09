// Right-hand panel: edit metadata of the selected model + file info.
import { useCallback, useEffect, useState } from 'react';
import MetadataForm, { toDraft, saveDraft } from './MetadataForm.jsx';
import ModelViewer from './ModelViewer.jsx';
import ColorAnalysis from './ColorAnalysis.jsx';
import EmbeddedImages, { PreviewSwitch } from './EmbeddedImages.jsx';
import { plateImage } from '../../core/embeddedImages.mjs';
import { ProvenanceBadge, PlateBadge, ColorLabels, isNonU1 } from './Badges.jsx';
import { isUnlabeled, formatBytes, formatInt, formatBbox, formatDate } from '../format.js';
import { t } from '../../core/i18n/index.mjs';

export default function DetailPanel({ id, platforms, onSaved, onRemoved, onClose, onOpen, onConverted }) {
  const [model, setModel] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState(false);
  const [exported, setExported] = useState(null);
  const [plate, setPlate] = useState(null); // selected plate of a multi-plate file

  const [inTrash, setInTrash] = useState(false); // missing record whose file is in .trash
  const [previewMode, setPreviewMode] = useState('3d'); // M19: '3d' | 'images'
  const [imagePath, setImagePath] = useState(null);
  const [converting, setConverting] = useState(false);
  const [converted, setConverted] = useState(null); // M18 conversion result
  const [actionError, setActionError] = useState('');
  const load = useCallback(async () => {
    const m = await window.api.get(id);
    setModel(m);
    setDraft(toDraft(m));
    setSaved(false);
    setExported(null);
    setConverted(null);
    setActionError('');
    setPlate(m.plates.length > 1 ? m.plates[0].plate : null);
    setPreviewMode('3d');
    setImagePath(m.embedded_images?.cover ?? null);
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
  // M18: convert to a Snapmaker U1 project (new "-U1" file in the cabinet; the source stays)
  const convertU1 = async () => {
    setConverting(true);
    setActionError('');
    const r = await window.api.convertU1(id);
    setConverting(false);
    if (r.cancelled) return; // M33: already converted, the user chose not to convert again
    if (r.error) return setActionError(r.error);
    setConverted(r);
    onConverted();
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
          <button className="icon" data-testid="restore" onClick={restore} disabled={model.missing} title={t('detail.restore')}>
            <i className="mdi mdi-restore" />
          </button>
        ) : (
          <button className="icon" data-testid="trash" onClick={trash} disabled={model.missing} title={t('detail.trash')}>
            <i className="mdi mdi-delete-outline" />
          </button>
        )}
        <button className="icon" data-testid="reveal" onClick={() => window.api.reveal(id)} disabled={model.missing} title={t(navigator.userAgent.includes('Mac') ? 'detail.revealMac' : 'detail.reveal')}>
          <i className="mdi mdi-folder-search-outline" />
        </button>
        <button className="icon" onClick={onClose} title={t('common.close')}><i className="mdi mdi-close" /></button>
      </header>
      {model.missing && (
        <div className="callout danger missing-actions" data-testid="missing-actions">
          <i className="mdi mdi-file-alert-outline" />
          <div className="grow">
            <div>{t('detail.missing', { rel: model.rel_path })}</div>
            <div className="row">
              <button data-testid="relocate" onClick={relocate}>{t('detail.relocate')}</button>
              <button data-testid="remove-record" onClick={removeRecord}>{t('dlg.removeRecordButton')}</button>
              {inTrash && (
                <button className="primary" data-testid="restore-missing" onClick={restoreMissing}>
                  {t('detail.restoreFromTrash')}
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
            {t('detail.exported', { path: exported.path })}
            {exported.summary &&
              t('detail.exportedSummary', {
                skipped: exported.summary.filter((x) => x.slot === null).length ? t('detail.exportedSkipped', { n: exported.summary.filter((x) => x.slot === null).length }) : '',
                mixes: exported.mixes ? t('detail.exportedMixes', { n: exported.mixes }) : '',
              })}
          </span>
        </div>
      )}
      {isNonU1(model) && !model.missing && (
        <div className="callout warn u1-warning" data-testid="u1-warning">
          <i className="mdi mdi-printer-3d-off" />
          <div className="grow">
            <div>
              {t('u1.warningPre')}<b>{model.source_printer}</b>{t('u1.warningPost', { process: model.source_process ? t('u1.warningProcess', { process: model.source_process }) : '' })}
            </div>
            <div className="row">
              <button className="primary" data-testid="convert-u1" disabled={converting} onClick={convertU1}>
                {converting ? <><i className="mdi mdi-loading mdi-spin" /> {t('u1.converting')}</> : <><i className="mdi mdi-swap-horizontal" /> {t('u1.convert')}</>}
              </button>
              <span className="small">{t('u1.convertNote')}</span>
            </div>
            {actionError && !model.missing && <div className="small" data-testid="u1-error">{actionError}</div>}
          </div>
        </div>
      )}
      {converted && (
        <div className="callout note u1-result" data-testid="u1-result">
          <i className="mdi mdi-check" />
          <div className="grow">
            <div>{t('u1.converted', { name: converted.name, rel: converted.relPath })}</div>
            <ul className="u1-report small">
              <li>{converted.report.machine} · {converted.report.process}</li>
              <li>{t('u1.reportFilaments', { list: [...new Set(converted.report.filaments)].join(t('common.listSep')) })}</li>
              {converted.report.fixes.length > 0 && <li>{t('u1.reportFixes', { list: converted.report.fixes.join(t('common.listSep')) })}</li>}
              <li data-testid="u1-plates">
                {t('u1.reportPlates', { n: converted.report.plates.filter((p) => p.status === 'moved').length })}
                {converted.report.plates.filter((p) => p.status === 'kept').map((p) => t('u1.reportKept', { plate: p.plate, reason: p.reason })).join('')}
              </li>
            </ul>
            <button data-testid="u1-open-converted" onClick={() => onOpen(converted.id)}>{t('u1.openConverted')}</button>
          </div>
        </div>
      )}
      {trashed && (
        <div className="callout warn"><i className="mdi mdi-delete-outline" /> <span className="grow">{t('detail.inTrash')}</span></div>
      )}
      {plateInfo && (
        <div className="plates" data-testid="plate-switcher">
          <div className="seg-group wrap">
            {model.plates.map((p) => (
              <button
                key={p.plate}
                className={p.plate === plate ? 'seg on' : 'seg'}
                data-testid={`plate-${p.plate}`}
                title={p.name || t('plate.n', { n: p.plate })}
                onClick={() => {
                  setPlate(p.plate);
                  // the image view follows the plate switcher: plate N -> its Orca render
                  const img = plateImage(model.embedded_images, p.plate);
                  if (img) setImagePath(img);
                }}
              >
                {t('plate.n', { n: p.plate })}
              </button>
            ))}
          </div>
          <div className="small muted" data-testid="plate-caption">
            {plateInfo.name ? `「${plateInfo.name}」 · ` : ''}
            {t('detail.faces', { n: formatInt(plateInfo.tri_count) })}
          </div>
        </div>
      )}
      <PreviewSwitch embedded={model.embedded_images} mode={previewMode} onMode={setPreviewMode} />
      {previewMode === 'images' && model.embedded_images?.images.length > 0 && (
        <EmbeddedImages id={model.id} embedded={model.embedded_images} path={imagePath} onPath={setImagePath} />
      )}
      {/* kept mounted while the images show, so going back to 3D does not reload the model */}
      <div hidden={previewMode === 'images' && model.embedded_images?.images.length > 0}>
        <ModelViewer model={model} plate={plate} colors={plateInfo ? plateInfo.colors : model.colors} />
      </div>
      <div className="detail-title">
        <div className="grow">
          <h2 title={model.name}>{model.name}</h2>
          <ColorLabels labels={model.color_labels} pct testid="detail-color-tags" />
        </div>
        {!model.missing && model.format === '3mf' && (
          <button className="primary" data-testid="export-quantized" onClick={export3mf} title={t('detail.export3mfTitle')}>
            <i className="mdi mdi-cube-send" /> {t('detail.export3mf')}
          </button>
        )}
      </div>
      {model.format === '3mf' && model.colors.length > 0 && (
        <div className="panel-card">
          {plateInfo ? (
            <ColorAnalysis colors={plateInfo.colors} totals={model.colors} title={t('plate.n', { n: plateInfo.plate })} mixing={mixing} />
          ) : (
            <ColorAnalysis colors={model.colors} mixing={mixing} />
          )}
        </div>
      )}
      {isUnlabeled(model) && (
        <div className="callout warn"><i className="mdi mdi-alert-outline" /> {t('detail.unlabeled')}</div>
      )}
      <div className="panel-card">
        <h3>{t('detail.sourceAndNotes')}</h3>
        <MetadataForm draft={draft} onChange={(d) => { setDraft(d); setSaved(false); }} platforms={platforms} />
        <div className="row end">
          {saved && !dirty && <span className="ok small"><i className="mdi mdi-check" /> {t('detail.saved')}</span>}
          <button className="primary" data-testid="detail-save" disabled={!dirty} onClick={save}>{t('common.save')}</button>
        </div>
      </div>
      <div className="panel-card">
      <h3>{t('detail.fileInfo')}</h3>
      <dl className="info">
        <dt>{t('info.path')}</dt><dd className="mono">{model.rel_path}</dd>
        <dt>{t('col.format')}</dt><dd>{model.format.toUpperCase()}</dd>
        <dt>{t('col.size')}</dt><dd>{formatBytes(model.size_bytes)}</dd>
        <dt>{t('col.triangles')}</dt><dd>{formatInt(model.tri_count)}</dd>
        <dt>{t('info.dimensions')}</dt><dd>{formatBbox(model.bbox_mm)}</dd>
        <dt>{t('col.colors')}</dt><dd>{model.color_count ?? '—'}</dd>
        <dt>{t('info.imported')}</dt><dd>{formatDate(model.imported_at)}</dd>
      </dl>
      </div>
    </aside>
  );
}
