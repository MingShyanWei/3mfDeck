import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import { ModelGrid, ModelList } from './components/ModelViews.jsx';
import DetailPanel from './components/DetailPanel.jsx';
import ImportDialog from './components/ImportDialog.jsx';
import SettingsDialog from './components/SettingsDialog.jsx';
import { SlotsContext } from './slots.js';
import { slotsFromColours, DEFAULT_SPOOLS } from '../core/filament.mjs';
import RecoverDialog from './components/RecoverDialog.jsx';
import { runThumbQueue } from './thumbQueue.js';

const SORTS = [
  ['imported', '匯入日期'],
  ['name', '名稱'],
  ['colors', '色數'],
];

export default function App() {
  const [models, setModels] = useState([]);
  const [counts, setCounts] = useState(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('imported');
  const [view, setView] = useState('grid');
  const [selectedId, setSelectedId] = useState(null);
  const [importIds, setImportIds] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // User spool colours (settings page) -> slots for mapping, recipes and export
  const [spools, setSpools] = useState(DEFAULT_SPOOLS);
  useEffect(() => {
    window.api.getSettings().then((s) => setSpools(s.spools));
  }, []);
  const slots = useMemo(() => slotsFromColours(spools), [spools]);
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
    const [list, c] = await Promise.all([window.api.list({ q, filter, sort }), window.api.sidebar()]);
    setModels(list);
    setCounts(c);
  }, [q, filter, sort]);

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
          ...(res.skipped.length ? [`略過 ${res.skipped.length} 個不支援的檔案`] : []),
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

  return (
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
      <Sidebar counts={counts} filter={filter} onFilter={setFilter} />
      <main className="main">
        <div className="toolbar">
          <div className="search">
            <i className="mdi mdi-magnify" />
            <input data-testid="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋名稱、標籤、備註" />
            {q && <button className="icon" onClick={() => setQ('')} title="清除"><i className="mdi mdi-close-circle" /></button>}
          </div>
          <label className="sort">
            排序
            <select data-testid="sort" value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
          <div className="seg-group">
            <button className={view === 'grid' ? 'seg on' : 'seg'} data-testid="view-grid" onClick={() => setView('grid')} title="卡片牆"><i className="mdi mdi-view-grid-outline" /></button>
            <button className={view === 'list' ? 'seg on' : 'seg'} data-testid="view-list" onClick={() => setView('list')} title="清單"><i className="mdi mdi-view-list-outline" /></button>
          </div>
          <button className="primary" data-testid="import-button" onClick={() => window.api.importDialog()}>
            <i className="mdi mdi-tray-arrow-down" /> 匯入…
          </button>
          <button className="icon" data-testid="settings-button" onClick={() => setSettingsOpen(true)} title="設定"><i className="mdi mdi-cog-outline" /></button>
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
            <span className="grow">發現 {consistency.untracked.length} 個檔案在檔案櫃中但不在索引裡（索引可能遺失或檔案是手動放入的）。</span>
            <button className="primary" data-testid="rebuild-index" onClick={rebuildIndex}>重建索引</button>
          </div>
        )}
        {consistency?.newlyMissing > 0 && !missingToastClosed && (
          <div className="callout danger" data-testid="missing-toast">
            <i className="mdi mdi-file-alert-outline" />
            <span className="grow">{consistency.newlyMissing} 筆記錄新出現遺失（檔案不在目前的根目錄）。</span>
            <button
              data-testid="missing-toast-view"
              onClick={() => {
                setFilter('missing');
                setMissingToastClosed(true);
              }}
            >
              檢視遺失
            </button>
            <button className="icon" data-testid="missing-toast-close" onClick={() => setMissingToastClosed(true)} title="關閉">
              <i className="mdi mdi-close" />
            </button>
          </div>
        )}
        {filter === 'missing' && (
          <div className="callout note" data-testid="missing-note">
            <i className="mdi mdi-file-alert-outline" />
            <span className="grow">遺失：記錄還在，但檔案不在目前的根目錄。點選檔案可「重新定位」、「移除記錄」（不刪檔），檔案在回收桶時可「還原」。</span>
            <button data-testid="recover-open" disabled={!models.length} onClick={() => setRecoverOpen(true)}>
              <i className="mdi mdi-file-find-outline" /> 依檔名找回…
            </button>
            <button
              data-testid="missing-select-all"
              disabled={!models.length}
              onClick={() => setPicked(picked.size === models.length ? new Set() : new Set(models.map((m) => m.id)))}
            >
              {picked.size === models.length && models.length ? '取消全選' : '全選'}
            </button>
            <button data-testid="missing-remove-selected" disabled={!picked.size} onClick={removePicked}>
              移除所選（{picked.size}）…
            </button>
          </div>
        )}
        {filter === 'trash' && (
          <div className="callout note">
            <i className="mdi mdi-delete-outline" />
            <span className="grow">回收桶：{counts?.trash ?? 0} 個檔案，可逐一還原。</span>
            <button data-testid="empty-trash" disabled={!counts?.trash} onClick={emptyTrash}>清空回收桶…</button>
          </div>
        )}
        {counts && counts.unlabeled > 0 && filter !== 'unlabeled' && (
          <button className="callout warn link" onClick={() => setFilter('unlabeled')}>
            <i className="mdi mdi-help-circle-outline" /> 有 {counts.unlabeled} 個檔案來源未標，點此檢視
          </button>
        )}
        <div className="content">
          {models.length === 0 ? (
            <div className="empty">
              <i className="mdi mdi-tray-arrow-down" />
              <p>{counts?.all ? '沒有符合條件的檔案' : '把 3MF / STL / OBJ / GLB… 拖進來，或按「匯入…」'}</p>
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
        />
      )}
      {dragging && (
        <div className="drop-overlay">
          <i className="mdi mdi-tray-arrow-down" />
          <p>放開以匯入（檔案會搬進檔案櫃）</p>
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
  );
}
