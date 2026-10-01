import { t, locale } from '../core/i18n/index.mjs';
// Display helpers shared by components.
export const PROVENANCE = {
  ai_generated: { get label() { return t('prov.ai_generated'); }, icon: 'mdi-robot-outline' },
  downloaded: { get label() { return t('prov.downloaded'); }, icon: 'mdi-download' },
  self_made: { get label() { return t('prov.self_made'); }, icon: 'mdi-pencil-ruler' },
  unknown: { get label() { return t('prov.unknown'); }, icon: 'mdi-help-circle-outline' },
};

export const PLATFORM_SUGGESTIONS = ['Meshy', 'Thingiverse', 'Printables', 'MakerWorld'];

export const isUnlabeled = (m) => !m.provenance_type || m.provenance_type === 'unknown';

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export const formatInt = (n) => (n == null ? '—' : n.toLocaleString(locale()));

export const formatBbox = (b) => (b ? `${b.x} × ${b.y} × ${b.z} mm` : '—');

// M24: dates in the UI language (Intl), e.g. 10/02/2026 or 2026/10/02
export const formatDate = (iso) => (iso ? new Intl.DateTimeFormat(locale(), { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)) : '—');
