// After an import batch: walk through each new file and fill in metadata.
// Every step can be skipped; skipped files stay in the library as 未標.
import { useEffect, useState } from 'react';
import MetadataForm, { toDraft, saveDraft } from './MetadataForm.jsx';

export default function ImportDialog({ ids, platforms, onDone }) {
  const [index, setIndex] = useState(0);
  const [model, setModel] = useState(null);
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    window.api.get(ids[index]).then((m) => {
      setModel(m);
      setDraft(toDraft(m));
    });
  }, [ids, index]);

  const next = () => (index + 1 < ids.length ? setIndex(index + 1) : onDone());
  const saveAndNext = async () => {
    await saveDraft(model.id, draft);
    next();
  };

  // Until the current file's data has loaded, show only the backdrop so a stale
  // form (previous file) can never be edited or saved.
  if (!model || model.id !== ids[index]) return <div className="modal-backdrop" />;
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-label="匯入對話框" data-testid="import-dialog">
        <header>
          <h2>
            <i className="mdi mdi-tray-arrow-down" /> 匯入 {index + 1} / {ids.length}
          </h2>
          <div className="muted mono">{model.rel_path}</div>
        </header>
        <MetadataForm draft={draft} onChange={setDraft} platforms={platforms} />
        <footer>
          <button className="ghost" data-testid="import-skip-all" onClick={onDone}>全部略過</button>
          <span className="spacer" />
          <button className="ghost" data-testid="import-skip" onClick={next}>略過此檔</button>
          <button className="primary" data-testid="import-save" onClick={saveAndNext}>
            {index + 1 < ids.length ? '儲存並下一個' : '儲存'}
          </button>
        </footer>
      </div>
    </div>
  );
}
