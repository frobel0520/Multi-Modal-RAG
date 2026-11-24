import { describe, expect, it } from "vitest";
import { fetchAuthMe, logout, submitQuery } from "../../web/src/api";

describe("T08 Frontend same-origin API client", () => {
  it("returns false on 401 from /api/auth/me and sends credentials: same-origin", async () => {
    let capturedCredentials: RequestCredentials | undefined;
    const fakeFetch: typeof fetch = async (_input, init) => {
      capturedCredentials = init?.credentials;
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    };

    expect(await fetchAuthMe(fakeFetch)).toBe(false);
    expect(capturedCredentials).toBe("same-origin");
  });

  it("throws on failed logout so UI does not fake logged-out state", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ error: "server_error" }), { status: 500 });

    await expect(logout(fakeFetch)).rejects.toThrow(/登出失敗/);
  });

  it("sends multipart FormData with filters and recognized data only on submitQuery", async () => {
    let capturedBody: BodyInit | null | undefined;
    let capturedCredentials: RequestCredentials | undefined;

    const fakeFetch: typeof fetch = async (_input, init) => {
      capturedBody = init?.body;
      capturedCredentials = init?.credentials;
      return new Response(
        JSON.stringify({
          request_id: "req-1",
          status: "grounded",
          answer: "測試回答",
          refusal_reason: null,
          extracted_image_query: null,
          citations: [],
          latency_ms: 120,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const screenshot = { codes: ["METRO"], rows: [{ year: 2024, value: 741824511 }] };

    const result = await submitQuery(
      {
        question: "這張圖 2024 年的人次？",
        series: "metro-taipei",
        year: "2024",
        screenshot,
      },
      fakeFetch,
    );

    expect(capturedCredentials).toBe("same-origin");
    expect(capturedBody).toBeInstanceOf(FormData);
    const form = capturedBody as FormData;
    expect(form.get("question")).toBe("這張圖 2024 年的人次？");
    expect(form.get("series")).toBe("metro-taipei");
    expect(form.get("year")).toBe("2024");
    expect(form.get("image")).toBeNull();
    expect(form.get("screenshot_evidence")).toBe(JSON.stringify(screenshot));
    expect(result.status).toBe("grounded");
  });
});
