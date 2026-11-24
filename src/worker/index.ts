import {
  defaultGoogleOAuthExchanger,
  handleAuthCallback,
  handleAuthLogin,
  handleAuthLogout,
  verifySessionFromRequest,
  type GoogleOAuthConfig,
  type OAuthCodeExchanger,
} from "../auth/google-oauth";
import { isSameOriginWrite } from "../auth/session-cookie";
import { ImageValidationError } from "../query/image-validation";
import { answerRailQuery } from "../rail/rail-query";
import { RAIL_DATASET_VERSION, railChartUrl, railSeries, railSeriesTitle, renderRailChart } from "../rail/rail-corpus";
import type { ScreenshotEvidence } from "../rail/screenshot-evidence";
import {
  KvDailyRateLimiter,
  type KvStoreLike,
  type RateLimiter,
} from "../query/rate-limiter";
import {
  SupabaseRetrievalStore,
  type RetrievalStore,
} from "../retrieval/supabase-client";

export interface Env {
  APP_VERSION: string;
  DATASET_VERSION: string;
  DAILY_GLOBAL_QUERY_LIMIT?: string;
  DAILY_PER_USER_QUERY_LIMIT?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  OWNER_EMAIL_ALLOWLIST?: string;
  SESSION_SECRET?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  RATE_LIMIT_KV?: KvStoreLike;
  AI?: { run(model: string, input: { text: string[] }): Promise<{ data?: number[][] }> };
  ASSETS?: Fetcher;
}

export interface WorkerDeps {
  oauthExchanger?: OAuthCodeExchanger;
  nowSeconds?: () => number;
  retrievalStore?: RetrievalStore;
  rateLimiter?: RateLimiter;
}

const API_SECURITY_HEADERS: Record<string, string> = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: API_SECURITY_HEADERS,
  });
}

function readOAuthConfig(env: Env): GoogleOAuthConfig | null {
  if (
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET ||
    !env.SESSION_SECRET ||
    !env.OWNER_EMAIL_ALLOWLIST
  ) {
    return null;
  }
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    sessionSecret: env.SESSION_SECRET,
    ownerEmailAllowlist: env.OWNER_EMAIL_ALLOWLIST,
  };
}

function resolveRetrievalStore(env: Env, deps: WorkerDeps): RetrievalStore | null {
  if (deps.retrievalStore) return deps.retrievalStore;
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  return new SupabaseRetrievalStore({
    supabaseUrl: env.SUPABASE_URL,
    supabaseAnonKey: env.SUPABASE_ANON_KEY,
  });
}

function resolveRateLimiter(env: Env, deps: WorkerDeps): RateLimiter | null {
  if (deps.rateLimiter) return deps.rateLimiter;
  if (!env.RATE_LIMIT_KV) return null;
  const globalLimit = Number.parseInt(env.DAILY_GLOBAL_QUERY_LIMIT ?? "250", 10) || 250;
  const perUserLimit = Number.parseInt(env.DAILY_PER_USER_QUERY_LIMIT ?? "100", 10) || 100;
  return new KvDailyRateLimiter(env.RATE_LIMIT_KV, globalLimit, perUserLimit);
}

function isScreenshotEvidence(input: unknown): input is ScreenshotEvidence {
  if (!input || typeof input !== "object") return false;
  const evidence = input as Partial<ScreenshotEvidence>;
  return Array.isArray(evidence.codes) && evidence.codes.length <= railSeries.length
    && evidence.codes.every((code) => typeof code === "string" && /^[A-Z]{3,5}$/.test(code))
    && Array.isArray(evidence.rows) && evidence.rows.length <= 30
    && evidence.rows.every((row) => row && Number.isInteger(row.year)
      && Number.isSafeInteger(row.value) && row.value >= 0);
}

async function parseQueryRequestBody(request: Request): Promise<Parameters<typeof answerRailQuery>[0]> {
  let body: Record<string, unknown>;
  if (request.headers.get("Content-Type")?.includes("multipart/form-data")) {
    const form = await request.formData();
    if (form.has("image")) {
      throw new ImageValidationError("請在網頁附上截圖，瀏覽器會先在本機辨識。");
    }
    body = Object.fromEntries(form);
    if (typeof body.year === "string" && /^\d{4}$/.test(body.year)) body.year = Number(body.year);
  } else {
    const parsed: unknown = await request.json().catch(() => null);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ImageValidationError("請求格式無效");
    }
    body = parsed as Record<string, unknown>;
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (question.length > 500) throw new ImageValidationError("問題最多 500 字。");
  const series = body.series ?? body.company;
  if (series != null && typeof series !== "string") throw new ImageValidationError("運具格式無效。");
  if (body.year != null && !Number.isInteger(body.year)) throw new ImageValidationError("年度格式無效。");

  let screenshot: unknown = body.screenshot_evidence ?? null;
  if (typeof screenshot === "string") {
    if (screenshot.length > 2000) throw new ImageValidationError("截圖辨識資料過長。");
    try {
      screenshot = JSON.parse(screenshot);
    } catch {
      throw new ImageValidationError("截圖辨識資料格式無效。");
    }
  }
  if (screenshot !== null && !isScreenshotEvidence(screenshot)) {
    throw new ImageValidationError("截圖辨識資料格式無效。");
  }
  return {
    question,
    seriesFilter: typeof series === "string" ? series.trim() || null : null,
    yearFilter: typeof body.year === "number" ? body.year : null,
    screenshot,
  };
}

