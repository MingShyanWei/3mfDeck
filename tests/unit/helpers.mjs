import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const FIXTURES = path.join(import.meta.dirname, '..', 'fixtures');

export async function tmpDir(prefix = 'mfcab-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

// Copy a fixture into `dir` (optionally renamed) so tests can move it.
export async function stage(dir, fixture, as = fixture) {
  await fs.mkdir(dir, { recursive: true });
  const p = path.join(dir, as);
  await fs.copyFile(path.join(FIXTURES, fixture), p);
  return p;
}

export const exists = (p) => fs.access(p).then(() => true, () => false);
