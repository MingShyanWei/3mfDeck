# SPEC 草案：3.15 噴嘴尺寸設定與列印設定預設（M34）

> **已於 2026-10-12 併入 SPEC.md**（使用者同意）。之後以 SPEC.md 為準，本檔保留作決策紀錄。

> 草案，待使用者確認後再併入 SPEC.md（SPEC.md 由使用者編修，本檔不直接改 SPEC）。
> 2026-10-10 使用者已拍板：轉 U1 依設定噴嘴；裙邊 10 mm；介面直接做、完成後附截圖。

### 3.15 噴嘴尺寸設定與列印設定預設（M34）

**背景**：使用者機器目前裝 0.4 mm 噴嘴。轉 U1 原本依「原檔」的噴嘴選 U1 設定，別人用 0.2 噴嘴做的檔案會轉成 0.2 設定，與實際機器不符；
匯出 3MF 則固定寫 0.4 噴嘴設定。另需要一組「公仔」列印設定，依 r/PrintedMinis〈FDM miniatures - How I support them and some updates〉
（u/HOHansen，使用者提供 PDF）的原則，換算到使用者的噴嘴。

- **設定頁「噴嘴尺寸」**：0.2／0.4／0.6／0.8 mm（U1 有對應的系統設定檔），預設 0.4，存 userData config。
- **轉換為 Snapmaker U1**：機型、process、線材設定一律依「噴嘴尺寸」設定選擇（不再依原檔噴嘴）；
  原檔噴嘴與設定不同時，轉換報告列出「噴嘴：依設定 X mm（原檔 Y mm）」。
- **匯出 3MF 的「列印設定」下拉**（詳情面板，匯出按鈕旁）：
  - **原檔設定**（預設）：沿用現行匯出（U1 系統設定），機型與 process 依噴嘴設定：0.4 噴嘴＝現行 0.20mm Standard、不寫任何覆寫；
    其他噴嘴改寫該噴嘴的機型（`Snapmaker U1 (<噴嘴> nozzle)`）、最接近 0.2 mm 層高的 process 與該噴嘴的線材設定。
  - **公仔**：以下設定寫入匯出檔的 `project_settings.config`（其餘沿用 U1 系統設定）：

| 設定（Orca key） | 值 | 依據（貼文） |
|---|---|---|
| 機型 `printer_settings_id` | `Snapmaker U1 (<噴嘴> nozzle)` | 噴嘴設定 |
| process `print_settings_id` | 該噴嘴層高最低的 U1 process | — |
| `layer_height` | 該噴嘴最低層高（0.2→0.04、0.4→0.08、0.6→0.12、0.8→0.16） | 層高越低越好 |
| `initial_layer_print_height` | max(0.2, 層高) | 第一層 0.2 讓支撐與裙邊黏牢 |
| `enable_support`／`support_type` | 1／`tree(auto)` | 樹狀支撐 |
| `support_style` | `tree_hybrid` | U1 預設樣式 default＝Organic，Organic 樹幹一律空心、忽略下列填充設定；Tree Hybrid 才會填充（2026-10-12 實測，使用者選定） |
| `support_top_z_distance` | 等於層高 | 複雜件 Top Z＝層高（不要 2 倍） |
| `support_interface_top_layers`／`_bottom_layers` | 0／0 | 不用介面層 |
| `support_base_pattern`／`support_base_pattern_spacing` | `rectilinear`／1.2 mm | 支撐內部要有填充，間距 1–1.5 mm（需搭配上列 Tree Hybrid，見驗收） |
| `brim_type`／`brim_width` | `outer_only`／10 mm | 大裙邊蓋住支撐（寬度由使用者拍板 10 mm） |
| `wall_generator`／`min_feature_size` | `arachne`／30% | Arachne、最小特徵 30% |
| `sparse_infill_pattern` | `lightning` | 非貼文內容，使用者要求縮短時間、內部空心（2026-10-12）：只在頂面需要處填充；密度沿用 U1 預設 15% |
| 線寬（外牆、內牆、頂面、填充、實心填充） | 0.2 噴嘴改 0.2；其他噴嘴沿用 U1 預設 | 線寬約等於噴嘴（0.2 噴嘴用 0.2）；支撐線寬不改 |
| `fan_min_speed`／`fan_max_speed`（每條線材） | 100 | 冷卻約 100% |
| `close_fan_the_first_x_layers`（每條線材） | 1 | 第一層除外 |
| 速度／加速度 | 沿用所選 process | 貼文要求調低但未給數值 |
| 回抽抬升（Z-hop） | 不寫，沿用 U1 預設（機型 0.4 mm Auto Lift，全高度；線材 SnapSpeed 0.4 mm Slope Lift） | 貼文要求開啟，U1 預設已開 |

  - **公仔＋熨燙**（2026-10-11 使用者要求）：公仔設定再加 `ironing_type` = `top`（所有朝上的平面，例如底座頂部）、
    `ironing_spacing` = 噴嘴 × 25%（0.4→0.1）；速度 30、流量 8% 沿用 U1 預設。不用 `topmost`：Orca 只燙物件最後一層（頭頂），燙不到底座。
  - 選「公仔」時提示：「請在 Orca 把模型往後傾 20–45°（可再往左或右 20°）」——擺放角度無法由檔案設定；
    噴嘴為 0.4 時另提示「0.2 噴嘴＋0.04 層高細節更好（貼文作者的設定）」。
