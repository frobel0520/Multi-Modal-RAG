import type { RailCitation } from "../../src/rail/rail-query";
import type { ScreenshotEvidence } from "../../src/rail/screenshot-evidence";

export type QueryStatus = "grounded" | "refused";

export type CitationItem = RailCitation;

export interface RailChart {
  readonly id: string;
  readonly title: string;
  readonly image_url: string;
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

export interface RailCatalog {
  readonly dataset_version: string;
  readonly series: RailChart[];
}

export interface SubmitQueryParams {
  readonly question: string;
  readonly screenshot?: ScreenshotEvidence;
  readonly series?: string;
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

export async function fetchRailCatalog(fetchImpl: typeof fetch = fetch): Promise<RailCatalog> {
  const res = await fetchImpl("/api/rail", {
    method: "GET",
    credentials: "same-origin",
  });
  if (!res.ok) {
    throw new ApiError("載入鐵道資料失敗", res.status);
  }
  return (await res.json()) as RailCatalog;
}

export async function submitQuery(
  params: SubmitQueryParams,
  fetchImpl: typeof fetch = fetch,
): Promise<QueryResult> {
  const form = new FormData();
  form.set("question", params.question.trim());
  if (params.series && params.series.trim().length > 0) {
    form.set("series", params.series.trim());
  }
  if (params.year && params.year.trim().length > 0) {
    form.set("year", params.year.trim());
  }
  if (params.screenshot) {
    form.set("screenshot_evidence", JSON.stringify(params.screenshot));
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
