# 01 — 專案規劃（Project Plan）

- **文件狀態**：提案（待擁有者核准）
- **建立日期**：2026-11-20
- **專案級別**：產品級（有正式部署與 Google OAuth Owner 白名單登入）
- **規範來源**：`frobel0520/harbor` 的 `standards/DevelopmentStandards.md`、`standards/DeploymentHandbook.md`、`standards/colab-bridge.md`

---

## 1. 專案目標

打造一個**零月費、可部署上線**的 Multi-Modal RAG 系統，解決純文字 RAG 在面對**高密度圖表、堆疊長條圖、跨頁財務／ESG 統計附表**時資訊流失與數值幻覺的問題。

MVP 階段採 **Owner 專屬使用（Google OAuth 白名單）**，優先驗證多模態檢索準確率、圖表截圖查詢體驗、Grounding 守門與線上延遲；待穩定後可透過架構切換開放公開試用。

---

## 2. 範圍定義

### 2.1 MVP 範圍（In Scope）

1. **精選公開 ESG 報告庫（180–240 頁）**：
   - 對象：**台積電（TSMC）、聯發科（MediaTek）、鴻海（Foxconn）**最新年度公開繁體中文 ESG 永續報告書。
   - 收錄方式：精選各公司核心量化與圖表章節（能源與溫室氣體、水資源與廢棄物、人才與公司治理績效總表），每家約 60–80 頁；保留官方來源 URL、報告年度、章節與頁碼作為固定 `dataset_version`。
   - 授權邊界：本 repo **不重新散布原始 PDF**，僅保存公開來源清單、頁碼範圍與處理腳本；展示用壓縮頁圖存於獨立 Supabase Storage 並附原報告出處連結。
2. **離線多模態索引管線（透過 `frobel0520/colab-bridge`）**：
   - PDF 逐頁轉圖（WebP）上傳至 Supabase Storage。
   - 結合 PDF 原生文字萃取與開源 VLM（`Qwen2.5-VL`）產出每頁結構化描述（圖表標題、年份、單位、關鍵數值）。
   - 使用 `BAAI/bge-m3` 產出 1024 維向量與全文檢索索引，寫入 Supabase PostgreSQL（`pgvector`）。
3. **線上同源網頁與 API（Cloudflare Worker）**：
   - **Google OAuth Owner 白名單登入**：採 `__Host-` `HttpOnly; Secure; SameSite=Strict` session cookie，未登入拒絕所有查詢與資源 API（fail closed）。
   - **純文字提問**：Hybrid 檢索 Top-K 官方頁面 → 送原頁圖給 Gemini 免費層看圖作答 → 回傳答案、結構化引用與原頁縮圖。
   - **上傳圖表截圖提問**：使用者上傳單張圖表／表格截圖（可選填補充文字）→ 解析截圖關鍵資訊 → 檢索對應官方報告頁 → 同步比對使用者截圖與官方原頁作答。上傳圖僅於當次請求記憶體處理，**絕不落地儲存**。
   - **Grounding 守門與降級**：引用頁碼必須存在於檢索候選集；證據不足即明確拒答；若 Gemini 免費層觸及限額（429），自動降級回傳純檢索結果（原頁縮圖＋離線結構化摘要）。
4. **離線評測與效能驗收**：
   - 建立 30–40 題標準評測集（單頁圖表數值、跨公司比較、上傳截圖比對、應拒答題）。
   - 完成正式環境頁面載入與 API p50／p95 效能實測。

### 2.2 非目標（Out of Scope for MVP）

- 不開放一般大眾公開免登入使用（待 Phase 2 評估）。
- 不開放使用者上傳自己的 PDF 並永久存入資料庫。
- 不實作多輪長對話歷史持久化（MVP 以單輪精準問答為主，降低 Token 消耗與資料保存風險）。
- 不實作 ColPali multi-vector 索引（受限於 Supabase 500 MB 免費空間，見 `docs/03-system-design.md` ADR-001）。

---

## 3. 零月費檢核與預估用量（硬性規則）

