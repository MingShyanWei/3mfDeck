// M22 (SPEC 3.11): version label from the build time.
import { describe, it, expect } from 'vitest';
import { formatVersion, formatBuildTime, versionLabel, buildInfo, SEMVER, AUTHOR, REPO, REPO_URL } from '../../src/core/version.mjs';
import { releaseVersion } from '../../scripts/dist.mjs';

describe('version', () => {
  const t = new Date(2026, 9, 2, 10, 1, 23); // local time
  it('M28: 1.<YYMM>.<DHHMM> of the build time, day not zero-padded', () => {
    expect(formatVersion(t)).toBe('1.2610.21001');
    expect(formatVersion(new Date(2026, 9, 2, 1, 46))).toBe('1.2610.20146');
    expect(formatVersion(new Date(2027, 0, 5, 3, 4))).toBe('1.2701.50304');
    expect(formatVersion(new Date(2026, 9, 12, 9, 5))).toBe('1.2610.120905');
  });

  it('M28: always strict semver (no leading zero) and increasing with time', () => {
    const dates = [];
    for (const day of [1, 9, 10, 31]) for (const [h, m] of [[0, 0], [0, 1], [9, 59], [23, 59]]) dates.push(new Date(2026, 11, day, h, m));
    dates.push(new Date(2027, 0, 1, 0, 0));
    const versions = dates.map(formatVersion);
    for (const v of versions) expect([v, SEMVER.test(v)]).toEqual([v, true]);
    expect(SEMVER.test('1.2610.020146')).toBe(false); // why the day is not padded
    const cmp = (a, b) => { const x = a.split('.').map(Number); const y = b.split('.').map(Number); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
    for (let i = 1; i < versions.length; i++) expect([versions[i - 1], versions[i], cmp(versions[i - 1], versions[i]) < 0]).toEqual([versions[i - 1], versions[i], true]);
  });

  it('M28: build-info carries the stamp; the label uses it as written, not recomputed in the viewer time zone', () => {
    const info = buildInfo(new Date(2026, 9, 2, 1, 46, 22), 'abc1234');
    expect(info).toMatchObject({ version: '1.2610.20146', builtAt: '2026-10-02 01:46:22', commit: 'abc1234' });
    // a viewer elsewhere: the stored strings win over the ISO time
    const shifted = { ...info, time: '2026-10-01T05:00:00.000Z' };
    expect(versionLabel(shifted, true)).toEqual({ version: '1.2610.20146', tooltip: '建置時間 2026-10-02 01:46:22 · git abc1234' });
    expect(versionLabel(shifted, false).version).toBe('1.2610.20146 dev');
    expect(releaseVersion(info)).toBe('1.2610.20146');
    expect(() => releaseVersion({ time: info.time, commit: 'x' })).toThrow(/no valid version/);
    expect(() => releaseVersion({ version: '1.2610.020146' })).toThrow(/no valid version/);
  });
  it('tooltip: full build time with seconds and the git hash; dev runs are marked', () => {
    expect(formatBuildTime(t)).toBe('2026-10-02 10:01:23');
    const info = { time: t.toISOString(), commit: '5c298a1' };
    expect(versionLabel(info, true)).toEqual({ version: '1.2610.21001', tooltip: '建置時間 2026-10-02 10:01:23 · git 5c298a1' });
    expect(versionLabel(info, false)).toEqual({ version: '1.2610.21001 dev', tooltip: '建置時間 2026-10-02 10:01:23 · git 5c298a1 · 開發模式（未打包）' });
  });
  it('author and repository', () => {
    expect([AUTHOR, REPO, REPO_URL]).toEqual(['Caspar Wei', 'github.com/MingShyanWei/3mfDeck', 'https://github.com/MingShyanWei/3mfDeck']);
  });
});
