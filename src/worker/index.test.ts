import { describe, expect, it } from "vitest";
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
      dataset_version: "test-v1",
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
