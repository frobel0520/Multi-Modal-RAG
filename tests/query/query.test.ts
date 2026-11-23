import { describe, expect, it } from "vitest";
import { signPayload, SESSION_COOKIE } from "../../src/auth/session-cookie";
import { VlmRateLimitError, type Embedder, type VlmClient } from "../../src/llm/gemini-client";
import { KvDailyRateLimiter, type KvStoreLike } from "../../src/query/rate-limiter";
import { MAX_UPLOAD_IMAGE_BYTES, validateUploadImageBytes } from "../../src/query/image-validation";
import type { RetrievalStore } from "../../src/retrieval/supabase-client";
import { EMBEDDING_DIMENSION, type MatchedReportPageDTO } from "../../src/schema/contracts";
import { handleRequest, type Env, type WorkerDeps } from "../../src/worker/index";

const BASE_ORIGIN = "https://multi-modal-rag.example.com";
const SESSION_SECRET = "0123456789abcdef0123456789abcdef";

const TEST_ENV: Env = {
  APP_VERSION: "0.1.0",
  DATASET_VERSION: "esg-2026-11-v1",
  SESSION_SECRET,
};

const VALID_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

const SAMPLE_CANDIDATES: MatchedReportPageDTO[] = [
  {
    report_id: "tsmc-esg-2024",
    company: "TSMC",
    report_year: 2024,
    report_title: "TSMC 2024 Sustainability Report",
    source_url: "https://example.com/tsmc-2024.pdf",
    dataset_version: "esg-2026-11-v1",
    page_number: 42,
    section_title: "Energy & Climate",
    visual_summary: "Bar chart: 2024 renewable energy share reached 14.1%.",
    has_chart: true,
    image_path: "tsmc-esg-2024/page-042.webp",
    cosine_similarity: 0.88,
    rrf_score: 0.032,
  },
];

