// M21 (SPEC 3.4c): is a rendered thumbnail "nearly all black"? Such a
// thumbnail (a black silhouette, from before the M21 thumbnail lighting) is
// replaced by the format icon rather than shown as a black blob.
// Measured on real thumbnails: the old 咕咕嘎嘎-U1 silhouette has 100 % of its
// model pixels darker than 24 in every channel; the same model re-rendered
// with the M21 lighting 5.4 %, a black/white/purple Hello Kitty 5.8 %.
export const DARK_LEVEL = 24; // channel value (0-255) below which a pixel counts as black
export const DARK_SHARE = 0.9; // share of model pixels that makes the thumbnail "black"

/** `pixels`: RGBA or BGRA bytes (channel order does not matter for max-of-RGB). */
export function isNearlyBlack(pixels) {
  let opaque = 0;
  let dark = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 200) continue; // background / anti-aliased edge
    opaque++;
    if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) < DARK_LEVEL) dark++;
  }
  return opaque > 0 && dark / opaque >= DARK_SHARE;
}
