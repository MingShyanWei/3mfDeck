# 3MF 櫃 — macOS 模型檔案櫃（完整規格 v1.0）

> 狀態：規格已定稿，尚未動工。動工前任何修改需使用者確認。
> 型態：Mac 桌面 Electron App，完全離線，無任何雲端依賴。

## 1. 目標與非目標

### 目標（痛點）
- 3D 模型檔散落各處（Downloads、轉檔暫存…），需要一個集中檔案櫃：匯入、搜尋、預覽、版本、來源紀錄。
- 進 Orca 切片前，先看懂每個 3MF 的顏色結構（paint_color 分布、色數、耗材配置），避免「顏色有點怪」要事後診斷。

### 非目標（明確不做）
- ❌ 切片／列印排程／Orca CLI 整合（以後再議）
- ❌ GLB→3MF 轉檔（用 makertools3d 等現成工具，本程式只管理結果）
- ❌ 連線印表機、看列印狀態
- ❌ 雲端同步、帳號、任何網路功能

## 2. 已拍板的決策

| # | 決策 | 內容 |
|---|------|------|
| D1 | 檔案本體 | 匯入時**搬進** App 管理的集中資料夾（預設 `~/3mf-library/`），不搬的話不給匯入。**根目錄可在設定頁修改**（僅能設定一個根；更改根目錄時 App 不自動搬檔，只索引新路徑下的檔案） |
| D2 | 3D 預覽 | 內建 three.js 即時預覽，**主要賣點**，不是縮圖陽春版 |
| D3 | 開發方式 | 規格先寫死（本文件）再動工；分階段交付，每階段驗收後才做下一階段 |
| D4 | 初始資料 | 從空櫃開始，不做既有檔案盤點匯入 |
| D5 | 來源 | 自產（AI 生成）＋下載兩種來源都要，必須標 provenance |

## 3. 功能規格

### 3.1 匯入（Import）
- 拖放檔案／資料夾到 App 視窗，或選單「匯入…」。
- 支援格式：`.3mf .stl .obj .glb .gltf .step .stp .amf`（與 Snapmaker Orca 官方支援清單一致）。
- **3MF 內嵌 provenance 自動解析**：匯入 3MF 時讀出 BambuStudio/Orca 內嵌的中繼資料
  （Title、Designer、License、Origin、DesignModelId、切片設定…），預填來源欄
  （`type=downloaded`、`platform` 猜 MakerWorld 等），使用者只需補 url／修改。
- 匯入流程（每批）：
  1. 檔案搬進 `~/3mf-library/<YYYY>/<原檔名>`；同名衝突加後綴 `-2`、`-3`…（不覆蓋）。
  2. 解析：3MF 拆 XML 讀 paint_color 分布；GLB 讀內嵌貼圖；STL/OBJ 讀三角數與尺寸。
  3. 跳出「匯入對話框」逐檔填：名稱（預設檔名）、來源（見 3.3）、標籤、備註。
  4. 來源可先略過、之後補，但清單上「來源未標」的項目要有明顯視覺提示。
- 匯入不等於完成紀錄：來源未標的檔案仍在櫃中，只是持續被提醒。

### 3.2 檔案櫃主畫面（Library）
- 左側：標籤樹＋來源過濾器（全部 / Meshy / Thingiverse / 自繪 / 未標…）。
- 中央：卡片牆（縮圖 + 名稱 + 來源徽章 + 色數徽章），支援格狀/清單兩種檢視。
- 頂部：搜尋框（名稱、標籤、備註全文）；排序（匯入日期/名稱/色數）。
- 單檔詳情面板：中繼資料編輯、3D 預覽（見 3.4）、顏色分析（見 3.5）、檔案資訊（大小、三角數、尺寸 mm）。

