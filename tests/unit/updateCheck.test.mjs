// M30/M32 (SPEC 3.13): the update check — on by default, at most once per
// 24 h — and proof that it makes no request while switched off.
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { runUpdateCycle, fetchLatestRelease, noticeFor, isCheckDue, CHECK_INTERVAL_MS, parseBuildMarker, buildMarker, compareVersions, RELEASES_URL, LATEST_RELEASE_API } from '../../src/core/updateCheck.mjs';
import { releaseNotes } from '../../scripts/release-notes.mjs';
import { loadSettings } from '../../src/core/settings.mjs';
import { tmpDir } from './helpers.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const release = (body, html_url = `${RELEASES_URL}/tag/v1.2610.30000`) => ({ ok: true, json: async () => ({ body, html_url }) });

const CURRENT = '1.2610.21310';
const NOW = Date.parse('2026-10-02T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const fresh = (extra = {}) => ({ updateCheck: true, lastUpdateCheck: null, updateLatest: null, skippedUpdate: null, ...extra });
const cycle = (settings, fetch, extra = {}) => runUpdateCycle({ settings, current: CURRENT, fetch, now: NOW, ...extra });

describe('M32: on by default, off means no request', () => {
  it('a fresh config and an older config without the field: check ON; only an explicit false turns it off', async () => {
    const dir = await tmpDir();
    expect(loadSettings(dir, '/r').updateCheck).toBe(true);
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ libraryRoot: '/r', spools: ['#000000'] })); // pre-M32 config
    expect(loadSettings(dir, '/r').updateCheck).toBe(true);
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ updateCheck: false }));
    expect(loadSettings(dir, '/r').updateCheck).toBe(false);
  });

  it('default settings: the startup cycle makes the request (proof it checks)', async () => {
    const dir = await tmpDir();
    const fetch = vi.fn(async () => release(buildMarker('1.2610.30000')));
    const r = await cycle(loadSettings(dir, '/r'), fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(LATEST_RELEASE_API);
    expect(r.requested).toBe(true);
    expect(r.notice).toEqual({ version: '1.2610.30000', url: `${RELEASES_URL}/tag/v1.2610.30000` });
    expect(r.save).toEqual({ lastUpdateCheck: new Date(NOW).toISOString(), updateLatest: r.notice });
  });

  it('switched off: zero requests, even when due, forced, or never checked', async () => {
    const fetch = vi.fn(async () => release(buildMarker('9.9999.99999')));
    for (const s of [fresh({ updateCheck: false }), fresh({ updateCheck: false, lastUpdateCheck: '2020-01-01T00:00:00Z' })]) {
      expect(await cycle(s, fetch)).toEqual({ notice: null, requested: false, save: null });
      expect(await cycle(s, fetch, { force: true })).toEqual({ notice: null, requested: false, save: null });
    }
    expect(await fetchLatestRelease({ enabled: false, fetch })).toEqual({ reached: false, latest: null });
    expect(fetch).toHaveBeenCalledTimes(0);
  });
});

