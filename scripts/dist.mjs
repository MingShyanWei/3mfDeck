// M28: package with the build's version stamp. `vite build` writes the stamp
// (1.<YYMM>.<DHHMM>) into dist/build-info.json; this hands that same string to
// electron-builder as the app version (extraMetadata.version), so the file
// names (artifactName uses ${version}), the packaged package.json and the
// sidebar all show one value. package.json's own "version" stays 0.1.0 and is
// never rewritten.
//
// Usage: node scripts/dist.mjs <electron-builder args>   (after vite build)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEMVER } from '../src/core/version.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The release version from build-info.json; throws when it is missing or not strict semver. */
export function releaseVersion(info) {
  if (!info?.version || !SEMVER.test(info.version)) throw new Error(`build-info.json has no valid version stamp: ${JSON.stringify(info)} (run vite build first)`);
  return info.version;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const info = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'build-info.json'), 'utf8'));
  const version = releaseVersion(info);
  console.log(`dist: version ${version} (commit ${info.commit})`);
  const bin = path.join(ROOT, 'node_modules', '.bin', 'electron-builder');
  const r = spawnSync(bin, [...process.argv.slice(2), `-c.extraMetadata.version=${version}`], { cwd: ROOT, stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
