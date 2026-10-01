// Right-hand panel: edit metadata of the selected model + file info.
import { useEffect, useState } from 'react';
import MetadataForm, { toDraft, saveDraft } from './MetadataForm.jsx';
import { isUnlabeled, formatBytes, formatInt, formatBbox, formatDate } from '../format.js';

export default function DetailPanel({ id, platforms, onSaved, onClose }) {
  const [model, setModel] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    window.api.get(id).then((m) => {
      setModel(m);
      setDraft(toDraft(m));
      setSaved(false);
    });
  }, [id]);

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

  return (
    <aside className="detail" data-testid="detail-panel">
      <header>
        <h2 title={model.name}>{model.name}</h2>
        <button className="icon" onClick={onClose} title="關閉"><i className="mdi mdi-close" /></button>
      </header>
      {model.missing && (
        <div className="callout danger"><i className="mdi mdi-file-alert-outline" /> 遺失：目前的根目錄下找不到這個檔案。</div>
      )}
      {isUnlabeled(model) && (
        <div className="callout warn"><i className="mdi mdi-alert-outline" /> 來源未標，請補上來源類型。</div>
      )}
      <MetadataForm draft={draft} onChange={(d) => { setDraft(d); setSaved(false); }} platforms={platforms} />
      <div className="row end">
        {saved && !dirty && <span className="ok small"><i className="mdi mdi-check" /> 已儲存</span>}
        <button className="primary" data-testid="detail-save" disabled={!dirty} onClick={save}>儲存</button>
      </div>
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
    </aside>
  );
}
