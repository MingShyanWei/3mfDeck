// M22 (SPEC 3.11): version label from the build time.
import { describe, it, expect } from 'vitest';
import { formatVersion, formatBuildTime, versionLabel, AUTHOR, REPO, REPO_URL } from '../../src/core/version.mjs';

describe('version', () => {
  const t = new Date(2026, 9, 2, 10, 1, 23); // local time
  it('1.<YYMMDDHHMM> of the build time', () => {
    expect(formatVersion(t)).toBe('1.2610021001');
    expect(formatVersion(new Date(2027, 0, 5, 3, 4))).toBe('1.2701050304');
    expect(formatVersion(t)).toMatch(/^1\.\d{10}$/);
  });
  it('tooltip: full build time with seconds and the git hash; dev runs are marked', () => {
    expect(formatBuildTime(t)).toBe('2026-10-02 10:01:23');
    const info = { time: t.toISOString(), commit: '5c298a1' };
    expect(versionLabel(info, true)).toEqual({ version: '1.2610021001', tooltip: '建置時間 2026-10-02 10:01:23 · git 5c298a1' });
    expect(versionLabel(info, false)).toEqual({ version: '1.2610021001 dev', tooltip: '建置時間 2026-10-02 10:01:23 · git 5c298a1 · 開發模式（未打包）' });
  });
  it('author and repository', () => {
    expect([AUTHOR, REPO, REPO_URL]).toEqual(['Caspar Wei', 'github.com/MingShyanWei/3mfDeck', 'https://github.com/MingShyanWei/3mfDeck']);
  });
});
