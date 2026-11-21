# Multi-Modal-RAG

針對台灣上市企業公開 **ESG 永續報告書** 打造的 Multi-Modal RAG（多模態檢索增強生成）圖表與數據問答系統。支援**純文字提問**與**上傳圖表截圖提問**，以原報告頁圖進行視覺推理並附上頁碼引用，證據不足時明確拒答。

## 專案狀態

- **階段**：SDLC 規劃中（`docs/01`～`docs/04` 草案完成，待核准後啟動實作）
- **專案級別**：產品級（Cloudflare Pages + Pages Functions 同源網頁＋API，MVP 採 Google OAuth Owner 白名單登入）
- **正式部署**：尚未部署（目標網址：`https://multi-modal-rag.pages.dev`）
- **最新進度**：見 [`progress.md`](progress.md)

## 核心能力（MVP 目標）

1. **精選公開 ESG 報告庫**：涵蓋台積電、聯發科、鴻海三家企業最新年度繁體中文公開 ESG 報告書之核心量化與圖表章節（約 180–240 頁）。
2. **雙模態提問**：
   - 文字提問（單公司數據查詢、跨公司指標比較）
   - 上傳圖表／表格截圖提問（比對官方原頁、定位出處或跨公司對照；截圖僅於當次請求記憶體處理，不落地儲存）
3. **視覺證據與 Grounding 守門**：回答皆附官方原頁縮圖、報告名稱與頁碼引用；檢索分數不足或證據不支持時明確拒答。
4. **零月費架構**：Google Colab（既有 Pro CU 離線建索引）＋ Supabase 免費層（`pgvector` ＋ Storage）＋ Cloudflare Worker（同源 SPA／API／KV／Workers AI）＋ Gemini API 免費層（含限流與純檢索降級）。

## 文件導覽

- [`docs/01-project-plan.md`](docs/01-project-plan.md)：專案目標、範圍、零月費額度試算與效能門檻
- [`docs/02-system-analysis.md`](docs/02-system-analysis.md)：使用流程、功能／非功能需求與威脅邊界分析
- [`docs/03-system-design.md`](docs/03-system-design.md)：系統架構、資料模型、API 契約、ADR 與 Task DAG
- [`docs/04-mvp-release-gate.md`](docs/04-mvp-release-gate.md)：MVP 發布門檻、評測標準、部署驗證與 Rollback 計畫
- [`AGENTS.md`](AGENTS.md)：跨專案規範引用與本 repo 協作規則
