import { PROVENANCE } from '../format.js';
import { LABELS, swatchOf } from '../../core/colorNames.mjs';

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

export default function Sidebar({ counts, filter, onFilter, colors = [], onToggleColor, onClearColors, onPurchase }) {
  if (!counts) return <aside className="sidebar" />;
  return (
    <aside className="sidebar">
      <div className="brand"><span className="logo" />3MF 櫃</div>
      <ul>
        <Item id="all" filter={filter} onFilter={onFilter} icon="mdi-cube-outline" label="全部" count={counts.all} />
        <Item id="unlabeled" filter={filter} onFilter={onFilter} icon="mdi-help-circle-outline" label="未標" count={counts.unlabeled} warn />
        <Item id="nonu1" filter={filter} onFilter={onFilter} icon="mdi-printer-3d-off" label="非 U1" count={counts.nonU1} warn />
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
      <h3 className="row">
        <span className="grow">顏色</span>
        {colors.length > 0 && (
          <button className="link-btn" data-testid="color-filter-clear" onClick={onClearColors}>清除</button>
        )}
      </h3>
      <div className="color-filter" data-testid="color-filter">
        {LABELS.map((l) => ({ label: l, n: counts.colors?.find((c) => c.label === l)?.n || 0 }))
          .filter((c) => c.n > 0 || colors.includes(c.label))
          .map((c) => (
            <button
              key={c.label}
              className={`color-chip${colors.includes(c.label) ? ' on' : ''}`}
              data-testid={`filter-color-${c.label}`}
              title={`含「${c.label}」的檔案（面積 ≥ 5%）；可多選，需同時含所選顏色`}
              onClick={() => onToggleColor(c.label)}
            >
              <i className="dot" style={{ background: swatchOf(c.label) || 'conic-gradient(#e33, #3c3, #39f, #e33)' }} />
              {c.label}
              <span className="count">{c.n}</span>
            </button>
          ))}
        {!counts.colors?.length && <p className="muted small pad">尚無顏色資料</p>}
      </div>
      <button className="side-item purchase-open" data-testid="purchase-open" onClick={onPurchase}>
        <i className="mdi mdi-cart-outline" />
        <span className="grow">採購建議…</span>
      </button>
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
