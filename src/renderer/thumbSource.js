/**
 * M21 (SPEC 3.4c): what a card / row shows — the product cover embedded in
 * the 3MF, else our 3D render (unless it came out as a black blob), else the
 * format icon. Returns { src, source } or null.
 */
export function thumbOf(m) {
  if (m.has_cover) return { src: `mfimg://cover/${m.id}`, source: 'cover' };
  if (m.has_thumb && !m.thumb_dark) return { src: `mfthumb://thumb/${m.id}`, source: 'render' };
  return null;
}
