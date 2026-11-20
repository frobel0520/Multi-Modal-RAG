# Progress

## 現況
- **`main` 分支**：已完成初始規範與 SDLC 規劃文件（PR #1 已合併）
- **進行中分支**：`feature/t01-project-scaffold`（T01：專案骨架與 CI，對應 Issue #2）
- **正式部署**：尚未部署（目標網址：`https://multi-modal-rag.curio-lab.workers.dev`）
- **Harbor 納管**：`DeploymentHandbook.md` 登記 PR #133 已開啟（待合併與 Harbor D1 新增記錄）

## 進行中與下一步
1. 完成 T01（Worker + React/Vite 專案骨架、`GET /api/health`、`progress.md` 行數檢查、CI）並開 PR。
2. T01 合併後，平行展開 **T02**（Supabase schema migration，Issue #4）與 **T05**（Google OAuth + `__Host-` session cookie，Issue #11）。

## 擁有者事前準備（部署與真實整合前必要操作）
- [ ] 建立 Supabase 免費專案（啟用 `pgvector` 與公開唯讀 Storage bucket）
- [ ] 建立 Google Cloud OAuth 2.0 Web Client（授權重新導向 URI 設為本機與正式 Worker 網址）
- [ ] 申請 Google AI Studio Gemini API Key（確認未啟用計費／未綁卡）
- [ ] 設定 GitHub Actions Secrets（`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`）與 Worker Secrets（`wrangler secret put`）

## 已知限制與待辦
- 免費額度上限需於 T02／T05 開工前向 Cloudflare、Supabase、Google AI Studio 官方文件二次核對。
- MVP 僅支援單一 Owner 白名單登入與預設精選企業 ESG 報告庫，不開放使用者持久化上傳 PDF。
- 離線建索引（T04）需由擁有者透過 `frobel0520/colab-bridge` 在 Google Colab GPU 執行。
