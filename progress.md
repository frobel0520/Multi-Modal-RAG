# Progress

## 現況
- **`main` 分支**：`a1b1805`（PR #19 已合併，切換為 Cloudflare Pages + Pages Functions）。
- **正式部署**：既有 run `44858853223` 停在必要憑證檢查，切換版尚未取得上線證據（目標網址：`https://multi-modal-rag.pages.dev`）。
- **Harbor 納管**：`DeploymentHandbook.md` 與 `progress.md` 已同步；待部署後更新為 `pages.dev` 並於 Harbor 主控台 D1 新增記錄

## 進行中與下一步
1. **T08**（Issue #6）：實作同源前端 SPA（Google 登入頁、文字＋拖拉／貼上截圖提問、原頁證據放大檢視器與 CSP `_headers`）。
2. **T03 / T04**（Issue #7 / #9）：建立 3 家公開 ESG 報告來源清單與 `colab-bridge` 離線索引腳本，於 Colab GPU 執行建索引。 2026-11-25 暫緩：Owner 取消 T03／T04 與 T09 評測任務。
3. **T09 / T10**（Issue #8 / #10）：真實離線評測、Pages 正式部署、資安與 p50/p95 效能驗收待完成。T10 的 23 項本機測試與建置產物標頭檢查通過，見 [Pages 離線預檢](docs/evidence/mvp-release-gate.md)。

## 擁有者事前準備（部署與真實整合前必要操作）
- 雲端帳號與金鑰（Supabase、Google OAuth Client、Gemini API Key、GitHub／Worker Secrets）：2026-11-25 Owner 決定短期不做，任務已取消；需要時再重開。

## 已知限制與待辦
- 目前 18 項測試皆為離線 fake/fixture 測試；真實 Supabase、Google OAuth、Workers AI 與 Gemini API 整合皆為「待驗收」。
- MVP 僅支援單一 Owner 白名單登入與預設精選企業 ESG 報告庫，不開放使用者持久化上傳 PDF。
