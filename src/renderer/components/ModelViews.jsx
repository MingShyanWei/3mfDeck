// Card grid and list (table) views of the library.
import { ProvenanceBadge, ColorBadge, MissingBadge, PlateBadge, ColorLabels, U1Badge } from './Badges.jsx';
import { isUnlabeled, formatBytes, formatInt, formatDate } from '../format.js';
import { thumbOf } from '../thumbSource.js';
import { t } from '../../core/i18n/index.mjs';

// `picked` (a Set of ids, or null): multi-select checkboxes, used by the 遺失 view
function Pick({ id, picked, onPick }) {
  if (!picked) return null;
  return (
    <label className="pick" title={t('list.pick')}>
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
                <i className="mdi mdi-file-alert-outline" /> {t('card.missing')}
              </div>
            )}
            {thumbOf(m) ? (
              <img src={thumbOf(m).src} alt="" data-testid="card-thumb" data-source={thumbOf(m).source} className={`thumb-${thumbOf(m).source}`} draggable={false} />
            ) : (
              <>
                <i className="mdi mdi-cube-outline" />
                <span className="fmt">{m.format.toUpperCase()}</span>
              </>
            )}
          </div>
          <div className="badges">
            <MissingBadge model={m} />
            <ProvenanceBadge model={m} />
            <PlateBadge model={m} />
            <U1Badge model={m} />
          </div>
          <div className="card-body">
            <div className="name" title={m.name}>{m.name}</div>
            <ColorLabels labels={m.color_labels} />
            <div className="sub">
              <ColorBadge model={m} />
              {m.color_count != null && <span>·</span>}
              <span>{m.format.toUpperCase()} · {formatBytes(m.size_bytes)}</span>
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
          <th className="thumb-col" />
          <th>{t('col.name')}</th>
          <th>{t('col.format')}</th>
          <th>{t('col.source')}</th>
          <th>{t('col.colors')}</th>
          <th className="num">{t('col.triangles')}</th>
          <th className="num">{t('col.size')}</th>
          <th>{t('col.tags')}</th>
          <th>{t('col.imported')}</th>
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
            <td className="thumb-col">
              {thumbOf(m) ? (
                <img src={thumbOf(m).src} alt="" data-testid="row-thumb" data-source={thumbOf(m).source} draggable={false} />
              ) : (
                <i className="mdi mdi-cube-outline" data-testid="row-thumb-icon" />
              )}
            </td>
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