所有營運項目須符合「每月持續營運費用為 0」且「不開啟需綁定信用卡之付費或免費試用功能」。開工前（T02／T05）須至各平台官方文件二次核對最新免費條款：

| 服務 | 用途 | 免費方案限制（暫估，開工前核對） | MVP 預估用量 | 超額保護與降級 |
|---|---|---|---|---|
| **Google Colab（既有 AI Pro 200 CU）** | 離線轉頁圖、VLM 摘要、BGE-M3 向量化、離線評測 | 既有方案每月約 200 CU，不額外購點 | 240 頁建索引約 5–15 CU（一次性） | 強制 checkpoint 存 Drive ＋ `runtime.unassign()` |
| **Supabase 免費層（免綁卡）** | PostgreSQL `pgvector` ＋ Storage 頁圖 | 500 MB DB、1 GB Storage、每月 5 GB egress | ~15 MB DB、~75 MB Storage | 不開放使用者寫入；僅 Owner 查詢，流量極低 |
| **Cloudflare Workers + KV + Workers AI（免綁卡）** | 同源 SPA＋API、限流計數、`@cf/baai/bge-m3` 查詢向量 | Worker 100k req/日、KV 1k write/日、Workers AI 10k neurons/日 | 單人使用遠低於上限（每日 < 100 次） | 超額拒絕不自動扣費；KV 強制設全站與單人每日查詢上限 |
| **Gemini API 免費層（免綁卡）** | 線上截圖理解與多模態看圖作答 | 依 Google AI Studio 免費層 RPM/RPD 限制 | 每日 < 100 次查詢 | 不綁卡超額回 429；自動降級為純檢索（回傳原頁圖＋離線摘要） |
| **GitHub Actions** | CI（lint/typecheck/test/audit）與 `main` 部署 | Public repo 標準執行器免費 | 每次 PR／push 約 2–3 分鐘 | 僅必要 job 執行 |

---

## 4. 效能與品質驗收門檻（硬性規則）

| 類別 | 指標 | 目標門檻 | 量測環境 |
|---|---|---|---|
| **前端載入** | 首頁 LCP（冷／暖啟動分開記錄） | < 2.5s | 正式 Worker 網址 |
| **API 延遲（文字提問）** | `/api/query`（無圖）p50 / p95 | p50 < 4.0s，p95 < 8.0s | 正式環境實測（樣本數 ≥ 20） |
| **API 延遲（截圖提問）** | `/api/query`（含上傳圖）p50 / p95 | p50 < 6.0s，p95 < 12.0s | 正式環境實測（樣本數 ≥ 15） |
| **檢索品質** | 離線 Eval Set Recall@5 | ≥ 85% | 固定 `dataset_version` |
| **Grounding 守門** | 引用頁碼合法率（皆在候選集內） | 100% | CI + 離線 Eval Set |
| **拒答準確率** | 應拒答題正確拒答率 | ≥ 90% | 離線 Eval Set |
| **離線建索引** | 240 頁總耗時與約略 CU 消耗 | 完整記錄加速器型號、耗時與 CU | Colab GPU（`colab-bridge`） |

---

## 5. 里程碑規劃

1. **M1 — 規劃與基礎骨架（T01–T02）**：SDLC 文件核准、專案骨架、CI、Supabase schema migration。
2. **M2 — 離線索引與資料集就緒（T03–T04）**：完成 3 家企業 ESG 報告來源清單、Colab 建索引腳本與 Supabase 寫入驗證。
3. **M3 — 認證、檢索與多模態 API（T05–T07）**：Google OAuth + `__Host-` session cookie、Hybrid 檢索、Gemini 看圖作答（含上傳截圖）與 Grounding 守門。
4. **M4 — 前端 UI 與離線評測（T08–T09）**：同源前端（文字＋拖拉／貼上截圖提問＋原頁證據檢視器）、Eval Set 評測。
5. **M5 — 正式部署與 Release Gate（T10）**：GitHub Actions 部署至 Cloudflare Worker、資安檢查、正式效能實測與收斂驗收證據。
