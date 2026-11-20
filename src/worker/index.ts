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
import {
  GeminiVlmClient,
  WorkersAiBgeM3Embedder,
  type Embedder,
  type VlmClient,
} from "../llm/gemini-client";
import {
  ImageValidationError,
  validateUploadImageBytes,
  type ValidatedUploadImage,
} from "../query/image-validation";
import {
  executeMultiModalQuery,
  RateLimitExceededError,
} from "../query/query-pipeline";
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
  embedder?: Embedder;
  vlmClient?: VlmClient;
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

async function parseQueryRequestBody(request: Request): Promise<{
  question: string;
  uploadedImage: ValidatedUploadImage | null;
  filterCompany: string | null;
  filterYear: number | null;
}> {
  const contentType = request.headers.get("Content-Type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const questionRaw = form.get("question");
    const companyRaw = form.get("company");
    const yearRaw = form.get("year");
    const imageEntry = form.get("image");

    const question = typeof questionRaw === "string" ? questionRaw : "";
    const filterCompany =
      typeof companyRaw === "string" && companyRaw.trim().length > 0 ? companyRaw.trim() : null;
    const filterYear =
      typeof yearRaw === "string" && /^\d{4}$/.test(yearRaw.trim())
        ? Number.parseInt(yearRaw.trim(), 10)
        : null;

    let uploadedImage: ValidatedUploadImage | null = null;
    if (imageEntry && typeof imageEntry === "object" && "arrayBuffer" in imageEntry) {
      const bytes = new Uint8Array(await imageEntry.arrayBuffer());
      uploadedImage = validateUploadImageBytes(bytes);
    }

    return { question, uploadedImage, filterCompany, filterYear };
  }

  const body = (await request.json().catch(() => null)) as {
    question?: unknown;
    company?: unknown;
    year?: unknown;
  } | null;

  if (!body || typeof body !== "object") {
    throw new ImageValidationError("請求格式無效，請提供 JSON 或 multipart/form-data", 400);
  }

  const question = typeof body.question === "string" ? body.question : "";
  const filterCompany =
    typeof body.company === "string" && body.company.trim().length > 0 ? body.company.trim() : null;
  const filterYear =
    typeof body.year === "number" && Number.isInteger(body.year) ? body.year : null;

  return { question, uploadedImage: null, filterCompany, filterYear };
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
      dataset_version: env.DATASET_VERSION || "uninitialized",
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

    if (url.pathname === "/api/query" && request.method === "POST") {
      const store = resolveRetrievalStore(env, deps);
      const rateLimiter = resolveRateLimiter(env, deps);
      const embedder = deps.embedder ?? (env.AI ? new WorkersAiBgeM3Embedder(env.AI) : null);
      const vlmClient =
        deps.vlmClient ??
        (env.GEMINI_API_KEY
          ? new GeminiVlmClient(env.GEMINI_API_KEY, env.GEMINI_MODEL || "gemini-2.5-flash")
          : null);

      if (!store || !rateLimiter || !embedder || !vlmClient) {
        return jsonResponse({ error: "query_pipeline_not_configured" }, 503);
      }

      try {
        const parsed = await parseQueryRequestBody(request);
        if (parsed.question.trim().length === 0 && !parsed.uploadedImage) {
          return jsonResponse({ error: "empty_query" }, 400);
        }

        const result = await executeMultiModalQuery(
          {
            userKey: session.sub,
            question: parsed.question,
            uploadedImage: parsed.uploadedImage,
            filterCompany: parsed.filterCompany,
            filterYear: parsed.filterYear,
          },
          {
            rateLimiter,
            embedder,
            retrievalStore: store,
            vlmClient,
          },
        );
        return jsonResponse(result, 200);
      } catch (err) {
        if (err instanceof ImageValidationError) {
          return jsonResponse({ error: err.message }, err.statusCode);
        }
        if (err instanceof RateLimitExceededError) {
          return jsonResponse({ error: err.message }, 429);
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
