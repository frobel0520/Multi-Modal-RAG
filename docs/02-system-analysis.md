# 02 — 系統分析（System Analysis）

- **文件狀態**：提案（待擁有者核准）
- **建立日期**：2026-11-20

---

## 1. 角色與權限邊界

| 角色 | 權限 | 說明 |
|---|---|---|
| **未登入訪客** | 僅可存取登入頁（`/` 顯示登入畫面）與 `/api/auth/login`、`/api/auth/callback`、`/api/health` | 所有查詢、報告清單與檢索 API 一律回傳 `401 Unauthorized`（fail closed） |
| **已登入 Owner** | 完整使用文字提問、上傳截圖提問、檢視報告清單與原頁引用、登出 | Google OAuth 驗證後，email 須完全符合 `OWNER_EMAIL_ALLOWLIST` 且 `email_verified === true` |

---

## 2. 核心使用流程

### 流程 1：Owner 登入與登出
1. 使用者開啟 `https://multi-modal-rag.curio-lab.workers.dev`。
2. 前端呼叫 `GET /api/auth/me`（同源帶 cookie）；若回 `401`，顯示登入頁與「使用 Google 登入」按鈕。
3. 點擊登入 → `GET /api/auth/login` 產生隨機 `state` 與 PKCE `code_verifier`（存於短效 `HttpOnly` cookie）並重導向 Google OAuth。
4. Google 回呼 `/api/auth/callback` → 驗證 `state`、以 `code` 換取 ID token／userinfo → 檢查 `email_verified === true` 且 email 在白名單內 → 簽發 `__Host-mmrag_session` cookie（`HttpOnly; Secure; SameSite=Strict; Path=/`）並重導向首頁。
5. 非白名單帳號一律回傳 `403 Forbidden`，不發放 session cookie。
6. 點擊登出 → `POST /api/auth/logout` 由伺服器清除 cookie；若伺服器端失敗則維持登入並提示，不可假裝登出。

### 流程 2：純文字多模態提問
1. 使用者輸入問題（可選填篩選公司／年度，例如「台積電」、「聯發科」、「鴻海」或「全部」）。
2. 送出 `POST /api/query`（JSON 或 multipart）。
3. 系統檢索出 Top-K（預設 3 頁，上限 5 頁）相關 ESG 報告頁面。
4. 系統將問題與 Top-K 原頁圖送給 VLM 產生回答，並通過 Grounding 守門驗證引用頁碼。
5. 前端顯示：
   - 回答內容（標註年份、數值與單位）
   - 狀態標籤：`grounded`（有證據支持）、`refused`（證據不足拒答）或 `degraded_retrieval_only`（VLM 限額降級，僅回傳檢索頁）
   - 引用卡片列表：顯示報告名稱、頁碼、原頁縮圖（可點擊放大檢視）、離線摘錄與官方報告連結。

### 流程 3：上傳圖表截圖提問
1. 使用者透過選檔、拖拉或剪貼簿貼上（`Ctrl+V`／`Cmd+V`）一張圖表或表格截圖，並可搭配文字問題（例：「這張圖在官方報告哪一頁？數字有出入嗎？」；若未填文字則套用預設指令「請辨識此圖表內容，找出對應的官方 ESG 報告頁面並核對數據」）。
2. 前端在瀏覽器端先檢查格式（PNG／JPEG／WebP）並壓縮至長邊 ≤ 1280px、大小 ≤ 1 MB。
3. Worker 收到請求後檢查 Content-Length（≤ 2 MB）與檔案 magic bytes（不信任副檔名或 MIME header）。
4. **兩階段視覺處理**：
   - 階段 1：VLM 快速解析截圖主題、指標名稱、公司／年份與關鍵數值，組合成檢索查詢詞。
   - 階段 2：Hybrid 檢索 Top-K 官方報告頁 → 將「使用者截圖 ＋ Top-K 官方原頁圖」一起交給 VLM 進行對照作答。
5. 請求結束後立即釋放記憶體中的圖片 buffer，**不寫入任何資料庫、Storage 或 log**。

---

## 3. 功能性需求

- **FR-01 認證與授權**：Google OAuth 2.0 + PKCE + Owner email 白名單 + `__Host-` cookie session。
- **FR-02 報告庫查詢**：提供 `GET /api/reports` 列出已收錄報告（公司、年度、頁數、`dataset_version`、官方出處 URL）。
- **FR-03 雙模態查詢**：`POST /api/query` 支援純文字與單張截圖＋文字查詢，並支援公司／年度篩選。
- **FR-04 Grounding 守門**：
  - 檢索最高分低於相似度門檻時直接拒答（不呼叫 VLM 生成）。
  - VLM 回傳的每一筆引用（`report_id`, `page_number`）必須存在於該次檢索候選集中；不合法引用一律剔除或降級拒答。
- **FR-05 額度保護與優雅降級**：KV 強制執行每日全站與單人查詢次數上限；VLM 429／逾時時回傳 `degraded_retrieval_only` 與命中原頁圖，不讓畫面整頁報錯。
- **FR-06 響應式 UI**：桌面與手機皆可流暢操作（含手機拍照／選圖上傳、點開原頁大圖縮放）。

---

## 4. 非功能性需求與威脅邊界

| 面向 | 要求 |
|---|---|
| **資安（同源與 CSRF）** | 網頁與 API 同源，不開 CORS；所有狀態變更與查詢 `POST` 檢查 `Origin` 等於本站（無 `Origin` 時檢查 `Sec-Fetch-Site: same-origin`）。 |
| **回應標頭** | CSP（`default-src 'self'`，圖片僅允許 `'self'`, `blob:`, `data:` 與指定 Supabase Storage 網域）、`X-Content-Type-Options: nosniff`、`frame-ancestors 'none'`；HTML `Cache-Control: no-cache`、API `Cache-Control: no-store`。 |
| **檔案上傳安全** | 僅接受 PNG／JPEG／WebP magic bytes；大小上限 2 MB；不執行圖片內嵌腳本、不持久化、不回傳原始檔給第三方（僅送 Gemini API 做當次推論）。 |
| **隱私與日誌** | Structured JSON log 僅記 request ID、延遲、token／降級狀態與錯誤碼；**絕不記錄**使用者 email、session token、API key、上傳圖片內容或完整提問個資。 |
| **可測試性** | 所有外部依賴（Google OAuth、Supabase、Workers AI、Gemini API）透過 interface 注入，CI 全程以 fake／fixture 執行，不打真實外部服務。 |