### 3.3 來源紀錄（Provenance）
每筆記錄一個 provenance 物件：
- `type`：`ai_generated`（AI 生成）/ `downloaded`（下載）/ `self_made`（自繪）/ `unknown`
- `platform`：Meshy / Thingiverse / Printables / 其他（自由填）
- `url`：來源網址（可空）
- `prompt`：AI 生成的原始 prompt（可空，方便重生成）
- `retrieved_at`：取得日期（預設匯入日）
- 清單上以徽章顯示（例：`🤖 Meshy`、`⬇ Printables`、`❓未標`）。

### 3.4 3D 預覽（three.js）
- 即時渲染：可旋轉/縮放/平移（OrbitControls）。
- 著色模式（切換按鈕）：
  1. **原始**：3MF 用 paint_color 上色、GLB 用原貼圖、STL/OBJ 灰色。
     3MF 亦須支援 **basematerials/colorgroup 材質色**（Meshy 等匯出的 3MF 用材質色而非 paint_color）：
     讀取 basematerials 色表與三角面的 materialindex，與 paint_color 合併為「顏色分布」
     （同一檔兩者並存時逐面以 paint_color 優先）。
  2. **耗材映射**：把 paint_color 的顏色量化成最接近的耗材槽色（U1 預設 CMYK 四色），顯示「這檔案會用到哪幾捲」。
  3. **線框**。
- 匯入時離線算一張 512px 縮圖存 DB（清單用，不即時渲染）。

### 3.5 顏色分析面板（3MF 專屬）
- paint_color 值分布表：每個顏色值 → 面數、佔比、長條圖。
- 自動偵測並警示：
  - 「大面積單色被抖色拆成兩個相近值」 → 標記「疑似抖色配對」（你驗過鴨子的案例：42%/35% 兩個值）。
  - 色數 ≤ 4 → 提示「色塊少於 4 色不需混色，量化成實色平塗最乾淨」。
  - 顏色值數量 > 耗材槽數 → 提示「超過 4 色，需 Full Spectrum 混色」。
- 一鍵「在 Finder 顯示」。

### 3.6 多盤 3MF（Multi-plate）
- 一個檔案＝一條櫃中記錄，**不拆檔、不拆條目**（Orca/Bambu 多盤結構拆開易壞且失去關聯）。
- 讀 `Metadata/plate_N.json` 取得盤面清單；一檔多盤時：
  - 卡片與清單顯示「N 盤」徽章；色數徽章顯示**全檔合計**色數。
  - 詳情面板的 3D 預覽提供**盤面切換**（盤 1/2/3…），只顯示該盤的物件。
  - 顏色分析面板**逐盤顯示**分布表與警示（盤面切換時跟著換），另附全檔合計一欄。
  - 縮圖用**第一盤**。
- 單盤檔案（多數）不出現任何盤面 UI，維持原樣。

### 3.7 其他操作
- 刪除：移到 App 內資源回收桶（`~/3mf-library/.trash/`），可還原；「清空回收桶」需二次確認。
- 重新命名、改標籤、改來源：隨時可改。
- 匯出：把檔案複製（不搬）到指定資料夾。
- 無版本管理需求的多版本：同一模型的多次轉檔就是多個檔案，靠標籤分組即可（明確不做 git 式版本樹）。

### 3.8 設定頁
- **櫃根目錄**：預設 `~/3mf-library/`，可改成任意路徑（如 iCloud Drive 資料夾）。
  更改根目錄時 App **不自動搬檔**，只把索引切到新路徑並對其重建（DB 中指向舊根的記錄標「遺失」）。
- 設定存在 App 自己的 config（Electron `userData`），不放進櫃根目錄。
- M1 先做最小設定頁：只有根目錄一項。

## 4. 資料模型（SQLite）

