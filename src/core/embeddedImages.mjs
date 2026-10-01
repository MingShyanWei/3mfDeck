// M19 (SPEC 3.4b): product images embedded in a 3MF project. Pure functions
// over the zip's entry names (no Node APIs), shared by main and tests.

export const IMAGE_MIME = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
export const mimeOf = (p) => IMAGE_MIME[p.split('.').pop().toLowerCase()] || 'application/octet-stream';

const MIDDLE = 'Auxiliaries/.thumbnails/thumbnail_middle.png';
const THUMB = 'Auxiliaries/.thumbnails/thumbnail_3mf.png';
const PHOTO = /^Auxiliaries\/Model Pictures\/[^/]+\.(png|webp|jpe?g)$/i;
const PLATE = /^Metadata\/plate_(\d+)\.png$/; // Orca's plate render (not _small / no_light / top / pick)

/**
 * The images worth showing, in display order, and the cover:
 * { cover: path | null, images: [{path, kind: 'cover'|'thumb'|'photo'|'plate', plate?}] }.
 * Cover priority: thumbnail_middle.png, thumbnail_3mf.png, the first model
 * picture (archive order = the creator's order), Metadata/plate_1.png.
 * Small duplicates (thumbnail_small, plate_N_small, no-light renders,
 * top/pick masks, Profile Pictures) are left out.
 */
export function listEmbeddedImages(names) {
  const has = new Set(names);
  const images = [];
  if (has.has(MIDDLE)) images.push({ path: MIDDLE, kind: 'cover' });
  if (has.has(THUMB)) images.push({ path: THUMB, kind: 'thumb' });
  for (const n of names) if (PHOTO.test(n)) images.push({ path: n, kind: 'photo' });
  const plates = names
    .map((n) => [n, PLATE.exec(n)])
    .filter(([, m]) => m)
    .map(([path, m]) => ({ path, kind: 'plate', plate: Number(m[1]) }))
    .sort((a, b) => a.plate - b.plate);
  images.push(...plates);
  const cover = has.has(MIDDLE) ? MIDDLE : has.has(THUMB) ? THUMB : images.find((i) => i.kind === 'photo')?.path ?? plates.find((p) => p.plate === 1)?.path ?? null;
  return { cover, images };
}

/** The plate render for plate `n`, if the project has one. */
export const plateImage = (embedded, n) => embedded?.images.find((i) => i.kind === 'plate' && i.plate === n)?.path ?? null;
