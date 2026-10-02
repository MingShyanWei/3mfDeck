// electron-builder packaging config. A platform-level `files` list that holds
// only exclusions makes electron-builder fall back to "**/*" and package the
// whole project (reports/, tests/, CLAUDE.md, docs/...) into app.asar — this
// shipped in every build from M23 to M27. Each platform list must therefore
// repeat the root allowlist.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../../package.json'), 'utf8'));
const { build } = pkg;

describe('packaging config', () => {
  it('the root files list is an allowlist of app code only', () => {
    expect(build.files.filter((p) => !p.startsWith('!'))).toEqual(['electron/**', 'src/core/**', 'dist/**', 'package.json']);
  });

  it('every platform files list repeats the root allowlist and only adds exclusions', () => {
    for (const platform of ['mac', 'win', 'linux']) {
      const files = build[platform].files ?? build.files;
      for (const p of build.files) expect([platform, files]).toEqual([platform, expect.arrayContaining([p])]);
      const extra = files.filter((p) => !build.files.includes(p));
      expect([platform, extra.every((p) => p.startsWith('!'))]).toEqual([platform, true]);
      expect([platform, files.includes('**/*')]).toEqual([platform, false]);
    }
  });

  it('each platform keeps only its own better-sqlite3 prebuilds', () => {
    const excluded = (platform) => build[platform].files.find((p) => p.includes('prebuilds')) ?? '';
    expect(excluded('mac')).toMatch(/\{win32,linux,linuxmusl\}/);
    expect(excluded('win')).toMatch(/\{darwin,linux,linuxmusl\}/);
    expect(excluded('linux')).toMatch(/\{darwin,win32\}/);
  });

  it('the deb is named after the brand, not the internal npm name (which must stay: it decides userData)', () => {
    expect(pkg.name).toBe('mf-cabinet');
    expect(build.deb).toEqual({ packageName: '3mfdeck', artifactName: '3mfdeck_${version}_${arch}.${ext}' });
    expect(build.linux.maintainer).toBe('Caspar Wei <6902864+MingShyanWei@users.noreply.github.com>');
  });

  it('M28: file names carry the build stamp (${version} = extraMetadata.version from build-info), package.json version stays semver', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(build.dmg.artifactName).toBe('3mfDeck-${version}-${arch}.${ext}');
    expect(build.nsis.artifactName).toBe('3mfDeck-${version}-win-${arch}-setup.${ext}');
    expect(build.portable.artifactName).toBe('3mfDeck-${version}-win-${arch}-portable.${ext}');
    expect(build.appImage.artifactName).toBe('3mfDeck-${version}-linux-x64.${ext}');
    // the AppImage name says x64 literally (its ${arch} would be x86_64): only x64 is built
    expect(build.linux.target.map((t) => t.arch)).toEqual([['x64'], ['x64']]);
    for (const s of ['dist', 'dist:mac', 'dist:win', 'dist:linux']) expect([s, pkg.scripts[s]]).toEqual([s, expect.stringMatching(/^vite build && node scripts\/dist\.mjs /)]);
  });
});
