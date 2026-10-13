// M33 (SPEC 3.1b): content fingerprints for duplicate detection; names and
// folders do not count.
// M36 (SPEC 3.1b revision): a ZIP file (3MF) is fingerprinted by what is
// inside it — the name, CRC-32 and size of every entry, read from the
// central directory — so the same project packed again at another time (a
// new timestamp in every entry) is still a duplicate. Stored as
// "zip1:<sha256 hex>"; any other file keeps the SHA-256 of its bytes (plain hex).
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFile } from 'node:child_process';

export const ZIP_PREFIX = 'zip1:';

/** SHA-256 (hex) of a file's contents, read as a stream (model files reach hundreds of MB). */
export function hashFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (chunk) => h.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}

async function readAt(fh, position, length) {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, position);
  if (bytesRead !== length) throw new Error('short read');
  return buf;
}

/**
 * The entries of a ZIP file's central directory: [{ name: Buffer, crc, size }]
 * (directories included; ZIP64 aware). Only the end of the file and the
 * directory are read, never the entry data. Throws on anything that is not
 * a well-formed ZIP.
 */
export async function zipEntries(file) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, 22 + 0xffff);
    const tail = await readAt(fh, size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('no end of central directory');
    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      // ZIP64: the locator sits right before the end record
      const loc = eocd - 20;
      if (loc < 0 || tail.readUInt32LE(loc) !== 0x07064b50) throw new Error('no ZIP64 locator');
      const rec = await readAt(fh, Number(tail.readBigUInt64LE(loc + 8)), 56);
      if (rec.readUInt32LE(0) !== 0x06064b50) throw new Error('no ZIP64 end record');
      count = Number(rec.readBigUInt64LE(32));
      cdSize = Number(rec.readBigUInt64LE(40));
      cdOffset = Number(rec.readBigUInt64LE(48));
    }
    const cd = await readAt(fh, cdOffset, cdSize);
    const out = [];
    let p = 0;
    for (let n = 0; n < count; n++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory entry');
      const crc = cd.readUInt32LE(p + 16);
      let entrySize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const name = cd.subarray(p + 46, p + 46 + nameLen);
      if (entrySize === 0xffffffff) {
        // ZIP64 extra field (0x0001): the uncompressed size comes first
        const extra = cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
        for (let e = 0; e + 4 <= extra.length; ) {
          const id = extra.readUInt16LE(e);
          const len = extra.readUInt16LE(e + 2);
          if (id === 0x0001 && len >= 8) entrySize = Number(extra.readBigUInt64LE(e + 4));
          e += 4 + len;
        }
      }
      out.push({ name: Buffer.from(name), crc, size: entrySize });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  } finally {
    await fh.close();
  }
}

const isZip = async (file) => {
  const fh = await fs.promises.open(file, 'r');
  try {
    const head = Buffer.alloc(4);
    const { bytesRead } = await fh.read(head, 0, 4, 0);
    return bytesRead === 4 && head.readUInt32LE(0) === 0x04034b50;
  } finally {
    await fh.close();
  }
};

/**
 * The duplicate-detection fingerprint of a file (M36): for a ZIP, "zip1:" +
 * SHA-256 of its entries (name, CRC-32, size; sorted by name; directories,
 * timestamps and compression left out); for anything else, or a ZIP that
 * cannot be read, the SHA-256 of the bytes.
 */
export async function fingerprintFile(file) {
  if (await isZip(file)) {
    try {
      const entries = (await zipEntries(file)).filter((e) => e.name[e.name.length - 1] !== 0x2f).sort((a, b) => Buffer.compare(a.name, b.name));
      const h = crypto.createHash('sha256');
      for (const e of entries) h.update(`${e.name.toString('hex')} ${e.crc.toString(16).padStart(8, '0')} ${e.size}\n`);
      return ZIP_PREFIX + h.digest('hex');
    } catch {
      // not a readable ZIP: fall back to the bytes
    }
  }
  return hashFile(file);
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