describe('M32: at most one check per 24 hours', () => {
  it('isCheckDue: never checked / >= 24 h ago / clock set back -> due; < 24 h -> not', () => {
    expect(isCheckDue(null, NOW)).toBe(true);
    expect(isCheckDue(new Date(NOW - 24 * HOUR).toISOString(), NOW)).toBe(true);
    expect(isCheckDue(new Date(NOW - 23.9 * HOUR).toISOString(), NOW)).toBe(false);
    expect(isCheckDue(new Date(NOW - 1000).toISOString(), NOW)).toBe(false);
    expect(isCheckDue(new Date(NOW + HOUR).toISOString(), NOW)).toBe(true);
    expect(CHECK_INTERVAL_MS).toBe(24 * HOUR);
  });

  it('repeated starts within 24 h: one request in total; the notice still comes from the stored release', async () => {
    const fetch = vi.fn(async () => release(buildMarker('1.2610.30000')));
    let settings = fresh();
    const notices = [];
    for (let i = 0; i < 5; i++) { // five launches, an hour apart
      const r = await cycle(settings, fetch, { now: NOW + i * HOUR });
      if (r.save) settings = { ...settings, ...r.save };
      notices.push(r.notice?.version);
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(notices).toEqual(Array(5).fill('1.2610.30000'));
    // 24 h after the first check: checked again
    await cycle(settings, fetch, { now: NOW + 24 * HOUR });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('switching the check back on (force) ignores the 24 h wait', async () => {
    const fetch = vi.fn(async () => release(buildMarker('1.2610.30000')));
    await cycle(fresh({ lastUpdateCheck: new Date(NOW - HOUR).toISOString() }), fetch, { force: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('offline saves nothing (the next start retries); an HTTP error is an answer and counts', async () => {
    const offline = await cycle(fresh(), async () => { throw new Error('offline'); });
    expect(offline).toMatchObject({ requested: true, save: null, notice: null });
    const limited = await cycle(fresh(), async () => ({ ok: false, status: 403, json: async () => ({}) }));
    expect(limited.save).toEqual({ lastUpdateCheck: new Date(NOW).toISOString(), updateLatest: null });
  });
});

describe('notice: newer only, not skipped, failures silent', () => {
  it('newer -> notice; same, older, skipped or no marker -> none', async () => {
    const run = (body, skipped = null) => cycle(fresh({ skippedUpdate: skipped }), async () => release(body)).then((r) => r.notice);
    expect(await run(buildMarker('1.2610.30000'))).toMatchObject({ version: '1.2610.30000' });
    expect(await run(buildMarker(CURRENT))).toBeNull();
    expect(await run(buildMarker('1.2610.9999'))).toBeNull(); // day 9 < day 21
    expect(await run(buildMarker('1.2611.10000'), '1.2611.10000')).toBeNull();
    expect(await run('a release without the marker')).toBeNull();
    expect(noticeFor({ version: '1.2611.10000', url: RELEASES_URL }, CURRENT, null)).toMatchObject({ version: '1.2611.10000' });
  });

  it('failures are silent: HTTP error, network error, odd JSON, timeout', async () => {
    const run = (fetch, timeoutMs) => fetchLatestRelease({ enabled: true, fetch, timeoutMs });
    expect(await run(async () => ({ ok: false, status: 403, json: async () => ({}) }))).toEqual({ reached: true, latest: null });
    expect(await run(async () => { throw new Error('offline'); })).toEqual({ reached: false, latest: null });
    expect(await run(async () => ({ ok: true, json: async () => { throw new SyntaxError('bad json'); } }))).toEqual({ reached: true, latest: null });
    const hang = (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    expect(await run(hang, 20)).toEqual({ reached: false, latest: null });
  });

  it('only this repository’s release pages are ever opened', async () => {
    const r = await fetchLatestRelease({ enabled: true, fetch: async () => release(buildMarker('1.2611.10000'), 'https://evil.example/x') });
    expect(r.latest.url).toBe(RELEASES_URL);
  });

  it('version comparison is numeric per part', () => {
    expect(compareVersions('1.2610.100000', '1.2610.92359')).toBeGreaterThan(0);
    expect(compareVersions('1.2611.10000', '1.2610.312359')).toBeGreaterThan(0);
    expect(compareVersions('1.2610.21122', '1.2610.21122')).toBe(0);
  });
});

describe('release notes carry the build marker', () => {
  it('first line is the marker the update check reads back', () => {
    const notes = releaseNotes({ version: '1.2610.21122', builtAt: '2026-10-02 11:22:33', commit: 'abc1234' }, [{ name: '3mfDeck-1.2610.21122-arm64.dmg', size: 132640425, sha256: 'ab'.repeat(32) }]);
    expect(notes.split('\n')[0]).toBe('<!-- build: 1.2610.21122 -->');
    expect(parseBuildMarker(notes)).toBe('1.2610.21122');
    expect(notes).toContain('| `3mfDeck-1.2610.21122-arm64.dmg` | 132,640,425 |');
    expect(() => releaseNotes({ commit: 'x' }, [])).toThrow(/no valid version/);
  });

  it('the release manifest carries the marker of its build', () => {
    const manifest = fs.readFileSync(path.join(ROOT, 'docs/release-manifest.md'), 'utf8');
    const v = parseBuildMarker(manifest);
    expect(v).toMatch(/^1\.\d{4}\.[1-9]\d{4,5}$/);
    expect(manifest).toContain(`**${v}**`);
  });
});

describe('the update check is the only network code', () => {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(mjs|cjs|js|jsx)$/.test(e.name)) files.push(p);
    }
  };
  walk(path.join(ROOT, 'src'));
  walk(path.join(ROOT, 'electron'));
  const NET = /\bfetch\s*\(|net\.request|net\.fetch|https?\.(get|request)\s*\(|XMLHttpRequest|new WebSocket|EventSource\s*\(/;

  it('no request API outside updateCheck.mjs, except main passing net.fetch into it', () => {
    const hits = [];
    for (const f of files) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (NET.test(line) && !/^\s*(\/\/|\*)/.test(line)) hits.push(`${path.relative(ROOT, f)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits.filter((h) => !h.startsWith('src/core/updateCheck.mjs:'))).toEqual([
      expect.stringMatching(/^electron\/main\.mjs:\d+: fetch: \(url, opts\) => net\.fetch\(url, opts\),$/),
    ]);
  });
});
