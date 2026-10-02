# 3mfDeck release manifest

| | |
|---|---|
| Version | **1.2610.21122** — built 2026-10-02 11:22:33 (+08:00) |
| Source commit | `38ac66d` (clean tree; all five files come from this one build) |
| Built on | macOS (arm64) with electron-builder 26; Windows and Linux files are cross-built on macOS |
| Release type | Manual: files are uploaded to [GitHub Releases](https://github.com/MingShyanWei/3mfDeck/releases) by hand (no CI) |

## Version format

**`1.<YYMM>.<DHHMM>`** — the build time (builder's local time): year + month, then day + hour + minute. **The day is not zero-padded**, because semver forbids leading zeros: `1.2610.020146` is not a valid version, `1.2610.20146` is (2026-10-02 01:46). Later builds always compare higher.

- One string everywhere: the file names, the version shown at the bottom of the sidebar (installed app; a development run adds “dev”), the packaged app version (macOS `CFBundleShortVersionString`, Windows file version, deb `Version`).
- It is computed once at `vite build` (stored in `build-info.json`) and passed to electron-builder by `scripts/dist.mjs` (`extraMetadata.version`).
- `package.json`'s own `"version"` field stays `0.1.0` (valid semver, never rewritten) and does **not** appear in any file name or in the app.
- Windows limit: the binary version fields in a Windows `.exe` hold at most 65535 per part. From day 7 of a month `DHHMM` is larger (e.g. `312359`), and Windows' Properties › Details then shows `…​.65535.0`; the file name and the app itself still show the full version.

## Files

| File | Platform | Architecture | Size (bytes) | SHA256 |
|---|---|---|---:|---|
| `3mfDeck-1.2610.21122-arm64.dmg` | macOS (Apple silicon) | arm64 | 132,640,425 | `4d1cdd17e40aa63ea40ab7df3303b48e49f2ac50add127c5a6a13545ebf33f29` |
| `3mfDeck-1.2610.21122-win-x64-setup.exe` | Windows installer (NSIS) | x64 | 115,590,134 | `3b3a7c54af3370a5b644df54c30d15b7b18915751d5af350f4f874f0c963f7f9` |
| `3mfDeck-1.2610.21122-win-x64-portable.exe` | Windows portable (no install) | x64 | 115,345,555 | `14af6c5f81f59c5a1c4821644aa78d1d8198c16d1d2c4cdb0fc186ba607eaaa8` |
| `3mfDeck-1.2610.21122-linux-x64.AppImage` | Linux (any distribution) | x64 | 133,355,008 | `1243f10b8ecdcea73dddad86a89772db0393cfc0f160218f577b5e80f619f7b3` |
| `3mfdeck_1.2610.21122_amd64.deb` | Linux (Debian / Ubuntu) | x64 (amd64) | 105,971,920 | `a2ffccbaf19eb14cf509f0a61f9b3ca02785a7ef1090ed387a53f841646ab7aa` |

Check a download: `shasum -a 256 <file>` (macOS / Linux) or `Get-FileHash <file> -Algorithm SHA256` (Windows PowerShell), and compare with the table.

electron-builder also writes `*.blockmap` and `latest*.yml` next to these (auto-update metadata; they reference the same file names). 3mfDeck has no auto-update, so they are **not** part of a release and need not be uploaded.

## Signing

- **macOS: not signed with a Developer ID (ad-hoc signature only), not notarized.** Gatekeeper blocks the first launch. Downloading without that warning would need Apple Developer Program signing plus notarization, which is **not in scope for this release**.
- **Windows: not code-signed.** SmartScreen may warn on first run.
- **Linux:** no signing.

## Download and open

**macOS** — open the `.dmg` and drag 3mfDeck into Applications. On first launch, either:
- right-click (Control-click) 3mfDeck in Applications → **Open** → **Open**; if macOS shows no Open button, go to **System Settings › Privacy & Security**, click **Open Anyway** next to the 3mfDeck message, and confirm with your password; or
- run `xattr -dr com.apple.quarantine /Applications/3mfDeck.app` in Terminal, then open it normally.

**Windows** — run `3mfDeck-1.2610.21122-win-x64-setup.exe` to install (you can choose the folder), or run `3mfDeck-1.2610.21122-win-x64-portable.exe` directly without installing. If SmartScreen says “Windows protected your PC”, click **More info → Run anyway**.

**Linux** — AppImage: `chmod +x 3mfDeck-1.2610.21122-linux-x64.AppImage && ./3mfDeck-1.2610.21122-linux-x64.AppImage`. Debian / Ubuntu: `sudo apt install ./3mfdeck_1.2610.21122_amd64.deb` (the package is named `3mfdeck`; remove it with `sudo apt remove 3mfdeck`).

## Verification status

- macOS: the same build is installed in /Applications and passes the end-to-end smoke test; its sidebar shows `v1.2610.21122`, equal to the packaged app version.
- All five: the packaged `package.json` version is `1.2610.21122`; Windows `FileVersion`/`ProductVersion` `1.2610.21122.0`; deb control `Package: 3mfdeck`, `Version: 1.2610.21122`, `Maintainer: Caspar Wei <6902864+MingShyanWei@users.noreply.github.com>`.
- Windows / Linux: built and inspected only (correct file types, x64 SQLite native module bundled, deb control metadata); **not run on a real Windows or Linux machine**.
- Package contents: every `app.asar` holds only `dist/`, `electron/`, `src/core/`, `package.json` and the runtime `node_modules`.

---

## 繁體中文：版本與下載

- **版本格式**：`1.<YYMM>.<DHHMM>`（建置時間：年月．日時分），**日不補零**——semver 不允許前導零，`1.2610.020146` 不合法、`1.2610.20146` 合法。檔名、側欄顯示（開發版另加「dev」）與 App 版本是同一個字串；`package.json` 的 `version` 維持 `0.1.0`（合法 semver，不出現在檔名或 App 中）。
- **macOS（arm64）**：`3mfDeck-1.2610.21122-arm64.dmg`，拖進「應用程式」。**此版未用 Developer ID 簽章（僅 ad-hoc）、未公證**，第一次開啟會被擋：
  - 在「應用程式」裡對 3mfDeck **右鍵 →「打開」→「打開」**；若沒有「打開」按鈕，到 **「系統設定 › 隱私權與安全性」** 按 3mfDeck 訊息旁的 **「強制打開」** 並輸入密碼；或
  - 在終端機執行 `xattr -dr com.apple.quarantine /Applications/3mfDeck.app` 後正常開啟。
  - 若之後要讓使用者下載後免警告，需加入 Apple Developer Program 做簽章＋公證（不在本版範圍）。
- **Windows（x64）**：`3mfDeck-1.2610.21122-win-x64-setup.exe`（安裝版）或 `3mfDeck-1.2610.21122-win-x64-portable.exe`（免安裝版）。未做程式碼簽章，SmartScreen 若警告請按「其他資訊 → 仍要執行」。
- **Linux（x64）**：`3mfDeck-1.2610.21122-linux-x64.AppImage`（`chmod +x` 後執行）或 `3mfdeck_1.2610.21122_amd64.deb`（`sudo apt install ./3mfdeck_1.2610.21122_amd64.deb`）。
- 檔案完整性：用上表的 SHA256 比對（`shasum -a 256 <檔名>`）。
