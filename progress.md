# Progress

## 現況
- **`main` 分支**：已整合 PR #27／#28 的工作階段、查詢限制與 KV 限流修正。
- **正式部署**：Owner 於 2026-11-28 決定暫時不上線。目前以本機與離線驗證為主。
- **Harbor 納管**：保留專案追蹤。公開網址與線上探測待 Owner 決定恢復部署且完成發布後再設定。

## 進行中與下一步
- [ ] **CR-001 第一階段**（Issue #20）：[資料 PR #21](https://github.com/frobel0520/Multi-Modal-RAG/pull/21) 交付 2021–2025 年臺北市臺鐵客運、北捷全線客運與臺北市高鐵進站的 15 筆快照及離線圖表。依序審查資料與下游問答 PR，[問答 PR #23](https://github.com/frobel0520/Multi-Modal-RAG/pull/23) 使用同源快照及本機 OCR，超出範圍或無法核對時拒答。驗證見 [CR-001](docs/05-cr-001-rail-statistics.md)。
- T08（#6）已完成；T03／T04／T09（#7／#9／#8）已於 2026-11-25 由 Owner 取消。

## 暫緩
- **T10**（[Issue #10](https://github.com/frobel0520/Multi-Modal-RAG/issues/10)）：Cloudflare Pages 正式部署、線上資安檢查與 p50／p95 效能驗收暫緩，等 Owner 決定恢復後再排程。既有本機測試與建置產物標頭檢查見 [Pages 離線預檢](docs/evidence/mvp-release-gate.md)。

## 擁有者事前準備（部署與真實整合前必要操作）
- 雲端帳號與金鑰（Supabase、Google OAuth Client、Gemini API Key、GitHub／Worker Secrets）：2026-11-25 Owner 決定短期不做，任務已取消；需要時再重開。

## 已知限制與待辦
- 鐵道問答以離線 HTTP corpus 驗證，文字 6／6、截圖證據 4／4、引用 11／11、拒答 12／12。鐵道問答無 Supabase、Workers AI 或 Gemini 執行依賴。[重跑方式與範圍](docs/05-cr-001-rail-statistics.md#問答驗證)
- 沿用 Owner 白名單；鐵道截圖由瀏覽器本機處理，API 接收可核對的圖表代碼與數值。
