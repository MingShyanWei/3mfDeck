// M30 (SPEC 3.13): release notes for a GitHub Release, with the machine-
// readable build marker the optional update check reads
// (<!-- build: 1.YYMM.DHHMM -->), so the check never depends on tag names.
// Lists the release files of this build (from release/) with size and SHA256.
//
// Usage (after the dist scripts): node scripts/release-notes.mjs
//   -> release/RELEASE_NOTES-<version>.md (paste it as the Release description)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMarker } from '../src/core/updateCheck.mjs';
import { releaseVersion } from './dist.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_EXT = /\.(dmg|exe|AppImage|deb)$/;

/** Markdown notes for `info` (build-info.json) and `files` [{name, size, sha256}]; the first line is the build marker. */
export function releaseNotes(info, files) {
  const version = releaseVersion(info);
  return [
    buildMarker(version),
    `**3mfDeck ${version}** — built ${info.builtAt ?? info.time} (commit \`${info.commit}\`)`,
    '',
    '| File | Size (bytes) | SHA256 |',
    '|---|---:|---|',
    ...files.map((f) => `| \`${f.name}\` | ${f.size.toLocaleString('en-US')} | \`${f.sha256}\` |`),
    '',
    'Updates are downloaded and installed by hand; the app never installs updates itself.',
    'macOS: not signed with a Developer ID (ad-hoc) and not notarized — right-click › Open, System Settings › Privacy & Security › Open Anyway, or `xattr -dr com.apple.quarantine /Applications/3mfDeck.app`.',
    'Windows: not code-signed; if SmartScreen warns, More info › Run anyway.',
    '',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const info = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'build-info.json'), 'utf8'));
  const version = releaseVersion(info);
  const dir = path.join(ROOT, 'release');
  const files = fs
    .readdirSync(dir)
    .filter((n) => n.includes(version) && RELEASE_EXT.test(n))
    .sort()
    .map((name) => {
      const buf = fs.readFileSync(path.join(dir, name));
      return { name, size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
    });
  if (!files.length) throw new Error(`no release files for ${version} in release/ (run the dist scripts first)`);
  const out = path.join(dir, `RELEASE_NOTES-${version}.md`);
  fs.writeFileSync(out, releaseNotes(info, files));
  console.log(`${out}: ${files.length} files, marker ${buildMarker(version)}`);
}
