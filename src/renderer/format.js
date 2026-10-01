// Display helpers shared by components.
export const PROVENANCE = {
  ai_generated: { label: 'AI 生成', icon: 'mdi-robot-outline' },
  downloaded: { label: '下載', icon: 'mdi-download' },
  self_made: { label: '自繪', icon: 'mdi-pencil-ruler' },
  unknown: { label: '未標', icon: 'mdi-help-circle-outline' },
};

export const PLATFORM_SUGGESTIONS = ['Meshy', 'Thingiverse', 'Printables', 'MakerWorld'];

export const isUnlabeled = (m) => !m.provenance_type || m.provenance_type === 'unknown';

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export const formatInt = (n) => (n == null ? '—' : n.toLocaleString('zh-TW'));

export const formatBbox = (b) => (b ? `${b.x} × ${b.y} × ${b.z} mm` : '—');

export const formatDate = (iso) => (iso ? iso.slice(0, 10) : '—');
