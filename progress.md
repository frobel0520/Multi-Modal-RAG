# Progress

## 現況
- **`main` 分支**：初始空白 repo（待合併 SDLC 規劃 PR）
- **進行中分支**：`docs/20261120-initial-planning`
- **正式部署**：尚未部署（目標網址：`https://multi-modal-rag.curio-lab.workers.dev`）
- **專案級別**：產品級（Cloudflare Worker 同源網頁＋API ＋ Google OAuth Owner 白名單登入）

## 進行中與下一步
1. 完成 SDLC 規劃文件（`docs/01-project-plan.md`～`docs/04-mvp-release-gate.md`）並送 PR 審查。
2. 規劃核准後，建立對應 GitHub Issues（T01–T10），依 Task DAG 分批開發。
3. 啟動 T01（專案骨架、CI、lint/typecheck/test 與 `progress.md` 行數檢查）與 T02（Supabase schema migration）。

## 擁有者事前準備（部署與真實整合前必要操作）
- [ ] 建立 Supabase 免費專案（啟用 `pgvector` 與公開唯讀 Storage bucket）
- [ ] 建立 Google Cloud OAuth 2.0 Web Client（授權重新導向 URI 設為本機與正式 Worker 網址）
- [ ] 申請 Google AI Studio Gemini API Key（確認未啟用計費／未綁卡）
- [ ] 設定 GitHub Actions Secrets（`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`）與 Worker Secrets（`wrangler secret put`）

## 已知限制與待辦
- 正式免費額度上限需於 T02/T05 開工前向 Cloudflare、Supabase、Google AI Studio 官方文件二次核對。
- MVP 僅支援單一 Owner 白名單登入與預設精選企業 ESG 報告庫，不開放使用者持久化上傳 PDF。
- 離線建索引（T03）需由擁有者透過 `frobel0520/colab-bridge` 在 Google Colab GPU 執行。
