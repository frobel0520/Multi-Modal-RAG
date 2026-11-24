# 離線評測報告

追蹤 [#8](https://github.com/frobel0520/Multi-Modal-RAG/issues/8)。正式 ESG 30–40 題與索引實跑維持 `not_scored`，待 [#7](https://github.com/frobel0520/Multi-Modal-RAG/issues/7) 確認完整來源與實際使用範圍，以及 [#9](https://github.com/frobel0520/Multi-Modal-RAG/issues/9) 產出同版索引證據。

## Fixture 機器驗證

- 執行 `node --test eval/test-evaluate.mjs`，再用 `node eval/evaluate.mjs eval/fixtures/sources.json eval/fixtures/questions.json eval/fixtures/results.json` 印出可重跑的結果。
- 合成資料覆蓋單頁圖表、跨公司比較、截圖核對的輸出格式和應拒答。截圖題的查詢 trace 為 fixture，這次沒有執行實際模型。

| 指標 | 合成結果 | 預期情境 |
|---|---:|---|
| Recall@5 | 83.3%（3 道有證據題） | Q2 的第二筆預期證據排在第六 |
| 引用合法率 | 75%（3／4） | Q3 引用一頁存在於語料但未被模型取用的頁面 |
| 正確拒答率 | 100%（1／1） | Q4 以 refused 回覆且無引用 |

正式 Gate 列為 `not_scored`，人工答案品質亦為 `not_scored`。

## 真實評測接續方式

題目檔以 `dataset_version`、`mode: real` 及 `questions` 記錄題型、問題、預期頁碼與答案依據。結果檔使用相同資料版本，附上 `index_evidence` 證據位置，每題記錄檢索排序 `retrieved`、允許引用的 `citation_candidates`、回覆狀態與實際 `citations`。結果頁碼一律使用來源清單的 1-based 實體 PDF 頁碼。

Recall@5 對每道可回答題計算前五筆命中證據數／該題應命中證據數，再取題目平均。引用必須屬於該次模型候選頁，且候選頁必須存在於該版索引範圍。無證據題以 `refused` 且無引用為正確。樣本缺失顯示 `not_scored`。正式門檻分別為 85%、100%、90%，答案正確性另做人工抽查。
