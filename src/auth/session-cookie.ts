/**
 * HttpOnly session cookie, HMAC-SHA256 token signing, and same-origin write protection.
 * Follows Harbor DeploymentHandbook.md §2.1 (__Host- prefix, HttpOnly, Secure, SameSite=Strict).
 */

export const SESSION_COOKIE = "__Host-mmrag_session";
export const OAUTH_TX_COOKIE = "__Host-mmrag_oauth_tx";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
export const OAUTH_TX_TTL_SECONDS = 60 * 10; // 10 minutes

export interface SessionPayload {
  readonly sub: string;
  readonly iat: number;
  readonly exp: number;
}

export interface OAuthTxPayload {
  readonly state: string;
  readonly code_verifier: string;
  readonly exp: number;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (input.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET must be at least 16 characters");
  }
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signPayload(payload: object, secret: string): Promise<string> {
  const key = await importHmacKey(secret);
  const encoded = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded));
  const signature = toBase64Url(new Uint8Array(signatureBuffer));
  return `${encoded}.${signature}`;
}

export async function verifyPayload<T>(token: string, secret: string): Promise<T | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  if (!encoded || !signature) return null;

  try {
    const key = await importHmacKey(secret);
    const sigBytes = fromBase64Url(signature);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes as unknown as BufferSource,
      new TextEncoder().encode(encoded),
    );
    if (!valid) return null;
    const json = new TextDecoder().decode(fromBase64Url(encoded));
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export function readCookie(request: Request, cookieName: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index !== -1 && part.slice(0, index).trim() === cookieName) {
      return part.slice(index + 1).trim() || null;
    }
  }
  return null;
}

export function buildSessionCookie(token: string, maxAgeSeconds = SESSION_TTL_SECONDS): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

export function buildClearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export function buildOAuthTxCookie(token: string, maxAgeSeconds = OAUTH_TX_TTL_SECONDS): string {
  // SameSite=Lax is required so the browser sends the state/PKCE cookie on top-level redirect back from Google.
  return `${OAUTH_TX_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function buildClearedOAuthTxCookie(): string {
  return `${OAUTH_TX_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function isSameOriginWrite(request: Request): boolean {
  if (request.method === "GET" || request.method === "HEAD") return true;
  const origin = request.headers.get("Origin");
  if (origin !== null) return origin === new URL(request.url).origin;
  return request.headers.get("Sec-Fetch-Site") === "same-origin";
}

export function randomBase64Url(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return toBase64Url(new Uint8Array(digest));
}
