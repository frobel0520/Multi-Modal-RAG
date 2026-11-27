# Pages 發布離線預檢

2026-11-23，以 `main` `a1b1805` 的 Pages 切換合併版為基準。預檢在 Windows x64、Node 24.22.1 執行。追蹤 [#10](https://github.com/frobel0520/Multi-Modal-RAG/issues/10) 和 [Pages 切換 PR #19](https://github.com/frobel0520/Multi-Modal-RAG/pull/19)。

| 檢查 | 判定 | 證據與限制 |
|---|---|---|
| 遠端 CI | 通過 | `a1b1805` 的型別、現有測試、SPA 建置與依賴稽核步驟成功。[CI 44858853270](https://github.com/frobel0520/Multi-Modal-RAG/actions/runs/44858853270) |
| 本機 CI | 通過 | `npm run ci` 完成進度行數、型別、23 項測試（含兩項離線拒絕上傳案例）與 SPA 建置 |
| 靜態標頭 | 建置產物通過 | `node scripts/check-pages-headers.mjs` 驗證 `dist/_headers` 與來源一致，包含 CSP `connect-src 'self'`、`frame-ancestors 'none'`、nosniff、禁止框架及首頁 no-cache；正式邊緣實際送出的標頭待驗 |
| 同源與 Session | 離線通過 | 既有 OAuth／API tests 驗證 `__Host-` Cookie 屬性、跨來源 POST 403、未登入 401、Owner 登入／登出及非白名單或未驗證帳號 403。OAuth 端使用 fixture |
| 上傳 | 離線通過 | 已登入的 multipart request 測試實際取得假 PNG 400 及超過 2 MiB 的檔案 413，兩者在模型與檢索之前拒絕；API 回傳 `no-store` |
| Gemini 降級 | 離線通過 | 模擬 429 回傳 `degraded_retrieval_only` 與引用。未呼叫正式服務 |
| 依賴稽核 | 通過 | 2026-11-23 `npm audit --audit-level=high --json` 紀錄無 high／critical；套件公告之後可能更新 |
| Formatter／Lint | 未配置 | 現行 package scripts、CI 未定義獨立 formatter 或 lint 關卡 |
| 正式部署 | 未通過 | 既有執行停止於必要憑證檢查，沒有本次切換版上線證明。[部署 44858853223](https://github.com/frobel0520/Multi-Modal-RAG/actions/runs/44858853223) |
| 正式資料集／效能／真機 | 待驗 | 真實索引與題庫、首頁 LCP、查詢 p50／p95、正式 429、OAuth、桌機及手機完整流程均待取得同一候選版的證據 |

本次為本機建置、測試和既有紀錄讀回。零月費關卡等正式帳號方案、儲存、綁定、用量與強制限額證據。報告原頁的實際使用範圍也需先確認。
