import { describe, expect, it } from "vitest";
import { handleRequest, type Env } from "../../src/worker/index";
import type { OAuthCodeExchanger } from "../../src/auth/google-oauth";
import {
  OAUTH_TX_COOKIE,
  SESSION_COOKIE,
  signPayload,
  verifyPayload,
  type SessionPayload,
} from "../../src/auth/session-cookie";

const BASE_ORIGIN = "https://multi-modal-rag.example.com";

const AUTH_ENV: Env = {
  APP_VERSION: "0.1.0",
  DATASET_VERSION: "test-v1",
  GOOGLE_CLIENT_ID: "synthetic-client-id.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "synthetic-client-secret",
  OWNER_EMAIL_ALLOWLIST: "owner@example.com",
  SESSION_SECRET: "0123456789abcdef0123456789abcdef",
};

function extractSetCookieValue(headers: Headers, cookieName: string): string | null {
  const cookies = headers.getSetCookie();
  for (const cookie of cookies) {
    if (cookie.startsWith(`${cookieName}=`)) {
      return cookie.slice(cookieName.length + 1).split(";")[0] ?? null;
    }
  }
  return null;
}

describe("T05 Google OAuth + __Host- session cookie + same-origin guard", () => {
  it("fails closed with 401 on unauthenticated /api/auth/me and protected API routes", async () => {
    const meRes = await handleRequest(new Request(`${BASE_ORIGIN}/api/auth/me`), AUTH_ENV);
    expect(meRes.status).toBe(401);

    const queryRes = await handleRequest(
      new Request(`${BASE_ORIGIN}/api/query`, {
        method: "POST",
        headers: { Origin: BASE_ORIGIN },
      }),
      AUTH_ENV,
    );
    expect(queryRes.status).toBe(401);
  });

  it("rejects cross-origin POST with 403 before session check", async () => {
    const res = await handleRequest(
      new Request(`${BASE_ORIGIN}/api/auth/logout`, {
        method: "POST",
        headers: { Origin: "https://evil.example.com" },
      }),
      AUTH_ENV,
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "cross_origin_forbidden" });
  });

  it("completes Google OAuth login -> callback -> /api/auth/me -> logout for allowlisted owner", async () => {
    const loginRes = await handleRequest(new Request(`${BASE_ORIGIN}/api/auth/login`), AUTH_ENV);
    expect(loginRes.status).toBe(302);

    const location = new URL(loginRes.headers.get("Location")!);
    expect(location.origin).toBe("https://accounts.google.com");
    const state = location.searchParams.get("state")!;
    expect(state).toBeTruthy();

    const txCookieValue = extractSetCookieValue(loginRes.headers, OAUTH_TX_COOKIE);
    expect(txCookieValue).toBeTruthy();

    const fakeExchanger: OAuthCodeExchanger = {
      async exchangeCode() {
        return { email: "OWNER@example.com", email_verified: true };
      },
    };

    const callbackRes = await handleRequest(
      new Request(`${BASE_ORIGIN}/api/auth/callback?code=fake-code&state=${state}`, {
        headers: { Cookie: `${OAUTH_TX_COOKIE}=${txCookieValue}` },
      }),
      AUTH_ENV,
      { oauthExchanger: fakeExchanger },
    );
    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.get("Location")).toBe(`${BASE_ORIGIN}/`);

    const sessionRawHeader = callbackRes.headers
      .getSetCookie()
      .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(sessionRawHeader).toContain("HttpOnly");
    expect(sessionRawHeader).toContain("Secure");
    expect(sessionRawHeader).toContain("SameSite=Strict");
    expect(sessionRawHeader).toContain("Path=/");

    const sessionToken = extractSetCookieValue(callbackRes.headers, SESSION_COOKIE)!;
    expect(sessionToken).toBeTruthy();
    const decodedSession = await verifyPayload<SessionPayload>(
      sessionToken,
      AUTH_ENV.SESSION_SECRET!,
    );
    expect(decodedSession?.sub).toBe("owner@example.com");

    const meRes = await handleRequest(
      new Request(`${BASE_ORIGIN}/api/auth/me`, {
        headers: { Cookie: `${SESSION_COOKIE}=${sessionToken}` },
      }),
      AUTH_ENV,
    );
    expect(meRes.status).toBe(200);
    expect(await meRes.json()).toEqual({ authenticated: true });

    const revokedRes = await handleRequest(
      new Request(`${BASE_ORIGIN}/api/auth/me`, {
        headers: { Cookie: `${SESSION_COOKIE}=${sessionToken}` },
      }),
      { ...AUTH_ENV, OWNER_EMAIL_ALLOWLIST: "other-owner@example.com" },
    );
    expect(revokedRes.status).toBe(401);

    const logoutRes = await handleRequest(
      new Request(`${BASE_ORIGIN}/api/auth/logout`, {
        method: "POST",
        headers: {
          Origin: BASE_ORIGIN,
          Cookie: `${SESSION_COOKIE}=${sessionToken}`,
        },
      }),
      AUTH_ENV,
    );
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });

  it("rejects non-allowlisted or unverified Google account with 403 and no session cookie", async () => {
    const loginRes = await handleRequest(new Request(`${BASE_ORIGIN}/api/auth/login`), AUTH_ENV);
    const state = new URL(loginRes.headers.get("Location")!).searchParams.get("state")!;
    const txCookieValue = extractSetCookieValue(loginRes.headers, OAUTH_TX_COOKIE)!;

    const nonOwnerExchanger: OAuthCodeExchanger = {
      async exchangeCode() {
        return { email: "stranger@example.com", email_verified: true };
      },
    };

    const res = await handleRequest(
      new Request(`${BASE_ORIGIN}/api/auth/callback?code=fake-code&state=${state}`, {
        headers: { Cookie: `${OAUTH_TX_COOKIE}=${txCookieValue}` },
      }),
      AUTH_ENV,
      { oauthExchanger: nonOwnerExchanger },
    );

    expect(res.status).toBe(403);
    expect(extractSetCookieValue(res.headers, SESSION_COOKIE)).toBeNull();
  });

  it("rejects SESSION_SECRET shorter than 32 characters", async () => {
    await expect(signPayload({ sub: "owner@example.com" }, "x".repeat(31))).rejects.toThrow(
      /at least 32 characters/,
    );
  });
});
