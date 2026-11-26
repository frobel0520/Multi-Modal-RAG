# Progress

## 現況
- **`main` 分支**：`d668eea`（PR #25 已合併；PR #19 起改用 Cloudflare Pages + Pages Functions）。
- **正式部署**：既有 run `44858853223` 停在必要憑證檢查，切換版尚未取得上線證據（目標網址：`https://multi-modal-rag.pages.dev`）。
- **Harbor 納管**：`DeploymentHandbook.md` 與 `progress.md` 已同步；待部署後更新為 `pages.dev` 並於 Harbor 主控台 D1 新增記錄

## 進行中與下一步
- [ ] **CR-001 第一階段**（Issue #20）：建立臺鐵、北捷、高鐵年度運量資料與圖表。
- [ ] **T10**（Issue #10）：Pages 正式部署、資安檢查與 p50/p95 效能驗收。23 項本機測試與建置產物標頭檢查已通過，見 [Pages 離線預檢](docs/evidence/mvp-release-gate.md)。
- T08（#6）已完成；T03／T04／T09（#7／#9／#8）已於 2026-11-25 由 Owner 取消。

## 擁有者事前準備（部署與真實整合前必要操作）
- 雲端帳號與金鑰（Supabase、Google OAuth Client、Gemini API Key、GitHub／Worker Secrets）：2026-11-25 Owner 決定短期不做，任務已取消；需要時再重開。

## 已知限制與待辦
- 目前 18 項測試皆為離線 fake/fixture 測試；真實 Supabase、Google OAuth、Workers AI 與 Gemini API 整合皆為「待驗收」。
- MVP 僅支援單一 Owner 白名單登入與預設精選企業 ESG 報告庫，不開放使用者持久化上傳 PDF。