- **寫入規則（2026-10-11 使用者在 Orca 實測確認）**：Orca 只採用列在 `different_settings_to_system` 的專案設定值，
  其餘一律退回系統預設（未列清單時支撐未開、沒有裙邊）。因此寫入 `project_settings.config` 的每個覆寫都必須列入該清單：
  `[process 鍵; 線材 1 鍵; …; 線材 n 鍵; 機型鍵]`（以 `;` 連接）。之後新增任何匯出或轉換設定皆同。
- **原檔不動**，只影響新匯出的檔案；全部本機處理，不連網。
- **驗收**：
  - 設定頁可改噴嘴並記住；轉 U1 依設定噴嘴選設定檔（以 0.2 噴嘴原檔、設定 0.4 驗證）。
  - 匯出「公仔」的 3MF 在 Snapmaker Orca GUI 開啟：設定被載入（層高、支撐、裙邊等）、無錯誤或相容性警告、可切片；
    支撐內部填充是否生效列入報告。
  - 2026-10-11 使用者在 Orca GUI 確認：支撐開啟（樹狀）、裙邊、熨燙設定生效。
  - 2026-10-12 支撐內部填充（使用者以 Snapmaker Orca 2.4.0 切片同一隻熊、匯出 G-code）：
    - U1 預設樣式（default＝Organic）下只改 `support_base_pattern`（rectilinear／default）：兩份約 536 萬行，只差 4 行註解，
      所有路徑（含 1,116 段支撐）完全相同——Organic 忽略此設定（Orca 原始碼：smsDefault→smsTreeOrganic，TreeSupport3D 把樹的密度歸零）。
    - 改 `support_style = tree_hybrid`：同層剖面（z 29.96）支撐內部出現間距 1.2 mm 的 rectilinear 填充線（Organic 只有一圈外殼）；
      支撐走線 274 m → 375 m、總用料 153.4 g → 157.4 g、時間 21h51m → 22h12m。**生效**，公仔設定因此加入 `support_style = tree_hybrid`。
  - 2026-10-12 閃電填充：同一隻熊、同上 Tree Hybrid 設定，只改 `sparse_infill_pattern = lightning`，使用者在 Orca 切片預估約 16 小時（原 22h12m）。
  - 「原檔設定」匯出與現行結果相同（0.4 噴嘴）。
