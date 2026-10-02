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

### 3.2b 遺失記錄（Missing records，M7）
- 「遺失」＝記錄在 DB、檔案不在目前根目錄下（多半因換過根目錄；改根不搬檔）。
- 遺失記錄的處置（清單「遺失」過濾器內）：
  - **重新定位**：選根目錄內或外的檔案，更新 rel_path（根目錄外的檔案確認後搬進櫃）。
  - **移除記錄**：只刪索引、不刪磁碟檔案。
  - **還原**：檔案在 `<root>/.trash/` 時，移回原位。
  - **批次**：多選移除（二次確認）；**依檔名自動找回**——根目錄下遞迴找同名檔案，先列對照預覽（唯一／同名衝突／找不到），確認後套用重新定位。
- 啟動時的遺失 toast 只在**新出現**遺失時提示一次（config 記 `notifiedMissing`），其餘靠過濾器與卡片標記呈現。

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
  2. **耗材映射**（M6 升級；M8 再升級「需混色配方」）：
     - **非混色檔**（paint_color 每面單一值或單一位元）：
       - ΔE ≤ 15 的顏色 → 由**單一捲**直接印（現行最近槽行為）。
       - ΔE > 15 的顏色 → **必須混色**：算出 CMYK 油墨配方（例：綠 ≈ C 50%＋Y 50%、橘 ≈ M 40%＋Y 60%），
         映射模式預覽套用混色估計色（不是硬套最近槽色）。
       - 統計表加「需混色」欄：哪些顏色單捲印不出、各需什麼配方——供「要不要直接買那捲」的線材決策。
     - **Full Spectrum 混色檔**（偵測：paint_color 值對應多捲配置）：
       - **事實基礎（OrcaSlicer 原始碼查證）**：每個面只記一捲耗材；「混色」是相鄰微小面以不同捲交錯排列（halftone）造成的視覺效果，不是逐面多捲混合。
       - 逐面解碼 → 單一捲；統計「哪幾捲參與、各佔多少面」，回答「這檔案會用到哪幾捲」。
       - 「混色估計」著色模式：以 CMYK 油墨模型估計遠看混色效果（頂點平滑內插），UI 明確標「估計值，實際以 Orca 渲染為準」；因 Orca 預覽保留可見細點，估計色與其逐像素不完全一致（ΔE 統計見測試）。
       - 驗證：拿 `FullSpectrum Lizard-U1.3mf` 的 `Metadata/plate_1.png`（Orca 官方預覽圖）對照估計色。
  3. ~~線框~~（M16 移除：無實質用途，App 未做網格診斷）。
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
- （M16 移除）原本「把檔案複製到指定資料夾」的匯出：功能重疊且少用，已連同 API 一併移除。
- 無版本管理需求的多版本：同一模型的多次轉檔就是多個檔案，靠標籤分組即可（明確不做 git 式版本樹）。

### 3.5d 顏色標籤、顏色搜尋與採購建議（M17）
- **顏色標籤（每顆模型）**：匯入時把調色盤的每個顏色對應到一組固定的中文色名
  （黑/白/灰/紅/橙/黃/綠/青/藍/紫/粉/棕/膚/金…，Lab 最近色 + 門檻，超過門檻記「其他」）；
  以面積加權取前 N 名作為該模型的顏色標籤（卡片與詳情面板顯示色名徽章）。
- **顏色搜尋**：側欄新增「顏色」過濾區（色名 + 數量），搜尋框也能用色名查詢；
  資料存 `color_stats.label`（匯入時算好），既有記錄走一次性回填。
- **採購建議（櫃子層級）**：統計整個檔案櫃的面積佔比 → 色名排行，
  結合線材庫算出「建議優先購買哪些顏色」；面板放在顏色過濾區下方或彈窗，
  並可直接把建議色加入線材庫草稿。

### 3.4b 原檔內嵌預覽圖（M19）
- 中間預覽區新增切換：**「3D」／「原檔圖」**（沒有內嵌圖的檔案不顯示這個切換）。
- 「原檔圖」模式顯示 3MF 內嵌的產品截圖：
  1. 優先 `Auxiliaries/.thumbnails/thumbnail_middle.png`（創作者封面，最大），否則 `thumbnail_3mf.png`
  2. `Auxiliaries/Model Pictures/*.webp`（創作者實拍照，可切換瀏覽）
  3. `Metadata/plate_N.png`（Orca 盤面渲染）；多盤檔隨盤面切換器連動，顯示對應那盤
- 下方縮圖列可切換所有可用內嵌圖；無內嵌圖（如 Meshy 產出）時整組 UI 隱藏。
- 匯入時把封面存成 DB 欄位（顯示用），其餘圖按需從檔案讀取（單一 zip entry，成本低）。

