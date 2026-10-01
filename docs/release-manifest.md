# 3mfDeck release manifest

| | |
|---|---|
| App version (sidebar) | **1.2610020146** — built 2026-10-02 01:46:22 (+08:00) |
| Source commit | `02e8671` (clean tree; all five files come from this one build) |
| Package version (file names) | 0.1.0 |
| Built on | macOS (arm64) with electron-builder 26; Windows and Linux files are cross-built on macOS |
| Release type | Manual: files are uploaded to [GitHub Releases](https://github.com/MingShyanWei/3mfDeck/releases) by hand (no CI) |

## Files

| File | Platform | Architecture | Size (bytes) | SHA256 |
|---|---|---|---:|---|
| `3mfDeck-0.1.0-arm64.dmg` | macOS (Apple silicon) | arm64 | 132,640,266 | `80d13c8802eb86af3b48c89fb506d9d0a3334a6ff4efd8d735706ee0cdcc2ef5` |
| `3mfDeck Setup 0.1.0.exe` | Windows installer (NSIS) | x64 | 115,589,714 | `ff18a00608696da76cb98b3d1bc85b3030a7615c81ee3cdb92d18a1302994533` |
| `3mfDeck 0.1.0.exe` | Windows portable (no install) | x64 | 115,345,135 | `fe00d12700be7528f8f6a1db365cf96ecc2c9a8d17eebf5094afc26e14ef6c12` |
| `3mfDeck-0.1.0.AppImage` | Linux (any distribution) | x64 | 133,355,060 | `ab080336c3800c985d794059ebb4c5e78616ad7cf489e2ef04b356a247eacf3a` |
| `3mfdeck_0.1.0_amd64.deb` | Linux (Debian / Ubuntu) | x64 (amd64) | 105,971,904 | `5d20ea9e8d2fd0ba1e99378e14e0df9d7b3d95281f13fda383b672dbf2f7c685` |

Check a download: `shasum -a 256 <file>` (macOS / Linux) or `Get-FileHash <file> -Algorithm SHA256` (Windows PowerShell), and compare with the table.

## Signing

- **macOS: not signed with a Developer ID (ad-hoc signature only), not notarized.** Gatekeeper blocks the first launch. Downloading without that warning would need Apple Developer Program signing plus notarization, which is **not in scope for this release**.
- **Windows: not code-signed.** SmartScreen may warn on first run.
- **Linux:** no signing.

## Download and open

**macOS** — open the `.dmg` and drag 3mfDeck into Applications. On first launch, either:
- right-click (Control-click) 3mfDeck in Applications → **Open** → **Open**; if macOS shows no Open button, go to **System Settings › Privacy & Security**, click **Open Anyway** next to the 3mfDeck message, and confirm with your password; or
- run `xattr -dr com.apple.quarantine /Applications/3mfDeck.app` in Terminal, then open it normally.

**Windows** — run `3mfDeck Setup 0.1.0.exe` to install (you can choose the folder), or run `3mfDeck 0.1.0.exe` directly without installing. If SmartScreen says “Windows protected your PC”, click **More info → Run anyway**.

**Linux** — AppImage: `chmod +x 3mfDeck-0.1.0.AppImage && ./3mfDeck-0.1.0.AppImage`. Debian / Ubuntu: `sudo apt install ./3mfdeck_0.1.0_amd64.deb` (the package is named `3mfdeck`; remove it with `sudo apt remove 3mfdeck`).

## Verification status

- macOS: the same build is installed in /Applications and passes the end-to-end smoke test.
- Windows / Linux: built and inspected only (correct file types, x64 SQLite native module bundled, deb control metadata); **not run on a real Windows or Linux machine**.
- Package contents: every `app.asar` holds only `dist/`, `electron/`, `src/core/`, `package.json` and the runtime `node_modules` (checked for all five files).

---

## 繁體中文：下載與開啟

- **macOS（arm64）**：`3mfDeck-0.1.0-arm64.dmg`，拖進「應用程式」。**此版未用 Developer ID 簽章（僅 ad-hoc）、未公證**，第一次開啟會被擋：
  - 在「應用程式」裡對 3mfDeck **右鍵 →「打開」→「打開」**；若沒有「打開」按鈕，到 **「系統設定 › 隱私權與安全性」** 按 3mfDeck 訊息旁的 **「強制打開」** 並輸入密碼；或
  - 在終端機執行 `xattr -dr com.apple.quarantine /Applications/3mfDeck.app` 後正常開啟。
  - 若之後要讓使用者下載後免警告，需加入 Apple Developer Program 做簽章＋公證（不在本版範圍）。
- **Windows（x64）**：`3mfDeck Setup 0.1.0.exe`（安裝版）或 `3mfDeck 0.1.0.exe`（免安裝版）。未做程式碼簽章，SmartScreen 若警告請按「其他資訊 → 仍要執行」。
- **Linux（x64）**：`3mfDeck-0.1.0.AppImage`（`chmod +x` 後執行）或 `3mfdeck_0.1.0_amd64.deb`（`sudo apt install ./3mfdeck_0.1.0_amd64.deb`）。
- 檔案完整性：用上表的 SHA256 比對（`shasum -a 256 <檔名>`）。
