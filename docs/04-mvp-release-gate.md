# 04 — MVP 發布門檻（Release Gate）

- **文件狀態**：提案（待擁有者核准）
- **建立日期**：2026-11-20
- **部署狀態（2026-11-28）**：暫時不上線。正式 Release Gate 暫緩，以下條件保留供日後恢復部署時使用。
- **目前驗收結果**：2026-11-23 已完成可離線覆核的預檢。見 [逐項證據](evidence/mvp-release-gate.md)。

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

- [ ] 恢復部署後確認正式獨立 origin（原規劃網址為 `https://multi-modal-rag.pages.dev`）。Pages 提供 `dist` 靜態 SPA，`functions/api/[[path]].ts` 在同一 origin 轉接 `/api/*`，不開 CORS。須讀回正式環境的同源行為與回應標頭。
- [ ] Session cookie 名稱以 `__Host-` 開頭，屬性含 `HttpOnly; Secure; SameSite=Strict; Path=/`
- [ ] `localStorage`／`sessionStorage` 不存任何 token 或 session；API 不回傳 token
- [ ] 跨來源 `POST` 回傳 `403`；未登入存取 `/api/query`、`/api/reports` 回傳 `401`
- [ ] 非白名單 Google 帳號登入回傳 `403`
- [ ] 上傳非圖片／偽造副檔名或超過 2 MB 的檔案被伺服器端拒絕（`400`／`413`），且合法上傳圖不落地儲存
- [ ] 正式回應標頭含 CSP、`X-Content-Type-Options: nosniff`、`frame-ancestors 'none'`；HTML `no-cache`、API `no-store`。Pages 的 `_headers` 只套用於靜態回應，Functions 回應須由程式設定。[Cloudflare Pages 標頭](https://developers.cloudflare.com/pages/configuration/headers/)
- [ ] 部署 workflow 僅由 `main` push 或 owner `workflow_dispatch` 觸發，使用 `production` environment，部署 job 限定 main 與 repo owner。既有執行止於必要憑證檢查，實際部署輸出仍待驗。

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
  - Pages 版本異常：由 Owner 在 Cloudflare Pages 專案的 Deployments 選擇仍保留、成功的前一筆 production deployment，執行 Rollback to this deployment。Preview 不能作為回滾目標；若從未成功發布，沒有可回滾版本。[Cloudflare Pages 回滾](https://developers.cloudflare.com/pages/configuration/rollbacks/)
  - 程式碼問題：由 Owner 核准 revert PR，再經 main 的既有部署流程發布。
  - 索引資料問題：保留前版 `dataset_version` 標記，異常時切回前版查詢過濾條件