### 3.4c 卡片縮圖用產品主圖（M21）
- 清單（卡片格與表格）的縮圖優先序：**內嵌封面（產品主圖）→ 3D 渲染縮圖 → 格式圖示**。
  有封面時顯示 3D 檔的產品主圖（`mfimg://cover/<id>`），沒有才用現有 `mfthumb://thumb/<id>`。
- 另需修一個既有缺陷：部分檔案的 3D 縮圖渲染出來是**全黑**（如 `咕咕嘎嘎-U1`，26.8MB）。
  要查根因（相機取景／光照／大檔超時）並修；在修好前，若縮圖近乎全黑應改用格式圖示而不是顯示黑塊。

### 3.5f 線材庫建議的搜尋修正（M31）
缺陷（以使用者真實線材庫實測）：`bestSubset` 用**貪婪加法＋停損規則**（「加一捲沒有改善就 break」），
因此**看不到「兩捲一起才能混出的顏色」**。實例：模型 2 色（黑 92.76%、橘 `#F98C36` 7.24%），
線材庫有黑/紅/黃/洋紅/青/白：
- 貪婪第 1 步選黑；第 2 步單獨加紅或單獨加黃都無法印出橘色 → 判定無改善 → **停止**，只回報 k=1。
- 實際上 **黑＋紅＋黃（k=3）可 100% 涵蓋**：黑單捲印主體，紅＋黃混出橘色（ΔE 0.6）。
- 錯誤結果：App 建議「只裝黑、另外買橘色線材」，而使用者手上就能印。
- **修正**：線材庫規模小（k ≤ min(4, n) 的子集數最多數十種），改為**窮盡列舉所有 k 的子集**，
  以 `compareCoverage` 選最佳、`recommend()` 取最小且 `complete` 的 k；不得再用會提前停止的貪婪捷徑。
  保留局部替換（swap refinement）作為保險，但正確性不得依賴它。
- **驗收**：以上述情境（黑/紅/黃/洋紅/青/白線材庫、2 色模型）驗證——修正後必須回報 k=3（黑＋紅＋黃）、
  可印 100%、不可印 0%，且**不再建議購買橘色線材**；同時列出修正前後的建議對照。

### 3.5e 建議捲色與顏色分析的「誠實數字」（M29）
問題（以 `reindeer_ams-U1.3mf` 實測）：主色佔 97.47% 面積時，面積加權讓細節色（眼睛 0.19%、鼻子 0.23%、鹿角 2.11%）形同不存在，
推薦邏輯只比「覆蓋率 ≥ 95%」就停在 **k=1**，宣稱覆蓋 97.47% 卻有 3 個顏色根本印不出來；每個線捲的百分比也以「最近槽」歸戶，
把該用 32% 洋紅的主色全算給黃色。UI 另有兩句互相矛盾的文案。
- **修正 1（推薦規則）**：不再以面積覆蓋率為唯一停損。必須**所有 distinct 顏色都能印出**（單捲或可混），才可推薦該 k；
  否則明確列出「印不出的顏色」並推薦到下一個能全部涵蓋的 k。
- **修正 2（小面積保護）**：任何顏色只要佔比達下限（`MUST_COVER_PCT`，預設 0.1%）即列為「必須涵蓋」，不得被主色平均掉。
- **修正 3（線捲百分比改按配方分攤）**：以混色印出的顏色，其面積按配方比例分攤到各成分線捲
  （例：97.47% 的 Y68+M32 → Y 66.3%、M 31.4%），而非全歸最近槽；百分比要能反映「每捲實際會用多少」。
- **修正 4（不可印比例要明示）**：覆蓋率旁必須寫出不可印的比例（例：可印 97.66%、不可印 2.34%），不得只給好看的高數字。
- **修正 5（文案矛盾）**：「不需要混色」的判斷改為「每個顏色都能在門檻內對應到某槽」才顯示，
  否則僅顯示「需要混色」那則；且對判定為「建議買線材」的顏色，不得同時並列看似會執行的配方
  （要標明「僅供參考／超標 ΔE」及不買時會用哪個最近捲）。
- **驗收**：以 `reindeer_ams-U1.3mf`（4 色、主色 97.47%）為樣本，列出修正前後「推薦 k、各捲百分比、不可印比例」對照；
  修正後不得再出現「k=1 且 3 色印不出」的建議。

### 3.9 Snapmaker U1 相容性檢查與轉換（M18）
- **偵測**：匯入時與詳情面板顯示用 `project_settings.printer_model` / `printer_settings_id` 判定；
  非 Snapmaker U1（例如 `Bambu Lab P1S/H2S`）→ 卡片與詳情面板顯示警示（含來源機型與 process 名稱），
  匯入時記錄 `source_printer` 供清單過濾（「非 U1」過濾器）。
