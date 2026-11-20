import {
  buildClearedOAuthTxCookie,
  buildClearedSessionCookie,
  buildOAuthTxCookie,
  buildSessionCookie,
  OAUTH_TX_COOKIE,
  OAUTH_TX_TTL_SECONDS,
  randomBase64Url,
  readCookie,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sha256Base64Url,
  signPayload,
  verifyPayload,
  type OAuthTxPayload,
  type SessionPayload,
} from "./session-cookie";

export interface OAuthUserInfo {
  readonly email: string;
  readonly email_verified: boolean;
}

export interface GoogleOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly sessionSecret: string;
  readonly ownerEmailAllowlist: string;
}

export interface OAuthCodeExchanger {
  exchangeCode(params: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    clientId: string;
    clientSecret: string;
  }): Promise<OAuthUserInfo>;
}

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

export const defaultGoogleOAuthExchanger: OAuthCodeExchanger = {
  async exchangeCode({ code, codeVerifier, redirectUri, clientId, clientSecret }) {
    const tokenRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!tokenRes.ok) {
      throw new Error(`oauth_token_exchange_failed:${tokenRes.status}`);
    }

    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    if (!tokenJson.access_token) {
      throw new Error("oauth_missing_access_token");
    }

    const userRes = await fetch(GOOGLE_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (!userRes.ok) {
      throw new Error(`oauth_userinfo_failed:${userRes.status}`);
    }

    const userJson = (await userRes.json()) as { email?: string; email_verified?: boolean };
    if (typeof userJson.email !== "string" || typeof userJson.email_verified !== "boolean") {
      throw new Error("oauth_invalid_userinfo");
    }

    return {
      email: userJson.email,
      email_verified: userJson.email_verified,
    };
  },
};

export function isOwnerAllowed(
  email: string,
  emailVerified: boolean,
  allowlistCsv: string,
): boolean {
  if (!emailVerified) return false;
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return false;

  const allowed = allowlistCsv
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);

  if (allowed.length === 0) return false;
  return allowed.includes(normalizedEmail);
}

export async function verifySessionFromRequest(
  request: Request,
  sessionSecret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<SessionPayload | null> {
  if (!sessionSecret) return null;
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;

  const payload = await verifyPayload<SessionPayload>(token, sessionSecret);
  if (!payload) return null;
  if (typeof payload.sub !== "string" || typeof payload.exp !== "number") return null;
  if (payload.exp <= nowSeconds) return null;
  return payload;
}

export async function handleAuthLogin(
  request: Request,
  config: GoogleOAuthConfig,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<Response> {
  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/api/auth/callback`;
  const state = randomBase64Url(24);
  const codeVerifier = randomBase64Url(32);
  const codeChallenge = await sha256Base64Url(codeVerifier);

  const txToken = await signPayload(
    {
      state,
      code_verifier: codeVerifier,
      exp: nowSeconds + OAUTH_TX_TTL_SECONDS,
    } satisfies OAuthTxPayload,
    config.sessionSecret,
  );

  const authUrl = new URL(GOOGLE_AUTH_ENDPOINT);
  authUrl.searchParams.set("client_id", config.clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("prompt", "select_account");

  const headers = new Headers();
  headers.set("Location", authUrl.toString());
  headers.set("Cache-Control", "no-store");
  headers.append("Set-Cookie", buildOAuthTxCookie(txToken));
  return new Response(null, { status: 302, headers });
}

export async function handleAuthCallback(
  request: Request,
  config: GoogleOAuthConfig,
  exchanger: OAuthCodeExchanger = defaultGoogleOAuthExchanger,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const txCookie = readCookie(request, OAUTH_TX_COOKIE);

  if (!code || !state || !txCookie) {
    return new Response(JSON.stringify({ error: "invalid_oauth_callback" }), {
      status: 400,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Set-Cookie": buildClearedOAuthTxCookie(),
      },
    });
  }

  const tx = await verifyPayload<OAuthTxPayload>(txCookie, config.sessionSecret);
  if (!tx || tx.state !== state || tx.exp <= nowSeconds) {
    return new Response(JSON.stringify({ error: "invalid_oauth_state" }), {
      status: 400,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Set-Cookie": buildClearedOAuthTxCookie(),
      },
    });
  }

  let userInfo: OAuthUserInfo;
  try {
    userInfo = await exchanger.exchangeCode({
      code,
      codeVerifier: tx.code_verifier,
      redirectUri: `${url.origin}/api/auth/callback`,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });
  } catch {
    return new Response(JSON.stringify({ error: "oauth_exchange_failed" }), {
      status: 502,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Set-Cookie": buildClearedOAuthTxCookie(),
      },
    });
  }

  if (!isOwnerAllowed(userInfo.email, userInfo.email_verified, config.ownerEmailAllowlist)) {
    return new Response(JSON.stringify({ error: "forbidden_account" }), {
      status: 403,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Set-Cookie": buildClearedOAuthTxCookie(),
      },
    });
  }

  const sessionToken = await signPayload(
    {
      sub: "owner",
      iat: nowSeconds,
      exp: nowSeconds + SESSION_TTL_SECONDS,
    } satisfies SessionPayload,
    config.sessionSecret,
  );

  const headers = new Headers();
  headers.set("Location", `${url.origin}/`);
  headers.set("Cache-Control", "no-store");
  headers.append("Set-Cookie", buildClearedOAuthTxCookie());
  headers.append("Set-Cookie", buildSessionCookie(sessionToken));
  return new Response(null, { status: 302, headers });
}

export function handleAuthLogout(): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  headers.append("Set-Cookie", buildClearedSessionCookie());
  return new Response(JSON.stringify({ authenticated: false }), { status: 200, headers });
}
