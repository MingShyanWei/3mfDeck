import { PROVENANCE, isUnlabeled } from '../format.js';
import { swatchOf, labelName } from '../../core/colorNames.mjs';
import { t } from '../../core/i18n/index.mjs';

export function ProvenanceBadge({ model }) {
  if (isUnlabeled(model)) {
    return (
      <span className="badge badge-warn" title={t('badge.unlabeledTitle')}>
        <i className="mdi mdi-help-circle-outline" /> {t('prov.unknown')}
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
    <span className="badge badge-missing" data-testid="missing-badge" title={t('badge.missingTitle')}>
      <i className="mdi mdi-file-alert-outline" /> {t('badge.missing')}
    </span>
  );
}

export function PlateBadge({ model }) {
  if (!(model.plate_count > 1)) return null;
  return (
    <span className="badge badge-plates" data-testid="plate-badge" title={t('badge.platesTitle')}>
      <i className="mdi mdi-layers-triple-outline" /> {t('badge.plates', { n: model.plate_count })}
    </span>
  );
}

export function ColorBadge({ model }) {
  if (model.color_count == null) return null;
  return (
    <span className="badge badge-colors" title={t('badge.colorsTitle')}>
      <i className="mdi mdi-palette-outline" /> {t('badge.colors', { n: model.color_count })}
    </span>
  );
}

// M17: colour-name badges (top labels by area); `pct` also shows each share
export function ColorLabels({ labels, pct = false, testid = 'color-tags' }) {
  if (!labels?.length) return null;
  return (
    <span className="color-tags" data-testid={testid}>
      {labels.map((l) => (
        <span key={l.label} className="ctag" data-label={l.label} title={`${labelName(l.label)} ${l.pct}%`}>
          <i className="dot" style={{ background: swatchOf(l.label) || 'conic-gradient(#e33, #3c3, #39f, #e33)' }} />
          {labelName(l.label)}
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
    <span className="badge badge-warn" data-testid="u1-badge" title={t('badge.nonU1Title', { printer: model.source_printer })}>
      <i className="mdi mdi-printer-3d-off" /> {t('badge.nonU1')}
    </span>
  );
}

// M33 (SPEC 3.1b): in the 重複 filter, which group of identical files a model belongs to (and where it lives)
export function DupBadge({ model }) {
  if (!model.dupGroup) return null;
  return (
    <span className="badge badge-warn" data-testid="dup-badge" data-group={model.dupGroup} title={model.rel_path}>
      <i className="mdi mdi-content-duplicate" /> {t('badge.dupGroup', { n: model.dupGroup })}
    </span>
  );
}
