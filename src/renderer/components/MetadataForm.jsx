// Editable metadata: name, provenance (type/platform/url/prompt/retrieved_at), tags, notes.
// Used by both the import dialog and the detail panel.
import { PROVENANCE, PLATFORM_SUGGESTIONS } from '../format.js';

export const toDraft = (m) => ({
  name: m.name || '',
  provenance_type: m.provenance_type || 'unknown',
  platform: m.platform || '',
  url: m.url || '',
  prompt: m.prompt || '',
  retrieved_at: m.retrieved_at || '',
  notes: m.notes || '',
  tags: (m.tags || []).join(', '),
});

/** Persist a draft: metadata fields + tags. */
export async function saveDraft(id, draft) {
  const { tags, ...fields } = draft;
  await window.api.update(id, fields);
  await window.api.setTags(id, tags.split(/[,，]/));
}

export default function MetadataForm({ draft, onChange, platforms = [] }) {
  const set = (k) => (e) => onChange({ ...draft, [k]: e.target.value });
  const suggestions = [...new Set([...PLATFORM_SUGGESTIONS, ...platforms])];
  return (
    <div className="form">
      <label>
        <span>名稱</span>
        <input data-testid="f-name" value={draft.name} onChange={set('name')} />
      </label>
      <fieldset className="prov-types">
        <legend>來源類型</legend>
        {Object.entries(PROVENANCE).map(([k, p]) => (
          <button
            type="button"
            key={k}
            data-testid={`f-type-${k}`}
            className={draft.provenance_type === k ? 'seg on' : 'seg'}
            onClick={() => onChange({ ...draft, provenance_type: k })}
          >
            <i className={`mdi ${p.icon}`} /> {p.label}
          </button>
        ))}
      </fieldset>
      <label>
        <span>平台</span>
        <input data-testid="f-platform" list="platform-list" value={draft.platform} onChange={set('platform')} placeholder="Meshy / Thingiverse / Printables / 其他" />
        <datalist id="platform-list">
          {suggestions.map((p) => <option key={p} value={p} />)}
        </datalist>
      </label>
      <label>
        <span>來源網址</span>
        <input data-testid="f-url" type="url" value={draft.url} onChange={set('url')} placeholder="https://…" />
      </label>
      <label>
        <span>Prompt</span>
        <textarea data-testid="f-prompt" rows={3} value={draft.prompt} onChange={set('prompt')} placeholder="AI 生成時的原始 prompt（可空）" />
      </label>
      <label>
        <span>取得日期</span>
        <input data-testid="f-retrieved" type="date" value={draft.retrieved_at} onChange={set('retrieved_at')} />
      </label>
      <label>
        <span>標籤</span>
        <input data-testid="f-tags" value={draft.tags} onChange={set('tags')} placeholder="以逗號分隔，例：鴨子, 禮物" />
      </label>
      <label>
        <span>備註</span>
        <textarea data-testid="f-notes" rows={3} value={draft.notes} onChange={set('notes')} />
      </label>
    </div>
  );
}
