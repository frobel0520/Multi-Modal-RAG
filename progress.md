# Progress

## 現況

- CR-001 改用政府公開鐵道統計。首批資料涵蓋 2021–2025 年臺鐵（臺北市車站）、北捷（全線）、高鐵（臺北市車站進站）。
- [Issue #20](https://github.com/frobel0520/Multi-Modal-RAG/issues/20) 的資料基底為 [草稿 PR #21](https://github.com/frobel0520/Multi-Modal-RAG/pull/21)，問答分支為 `feature/20-rail-qa`。
- 文字查詢與本機截圖 OCR 已接入同源 API。結構化快照提供人次與引用，超出範圍或比對失敗時拒答。驗證見 [CR-001](docs/05-cr-001-rail-statistics.md)。

## 進行中與下一步

1. 審查資料及問答 PR，依序整合。
2. 真實部署前確認 Cloudflare 免費方案、正式登入、手機實機與 API 效能，再執行 Release Gate。

## 待辦與限制

- 截圖辨識適用於本版網頁證據圖表，需有圖表代碼與可核對的年份和數值。正式環境與手機實機尚未驗收。模型評分 `not_scored`。
- 臺鐵及高鐵首批範圍為臺北市。公路、空運與航運待鐵道版驗收後規劃。
