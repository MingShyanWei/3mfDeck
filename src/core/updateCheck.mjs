// M30/M32 (SPEC 3.13): update notification. Three layers:
// 1. always, no network: the current version and a button that hands the
//    Releases page to the system browser (shell.openExternal);
// 2. ON by default (M32), can be switched off in Settings: after startup the
//    GitHub Releases API is asked for the newest release — at most once per
//    24 hours — and its build marker (<!-- build: 1.YYMM.DHHMM -->, written by
//    scripts/release-notes.mjs) is compared with this build; a newer one is
//    offered in the sidebar. This is the app's only network activity and it
//    lets GitHub see the user's IP address. Switched off: no request at all.
// 3. never: downloading or installing inside the app (macOS auto-update needs
//    a Developer ID signature; this app is ad-hoc signed). Updates are always
//    downloaded and installed by hand.

export const RELEASES_URL = 'https://github.com/MingShyanWei/3mfDeck/releases';
export const LATEST_RELEASE_API = 'https://api.github.com/repos/MingShyanWei/3mfDeck/releases/latest';
/** At most one check per this interval (SPEC 3.13: 24 hours). */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

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

/** Whether a check is due: never checked, or the last check is at least `interval` ago (a clock set back counts as due). */
export function isCheckDue(lastCheckedAt, now = Date.now(), interval = CHECK_INTERVAL_MS) {
  const last = Date.parse(lastCheckedAt ?? '');
  return Number.isNaN(last) || now - last >= interval || now < last;
}

/**
 * Ask GitHub for the newest release — only when `enabled`.
 * Returns { reached, latest }: `reached` = GitHub answered (any HTTP status;
 * false when offline / timed out); `latest` = { version, url } of the newest
 * release's build marker, or null. Never throws.
 */
export async function fetchLatestRelease({ enabled, fetch, url = LATEST_RELEASE_API, timeoutMs = 10000 }) {
  if (!enabled) return { reached: false, latest: null }; // switched off: no request at all
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let reached = false;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' }, signal: ctrl.signal });
    reached = true;
    if (!res.ok) return { reached, latest: null };
    const release = await res.json();
    const version = parseBuildMarker(release?.body);
    if (!version) return { reached, latest: null };
    // only ever open this repository's release pages
    const page = typeof release.html_url === 'string' && release.html_url.startsWith(`${RELEASES_URL}/`) ? release.html_url : RELEASES_URL;
    return { reached, latest: { version, url: page } };
  } catch {
    return { reached, latest: null };
  } finally {
    clearTimeout(timer);
  }
}

/** The notice to show for a known latest release: newer than `current` and not skipped, else null. */
export function noticeFor(latest, current, skipped = null) {
  if (!latest?.version || !current || latest.version === skipped) return null;
  return compareVersions(latest.version, current) > 0 ? latest : null;
}

/**
 * One startup (or settings-toggle) cycle. `settings` = loadSettings() result
 * ({ updateCheck, lastUpdateCheck, updateLatest, skippedUpdate }).
 * - switched off: no request, no notice;
 * - checked within the last 24 h (and not `force`): no request, the notice
 *   comes from the release found last time;
 * - otherwise one request; when GitHub answered, the time and the release
 *   are returned in `save` for config.json (offline saves nothing, so the
 *   next start tries again).
 * Returns { notice, requested, save }.
 */
export async function runUpdateCycle({ settings, current, fetch, url, now = Date.now(), force = false, timeoutMs }) {
  if (!settings.updateCheck) return { notice: null, requested: false, save: null };
  if (!force && !isCheckDue(settings.lastUpdateCheck, now)) {
    return { notice: noticeFor(settings.updateLatest, current, settings.skippedUpdate), requested: false, save: null };
  }
  const { reached, latest } = await fetchLatestRelease({ enabled: true, fetch, url, timeoutMs });
  const save = reached ? { lastUpdateCheck: new Date(now).toISOString(), updateLatest: latest } : null;
  const known = reached ? latest : settings.updateLatest;
  return { notice: noticeFor(known, current, settings.skippedUpdate), requested: true, save };
}
