# Progress

## 現況
- **`main` 分支**：`860e238`（已完成 SDLC、T01、T02、T05、T06、T07、T08 前端 SPA；離線測試 21/21 通過）
- **進行中分支**：`feature/t10-pages-deploy`（切換為 Cloudflare Pages + Pages Functions 與 `.github/workflows/deploy.yml`）
- **正式部署**：尚未部署（目標網址：`https://multi-modal-rag.pages.dev`）
- **Harbor 納管**：`DeploymentHandbook.md` 與 `progress.md` 已同步；待部署後更新為 `pages.dev` 並於 Harbor 主控台 D1 新增記錄

## 進行中與下一步
1. **T08**（Issue #6）：實作同源前端 SPA（Google 登入頁、文字＋拖拉／貼上截圖提問、原頁證據放大檢視器與 CSP `_headers`）。
2. **T03 / T04**（Issue #7 / #9）：建立 3 家公開 ESG 報告來源清單與 `colab-bridge` 離線索引腳本，於 Colab GPU 執行建索引。
3. **T09 / T10**（Issue #8 / #10）：離線 30–40 題 Eval Set 評測、正式部署至 Cloudflare Worker、資安與 p50/p95 效能驗收。

## 擁有者事前準備（部署與真實整合前必要操作）
- [ ] 建立 Supabase 免費專案（啟用 `pgvector`、套用 `migrations/0001_init.sql`、建立公開唯讀 `esg-pages` Storage bucket）
- [ ] 建立 Google Cloud OAuth 2.0 Web Client（授權重新導向 URI 設為本機與正式 Worker 網址）
- [ ] 申請 Google AI Studio Gemini API Key（確認未啟用計費／未綁卡）
- [ ] 設定 GitHub Actions Secrets（`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`）與 Worker Secrets（`wrangler secret put`）

## 已知限制與待辦
- 目前 18 項測試皆為離線 fake/fixture 測試；真實 Supabase、Google OAuth、Workers AI 與 Gemini API 整合皆為「待驗收」。
- MVP 僅支援單一 Owner 白名單登入與預設精選企業 ESG 報告庫，不開放使用者持久化上傳 PDF。
