import { PROVENANCE } from '../format.js';

function Item({ id, filter, onFilter, icon, label, count, warn, danger }) {
  return (
    <li>
      <button className={`side-item${filter === id ? ' on' : ''}${warn && count ? ' warn' : ''}${danger && count ? ' danger' : ''}`} data-testid={`filter-${id}`} onClick={() => onFilter(id)}>
        <i className={`mdi ${icon}`} />
        <span className="grow">{label}</span>
        <span className="count">{count ?? 0}</span>
      </button>
    </li>
  );
}

export default function Sidebar({ counts, filter, onFilter }) {
  if (!counts) return <aside className="sidebar" />;
  return (
    <aside className="sidebar">
      <div className="brand"><span className="logo" />3MF 櫃</div>
      <ul>
        <Item id="all" filter={filter} onFilter={onFilter} icon="mdi-cube-outline" label="全部" count={counts.all} />
        <Item id="unlabeled" filter={filter} onFilter={onFilter} icon="mdi-help-circle-outline" label="未標" count={counts.unlabeled} warn />
      </ul>
      <h3>來源</h3>
      <ul>
        {['ai_generated', 'downloaded', 'self_made'].map((t) => (
          <Item key={t} id={`type:${t}`} filter={filter} onFilter={onFilter} icon={PROVENANCE[t].icon} label={PROVENANCE[t].label} count={counts.types[t]} />
        ))}
      </ul>
      {counts.platforms.length > 0 && (
        <>
          <h3>平台</h3>
          <ul>
            {counts.platforms.map((p) => (
              <Item key={p.name} id={`platform:${p.name}`} filter={filter} onFilter={onFilter} icon="mdi-web" label={p.name} count={p.n} />
            ))}
          </ul>
        </>
      )}
      <ul className="trash-item">
        <Item id="missing" filter={filter} onFilter={onFilter} icon="mdi-file-alert-outline" label="遺失" count={counts.missing} danger />
        <Item id="trash" filter={filter} onFilter={onFilter} icon="mdi-delete-outline" label="回收桶" count={counts.trash} />
      </ul>
      <h3>標籤</h3>
      {counts.tags.length === 0 && <p className="muted small pad">尚無標籤</p>}
      <ul>
        {counts.tags.map((t) => (
          <Item key={t.name} id={`tag:${t.name}`} filter={filter} onFilter={onFilter} icon="mdi-tag-outline" label={t.name} count={t.n} />
        ))}
      </ul>
    </aside>
  );
}
