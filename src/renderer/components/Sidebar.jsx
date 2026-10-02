import { useEffect, useState } from 'react';
import { PROVENANCE } from '../format.js';
import { LABELS, swatchOf, labelName } from '../../core/colorNames.mjs';
import { t, getLang } from '../../core/i18n/index.mjs';

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

// M22 (SPEC 3.11): build version (1.<YYMMDDHHMM>, from the build time) and the
// author / repository, bottom left. The link opens the system browser through
// main (shell.openExternal); the app makes no network request itself.
function AppFooter() {
  const [info, setInfo] = useState(null);
  const lang = getLang();
  useEffect(() => {
    window.api.appInfo().then(setInfo); // the tooltip is written in the current language
  }, [lang]);
  if (!info) return null;
  return (
    <footer className="app-footer">
      <div className="app-version" data-testid="app-version" title={info.tooltip}>
        v{info.version}
      </div>
      <button className="app-credit" data-testid="app-credit" title={t('footer.openRepo', { url: `https://${info.repo}` })} onClick={() => window.api.openRepo()}>
        <span><i className="mdi mdi-github" /> {info.author}</span>
        <span>{info.repo}</span>
      </button>
    </footer>
  );
}

// M30 (SPEC 3.13): a newer release, found only when the user turned the
// update check on. Non-blocking: download (system browser), skip this
// version, or close for this session. Never downloads or installs anything.
function UpdateNotice() {
  const [notice, setNotice] = useState(null);
  const [closed, setClosed] = useState(null); // version closed for this session
  useEffect(() => {
    window.api.updateStatus().then(setNotice);
    return window.api.onUpdate(setNotice);
  }, []);
  if (!notice || closed === notice.version) return null;
  return (
    <div className="update-notice" data-testid="update-notice" data-version={notice.version}>
      <div className="row">
        <i className="mdi mdi-arrow-up-circle-outline" />
        <span className="grow">{t('update.available', { version: notice.version })}</span>
        <button className="icon" data-testid="update-close" title={t('update.dismiss')} onClick={() => setClosed(notice.version)}><i className="mdi mdi-close" /></button>
      </div>
      <div className="small muted">{t('update.manual')}</div>
      <div className="row">
        <button className="small primary" data-testid="update-open" onClick={() => window.api.openUpdate()}>{t('update.download')}</button>
        <button className="small" data-testid="update-skip" onClick={() => window.api.skipUpdate(notice.version)}>{t('update.skip')}</button>
      </div>
    </div>
  );
}

export default function Sidebar({ counts, filter, onFilter, colors = [], onToggleColor, onClearColors, onPurchase }) {
  if (!counts) return <aside className="sidebar" />;
  return (
    <aside className="sidebar">
      <div className="brand"><span className="logo" />3mfDeck</div>
      <ul>
        <Item id="all" filter={filter} onFilter={onFilter} icon="mdi-cube-outline" label={t('side.all')} count={counts.all} />
        <Item id="unlabeled" filter={filter} onFilter={onFilter} icon="mdi-help-circle-outline" label={t('prov.unknown')} count={counts.unlabeled} warn />
        <Item id="nonu1" filter={filter} onFilter={onFilter} icon="mdi-printer-3d-off" label={t('badge.nonU1')} count={counts.nonU1} warn />
      </ul>
      <h3>{t('side.sources')}</h3>
      <ul>
        {['ai_generated', 'downloaded', 'self_made'].map((type) => (
          <Item key={type} id={`type:${type}`} filter={filter} onFilter={onFilter} icon={PROVENANCE[type].icon} label={PROVENANCE[type].label} count={counts.types[type]} />
        ))}
      </ul>
      {counts.platforms.length > 0 && (
        <>
          <h3>{t('side.platforms')}</h3>
          <ul>
            {counts.platforms.map((p) => (
              <Item key={p.name} id={`platform:${p.name}`} filter={filter} onFilter={onFilter} icon="mdi-web" label={p.name} count={p.n} />
            ))}
          </ul>
        </>
      )}
      <ul className="trash-item">
        <Item id="missing" filter={filter} onFilter={onFilter} icon="mdi-file-alert-outline" label={t('badge.missing')} count={counts.missing} danger />
        <Item id="trash" filter={filter} onFilter={onFilter} icon="mdi-delete-outline" label={t('side.trash')} count={counts.trash} />
      </ul>
      <h3 className="row">
        <span className="grow">{t('side.colors')}</span>
        {colors.length > 0 && (
          <button className="link-btn" data-testid="color-filter-clear" onClick={onClearColors}>{t('side.clear')}</button>
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
              title={t('side.colorTitle', { color: labelName(c.label) })}
              onClick={() => onToggleColor(c.label)}
            >
              <i className="dot" style={{ background: swatchOf(c.label) || 'conic-gradient(#e33, #3c3, #39f, #e33)' }} />
              {labelName(c.label)}
              <span className="count">{c.n}</span>
            </button>
          ))}
        {!counts.colors?.length && <p className="muted small pad">{t('side.noColors')}</p>}
      </div>
      <button className="side-item purchase-open" data-testid="purchase-open" onClick={onPurchase}>
        <i className="mdi mdi-cart-outline" />
        <span className="grow">{t('side.purchase')}</span>
      </button>
      <h3>{t('side.tags')}</h3>
      {counts.tags.length === 0 && <p className="muted small pad">{t('side.noTags')}</p>}
      <ul>
        {counts.tags.map((tag) => (
          <Item key={tag.name} id={`tag:${tag.name}`} filter={filter} onFilter={onFilter} icon="mdi-tag-outline" label={tag.name} count={tag.n} />
        ))}
      </ul>
      <UpdateNotice />
      <AppFooter />
    </aside>
  );
}
