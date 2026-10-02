// M30 (SPEC 3.13): the optional update check, and proof that it makes no
// request while switched off.
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { checkForUpdate, parseBuildMarker, buildMarker, compareVersions, RELEASES_URL, LATEST_RELEASE_API } from '../../src/core/updateCheck.mjs';
import { releaseNotes } from '../../scripts/release-notes.mjs';
import { loadSettings } from '../../src/core/settings.mjs';
import { tmpDir } from './helpers.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const release = (body, html_url = `${RELEASES_URL}/tag/v1.2610.30000`) => ({ ok: true, json: async () => ({ body, html_url }) });

describe('checkForUpdate', () => {
  it('switched off: no request at all, whatever else is passed', async () => {
    const fetch = vi.fn(async () => release(buildMarker('9.9999.99999')));
    expect(await checkForUpdate({ enabled: false, current: '1.2610.21122', fetch })).toBeNull();
    expect(await checkForUpdate({ enabled: undefined, current: '1.2610.21122', fetch })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(0);
  });

  it('the setting is off by default (fresh config) and only `true` turns it on', async () => {
    const dir = await tmpDir();
    expect(loadSettings(dir, '/r').updateCheck).toBe(false);
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ updateCheck: 'yes' }));
    expect(loadSettings(dir, '/r').updateCheck).toBe(false);
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ updateCheck: true }));
    expect(loadSettings(dir, '/r').updateCheck).toBe(true);
  });

  it('switched on: one request to the latest-release API; a newer build marker is offered', async () => {
    const fetch = vi.fn(async () => release(`Notes\n${buildMarker('1.2610.30000')}\n`));
    expect(await checkForUpdate({ enabled: true, current: '1.2610.21122', fetch })).toEqual({ version: '1.2610.30000', url: `${RELEASES_URL}/tag/v1.2610.30000` });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(LATEST_RELEASE_API);
  });

  it('nothing to offer: same or older build, skipped version, no marker', async () => {
    const run = (body, current = '1.2610.21122', skipped = null) => checkForUpdate({ enabled: true, current, skipped, fetch: async () => release(body) });
    expect(await run(buildMarker('1.2610.21122'))).toBeNull();
    expect(await run(buildMarker('1.2610.9999'))).toBeNull(); // day 9 < day 21
    expect(await run(buildMarker('1.2611.10000'), '1.2610.21122', '1.2611.10000')).toBeNull();
    expect(await run('a release without the marker')).toBeNull();
  });

  it('failures are silent: HTTP error, network error, odd JSON, timeout', async () => {
    const run = (fetch, timeoutMs) => checkForUpdate({ enabled: true, current: '1.2610.21122', fetch, timeoutMs });
    expect(await run(async () => ({ ok: false, status: 403, json: async () => ({}) }))).toBeNull();
    expect(await run(async () => { throw new Error('offline'); })).toBeNull();
    expect(await run(async () => ({ ok: true, json: async () => { throw new SyntaxError('bad json'); } }))).toBeNull();
    const hang = (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    expect(await run(hang, 20)).toBeNull();
  });

  it('only this repository’s release pages are ever opened', async () => {
    const r = await checkForUpdate({ enabled: true, current: '1.2610.21122', fetch: async () => release(buildMarker('1.2611.10000'), 'https://evil.example/x') });
    expect(r.url).toBe(RELEASES_URL);
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
