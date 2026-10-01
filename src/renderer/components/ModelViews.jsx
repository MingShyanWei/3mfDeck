// Card grid and list (table) views of the library.
import { ProvenanceBadge, ColorBadge, MissingBadge, PlateBadge } from './Badges.jsx';
import { isUnlabeled, formatBytes, formatInt, formatDate } from '../format.js';

// `picked` (a Set of ids, or null): multi-select checkboxes, used by the 遺失 view
function Pick({ id, picked, onPick }) {
  if (!picked) return null;
  return (
    <label className="pick" title="選取">
      <input type="checkbox" data-testid="pick" checked={picked.has(id)} onChange={() => onPick(id)} />
    </label>
  );
}

export function ModelGrid({ models, selectedId, onSelect, picked = null, onPick }) {
  return (
    <div className="grid" data-testid="model-grid">
      {models.map((m) => (
        <div className="card-wrap" key={m.id}>
          <Pick id={m.id} picked={picked} onPick={onPick} />
        <button
          className={`card${selectedId === m.id ? ' selected' : ''}${isUnlabeled(m) ? ' unlabeled' : ''}${m.missing ? ' missing' : ''}`}
          data-testid="model-card"
          onClick={() => onSelect(m.id)}
        >
          <div className="thumb">
            {m.missing && (
              <div className="missing-overlay" data-testid="missing-overlay">
                <i className="mdi mdi-file-alert-outline" /> 檔案遺失
              </div>
            )}
            {m.has_thumb ? (
              <img src={`mfthumb://thumb/${m.id}`} alt="" data-testid="card-thumb" draggable={false} />
            ) : (
              <>
                <i className="mdi mdi-cube-outline" />
                <span className="fmt">{m.format.toUpperCase()}</span>
              </>
            )}
          </div>
          <div className="card-body">
            <div className="name" title={m.name}>{m.name}</div>
            <div className="badges">
              <MissingBadge model={m} />
              <ProvenanceBadge model={m} />
              <PlateBadge model={m} />
              <ColorBadge model={m} />
            </div>
          </div>
        </button>
        </div>
      ))}
    </div>
  );
}

export function ModelList({ models, selectedId, onSelect, picked = null, onPick }) {
  return (
    <table className="list" data-testid="model-list">
      <thead>
        <tr>
          {picked && <th />}
          <th>名稱</th>
          <th>格式</th>
          <th>來源</th>
          <th>色數</th>
          <th className="num">三角數</th>
          <th className="num">大小</th>
          <th>標籤</th>
          <th>匯入日期</th>
        </tr>
      </thead>
      <tbody>
        {models.map((m) => (
          <tr
            key={m.id}
            data-testid="model-row"
            className={`${selectedId === m.id ? 'selected' : ''}${isUnlabeled(m) ? ' unlabeled' : ''}${m.missing ? ' missing' : ''}`}
            onClick={() => onSelect(m.id)}
          >
            {picked && (
              <td onClick={(e) => e.stopPropagation()}>
                <Pick id={m.id} picked={picked} onPick={onPick} />
              </td>
            )}
            <td className="name">{m.name} <MissingBadge model={m} /></td>
            <td className="mono">{m.format}</td>
            <td><ProvenanceBadge model={m} /></td>
            <td>
              <PlateBadge model={m} /> <ColorBadge model={m} />
            </td>
            <td className="num">{formatInt(m.tri_count)}</td>
            <td className="num">{formatBytes(m.size_bytes)}</td>
            <td className="tags">{m.tags.join(', ')}</td>
            <td>{formatDate(m.imported_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
