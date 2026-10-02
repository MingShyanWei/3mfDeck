import { useEffect, useState } from 'react';
import { DEFAULT_SPOOLS } from '../../core/filament.mjs';
import { t, LANGS, LANG_NAMES } from '../../core/i18n/index.mjs';
import { FILAMENT_PROFILES_URL } from '../../core/inventoryImport.mjs';

export default function SettingsDialog({ onClose, onRootChanged, onSpoolsChanged, language, onLanguage }) {
  const [settings, setSettings] = useState(null);
  const [message, setMessage] = useState('');
  const [spools, setSpools] = useState(null); // draft spool colours
  const [spoolMsg, setSpoolMsg] = useState('');
  const [inventory, setInventory] = useState(null); // draft filament inventory
  const [invMsg, setInvMsg] = useState('');
  const [updateCheck, setUpdateCheck] = useState(true); // M32: on by default (the saved value replaces it before the box is shown)
  const [version, setVersion] = useState(null);

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setSettings(s);
      setSpools(s.spools);
      setInventory(s.inventory || []);
      setUpdateCheck(s.updateCheck === true);
    });
    window.api.appInfo().then((i) => setVersion(i.version));
  }, []);

  const setCount = (n) => setSpools(Array.from({ length: n }, (_, i) => spools[i] ?? DEFAULT_SPOOLS[i]));
  const setColour = (i, v) => setSpools(spools.map((c, k) => (k === i ? v : c)));
  const saveSpools = async (list) => {
    const r = await window.api.setSpools(list);
    if (r.error) return setSpoolMsg(r.error);
    setSpools(r.spools);
    setSpoolMsg(t('settings.spoolsSaved'));
    onSpoolsChanged(r.spools);
  };

  const change = async () => {
    const r = await window.api.chooseRoot();
    if (!r) return;
    setSettings({ ...settings, libraryRoot: r.libraryRoot });
    setMessage(t('settings.rootSwitched', { indexed: r.indexed, missing: r.missing }));
    onRootChanged();
  };

  return (
    <div className="modal-backdrop">
      <div className="modal narrow" role="dialog" aria-label={t('app.settings')}>
        <header>
          <h2><i className="mdi mdi-cog-outline" /> {t('app.settings')}</h2>
        </header>
        <div className="form">
          <label>
            <span>{t('settings.language')}</span>
            <select data-testid="settings-language" value={language} onChange={(e) => onLanguage(e.target.value)}>
              {LANGS.map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
            </select>
          </label>
          <label>
            <span>{t('settings.root')}</span>
            <div className="row">
              <code className="path" data-testid="settings-root">{settings?.libraryRoot}</code>
              <button data-testid="settings-change-root" onClick={change}>{t('settings.change')}</button>
            </div>
          </label>
          <p className="muted small">{t('settings.rootNote')}</p>
          {message && <p className="ok small" data-testid="settings-message">{message}</p>}
          {spools && (
            <fieldset className="spool-editor" data-testid="spool-editor">
              <legend>{t('settings.spools')}</legend>
              <div className="row">
                <span className="small muted">{t('settings.spoolCount')}</span>
                <select data-testid="spool-count" value={spools.length} onChange={(e) => setCount(Number(e.target.value))}>
                  {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              {spools.map((c, i) => (
                <div className="row" key={i}>
                  <span className="small muted">{t('slot.n', { n: i + 1 })}</span>
                  <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(c) ? c : '#000000'} onChange={(e) => setColour(i, e.target.value.toUpperCase())} />
                  <input className="mono" data-testid={`spool-${i + 1}`} value={c} onChange={(e) => setColour(i, e.target.value)} placeholder="#RRGGBB" />
                </div>
              ))}
              <div className="row">
                <button className="primary" data-testid="spool-save" onClick={() => saveSpools(spools)}>{t('settings.saveSpools')}</button>
                <button data-testid="spool-reset" onClick={() => saveSpools(DEFAULT_SPOOLS)}>{t('settings.resetSpools')}</button>
              </div>
              {spoolMsg && <p className="small" data-testid="spool-message">{spoolMsg}</p>}
            </fieldset>
          )}
          {inventory && (
            <fieldset className="spool-editor" data-testid="inventory-editor">
              <legend>{t('settings.inventory')}</legend>
              <div className="inventory-help small muted" data-testid="inventory-help">
                <p>{t('settings.inv3dfpIntro')}</p>
                <ol>
                  <li>{t('settings.inv3dfpStep1')}</li>
                  <li>{t('settings.inv3dfpStep2')}</li>
                </ol>
                <button className="link-btn" data-testid="inventory-3dfp-link" title={t('footer.openRepo', { url: FILAMENT_PROFILES_URL })} onClick={() => window.api.openFilamentProfiles()}>
                  <i className="mdi mdi-open-in-new" /> {t('settings.inv3dfpOpen')}
                </button>
              </div>
              <div className="inventory-list" data-testid="inventory-list">
                {inventory.map((f, i) => (
                  <div className="row" key={i} data-testid={`inventory-item-${i}`}>
                    <span className="swatch" style={{ background: f.hex }} />
                    <input className="mono" style={{ width: 84 }} data-testid={`inventory-hex-${i}`} value={f.hex} onChange={(e) => setInventory(inventory.map((x, j) => (j === i ? { ...x, hex: e.target.value } : x)))} placeholder="#RRGGBB" />
                    <input data-testid={`inventory-name-${i}`} value={f.name} onChange={(e) => setInventory(inventory.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder={t('settings.inventoryNamePlaceholder')} />
                    <button data-testid={`inventory-del-${i}`} onClick={() => setInventory(inventory.filter((_, j) => j !== i))}><i className="mdi mdi-delete-outline" /></button>
                  </div>
                ))}
              </div>
              <div className="row inventory-actions">
                <button data-testid="inventory-import" onClick={async () => {
                  const r = await window.api.importInventory();
                  if (!r) return;
                  if (r.error) return setInvMsg(r.error);
                  const existing = new Set(inventory.map((f) => f.hex));
                  const add = r.items.filter((f) => !existing.has(f.hex));
                  setInventory([...inventory, ...add]);
                  setInvMsg(t('settings.imported', { n: add.length, dup: add.length < r.items.length ? t('settings.importedDup', { n: r.items.length - add.length }) : '', skipped: r.skipped.length ? t('settings.importedSkipped', { n: r.skipped.length }) : '' }));
                }}><i className="mdi mdi-file-import-outline" /> {t('settings.import3dfp')}</button>
                <button data-testid="inventory-add" onClick={() => setInventory([...inventory, { name: '', hex: '#FFFFFF' }])}><i className="mdi mdi-plus" /> {t('settings.addFilament')}</button>
                <button className="primary" data-testid="inventory-save" onClick={async () => {
                  const r = await window.api.setInventory(inventory);
                  if (r.error) return setInvMsg(r.error);
                  setInventory(r.inventory);
                  setInvMsg(t('settings.inventorySaved', { n: r.inventory.length }));
                }}>{t('settings.saveInventory')}</button>
              </div>
              {invMsg && <p className="small" data-testid="inventory-message">{invMsg}</p>}
            </fieldset>
          )}
          <fieldset className="spool-editor" data-testid="updates-section">
            <legend>{t('settings.updates')}</legend>
            <div className="row">
              <span className="grow" data-testid="settings-version">{t('settings.currentVersion', { version: version ?? '…' })}</span>
              <button data-testid="settings-open-releases" onClick={() => window.api.openReleases()}><i className="mdi mdi-open-in-new" /> {t('settings.openReleases')}</button>
            </div>
            {/* shown once the saved value is loaded: before that it would show (and act on) a guess */}
            {settings && (
              <label className="row check">
                <input type="checkbox" data-testid="settings-update-check" checked={updateCheck} onChange={async (e) => {
                  const on = e.target.checked;
                  setUpdateCheck(on);
                  await window.api.setUpdateCheck(on);
                }} />
                <span>{t('settings.updateCheck')}</span>
              </label>
            )}
            <p className="small muted" data-testid="update-check-note">{t('settings.updateCheckNote')}</p>
            <p className="small muted" data-testid="update-manual-note">{t('settings.manualUpdateNote')}</p>
          </fieldset>
        </div>
        <footer>
          <span className="spacer" />
          <button className="primary" data-testid="settings-done" onClick={onClose}>{t('common.done')}</button>
        </footer>
      </div>
    </div>
  );
}
