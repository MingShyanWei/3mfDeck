// M33 (SPEC 3.1b): content fingerprints for duplicate detection. A file's
// SHA-256, read as a stream (model files reach hundreds of MB). Two files are
// duplicates only when their bytes are identical; names and folders do not
// count.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFile } from 'node:child_process';

/** SHA-256 (hex) of a file's contents. */
export function hashFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (chunk) => h.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}

/** macOS file flag of a "dataless" file: an iCloud file whose contents are not on this Mac (sys/stat.h). */
export const SF_DATALESS = 0x40000000;

/**
 * Whether `file` is an iCloud placeholder whose contents are not downloaded.
 * Reads only the file flags (`stat -f %f`), which does not trigger a download;
 * reading the contents would. Not macOS, or the flags cannot be read: false.
 */
export function isDataless(file, { platform = process.platform, run = execFile } = {}) {
  if (platform !== 'darwin') return Promise.resolve(false);
  return new Promise((resolve) => {
    run('/usr/bin/stat', ['-f', '%f', file], (err, stdout) => {
      if (err) return resolve(false);
      const flags = Number.parseInt(String(stdout).trim(), 10);
      resolve(Number.isFinite(flags) && (flags & SF_DATALESS) !== 0);
    });
  });
}
