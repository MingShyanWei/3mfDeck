// M22 (SPEC 3.11): the version is the build time — 1.<YYMMDDHHMM>, local time.
// Injected at `vite build` (vite.config.js define); nothing is fetched.
const pad = (n) => String(n).padStart(2, '0');

/** "1.2610021001" for 2026-10-02 10:01 (local time). */
export function formatVersion(date) {
  return `1.${pad(date.getFullYear() % 100)}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/** "2026-10-02 10:01:23" (local time) for the tooltip. */
export function formatBuildTime(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * What the sidebar shows. `info` = the injected build info { time (ISO), commit };
 * `packaged` = running from the installed app (Electron's app.isPackaged).
 * An unpackaged run (electron . / tests) is labelled dev so it cannot be
 * mistaken for an installed build.
 */
export function versionLabel(info, packaged) {
  const date = new Date(info.time);
  const version = formatVersion(date) + (packaged ? '' : ' dev');
  return { version, tooltip: `建置時間 ${formatBuildTime(date)} · git ${info.commit}${packaged ? '' : ' · 開發模式（未打包）'}` };
}

// Author and source repository, shown in the sidebar footer and the About panel.
// Clicking hands the URL to the system browser (shell.openExternal); the app
// itself never makes a network request.
export const AUTHOR = 'Caspar Wei'; // display name; the GitHub account is MingShyanWei
export const REPO = 'github.com/MingShyanWei/3mfDeck';
export const REPO_URL = `https://${REPO}`;
