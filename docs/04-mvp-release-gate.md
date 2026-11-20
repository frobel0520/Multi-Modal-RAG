# 04 — MVP 發布門檻（Release Gate）

- **文件狀態**：提案（待擁有者核准）
- **建立日期**：2026-11-20
- **目前驗收結果**：`pending`（尚未進入實作與正式部署）

---

## 1. CI 與自動化檢查（機器判定）

- [ ] TypeScript 型別檢查（`tsc --noEmit`）通過
- [ ] Formatter／Lint 通過
- [ ] 單元、契約與 Grounding 守門測試全部通過（CI 全程隔離外部服務）
- [ ] `npm audit` 無 high／critical 漏洞（工具失敗視同未完成）
- [ ] `progress.md` 行數 ≤ 100 行
- [ ] Privacy-guard 檢查：無個資、無憑證、無本機絕對路徑、無 AI 作者署名

---

## 2. 資安基準檢查（依 `DeploymentHandbook.md` 第 2 章）

- [ ] 獨立 origin：`https://multi-modal-rag.curio-lab.workers.dev`（同源提供網頁與 `/api/*`，不開 CORS）
- [ ] Session cookie 名稱以 `__Host-` 開頭，屬性含 `HttpOnly; Secure; SameSite=Strict; Path=/`
- [ ] `localStorage`／`sessionStorage` 不存任何 token 或 session；API 不回傳 token
- [ ] 跨來源 `POST` 回傳 `403`；未登入存取 `/api/query`、`/api/reports` 回傳 `401`
- [ ] 非白名單 Google 帳號登入回傳 `403`
- [ ] 上傳非圖片／偽造副檔名或超過 2 MB 的檔案被伺服器端拒絕（`400`／`413`），且合法上傳圖不落地儲存
- [ ] 回應標頭含 CSP、`X-Content-Type-Options: nosniff`、`frame-ancestors 'none'`；HTML `no-cache`、API `no-store`
- [ ] 部署 workflow 僅由 `main` push 或 owner `workflow_dispatch` 觸發，含 `environment` 與 `GITHUB_ACTOR == GITHUB_REPOSITORY_OWNER` 檢查；wrangler 輸出不洩漏 vars

---

## 3. 品質與多模態評測（真實資料集）

- [ ] 固定 `dataset_version`（台積電、聯發科、鴻海 3 家公開 ESG 報告書，180–240 頁）完整寫入 Supabase
- [ ] 離線 Eval Set（30–40 題，涵蓋單頁圖表數值、跨公司比較、上傳截圖比對、應拒答題）：
  - [ ] Recall@5 ≥ 85%
  - [ ] 引用頁碼合法率 = 100%
  - [ ] 無證據正確拒答率 ≥ 90%
- [ ] 評測結果與失敗案例記錄於 `docs/evidence/eval-report.md`（機器指標與人工抽查分開記錄）

---

## 4. 效能驗收（正式環境實測）

需於正式部署環境實測並記錄版本、資料量、冷／暖啟動與樣本數至 `docs/evidence/mvp-release-gate.md`：

- [ ] 首頁 LCP < 2.5s
- [ ] 純文字查詢 `/api/query`：p50 < 4.0s、p95 < 8.0s（n ≥ 20）
- [ ] 截圖上傳查詢 `/api/query`：p50 < 6.0s、p95 < 12.0s（n ≥ 15）
- [ ] 觸發 Gemini 429 降級時，系統正常回傳 `degraded_retrieval_only` 與原頁截圖
- [ ] 實機驗證（桌機＋手機）：登入 → 文字提問 → 上傳截圖提問 → 點開原頁大圖 → 登出，瀏覽器主控台無 CSP 錯誤

---

## 5. 零月費與 Rollback 計畫

- [ ] 確認所有使用服務皆在免費方案內且未綁定信用卡付費功能
- [ ] 記錄實際資源佔用：Colab CU 消耗、Supabase DB MB、Storage MB、Worker 每日限流設定
- [ ] **Rollback 方式**：
  - Worker 版本異常：執行 `wrangler rollback` 立即退回前一版
  - 程式碼問題：revert 對應 PR，由 `main` CI 重新部署
  - 索引資料問題：保留前版 `dataset_version` 標記，異常時切回前版查詢過濾條件