```sql
CREATE TABLE models (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  rel_path      TEXT NOT NULL UNIQUE,   -- 相對 ~/3mf-library/
  format        TEXT NOT NULL,          -- 3mf/stl/obj/glb/gltf/step/step/amf
  size_bytes    INTEGER NOT NULL,
  tri_count     INTEGER,
  bbox_mm       TEXT,                   -- JSON {x,y,z}
  color_count   INTEGER,                -- paint_color 值分布數（3MF 才有）
  thumb         BLOB,                   -- 512px PNG
  provenance_type TEXT,                 -- ai_generated/downloaded/self_made/unknown
  platform      TEXT,
  url           TEXT,
  prompt        TEXT,
  retrieved_at  TEXT,                    -- ISO date
  notes         TEXT,
  imported_at   TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE TABLE tags (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE model_tags (
  model_id INTEGER REFERENCES models(id) ON DELETE CASCADE,
  tag_id   INTEGER REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (model_id, tag_id)
);
CREATE TABLE color_stats (              -- 3MF 的 paint_color 分布（分析用）
  model_id INTEGER REFERENCES models(id) ON DELETE CASCADE,
  color    TEXT,                        -- #RRGGBB
  faces    INTEGER,
  pct      REAL,
  PRIMARY KEY (model_id, color)
);
```

- 原則：**檔案系統為真、DB 只是索引**。DB 開機時對 `~/3mf-library/` 做一致性檢查：檔案在 DB 不在 → 提示重建索引；DB 有檔案不在 → 標「遺失」。

## 5. 技術 Stack

| 層 | 選擇 | 理由 |
|---|------|------|
| 殼 | Electron + electron-builder（dmg） | 桌面離線 App |
| UI | React + Vite | 標準、好找人接手 |
| 3D | three.js + OrbitControls + 3MFLoader | 3MF/GLB/STL 都有現成 loader |
| 3MF 解析 | 自寫（3MF 是 zip + XML）：`jszip` + `fast-xml-parser`，讀 paint_color 逐面值 | three.js 的 3MFLoader 不一定吐 paint_color 分布，自己拆才可控 |
| DB | better-sqlite3（同步、單檔） | 簡單、無服務 |
| 檔案 | `fs` + `fsevents`（watcher 可選） | |
| 測試 | Vitest（解析/量化邏輯單元測試）+ Electron smoke test | |

Node ≥ 20；macOS 26 為目標平台（不做 Win/Linux）。

## 6. 里程碑（每階段驗收通過才進下一階段）

| 階段 | 內容 | 驗收標準 |
|---|---|---|
| M1 | 專案骨架＋匯入（搬檔、解析、中繼資料、來源＋3MF 內嵌 provenance 預填）＋清單＋搜尋＋設定頁（根目錄可改） | 匯入 5 個混合格式檔案（含 Wine-U1.3mf），來源/標籤/搜尋全部正確；Wine-U1.3mf 的來源欄被自動預填；改根目錄後索引指向新路徑 |
| M2 | 3D 預覽（三種著色模式）＋縮圖 | 鴨子 3MF 用 paint_color 正確上色；GLB 顯示貼圖；STL 灰色可轉 |
| M3 | 顏色分析面板（分布表＋三種警示） | 鴨子檔案正確標出「42%/35% 疑似抖色配對」；≤4 色提示出現 |
| M4 | 回收桶、匯出、一致性檢查、打包 dmg | 刪除可還原；拔掉 DB 檔重開 App 能重建索引；dmg 裝到 /Applications 可跑 |

## 7. 驗證素材（沿用實測證據）
- 鴨子 FullSpectrum 3MF（664,130 面、4 色 `#00FFFF/#FF00FF/#FFFF00/#000000`）作為 M1/M2/M3 的標準測試檔。
- 同一顆鴨子的 GLB 原檔（含 baseColorTexture）用於預覽比對。

## 8. 開放問題（動工前需確認）
1. 集中資料夾路徑 `~/3mf-library/` 是否 OK？要放 iCloud/外接碟也行，但 App 只認一個根目錄。
2. App 名稱：暫定「3MF 櫃」，正式名稱動工前定。
