import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent } from "react";
import {
  ApiError,
  fetchAuthMe,
  fetchReports,
  logout,
  submitQuery,
  type CitationItem,
  type QueryResult,
  type ReportSummary,
} from "./api";
import { compressImageForUpload } from "./image-compress";
import "./styles.css";

const STATUS_LABELS: Record<QueryResult["status"], string> = {
  grounded: "有證據支持",
  refused: "證據不足拒答",
  degraded_retrieval_only: "VLM 限額降級（純檢索模式）",
};

export function App() {
  const [authState, setAuthState] = useState<"loading" | "authenticated" | "unauthenticated">("loading");
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [datasetVersion, setDatasetVersion] = useState<string>("uninitialized");

  const [question, setQuestion] = useState("");
  const [company, setCompany] = useState("");
  const [year, setYear] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [lightboxCitation, setLightboxCitation] = useState<CitationItem | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    fetchAuthMe()
      .then((authed) => {
        if (!active) return;
        setAuthState(authed ? "authenticated" : "unauthenticated");
        if (authed) {
          fetchReports()
            .then((data) => {
              if (!active) return;
              setReports(data.reports);
              setDatasetVersion(data.dataset_version);
            })
            .catch(() => {
              // Reports list may be unavailable before Supabase is configured; keep UI usable.
            });
        }
      })
      .catch(() => {
        if (active) setAuthState("unauthenticated");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!lightboxCitation) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightboxCitation(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightboxCitation]);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);

  async function attachImageFile(rawFile: File) {
    setErrorMessage(null);
    try {
      const prepared = await compressImageForUpload(rawFile);
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
      setImageFile(prepared);
      setImagePreviewUrl(URL.createObjectURL(prepared));
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "圖片處理失敗");
    }
  }

  function clearImage() {
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    setImageFile(null);
    setImagePreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          event.preventDefault();
          void attachImageFile(file);
          break;
        }
      }
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      void attachImageFile(file);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!question.trim() && !imageFile) {
      setErrorMessage("請輸入問題，或上傳一張 ESG 圖表截圖。");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await submitQuery({
        question,
        imageFile,
        company,
        year,
      });
      setResult(response);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAuthState("unauthenticated");
      }
      setErrorMessage(err instanceof Error ? err.message : "查詢失敗，請稍後再試。");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLogout() {
    setErrorMessage(null);
    try {
      await logout();
      setAuthState("unauthenticated");
      setResult(null);
      clearImage();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "登出失敗");
    }
  }

  if (authState === "loading") {
    return (
      <main className="app-shell">
        <div className="card login-card">
          <p>正在確認登入狀態…</p>
        </div>
      </main>
    );
  }

  if (authState === "unauthenticated") {
    return (
      <main className="app-shell">
        <section className="card login-card">
          <h1>Multi-Modal RAG</h1>
          <p>台灣上市企業公開 ESG 報告書圖表與數據問答系統（Owner 專屬存取）。</p>
          {errorMessage && <div className="error-banner">{errorMessage}</div>}
          <a className="btn btn-primary" href="/api/auth/login">
            使用 Google 帳號登入
          </a>
        </section>
      </main>
    );
  }

  const companyOptions = Array.from(
    new Set(["TSMC", "MediaTek", "Foxconn", ...reports.map((r) => r.company)]),
  );

  return (
    <main className="app-shell" onPaste={handlePaste}>
      <header className="topbar">
        <div className="brand">
          <h1>Multi-Modal RAG — ESG 圖表問答</h1>
          <p>台積電、聯發科、鴻海公開永續報告書多模態檢索與原頁引用</p>
        </div>
        <div className="topbar-actions">
          <span className="pill">資料版次：{datasetVersion}</span>
          <button type="button" className="btn btn-secondary" onClick={() => void handleLogout()}>
            登出
          </button>
        </div>
      </header>

      {errorMessage && (
        <div className="error-banner" role="alert">
          {errorMessage}
        </div>
      )}

      <section className="card">
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="filters-row">
            <label className="field">
              <span>企業篩選</span>
              <select value={company} onChange={(e) => setCompany(e.target.value)}>
                <option value="">全部企業</option>
                {companyOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>報告年度（選填）</span>
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                placeholder="例如 2024"
                value={year}
                onChange={(e) => setYear(e.target.value.replace(/[^\d]/g, ""))}
              />
            </label>
          </div>

          <textarea
            className="question-input"
            placeholder="輸入問題，例如：比較台積電與聯發科 2024 年再生能源使用比例與溫室氣體減量目標（也可直接 Ctrl+V 貼上圖表截圖）"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                void handleSubmit(e);
              }
            }}
          />

          <div
            className={`upload-zone${isDragging ? " dragging" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <div className="upload-header">
              <strong>上傳圖表截圖提問（選填）</strong>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void attachImageFile(file);
                  }}
                />
              </div>
            </div>
            <p className="upload-hint">
              支援拖拉、選檔或 Ctrl+V 貼上 PNG／JPEG／WebP（自動壓縮 ≤ 1280px）。截圖僅於當次請求記憶體比對，不寫入資料庫。
            </p>

            {imageFile && imagePreviewUrl && (
              <div className="upload-preview">
                <img src={imagePreviewUrl} alt="已選取的圖表截圖預覽" />
                <div>
                  <div>{imageFile.name}</div>
                  <div className="upload-hint">{Math.round(imageFile.size / 1024)} KB</div>
                </div>
                <button type="button" className="btn btn-secondary" onClick={clearImage}>
                  移除圖片
                </button>
              </div>
            )}
          </div>

          <div className="composer-footer">
            <span className="upload-hint">已收錄報告：{reports.length} 份</span>
            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? "檢索與視覺分析中…" : "送出查詢"}
            </button>
          </div>
        </form>
      </section>

      {result && (
        <section className="card" aria-live="polite">
          <div className="answer-header">
            <span className={`status-badge status-${result.status}`}>
              {STATUS_LABELS[result.status]}
            </span>
            <span className="pill">耗時 {result.latency_ms} ms</span>
          </div>

          {result.status === "refused" ? (
            <p className="answer-text">{result.refusal_reason || "證據不足，無法回答。"}</p>
          ) : (
            <p className="answer-text">{result.answer}</p>
          )}

          {result.extracted_image_query && (
            <div className="extracted-query">
              <strong>截圖辨識檢索詞：</strong>
              {result.extracted_image_query}
            </div>
          )}

          {result.citations.length > 0 && (
            <div className="citations-grid">
              {result.citations.map((item) => (
                <article
                  key={`${item.report_id}-${item.page_number}`}
                  className="citation-card"
                >
                  <button
                    type="button"
                    className="citation-thumb-btn"
                    onClick={() => setLightboxCitation(item)}
                    aria-label={`放大檢視 ${item.company} ${item.report_year} 第 ${item.page_number} 頁`}
                  >
                    <img
                      src={item.image_url}
                      alt={`${item.company} ${item.report_year} 第 ${item.page_number} 頁原圖`}
                      loading="lazy"
                    />
                  </button>
                  <div className="citation-body">
                    <div className="citation-meta">
                      <span>
                        {item.company} {item.report_year} · P.{item.page_number}
                      </span>
                      <span>相似度 {(item.relevance_score * 100).toFixed(1)}%</span>
                    </div>
                    {item.section_title && <div>章節：{item.section_title}</div>}
                    <p className="citation-excerpt">{item.visual_excerpt}</p>
                    <a href={item.source_url} target="_blank" rel="noopener noreferrer">
                      檢視官方原始報告
                    </a>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {lightboxCitation && (
        <div
          className="lightbox-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="原頁圖表放大檢視"
          onClick={() => setLightboxCitation(null)}
        >
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <div className="lightbox-bar">
              <strong>
                {lightboxCitation.company} {lightboxCitation.report_year} — 第{" "}
                {lightboxCitation.page_number} 頁
              </strong>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setLightboxCitation(null)}
              >
                關閉 (Esc)
              </button>
            </div>
            <div className="lightbox-img-wrap">
              <img
                src={lightboxCitation.image_url}
                alt={`${lightboxCitation.company} 第 ${lightboxCitation.page_number} 頁大圖`}
              />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
