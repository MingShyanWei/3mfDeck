import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import { ModelGrid, ModelList } from './components/ModelViews.jsx';
import DetailPanel from './components/DetailPanel.jsx';
import ImportDialog from './components/ImportDialog.jsx';
import SettingsDialog from './components/SettingsDialog.jsx';
import { SlotsContext, SetSpoolsContext } from './slots.js';
import { slotsFromColours, DEFAULT_SPOOLS } from '../core/filament.mjs';
import RecoverDialog from './components/RecoverDialog.jsx';
import PurchaseDialog from './components/PurchaseDialog.jsx';
import { runThumbQueue } from './thumbQueue.js';
import { t, setLang } from '../core/i18n/index.mjs';

const SORTS = [
  ['imported', 'col.imported'],
  ['name', 'col.name'],
  ['colors', 'col.colors'],
];

export default function App() {
  const [models, setModels] = useState([]);
  const [counts, setCounts] = useState(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [colors, setColors] = useState([]); // M17 colour-label filter (all must match)
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [sort, setSort] = useState('imported');
  const [view, setView] = useState('grid');
  const [selectedId, setSelectedId] = useState(null);
  const [importIds, setImportIds] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // User spool colours (settings page) -> slots for mapping, recipes and export
  const [spools, setSpools] = useState(DEFAULT_SPOOLS);
  // M24 (SPEC 3.12): UI language, decided in main (saved choice / system locale). Nothing renders
  // until it is known, so the first paint is already in the right language.
  const [lang, setLangState] = useState(null);
  useEffect(() => {
    window.api.getSettings().then((s) => {
      setSpools(s.spools);
      setLang(s.language);
      setLangState(s.language);
    });
  }, []);
  const changeLanguage = async (l) => {
    await window.api.setLanguage(l);
    setLang(l); // core messages (warnings, report rows) in this process too
    setLangState(l);
  };
  // slot labels (C 青 / C Cyan) are taken in the current language
  const slots = useMemo(() => slotsFromColours(spools), [spools, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState(null);
  const [consistency, setConsistency] = useState(null);
  // The "newly missing" notice shows once per occurrence; closing it is final
  const [missingToastClosed, setMissingToastClosed] = useState(false);
  // Multi-select in the 遺失 view (batch remove), and the 依檔名找回 dialog
  const [picked, setPicked] = useState(new Set());
  const [recoverOpen, setRecoverOpen] = useState(false);
  useEffect(() => setPicked(new Set()), [filter]);
  const togglePick = (id) => {
    const next = new Set(picked);
    next.has(id) ? next.delete(id) : next.add(id);
    setPicked(next);
  };
  const removePicked = async () => {
    const removed = await window.api.removeMissing([...picked]);
    if (!removed) return; // cancelled
    setPicked(new Set());
    setSelectedId(null);
    refresh();
    checkConsistency();
  };

  const refresh = useCallback(async () => {
    const [list, c] = await Promise.all([window.api.list({ q, filter, sort, colors }), window.api.sidebar()]);
    setModels(list);
    setCounts(c);
  }, [q, filter, sort, colors]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Thumbnails are rendered in the background; refresh as each one lands
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const thumbs = useCallback(() => runThumbQueue(() => refreshRef.current()), []);
  useEffect(() => {
    thumbs();
  }, [thumbs]);

  // Startup consistency check (SPEC §4): untracked files -> offer a rebuild
  const checkConsistency = useCallback(
    () =>
      window.api.checkConsistency().then((c) => {
        setConsistency(c);
        if (c.newlyMissing) setMissingToastClosed(false);
      }),
    [],
  );
  useEffect(() => {
    checkConsistency();
  }, [checkConsistency]);
  const rebuildIndex = async () => {
    await window.api.rebuildIndex();
    await refresh();
    thumbs();
    checkConsistency();
  };
  const emptyTrash = async () => {
    const n = await window.api.emptyTrash();
    if (n) {
      setSelectedId(null);
      refresh();
    }
  };

  // Import results arrive from main for both menu and drag & drop imports
  useEffect(
    () =>
      window.api.onImported((res) => {
        refresh();
        thumbs();
        if (res.ids.length) setImportIds(res.ids);
        const problems = [
          ...res.errors.map((e) => `${e.file.split('/').pop()}：${e.error}`),
          ...(res.skipped.length ? [t('app.skippedFiles', { n: res.skipped.length })] : []),
        ];
        setNotice(problems.length ? problems.join('\n') : null);
      }),
    [refresh, thumbs],
  );
  useEffect(() => window.api.onOpenSettings(() => setSettingsOpen(true)), []);

  const onDrop = async (e) => {
    e.preventDefault();
    setDragging(false);
    const files = [...e.dataTransfer.files];
    if (files.length) await window.api.importFiles(files);
  };

  const platforms = counts?.platforms.map((p) => p.name) || [];

  if (!lang) return null; // language not known yet (one IPC round trip)
  return (
    <SetSpoolsContext.Provider value={setSpools}>
    <SlotsContext.Provider value={slots}>
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <Sidebar
        counts={counts}
        filter={filter}
        onFilter={setFilter}
        colors={colors}
        onToggleColor={(l) => setColors(colors.includes(l) ? colors.filter((c) => c !== l) : [...colors, l])}
        onClearColors={() => setColors([])}
        onPurchase={() => setPurchaseOpen(true)}
      />
      <main className="main">
        <div className="toolbar">
          <div className="search">
            <i className="mdi mdi-magnify" />
            <input data-testid="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('app.searchPlaceholder')} />
            {q && <button className="icon" onClick={() => setQ('')} title={t('side.clear')}><i className="mdi mdi-close-circle" /></button>}
          </div>
          <label className="sort">
            {t('app.sort')}
            <select data-testid="sort" value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORTS.map(([k, label]) => <option key={k} value={k}>{t(label)}</option>)}
            </select>
          </label>
          <div className="seg-group">
            <button className={view === 'grid' ? 'seg on' : 'seg'} data-testid="view-grid" onClick={() => setView('grid')} title={t('app.viewGrid')}><i className="mdi mdi-view-grid-outline" /></button>
            <button className={view === 'list' ? 'seg on' : 'seg'} data-testid="view-list" onClick={() => setView('list')} title={t('app.viewList')}><i className="mdi mdi-view-list-outline" /></button>
          </div>
          <button className="primary" data-testid="import-button" onClick={() => window.api.importDialog()}>
            <i className="mdi mdi-tray-arrow-down" /> {t('menu.import')}
          </button>
          <button className="icon" data-testid="settings-button" onClick={() => setSettingsOpen(true)} title={t('app.settings')}><i className="mdi mdi-cog-outline" /></button>
        </div>
        {notice && (
          <div className="callout warn notice">
            <i className="mdi mdi-alert-outline" /> <pre>{notice}</pre>
            <button className="icon" onClick={() => setNotice(null)}><i className="mdi mdi-close" /></button>
          </div>
        )}
        {consistency?.untracked.length > 0 && (
          <div className="callout warn" data-testid="consistency-banner">
            <i className="mdi mdi-database-alert-outline" />
            <span className="grow">{t('app.untracked', { n: consistency.untracked.length })}</span>
            <button className="primary" data-testid="rebuild-index" onClick={rebuildIndex}>{t('app.rebuild')}</button>
          </div>
        )}
        {consistency?.newlyMissing > 0 && !missingToastClosed && (
          <div className="callout danger" data-testid="missing-toast">
            <i className="mdi mdi-file-alert-outline" />
            <span className="grow">{t('app.newlyMissing', { n: consistency.newlyMissing })}</span>
            <button
              data-testid="missing-toast-view"
              onClick={() => {
                setFilter('missing');
                setMissingToastClosed(true);
              }}
            >
              {t('app.viewMissing')}
            </button>
            <button className="icon" data-testid="missing-toast-close" onClick={() => setMissingToastClosed(true)} title={t('common.close')}>
              <i className="mdi mdi-close" />
            </button>
          </div>
        )}
        {filter === 'missing' && (
          <div className="callout note" data-testid="missing-note">
            <i className="mdi mdi-file-alert-outline" />
            <span className="grow">{t('app.missingNote')}</span>
            <button data-testid="recover-open" disabled={!models.length} onClick={() => setRecoverOpen(true)}>
              <i className="mdi mdi-file-find-outline" /> {t('app.recover')}
            </button>
            <button
              data-testid="missing-select-all"
              disabled={!models.length}
              onClick={() => setPicked(picked.size === models.length ? new Set() : new Set(models.map((m) => m.id)))}
            >
              {picked.size === models.length && models.length ? t('app.unselectAll') : t('app.selectAll')}
            </button>
            <button data-testid="missing-remove-selected" disabled={!picked.size} onClick={removePicked}>
              {t('app.removeSelected', { n: picked.size })}
            </button>
          </div>
        )}
        {filter === 'trash' && (
          <div className="callout note">
            <i className="mdi mdi-delete-outline" />
            <span className="grow">{t('app.trashNote', { n: counts?.trash ?? 0 })}</span>
            <button data-testid="empty-trash" disabled={!counts?.trash} onClick={emptyTrash}>{t('app.emptyTrash')}</button>
          </div>
        )}
        {counts && counts.unlabeled > 0 && filter !== 'unlabeled' && (
          <button className="callout warn link" onClick={() => setFilter('unlabeled')}>
            <i className="mdi mdi-help-circle-outline" /> {t('app.unlabeledHint', { n: counts.unlabeled })}
          </button>
        )}
        <div className="content">
          {models.length === 0 ? (
            <div className="empty">
              <i className="mdi mdi-tray-arrow-down" />
              <p>{counts?.all ? t('app.noMatch') : t('app.emptyLibrary')}</p>
            </div>
          ) : view === 'grid' ? (
            <ModelGrid models={models} selectedId={selectedId} onSelect={setSelectedId} picked={filter === 'missing' ? picked : null} onPick={togglePick} />
          ) : (
            <ModelList models={models} selectedId={selectedId} onSelect={setSelectedId} picked={filter === 'missing' ? picked : null} onPick={togglePick} />
          )}
        </div>
      </main>
      {selectedId && (
        <DetailPanel
          id={selectedId}
          platforms={platforms}
          onSaved={refresh}
          onRemoved={() => {
            setSelectedId(null);
            refresh();
          }}
          onClose={() => setSelectedId(null)}
          onOpen={(newId) => {
            setSelectedId(newId);
            refresh();
          }}
          onConverted={() => {
            refresh();
            thumbs(); // the converted file is a new record without a thumbnail yet
          }}
        />
      )}
      {dragging && (
        <div className="drop-overlay">
          <i className="mdi mdi-tray-arrow-down" />
          <p>{t('app.dropHint')}</p>
        </div>
      )}
      {importIds && (
        <ImportDialog
          ids={importIds}
          platforms={platforms}
          onDone={() => {
            setImportIds(null);
            refresh();
          }}
        />
      )}
      {purchaseOpen && <PurchaseDialog onClose={() => setPurchaseOpen(false)} />}
      {recoverOpen && (
        <RecoverDialog
          onClose={() => setRecoverOpen(false)}
          onApplied={() => {
            refresh();
            thumbs();
            checkConsistency();
          }}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          language={lang}
          onLanguage={changeLanguage}
          onSpoolsChanged={setSpools}
          onClose={() => setSettingsOpen(false)}
          onRootChanged={() => {
            setSelectedId(null);
            refresh();
            thumbs();
            checkConsistency();
          }}
        />
      )}
    </div>
    </SlotsContext.Provider>
    </SetSpoolsContext.Provider>
  );
}
