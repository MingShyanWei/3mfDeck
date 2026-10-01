import { useEffect, useState } from 'react';
import { DEFAULT_SPOOLS } from '../../core/filament.mjs';

export default function SettingsDialog({ onClose, onRootChanged, onSpoolsChanged }) {
  const [settings, setSettings] = useState(null);
  const [message, setMessage] = useState('');
  const [spools, setSpools] = useState(null); // draft spool colours
  const [spoolMsg, setSpoolMsg] = useState('');
  const [inventory, setInventory] = useState(null); // draft filament inventory
  const [invMsg, setInvMsg] = useState('');

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setSettings(s);
      setSpools(s.spools);
      setInventory(s.inventory || []);
    });
  }, []);

  const setCount = (n) => setSpools(Array.from({ length: n }, (_, i) => spools[i] ?? DEFAULT_SPOOLS[i]));
  const setColour = (i, v) => setSpools(spools.map((c, k) => (k === i ? v : c)));
  const saveSpools = async (list) => {
    const r = await window.api.setSpools(list);
    if (r.error) return setSpoolMsg(r.error);
    setSpools(r.spools);
    setSpoolMsg('已儲存：耗材映射、混色配方與量化匯出改用這組捲色。');
    onSpoolsChanged(r.spools);
  };

  const change = async () => {
    const r = await window.api.chooseRoot();
    if (!r) return;
    setSettings({ ...settings, libraryRoot: r.libraryRoot });
    setMessage(`已切換：新增索引 ${r.indexed} 個檔案，${r.missing} 筆記錄標示為遺失。`);
    onRootChanged();
  };

  return (
    <div className="modal-backdrop">
      <div className="modal narrow" role="dialog" aria-label="設定">
        <header>
          <h2><i className="mdi mdi-cog-outline" /> 設定</h2>
        </header>
        <div className="form">
          <label>
            <span>檔案櫃根目錄</span>
            <div className="row">
              <code className="path" data-testid="settings-root">{settings?.libraryRoot}</code>
              <button data-testid="settings-change-root" onClick={change}>變更…</button>
            </div>
          </label>
          <p className="muted small">變更根目錄不會搬動任何檔案，只會對新根目錄重建索引。原根目錄下的記錄會標示「遺失」（記錄仍保留，切回原根目錄即恢復）。</p>
          {message && <p className="ok small" data-testid="settings-message">{message}</p>}
          {spools && (
            <fieldset className="spool-editor" data-testid="spool-editor">
              <legend>耗材捲色（實際裝的線材）</legend>
              <div className="row">
                <span className="small muted">捲數</span>
                <select data-testid="spool-count" value={spools.length} onChange={(e) => setCount(Number(e.target.value))}>
                  {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              {spools.map((c, i) => (
                <div className="row" key={i}>
                  <span className="small muted">槽{i + 1}</span>
                  <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(c) ? c : '#000000'} onChange={(e) => setColour(i, e.target.value.toUpperCase())} />
                  <input className="mono" data-testid={`spool-${i + 1}`} value={c} onChange={(e) => setColour(i, e.target.value)} placeholder="#RRGGBB" />
                </div>
              ))}
              <div className="row">
                <button className="primary" data-testid="spool-save" onClick={() => saveSpools(spools)}>儲存捲色</button>
                <button data-testid="spool-reset" onClick={() => saveSpools(DEFAULT_SPOOLS)}>恢復理想 CMYK</button>
              </div>
              {spoolMsg && <p className="small" data-testid="spool-message">{spoolMsg}</p>}
            </fieldset>
          )}
          {inventory && (
            <fieldset className="spool-editor" data-testid="inventory-editor">
              <legend>線材庫（你擁有的線材）</legend>
              <div className="inventory-list" data-testid="inventory-list">
                {inventory.map((f, i) => (
                  <div className="row" key={i} data-testid={`inventory-item-${i}`}>
                    <span className="swatch" style={{ background: f.hex }} />
                    <input className="mono" style={{ width: 84 }} data-testid={`inventory-hex-${i}`} value={f.hex} onChange={(e) => setInventory(inventory.map((x, j) => (j === i ? { ...x, hex: e.target.value } : x)))} placeholder="#RRGGBB" />
                    <input data-testid={`inventory-name-${i}`} value={f.name} onChange={(e) => setInventory(inventory.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="名稱（廠牌/色名）" />
                    <button data-testid={`inventory-del-${i}`} onClick={() => setInventory(inventory.filter((_, j) => j !== i))}><i className="mdi mdi-delete-outline" /></button>
                  </div>
                ))}
              </div>
              <div className="row">
                <button data-testid="inventory-add" onClick={() => setInventory([...inventory, { name: '', hex: '#FFFFFF' }])}><i className="mdi mdi-plus" /> 新增線材</button>
                <button className="primary" data-testid="inventory-save" onClick={async () => {
                  const r = await window.api.setInventory(inventory);
                  if (r.error) return setInvMsg(r.error);
                  setInventory(r.inventory);
                  setInvMsg(`已儲存 ${r.inventory.length} 條線材。建議捲色會優先從這裡挑。`);
                }}>儲存線材庫</button>
              </div>
              {invMsg && <p className="small" data-testid="inventory-message">{invMsg}</p>}
            </fieldset>
          )}
        </div>
        <footer>
          <span className="spacer" />
          <button className="primary" data-testid="settings-done" onClick={onClose}>完成</button>
        </footer>
      </div>
    </div>
  );
}
