# 3mfDeck release manifest

| | |
|---|---|
| App version (sidebar) | **1.2610020134** — built 2026-10-02 01:34:18 (+08:00) |
| Source commit | `cff96c7` (clean tree; all five files come from this one build) |
| Package version (file names) | 0.1.0 |
| Built on | macOS (arm64) with electron-builder 26; Windows and Linux files are cross-built on macOS |
| Release type | Manual: files are uploaded to [GitHub Releases](https://github.com/MingShyanWei/3mfDeck/releases) by hand (no CI) |

## Files

| File | Platform | Architecture | Size (bytes) | SHA256 |
|---|---|---|---:|---|
| `3mfDeck-0.1.0-arm64.dmg` | macOS (Apple silicon) | arm64 | 168,832,337 | `25f4076a36309759aaa2197427e1e45e0daa83c1a276937418fbdd1083c3ebde` |
| `3mfDeck Setup 0.1.0.exe` | Windows installer (NSIS) | x64 | 151,292,745 | `b0e2fd52bfb9c9d327dbcdfe8621b45d5fbe98cc35ac198a3b6f4bda9b210091` |
| `3mfDeck 0.1.0.exe` | Windows portable (no install) | x64 | 151,048,220 | `aa1cfa502fa0a4097dd1a294317e374cafed6c338d392303648738aa0456b0ec` |
| `3mfDeck-0.1.0.AppImage` | Linux (any distribution) | x64 | 169,224,669 | `bf220a0e0f53eb736582a553cc03553ebb3a509e537554b00b9e2a4bbf682af4` |
| `mf-cabinet_0.1.0_amd64.deb` | Linux (Debian / Ubuntu) | x64 (amd64) | 139,198,560 | `1b3379c390c8f7c9e9bd8363b594cefa50e7554feba27d810a39abbb231ef028` |

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

**Linux** — AppImage: `chmod +x 3mfDeck-0.1.0.AppImage && ./3mfDeck-0.1.0.AppImage`. Debian / Ubuntu: `sudo apt install ./mf-cabinet_0.1.0_amd64.deb` (the package is named `mf-cabinet`).

## Verification status

- macOS: the same build is installed in /Applications and passes the end-to-end smoke test.
- Windows / Linux: built and inspected only (correct file types, x64 SQLite native module bundled, deb control metadata); **not run on a real Windows or Linux machine**.

---

## 繁體中文：下載與開啟

- **macOS（arm64）**：`3mfDeck-0.1.0-arm64.dmg`，拖進「應用程式」。**此版未用 Developer ID 簽章（僅 ad-hoc）、未公證**，第一次開啟會被擋：
  - 在「應用程式」裡對 3mfDeck **右鍵 →「打開」→「打開」**；若沒有「打開」按鈕，到 **「系統設定 › 隱私權與安全性」** 按 3mfDeck 訊息旁的 **「強制打開」** 並輸入密碼；或
  - 在終端機執行 `xattr -dr com.apple.quarantine /Applications/3mfDeck.app` 後正常開啟。
  - 若之後要讓使用者下載後免警告，需加入 Apple Developer Program 做簽章＋公證（不在本版範圍）。
- **Windows（x64）**：`3mfDeck Setup 0.1.0.exe`（安裝版）或 `3mfDeck 0.1.0.exe`（免安裝版）。未做程式碼簽章，SmartScreen 若警告請按「其他資訊 → 仍要執行」。
- **Linux（x64）**：`3mfDeck-0.1.0.AppImage`（`chmod +x` 後執行）或 `mf-cabinet_0.1.0_amd64.deb`（`sudo apt install ./mf-cabinet_0.1.0_amd64.deb`）。
- 檔案完整性：用上表的 SHA256 比對（`shasum -a 256 <檔名>`）。
