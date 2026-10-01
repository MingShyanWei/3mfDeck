import { PROVENANCE, isUnlabeled } from '../format.js';
import { swatchOf } from '../../core/colorNames.mjs';

export function ProvenanceBadge({ model }) {
  if (isUnlabeled(model)) {
    return (
      <span className="badge badge-warn" title="來源未標，請補上">
        <i className="mdi mdi-help-circle-outline" /> 未標
      </span>
    );
  }
  const p = PROVENANCE[model.provenance_type];
  return (
    <span className={`badge badge-${model.provenance_type}`} title={p.label}>
      <i className={`mdi ${p.icon}`} /> {model.platform || p.label}
    </span>
  );
}

export function MissingBadge({ model }) {
  if (!model.missing) return null;
  return (
    <span className="badge badge-missing" data-testid="missing-badge" title="檔案不在目前的檔案櫃根目錄下">
      <i className="mdi mdi-file-alert-outline" /> 遺失
    </span>
  );
}

export function PlateBadge({ model }) {
  if (!(model.plate_count > 1)) return null;
  return (
    <span className="badge badge-plates" data-testid="plate-badge" title="多盤 3MF">
      <i className="mdi mdi-layers-triple-outline" /> {model.plate_count} 盤
    </span>
  );
}

export function ColorBadge({ model }) {
  if (model.color_count == null) return null;
  return (
    <span className="badge badge-colors" title="paint_color 色數">
      <i className="mdi mdi-palette-outline" /> {model.color_count} 色
    </span>
  );
}

// M17: colour-name badges (top labels by area); `pct` also shows each share
export function ColorLabels({ labels, pct = false, testid = 'color-tags' }) {
  if (!labels?.length) return null;
  return (
    <span className="color-tags" data-testid={testid}>
      {labels.map((l) => (
        <span key={l.label} className="ctag" data-label={l.label} title={`${l.label} ${l.pct}%`}>
          <i className="dot" style={{ background: swatchOf(l.label) || 'conic-gradient(#e33, #3c3, #39f, #e33)' }} />
          {l.label}
          {pct && <small>{l.pct}%</small>}
        </span>
      ))}
    </span>
  );
}

// M18: the project was set up for another printer (not a Snapmaker U1)
export const isNonU1 = (m) => Boolean(m.source_printer) && m.source_printer !== 'Snapmaker U1';
export function U1Badge({ model }) {
  if (!isNonU1(model)) return null;
  return (
    <span className="badge badge-warn" data-testid="u1-badge" title={`專案機型：${model.source_printer}（不是 Snapmaker U1）`}>
      <i className="mdi mdi-printer-3d-off" /> 非 U1
    </span>
  );
}