- **轉換（自寫引擎，不採用第三方程式碼）**：詳情面板警示區提供「轉換為 Snapmaker U1」按鈕 →
  另存為新檔（檔名加 `-U1`，原檔不動，轉換後匯入檔案櫃）。轉換內容：
  1. 讀來源專案設定；依來源噴嘴直徑對應 U1 的 process 家族（0.2/0.4/0.6/0.8），
     寫入 U1 system preset 名稱（`printer_model`/`printer_settings_id`/`print_settings_id`/`filament_settings_id`）。
  2. **相容性修正**（比照社群既有做法，但自行實作）：啟用 Exclude Object、關閉多餘 Brim、
     偵測到可變層高（adaptive layer height）時把 Tree 支撐改為 Hybrid。
  3. **多盤座標換算**：以 U1 的 `printable_area`（270×270、中心 135.5）為基準，
     對照來源機型（同為本機 Orca profile 的資料源）的盤面中心與間距，平移各盤物件；
     保留物件排列、旋轉、縮放、Z 高度與盤間距；無法安全換算的盤整盤不動。
  4. **保留來源線材設定**（最大體積流速、溫度、冷卻等 filament override），
     避免回退成 U1 系統預設。
  5. 沿用既有 3MF 寫入器（paint_color／色表／材質色一律不動）。
- **資料源**：只讀本機 Snapmaker Orca 的 system profiles（`/Applications/Snapmaker Orca.app/Contents/Resources/profiles/`），
  不連網、不內嵌第三方 profile 檔、不複製任何第三方轉換程式碼。
- **驗收**：用使用者櫃子裡的真實非 U1 檔（`Molly茉莉-太空人-13cm.3mf` Bambu H2S、`拉屎茉莉.3mf` P1S、`警徽多色.3mf` P1S）
  轉換後在 Snapmaker Orca GUI 開啟：無相容性警告、盤面物件落在 U1 列印範圍內、色彩／多盤結構完整。

### 3.11 版本號顯示（M22；M28 起格式統一）
- 側欄左下方顯示版本號，格式 **`1.<YYMM>.<DHHMM>`**（例：`1.2610.20146`＝2026-10-02 01:46 建置），
  以**建置時間**為準（打包時注入常數，不用手動改）。日不補零（`2` 而非 `02`），因為 semver 禁止數字段前導零。
- **單一來源**：同一字串同時用於側欄顯示、`package.json`（藉 `extraMetadata` 注入，檔案內 version 仍維持合法 semver）、
  以及打包檔名（`artifactName` 用 `${version}`）。
- 滑鼠移上去顯示完整建置時間（含秒）與 git commit short hash 作為 tooltip。
- dev 模式顯示 dev 版本號（同樣格式、用啟動時間或 dev 標記），不得與安裝版混淆。
- 不得連網查版本（App 全離線）。

### 3.12 多語言（英／繁中／簡中，英文為主）（M24）
- **語言**：`en`（**預設／主要**）、`zh-TW`、`zh-CN`。首次啟動依系統語系自動選，設定頁可手動切換並記住。
- **介面**：所有字串走 i18n（單一 `t(key)` 查表，每個語言一份字典），**不得有硬編字串**；
  連主程序的選單、對話框、錯誤訊息、smoke 會看到的文案都要涵蓋。日期／數字用 `Intl` 依當前語言格式化。
- **色名標籤**：DB 存**語言無關的色名鍵**（例 `black`、`skin`），顯示與搜尋時再依語言轉字（黑／Black／黑），
  且三種語言的色名都要能被搜到（例：打 "white" 或「白」都能找到）。
- **匯出檔名／報告**：檔名後綴（`-量化4捲`、`-U1` 等）依當前語言產生；沒有把握的舊檔名維持原樣。
- **文件**：`README.md` 改為**英文為主**，另附 `README.zh-TW.md`、`README.zh-CN.md`（互加語言切換連結）。
- **不做的**：不連網翻譯、不加第四語言、不改 SPEC.md 的技術內容（內部文件維持繁中）。

### 3.13 版本更新通知（M30；M32 改為預設自動檢查）
- **原則調整（經使用者同意，2026-10-02）**：App 啟動後**預設會自動檢查一次更新**（這是全 App 唯一的網路行為）；
  設定頁可**完全關閉**，關閉後即零網路請求。
