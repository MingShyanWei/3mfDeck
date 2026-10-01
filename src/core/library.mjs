// Moving files into the library folder. Never overwrites: a name clash
// gets "-2", "-3", ... appended before the extension.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { SUPPORTED_EXTS } from './parse/index.mjs';

export const TRASH_DIR = '.trash';

// Move without ever replacing an existing file: link() and COPYFILE_EXCL
// both fail with EEXIST if `dest` exists.
async function moveNoClobber(src, dest) {
  try {
    await fs.link(src, dest);
  } catch (err) {
    if (err.code !== 'EXDEV' && err.code !== 'EPERM' && err.code !== 'ENOTSUP') throw err;
    await fs.copyFile(src, dest, constants.COPYFILE_EXCL); // cross-volume
  }
  await fs.unlink(src);
}

/**
 * Put `src` into `dir` under its own basename via `place(src, dest)`, which
 * must fail with EEXIST instead of overwriting; on a clash retry with
 * "-2", "-3", ... before the extension. Returns the absolute destination.
 */
async function placeUnique(src, dir, name, place) {
  await fs.mkdir(dir, { recursive: true });
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  for (let i = 1; ; i++) {
    const dest = path.join(dir, i === 1 ? `${stem}${ext}` : `${stem}-${i}${ext}`);
    try {
      await place(src, dest);
      return dest;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
}

/**
 * Move `src` to `<root>/<YYYY>/<basename>` (YYYY = import year), adding a
 * numeric suffix on name clashes. Returns the destination path relative to root.
 */
export async function moveIntoLibrary(src, root, now = new Date()) {
  const dest = await placeUnique(src, path.join(root, String(now.getFullYear())), path.basename(src), moveNoClobber);
  return path.relative(root, dest);
}

/** Move a file to `relDest` under root (suffix on clash). Returns the new rel path. */
export async function moveWithinRoot(root, relSrc, relDest) {
  const dest = await placeUnique(path.join(root, relSrc), path.join(root, path.dirname(relDest)), path.basename(relDest), moveNoClobber);
  return path.relative(root, dest);
}

const isSupported = (p) => SUPPORTED_EXTS.includes(path.extname(p).toLowerCase());

/**
 * Expand dropped/selected paths: files are kept if their extension is
 * supported, folders are walked recursively (hidden entries skipped).
 * Returns { files, skipped }.
 */
export async function collectImportFiles(paths) {
  const files = [];
  const skipped = [];
  const walk = async (p) => {
    const st = await fs.stat(p);
    if (st.isDirectory()) {
      for (const name of (await fs.readdir(p)).sort()) if (!name.startsWith('.')) await walk(path.join(p, name));
    } else if (isSupported(p)) files.push(p);
    else skipped.push(p);
  };
  for (const p of paths) await walk(p);
  return { files, skipped };
}

async function listSupported(root, start) {
  const out = [];
  const walk = async (dir) => {
    for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.')) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) await walk(p);
      else if (isSupported(p)) out.push(path.relative(root, p));
    }
  };
  await walk(start).catch((err) => {
    if (err.code !== 'ENOENT') throw err;
  });
  return out.sort();
}

/** All supported files under root (excluding hidden dirs such as .trash), as root-relative paths. */
export const listLibraryFiles = (root) => listSupported(root, root);

/** Supported files inside <root>/.trash, as root-relative paths (".trash/..."). */
export const listTrashFiles = (root) => listSupported(root, path.join(root, TRASH_DIR));
