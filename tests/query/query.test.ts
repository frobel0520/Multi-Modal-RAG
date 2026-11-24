import { describe, expect, it } from "vitest";
import { signPayload, SESSION_COOKIE } from "../../src/auth/session-cookie";
import { VlmRateLimitError, type Embedder, type VlmClient } from "../../src/llm/gemini-client";
import { KvDailyRateLimiter, type KvStoreLike } from "../../src/query/rate-limiter";
import { executeMultiModalQuery, type QueryPipelineDeps } from "../../src/query/query-pipeline";
import { validateUploadImageBytes } from "../../src/query/image-validation";
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

describe("Existing retrieval pipeline, image validation, and rail API rate limit", () => {
  it("validates PNG magic bytes and rejects fake image payloads", () => {
    expect(validateUploadImageBytes(VALID_PNG_BYTES).mimeType).toBe("image/png");
    expect(() => validateUploadImageBytes(new TextEncoder().encode("not an image payload"))).toThrow(
      /僅支援 PNG、JPEG 或 WebP/,
    );
  });

  it("extracts image terms and returns grounded citations in the report pipeline", async () => {
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

    const deps: QueryPipelineDeps = {
      retrievalStore: createFakeStore(),
      rateLimiter: new KvDailyRateLimiter(createMemoryKv(), 10, 5),
      embedder: FAKE_EMBEDDER,
      vlmClient: fakeVlm,
    };
    const json = await executeMultiModalQuery({
      userKey: "owner",
      question: "這張圖的數據對應哪一頁？",
      uploadedImage: validateUploadImageBytes(VALID_PNG_BYTES),
    }, deps);
    expect(json.status).toBe("grounded");
    expect(json.extracted_image_query).toBe("TSMC 2024 再生能源比例");
    expect(json.citations).toHaveLength(1);
    expect(json.citations[0]?.page_number).toBe(42);
  });

  it("degrades report retrieval on Gemini 429 rate limit", async () => {
    const rateLimitedVlm: VlmClient = {
      async extractImageQuery() {
        throw new VlmRateLimitError();
      },
      async generateGroundedAnswer() {
        throw new VlmRateLimitError();
      },
    };

    const deps: QueryPipelineDeps = {
      retrievalStore: createFakeStore(),
      rateLimiter: new KvDailyRateLimiter(createMemoryKv(), 10, 5),
      embedder: FAKE_EMBEDDER,
      vlmClient: rateLimitedVlm,
    };
    const json = await executeMultiModalQuery({
      userKey: "owner",
      question: "TSMC 2024 再生能源比例？",
      uploadedImage: null,
    }, deps);
    expect(json.status).toBe("degraded_retrieval_only");
    expect(json.citations).toHaveLength(1);
  });

  it("enforces KV daily rate limit and returns 429 when exceeded", async () => {
    const cookie = await createOwnerCookieHeader();
    const kv = createMemoryKv();
    const deps: WorkerDeps = { rateLimiter: new KvDailyRateLimiter(kv, 1, 1) };

    const makeReq = () =>
      new Request(`${BASE_ORIGIN}/api/query`, {
        method: "POST",
        headers: {
          Origin: BASE_ORIGIN,
          Cookie: cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ question: "2024 年臺鐵人次？" }),
      });

    const first = await handleRequest(makeReq(), TEST_ENV, deps);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ status: "grounded" });

    const second = await handleRequest(makeReq(), TEST_ENV, deps);
    expect(second.status).toBe(429);
  });
});
