import { useEffect, useState } from 'react';

export default function SettingsDialog({ onClose, onRootChanged }) {
  const [settings, setSettings] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    window.api.getSettings().then(setSettings);
  }, []);

  const change = async () => {
    const r = await window.api.chooseRoot();
    if (!r) return;
    setSettings({ libraryRoot: r.libraryRoot });
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
        </div>
        <footer>
          <span className="spacer" />
          <button className="primary" data-testid="settings-done" onClick={onClose}>完成</button>
        </footer>
      </div>
    </div>
  );
}
