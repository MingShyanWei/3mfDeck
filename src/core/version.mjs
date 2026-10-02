import { t } from './i18n/index.mjs';
// M22 (SPEC 3.11): the version is the build time. M28: it is a valid semver,
// 1.<YYMM>.<DHHMM> in the builder's local time, the day NOT zero-padded —
// semver forbids leading zeros ("1.2610.020146" is invalid). The same string
// names the release files and is shown in the sidebar: `vite build` computes
// it once into build-info.json and scripts/dist.mjs hands that value to
// electron-builder, so the UI never recomputes it (a viewer in another time
// zone would otherwise see a different stamp). Nothing is fetched.
const pad = (n) => String(n).padStart(2, '0');

/** "1.2610.21001" for 2026-10-02 10:01 (local time); "1.2610.120905" for 2026-10-12 09:05. */
export function formatVersion(date) {
  return `1.${pad(date.getFullYear() % 100)}${pad(date.getMonth() + 1)}.${date.getDate()}${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/** Strict semver x.y.z (no leading zeros, no pre-release), what electron-builder accepts for a release. */
export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** What `vite build` writes to build-info.json: the stamp and its display time, fixed at build time. */
export function buildInfo(now, commit) {
  return { time: now.toISOString(), builtAt: formatBuildTime(now), version: formatVersion(now), commit };
}

/** "2026-10-02 10:01:23" (local time) for the tooltip. */
export function formatBuildTime(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * What the sidebar shows. `info` = build-info.json { time (ISO), builtAt, version, commit }
 * (builds before M28 have only time + commit: then both are derived from time);
 * `packaged` = running from the installed app (Electron's app.isPackaged).
 * An unpackaged run (electron . / tests) is labelled dev so it cannot be
 * mistaken for an installed build.
 */
export function versionLabel(info, packaged) {
  const date = new Date(info.time);
  const version = (info.version ?? formatVersion(date)) + (packaged ? '' : ' dev');
  return { version, tooltip: t(packaged ? 'version.tooltip' : 'version.tooltipDev', { time: info.builtAt ?? formatBuildTime(date), commit: info.commit }) };
}

// Author and source repository, shown in the sidebar footer and the About panel.
// Clicking hands the URL to the system browser (shell.openExternal); the app
// itself never makes a network request.
export const AUTHOR = 'Caspar Wei'; // display name; the GitHub account is MingShyanWei
export const REPO = 'github.com/MingShyanWei/3mfDeck';
export const REPO_URL = `https://${REPO}`;
