# Multi-Modal-RAG

以政府開放鐵道統計為語料的多模態問答專案。提供 2021–2025 年臺鐵、北捷、高鐵年度人次的文字與截圖問答，回答附政府來源及證據圖表。

**部署狀態：暫時不上線。** 目前可離線查看圖表與執行本機驗證。

| 資料 | 口徑 |
| --- | --- |
| 臺鐵 | 臺北市車站客運人次 |
| 北捷 | 臺北捷運全線客運人次 |
| 高鐵 | 臺北市車站進站人次 |

## 網頁問答

在本機或未來部署的網頁中，登入後可輸入「2024 年北捷客運人次是多少？」或選擇運具與西元年。截圖查詢請從網頁列出的證據圖表擷取，保留圖表代碼及至少一列完整的年度和數值。圖片在瀏覽器處理。超出收錄範圍或無法核對截圖時會顯示原因。

## 離線查看圖表

用 Python 3.10+ 從已核對的快照生成 HTML。在瀏覽器開啟 `artifacts/rail/index.html` 即可離線查看。

```sh
python scripts/build-rail-corpus.py --snapshot data/rail/passengers.json --output-dir artifacts/rail
```

重新匯入時，依 [來源清單](data/rail/sources.json) 的下載網址及檔名將兩份原始 CSV 存入 `artifacts/rail-input/`，執行下列指令。政府下載端點會更新，雜湊不符時需核對新版資料、更新來源清單後再匯入。

```sh
python scripts/build-rail-corpus.py --input-dir artifacts/rail-input --output-dir artifacts/rail
```

## 狀態與文件

- [鐵道語料變更、資料授權與驗收](docs/05-cr-001-rail-statistics.md)
- [最新進度](progress.md)
- [原專案計畫](docs/01-project-plan.md)、[系統分析](docs/02-system-analysis.md)、[系統設計](docs/03-system-design.md)、[Release Gate](docs/04-mvp-release-gate.md)
