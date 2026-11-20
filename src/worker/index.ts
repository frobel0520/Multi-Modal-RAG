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

export interface Env {
  APP_VERSION: string;
  DATASET_VERSION: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  OWNER_EMAIL_ALLOWLIST?: string;
  SESSION_SECRET?: string;
  ASSETS?: Fetcher;
}

export interface WorkerDeps {
  oauthExchanger?: OAuthCodeExchanger;
  nowSeconds?: () => number;
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
