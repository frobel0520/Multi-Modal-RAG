import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent } from "react";
import {
  ApiError,
  fetchAuthMe,
  fetchRailCatalog,
  logout,
  submitQuery,
  type CitationItem,
  type QueryResult,
  type RailChart,
} from "./api";
import { compressImageForUpload } from "./image-compress";
import "./styles.css";

const STATUS_LABELS: Record<QueryResult["status"], string> = {
  grounded: "有證據支持",
  refused: "證據不足拒答",
};

export function App() {
  const [authState, setAuthState] = useState<"loading" | "authenticated" | "unauthenticated">("loading");
  const [charts, setCharts] = useState<RailChart[]>([]);
  const [datasetVersion, setDatasetVersion] = useState<string>("uninitialized");

  const [question, setQuestion] = useState("");
  const [series, setSeries] = useState("");
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
          fetchRailCatalog()
            .then((data) => {
              if (!active) return;
              setCharts(data.series);
              setDatasetVersion(data.dataset_version);
            })
            .catch(() => {
              if (active) setErrorMessage("載入鐵道資料失敗。");
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
    if (!question.trim() && !imageFile && !(series && year)) {
      setErrorMessage("請輸入問題、選擇運具與年度，或附上收錄圖表的截圖。");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setResult(null);
    try {
      const screenshot = imageFile
        ? await (await import("./rail-ocr")).recognizeRailScreenshot(imageFile)
        : undefined;
      const response = await submitQuery({ question, series, year, screenshot });
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
          <p>臺鐵、北捷與高鐵的政府公開運量問答。</p>
          {errorMessage && <div className="error-banner">{errorMessage}</div>}
          <a className="btn btn-primary" href="/api/auth/login">
            使用 Google 帳號登入
          </a>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell" onPaste={handlePaste}>
      <header className="topbar">
        <div className="brand">
          <h1>鐵道運量問答</h1>
          <p>查詢 2021–2025 年臺鐵、北捷與高鐵年度人次</p>
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
              <span>運具（選填）</span>
              <select value={series} onChange={(e) => setSeries(e.target.value)}>
                <option value="">從問題或截圖辨識</option>
                {charts.map((chart) => (
                  <option key={chart.id} value={chart.id}>
                    {chart.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>西元年度（選填）</span>
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
            aria-label="查詢問題"
            maxLength={500}
            placeholder="例如：2024 年北捷客運人次是多少？"
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
              請使用下方收錄圖表，保留圖表代碼及年度數值。可拖拉、選檔或貼上 PNG、JPEG 或 WebP。圖片在瀏覽器內辨識。
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
            <div className="upload-hint">
              {charts.map((chart) => (
                <div key={chart.id}><a href={chart.image_url} target="_blank" rel="noreferrer">{chart.title}</a></div>
              ))}
            </div>
            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? "查詢中…" : "送出查詢"}
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

          {result.citations.length > 0 && (
            <div className="citations-grid">
              {result.citations.slice(0, 1).map((item) => (
                <article
                  key={item.chart_id}
                  className="citation-card"
                >
                  <button
                    type="button"
                    className="citation-thumb-btn"
                    onClick={() => setLightboxCitation(item)}
                    aria-label={`放大檢視 ${item.title}`}
                  >
                    <img
                      src={item.image_url}
                      alt={item.title}
                      loading="lazy"
                    />
                  </button>
                  <div className="citation-body">
                    <div className="citation-meta">
                      <span>{item.title}</span>
                    </div>
                    {result.citations.map((fact) => (
                      <p className="citation-excerpt" key={fact.year}>
                        {fact.year} 年 {fact.value.toLocaleString("zh-TW")} {fact.unit}
                      </p>
                    ))}
                    <p className="citation-excerpt">{item.publisher}・資料快照 {item.dataset_version}</p>
                    <a href={item.source_url} target="_blank" rel="noopener noreferrer">{item.source_title}</a>
                    <a href={item.license_url} target="_blank" rel="noopener noreferrer">{item.license_label}</a>
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
          aria-label="證據圖表放大檢視"
          onClick={() => setLightboxCitation(null)}
        >
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <div className="lightbox-bar">
              <strong>
                {lightboxCitation.title}
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
                alt={lightboxCitation.title}
              />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
