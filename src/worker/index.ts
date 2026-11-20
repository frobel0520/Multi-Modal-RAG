export interface Env {
  APP_VERSION: string;
  DATASET_VERSION: string;
  ASSETS?: Fetcher;
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

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/health" && request.method === "GET") {
    return jsonResponse({
      status: "ok",
      version: env.APP_VERSION || "0.1.0",
      dataset_version: env.DATASET_VERSION || "uninitialized",
    });
  }

  if (url.pathname.startsWith("/api/")) {
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