function createMemoryKv(): KvStoreLike {
  const store = new Map<string, string>();
  return {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

function createFakeStore(): RetrievalStore {
  return {
    async listReports() {
      return [
        {
          id: "tsmc-esg-2024",
          company: "TSMC",
          report_year: 2024,
          title: "TSMC 2024 Sustainability Report",
          source_url: "https://example.com/tsmc-2024.pdf",
          dataset_version: "esg-2026-11-v1",
          total_indexed_pages: 72,
        },
      ];
    },
    async matchPages() {
      return SAMPLE_CANDIDATES;
    },
    buildPublicImageUrl(imagePath) {
      return `https://cdn.example.com/esg-pages/${imagePath}`;
    },
  };
}

const FAKE_EMBEDDER: Embedder = {
  async embedQuery() {
    return new Array<number>(EMBEDDING_DIMENSION).fill(0.01);
  },
};

async function createOwnerCookieHeader(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const token = await signPayload({ sub: "owner", iat: now, exp: now + 3600 }, SESSION_SECRET);
  return `${SESSION_COOKIE}=${token}`;
}

describe("T07 /api/query dual-modal pipeline, image validation, and KV rate limit", () => {
  it("validates PNG magic bytes and rejects fake image payloads", () => {
    expect(validateUploadImageBytes(VALID_PNG_BYTES).mimeType).toBe("image/png");
    expect(() => validateUploadImageBytes(new TextEncoder().encode("not an image payload"))).toThrow(
      /僅支援 PNG、JPEG 或 WebP/,
    );
  });

  it.each([
    { label: "a fake PNG", size: 12, expectedStatus: 400 },
    { label: "a PNG over the image limit", size: MAX_UPLOAD_IMAGE_BYTES + 1, expectedStatus: 413 },
  ])("rejects $label before calling retrieval or models", async ({ size, expectedStatus }) => {
    const cookie = await createOwnerCookieHeader();
    const bytes = new Uint8Array(size);
    if (expectedStatus === 413) bytes.set(VALID_PNG_BYTES);
    const form = new FormData();
    form.set("question", "合成驗收題");
    form.set("image", new File([bytes], "chart.png", { type: "image/png" }));
    const unexpectedService = async (): Promise<never> => {
      throw new Error("Invalid uploads must stop before any external service call");
    };
    const response = await handleRequest(new Request(`${BASE_ORIGIN}/api/query`, {
      method: "POST",
      headers: { Origin: BASE_ORIGIN, Cookie: cookie },
      body: form,
    }), TEST_ENV, {
      retrievalStore: { ...createFakeStore(), matchPages: unexpectedService },
      rateLimiter: new KvDailyRateLimiter(createMemoryKv(), 10, 5),
      embedder: { embedQuery: unexpectedService },
      vlmClient: { extractImageQuery: unexpectedService, generateGroundedAnswer: unexpectedService },
    });
    expect(response.status).toBe(expectedStatus);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("handles authenticated image-upload query and returns grounded citations", async () => {
    const cookie = await createOwnerCookieHeader();
    const fakeVlm: VlmClient = {
      async extractImageQuery() {
        return "TSMC 2024 再生能源比例";
      },
      async generateGroundedAnswer() {
        return {
          refused: false,
          refusalReason: null,
          answer: "依據 TSMC 2024 永續報告書第 42 頁，2024 年再生能源比例為 14.1%。",
          citedRefs: [{ report_id: "tsmc-esg-2024", page_number: 42 }],
        };
      },
    };

    const form = new FormData();
    form.set("question", "這張圖的數據對應哪一頁？");
    form.set("image", new File([VALID_PNG_BYTES], "chart.png", { type: "image/png" }));

    const deps: WorkerDeps = {
      retrievalStore: createFakeStore(),
      rateLimiter: new KvDailyRateLimiter(createMemoryKv(), 10, 5),
      embedder: FAKE_EMBEDDER,
      vlmClient: fakeVlm,
    };

    const res = await handleRequest(
      new Request(`${BASE_ORIGIN}/api/query`, {
        method: "POST",
        headers: { Origin: BASE_ORIGIN, Cookie: cookie },
        body: form,
      }),
      TEST_ENV,
      deps,
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      status: string;
      extracted_image_query: string | null;
      citations: Array<{ page_number: number }>;
    };
    expect(json.status).toBe("grounded");
    expect(json.extracted_image_query).toBe("TSMC 2024 再生能源比例");
    expect(json.citations).toHaveLength(1);
    expect(json.citations[0]?.page_number).toBe(42);
  });

  it("degrades gracefully to degraded_retrieval_only on Gemini 429 rate limit", async () => {
    const cookie = await createOwnerCookieHeader();
    const rateLimitedVlm: VlmClient = {
      async extractImageQuery() {
        throw new VlmRateLimitError();
      },
      async generateGroundedAnswer() {
        throw new VlmRateLimitError();
      },
    };

    const deps: WorkerDeps = {
      retrievalStore: createFakeStore(),
      rateLimiter: new KvDailyRateLimiter(createMemoryKv(), 10, 5),
      embedder: FAKE_EMBEDDER,
      vlmClient: rateLimitedVlm,
    };

    const res = await handleRequest(
      new Request(`${BASE_ORIGIN}/api/query`, {
        method: "POST",
        headers: {
          Origin: BASE_ORIGIN,
          Cookie: cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ question: "TSMC 2024 再生能源比例？" }),
      }),
      TEST_ENV,
      deps,
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string; citations: unknown[] };
    expect(json.status).toBe("degraded_retrieval_only");
    expect(json.citations).toHaveLength(1);
  });

  it("enforces KV daily rate limit and returns 429 when exceeded", async () => {
    const cookie = await createOwnerCookieHeader();
    const kv = createMemoryKv();
    const deps: WorkerDeps = {
      retrievalStore: createFakeStore(),
      rateLimiter: new KvDailyRateLimiter(kv, 1, 1),
      embedder: FAKE_EMBEDDER,
      vlmClient: {
        async extractImageQuery() {
          return "query";
        },
        async generateGroundedAnswer() {
          return {
            refused: false,
            refusalReason: null,
            answer: "ok",
            citedRefs: [{ report_id: "tsmc-esg-2024", page_number: 42 }],
          };
        },
      },
    };

    const makeReq = () =>
      new Request(`${BASE_ORIGIN}/api/query`, {
        method: "POST",
        headers: {
          Origin: BASE_ORIGIN,
          Cookie: cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ question: "TSMC 2024 再生能源比例？" }),
      });

    const first = await handleRequest(makeReq(), TEST_ENV, deps);
    expect(first.status).toBe(200);

    const second = await handleRequest(makeReq(), TEST_ENV, deps);
    expect(second.status).toBe(429);
  });
});
