export type QueryStatus = "grounded" | "refused" | "degraded_retrieval_only";

export interface ReportSummary {
  readonly id: string;
  readonly company: string;
  readonly report_year: number;
  readonly title: string;
  readonly source_url: string;
  readonly dataset_version: string;
  readonly total_indexed_pages: number;
}

export interface CitationItem {
  readonly report_id: string;
  readonly company: string;
  readonly report_year: number;
  readonly page_number: number;
  readonly section_title: string | null;
  readonly image_url: string;
  readonly source_url: string;
  readonly relevance_score: number;
  readonly visual_excerpt: string;
}

export interface QueryResult {
  readonly request_id: string;
  readonly status: QueryStatus;
  readonly answer: string;
  readonly refusal_reason: string | null;
  readonly extracted_image_query: string | null;
  readonly citations: CitationItem[];
  readonly latency_ms: number;
}

export interface ReportsListResult {
  readonly dataset_version: string;
  readonly reports: ReportSummary[];
}

export interface SubmitQueryParams {
  readonly question: string;
  readonly imageFile?: File | null;
  readonly company?: string;
  readonly year?: string;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function fetchAuthMe(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const res = await fetchImpl("/api/auth/me", {
    method: "GET",
    credentials: "same-origin",
  });
  if (res.status === 401) return false;
  if (!res.ok) {
    throw new ApiError("無法確認登入狀態", res.status);
  }
  const data = (await res.json()) as { authenticated?: boolean };
  return Boolean(data.authenticated);
}

export async function logout(fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
  });
  if (!res.ok) {
    throw new ApiError("登出失敗，請稍後再試（目前仍維持登入狀態）", res.status);
  }
}

export async function fetchReports(fetchImpl: typeof fetch = fetch): Promise<ReportsListResult> {
  const res = await fetchImpl("/api/reports", {
    method: "GET",
    credentials: "same-origin",
  });
  if (!res.ok) {
    throw new ApiError("載入報告清單失敗", res.status);
  }
  return (await res.json()) as ReportsListResult;
}

export async function submitQuery(
  params: SubmitQueryParams,
  fetchImpl: typeof fetch = fetch,
): Promise<QueryResult> {
  const form = new FormData();
  form.set("question", params.question.trim());
  if (params.company && params.company.trim().length > 0) {
    form.set("company", params.company.trim());
  }
  if (params.year && params.year.trim().length > 0) {
    form.set("year", params.year.trim());
  }
  if (params.imageFile) {
    form.set("image", params.imageFile, params.imageFile.name || "chart.webp");
  }

  const res = await fetchImpl("/api/query", {
    method: "POST",
    credentials: "same-origin",
    body: form,
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error || `查詢失敗（HTTP ${res.status}）`, res.status);
  }

  return (await res.json()) as QueryResult;
}
