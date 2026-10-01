import { PROVENANCE, isUnlabeled } from '../format.js';

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

export function ColorBadge({ model }) {
  if (model.color_count == null) return null;
  return (
    <span className="badge badge-colors" title="paint_color 色數">
      <i className="mdi mdi-palette-outline" /> {model.color_count} 色
    </span>
  );
}
