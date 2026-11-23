# ESG 離線索引來源與驗證

T03／[#7](https://github.com/frobel0520/Multi-Modal-RAG/issues/7) 固定 2025 年英文版 PDF。頁碼是 PDF 檢視器自封面起算的 1-based 實體頁碼，同一報告依頁碼去重。

| 來源 | 官方 PDF 頁數 | 預選索引頁數 | 證據 |
|---|---:|---:|---|
| MediaTek | 107 | 64 | 核對下載檔 SHA-256 與頁碼 |
| Hon Hai | 228 | 74 | 核對下載檔 SHA-256 與頁碼 |
| TSMC | 待確認 | 待確認 | 官網連結已確認；此環境下載返回 HTTP 403 |

`sources.json` 是來源清單。三家共同的正式語料版本和 180–240 頁門檻仍待完成，台積電列於 `pending_sources`，未填入推測的雜湊或頁數。真實索引、報告原頁重製及對外顯示的權利範圍待確認。

在 `colab-bridge` 使用合成 PDF 執行 `python -m unittest discover -s tests -p test_esg_index.py -v`。測試會實際呼叫索引 CLI 產出一頁 PNG、原文和 1024 維 fixture 向量，再驗證資料列及續跑。正式模型輸出、GPU 耗時及品質各留至 T04／T09。此次沒有提交來源 PDF、真實頁圖或真實索引。
