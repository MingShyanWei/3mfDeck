// M30 (SPEC 3.13): update notification. Three layers:
// 1. default, no network: the current version and a button that hands the
//    Releases page to the system browser (shell.openExternal);
// 2. optional, OFF by default: "check for updates (connects to GitHub)" —
//    only then is the GitHub Releases API called; the newest release's build
//    marker (<!-- build: 1.YYMM.DHHMM -->, written by scripts/release-notes.mjs)
//    is compared with this build and a newer one is offered in the sidebar;
// 3. never: downloading or installing inside the app (macOS auto-update needs
//    a Developer ID signature; this app is ad-hoc signed). Updates are always
//    downloaded and installed by hand.
// This module is the app's only network call site, and it makes no request
// unless `enabled` is true.

export const RELEASES_URL = 'https://github.com/MingShyanWei/3mfDeck/releases';
export const LATEST_RELEASE_API = 'https://api.github.com/repos/MingShyanWei/3mfDeck/releases/latest';

const MARKER = /<!--\s*build:\s*(\d+\.\d+\.\d+)\s*-->/;

/** The machine-readable build marker for release notes. */
export const buildMarker = (version) => `<!-- build: ${version} -->`;

/** The build version a release's notes carry, or null. */
export function parseBuildMarker(text) {
  return MARKER.exec(text ?? '')?.[1] ?? null;
}

/** Numeric x.y.z comparison: < 0, 0, > 0. */
export function compareVersions(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/**
 * Ask GitHub for the newest release when — and only when — `enabled`.
 * Returns { version, url } for a newer, not skipped build, else null.
 * Any failure (offline, rate limit, odd response) is silent: null.
 * `fetch` is injected (main passes Electron's net.fetch; tests a stub).
 */
export async function checkForUpdate({ enabled, current, skipped = null, fetch, url = LATEST_RELEASE_API, timeoutMs = 10000 }) {
  if (!enabled) return null; // layer 2 is off: no request at all
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' }, signal: ctrl.signal });
    if (!res.ok) return null;
    const release = await res.json();
    const version = parseBuildMarker(release?.body);
    if (!version || !current || compareVersions(version, current) <= 0 || version === skipped) return null;
    // only ever open this repository's release pages
    const page = typeof release.html_url === 'string' && release.html_url.startsWith(`${RELEASES_URL}/`) ? release.html_url : RELEASES_URL;
    return { version, url: page };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
