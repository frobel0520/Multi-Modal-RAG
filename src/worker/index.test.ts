import { describe, expect, it } from "vitest";
import type { RailCitation } from "../rail/rail-query";
import { SESSION_COOKIE, signPayload } from "../auth/session-cookie";
import { handleRequest, type Env } from "./index";

const TEST_ENV: Env = {
  APP_VERSION: "0.1.0",
  DATASET_VERSION: "test-v1",
};

describe("Worker /api/health", () => {
  it("returns ok status with version metadata and no-store cache header", async () => {
    const response = await handleRequest(
      new Request("https://multi-modal-rag.example.com/api/health", { method: "GET" }),
      TEST_ENV,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.json()).toEqual({
      status: "ok",
      version: "0.1.0",
      dataset_version: "2026-11-24",
    });
  });

  it("fails closed with 401 for unauthenticated /api/* paths", async () => {
    const response = await handleRequest(
      new Request("https://multi-modal-rag.example.com/api/unknown", { method: "GET" }),
      TEST_ENV,
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });
});

describe("Worker rail HTTP flow", () => {
  const origin = "https://multi-modal-rag.example.com";
  const env: Env = {
    ...TEST_ENV,
    SESSION_SECRET: "fixture-test-secret-only-fixture-test-secret",
    OWNER_EMAIL_ALLOWLIST: "owner@example.com",
  };
  const now = 1_800_000_000;
  const deps = { nowSeconds: () => now };

  async function sessionHeaders(): Promise<Headers> {
    const token = await signPayload({ sub: "owner@example.com", iat: now, exp: now + 600 }, env.SESSION_SECRET!);
    return new Headers({ Cookie: `${SESSION_COOKIE}=${token}`, Origin: origin });
  }

  it("answers a signed multipart screenshot request and serves the cited SVG", async () => {
    const headers = await sessionHeaders();
    const form = new FormData();
    form.set("question", "這張圖 2024 年人次？");
    form.set("screenshot_evidence", JSON.stringify({
      codes: ["METRO"], rows: [{ year: 2024, value: 741824511 }],
    }));
    const response = await handleRequest(new Request(`${origin}/api/query`, {
      method: "POST", headers, body: form,
    }), env, deps);
    expect(response.status).toBe(200);
    const result = await response.json() as { status: string; citations: RailCitation[] };
    expect(result).toMatchObject({ status: "grounded", citations: [{
      value: 741824511,
      source_url: "https://data.gov.tw/dataset/132092",
      publisher: "臺北市政府主計處",
      unit: "人次",
    }] });

    const chartPath = result.citations[0]?.image_url;
    const chart = await handleRequest(new Request(`${origin}${chartPath}`, { headers }), env, deps);
    expect(chart.headers.get("Content-Type")).toContain("image/svg+xml");
    expect(await chart.text()).toContain("741,824,511");
  });

  it("rejects files submitted to the rail API and refuses unverifiable evidence without citations", async () => {
    const headers = await sessionHeaders();
    const form = new FormData();
    form.set("question", "這張圖 2024 年人次？");
    form.set("image", new File([new Uint8Array([0, 1, 2])], "fixture.png", { type: "image/png" }));
    const fileResponse = await handleRequest(new Request(`${origin}/api/query`, {
      method: "POST", headers, body: form,
    }), env, deps);
    expect(fileResponse.status).toBe(400);

    headers.set("Content-Type", "application/json");
    const unverifiedResponse = await handleRequest(new Request(`${origin}/api/query`, {
      method: "POST", headers, body: JSON.stringify({
        question: "這張圖 2024 年人次？",
        screenshot_evidence: { codes: ["METRO"], rows: [{ year: 2024, value: 1 }] },
      }),
    }), env, deps);
    expect(unverifiedResponse.status).toBe(200);
    expect(await unverifiedResponse.json()).toMatchObject({ status: "refused", citations: [] });
  });

  it("rejects malformed screenshot evidence and protects the query and chart endpoints", async () => {
    const headers = await sessionHeaders();
    headers.set("Content-Type", "application/json");
    const response = await handleRequest(new Request(`${origin}/api/query`, {
      method: "POST", headers, body: JSON.stringify({
        screenshot_evidence: { codes: ["METRO"], rows: [null] },
      }),
    }), env, deps);
    expect(response.status).toBe(400);
    const chart = await handleRequest(new Request(`${origin}/api/rail/charts/metro-taipei-2026-11-24.svg`), env, deps);
    expect(chart.status).toBe(401);
    headers.set("Origin", "https://other.example.com");
    const crossOrigin = await handleRequest(new Request(`${origin}/api/query`, {
      method: "POST", headers, body: JSON.stringify({ question: "2024 年北捷人次" }),
    }), env, deps);
    expect(crossOrigin.status).toBe(403);
  });
});