- **層 1（常駐、零連線）**：設定頁／About 顯示目前版本（`1.YYMM.DHHMM`）＋「開啟 Releases 頁面」按鈕（交系統瀏覽器）。
- **層 2（預設開啟）**：啟動時自動查 GitHub Releases API，比對最新版的建置標記；
  較新時在側欄顯示**非阻擋式**提示（可關閉、可「略過此版本」，略過記錄存 config）。
  - **頻率限制**：距上次檢查未滿 24 小時就不查（記錄於 config），避免每次啟動都打 API。
  - **不得阻塞啟動**：查詢在背景進行，UI 先出來；失敗（離線、限流、回應異常）一律靜默。
  - **隱私揭露**：查詢會讓 GitHub 看到你的 IP；此事實必須寫在設定頁說明與 README。
- **層 3（明確不做）**：App 內自動下載／安裝更新。macOS 的 Squirrel 自動更新需 Developer ID 簽章（本專案維持 ad-hoc）；
  更新一律由使用者手動下載安裝。
- **版本比對來源**：release notes 內含機器可讀標記（例如 `<!-- build: 1.2610.21310 -->`），
  updater 以此為準，避免受 tag 命名格式變動影響。
- **驗收**：預設即會查（有測試證明）；關閉後零請求（以 stub 攔截證明）；24 小時內不重複查（有測試）；
  有新版時側欄出現提示、同版不出現。

### 3.8 設定頁
- **櫃根目錄**：預設 `~/3mf-library/`，可改成任意路徑（如 iCloud Drive 資料夾）。
  更改根目錄時 App **不自動搬檔**，只把索引切到新路徑並對其重建（DB 中指向舊根的記錄標「遺失」）。
- 設定存在 App 自己的 config（Electron `userData`），不放進櫃根目錄。
- M1 先做最小設定頁：只有根目錄一項。

### 3.5b 匯出 3MF（M9；M16 起按鈕名稱為「匯出 3MF」，量化為內部行為）
- **映射報告匯出（CSV）**：顏色 → 捲槽／混色配方的清單，欄位：原始色、面數、佔比、指定捲槽、ΔE 或配方、備註（單捲／需混色／需購買）。
- **量化 3MF 匯出**：把映射結果寫回一顆新 3MF（不動原檔）——每個色塊的 paint_color 依映射指定到對應捲槽 index，讓 Orca 開啟即完成多色配置，免手動指定。
  - ΔE ≤ 門檻的顏色 → 指定最近捲；超過門檻且無法接受的 → 選「量化到最近捲（並在報告標 ΔE）」或「跳過該面」（匯出時二選一，預設前者）。
  - 需混色/需購買的顏色無法逐面寫入兩捲（Orca 逐面只記一捲），一律量化到最近捲，並在報告中標明。
  - 產出必須在 Snapmaker Orca GUI 實際開啟驗證（CLI 有版本檢查坑，不可作準）：色塊分配與原圖一致、可切片。
- **捲色自訂（設定頁）**：耗材槽顏色可在設定頁自填「實際裝的線材色」（色碼，預設理想 CMYK＃00FFFF/#FF00FF/#FFFF00/#000000＋黑），捲數可 1–4。耗材映射、混色配方、量化匯出全部改用自訂捲色計算——解決「配方用理想色」的限制。

### 3.5c 混色耗材匯出（M10，Full Spectrum virtual extruders）
- 量化 3MF 匯出升級：ΔE ≤ 門檻 → 指定實體捲；需混色 → 寫成 **Mix（虛擬擠出頭）**，Orca 以原生 mixed filament 混色列印。
- `Metadata/project_settings.config` 新增 `mixed_filament_definitions` 列（modern dialect）：
  `compA,compB,1,1,mix_b_percent,0,g,w,m0,z0,xa0,xb0,d0,o0,uN,cm2`，每列兩個實體捲＋B 佔比。
  **虛擬擠出頭編號＝實體捲數＋第 N 個 enabled 未刪除列**（4 捲時第一個 mix = 5）；面以 paint_color state 指向該編號。
- 配方求解用 **FilamentMixer 顏料模型**（ratdoux/OrcaSlicer-FullSpectrum 的 filament_mixer_model.h，MIT，移植自 SamiSalah221/3mf-to-glb 的 TS port）：
  對所有捲對（compA, compB）× mix_b_percent 0–100% 網格搜尋，取 ΔE(CIEDE2000) 最小者；與單捲最近槽比較，單捲 ΔE ≤ 門檻仍用單捲。
- `filament_colour` 陣列維持僅實體捲（虛擬擠出頭顯示色由 Orca 自算）。
- 預覽與報告的「混色估計色」改用同一 FilamentMixer 模型（不再是 halftone 平均），保持匯出前所見＝匯出後所得。
- 驗收：匯出檔在 Snapmaker Orca GUI 開啟，mix 定義被載入（耗材列表出現混合色）、面指定正確、無錯誤；以使用者的 `Filament+Swatch+Sample+Card-U1-量化4捲_mix.3mf` 為 ground truth 對照檔案結構。

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