export async function handleRequest(
  request: Request,
  env: Env,
  deps: WorkerDeps = {},
): Promise<Response> {
  const url = new URL(request.url);
  const nowSeconds = deps.nowSeconds ? deps.nowSeconds() : Math.floor(Date.now() / 1000);

  if (url.pathname === "/api/health" && request.method === "GET") {
    return jsonResponse({
      status: "ok",
      version: env.APP_VERSION || "0.1.0",
      dataset_version: RAIL_DATASET_VERSION,
    });
  }

  if (url.pathname === "/api/auth/login" && request.method === "GET") {
    const config = readOAuthConfig(env);
    if (!config) return jsonResponse({ error: "auth_not_configured" }, 503);
    return handleAuthLogin(request, config, nowSeconds);
  }

  if (url.pathname === "/api/auth/callback" && request.method === "GET") {
    const config = readOAuthConfig(env);
    if (!config) return jsonResponse({ error: "auth_not_configured" }, 503);
    return handleAuthCallback(
      request,
      config,
      deps.oauthExchanger ?? defaultGoogleOAuthExchanger,
      nowSeconds,
    );
  }

  if (url.pathname.startsWith("/api/")) {
    if (!isSameOriginWrite(request)) {
      return jsonResponse({ error: "cross_origin_forbidden" }, 403);
    }

    const session = await verifySessionFromRequest(
      request,
      env.SESSION_SECRET ?? "",
      nowSeconds,
    );
    if (!session) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }

    if (url.pathname === "/api/auth/me" && request.method === "GET") {
      return jsonResponse({ authenticated: true });
    }

    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      return handleAuthLogout();
    }

    if (url.pathname === "/api/reports" && request.method === "GET") {
      const store = resolveRetrievalStore(env, deps);
      if (!store) return jsonResponse({ error: "retrieval_not_configured" }, 503);
      const reports = await store.listReports();
      return jsonResponse({
        dataset_version: env.DATASET_VERSION || "uninitialized",
        reports,
      });
    }

    if (url.pathname === "/api/rail" && request.method === "GET") {
      return jsonResponse({
        dataset_version: RAIL_DATASET_VERSION,
        series: railSeries.map((series) => ({
          id: series.id,
          title: railSeriesTitle(series),
          image_url: railChartUrl(series),
        })),
      });
    }

    if (url.pathname.startsWith("/api/rail/charts/") && request.method === "GET") {
      const series = railSeries.find((item) => railChartUrl(item) === url.pathname);
      if (!series) return jsonResponse({ error: "not_found" }, 404);
      return new Response(renderRailChart(series), {
        headers: {
          ...API_SECURITY_HEADERS,
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Content-Security-Policy": "default-src 'none'; sandbox",
        },
      });
    }

    if (url.pathname === "/api/query" && request.method === "POST") {
      const startedAt = performance.now();
      try {
        const parsed = await parseQueryRequestBody(request);
        if (!parsed.question && !parsed.screenshot && !parsed.seriesFilter && parsed.yearFilter === null) {
          return jsonResponse({ error: "empty_query" }, 400);
        }
        const rateLimiter = resolveRateLimiter(env, deps);
        if (rateLimiter) {
          const limit = await rateLimiter.consume(session.sub);
          if (!limit.allowed) return jsonResponse({ error: limit.reason ?? "今日查詢額度已達上限" }, 429);
        }
        const result = answerRailQuery(parsed);
        return jsonResponse({
          request_id: crypto.randomUUID(),
          ...result,
          extracted_image_query: null,
          latency_ms: Math.round(performance.now() - startedAt),
        });
      } catch (err) {
        if (err instanceof ImageValidationError) {
          return jsonResponse({ error: err.message }, err.statusCode);
        }
        return jsonResponse({ error: "query_execution_failed" }, 502);
      }
    }

    return jsonResponse({ error: "not_found" }, 404);
  }

  if (env.ASSETS) {
    return env.ASSETS.fetch(request);
  }

  return jsonResponse({ error: "assets_not_configured" }, 503);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
