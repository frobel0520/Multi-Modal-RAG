import { describe, expect, it } from "vitest";
import {
  applyGroundingGuard,
  evaluateRetrievalGate,
} from "../../src/grounding/grounding-guard";
import { SupabaseRetrievalStore } from "../../src/retrieval/supabase-client";
import { EMBEDDING_DIMENSION, type MatchedReportPageDTO } from "../../src/schema/contracts";

const SAMPLE_PAGES: MatchedReportPageDTO[] = [
  {
    report_id: "tsmc-esg-2024",
    company: "TSMC",
    report_year: 2024,
    report_title: "TSMC 2024 Sustainability Report",
    source_url: "https://example.com/tsmc-2024.pdf",
    dataset_version: "esg-2026-11-v1",
    page_number: 42,
    section_title: "Energy & Climate",
    visual_summary: "Bar chart: renewable energy share reached 14.1% in 2024.",
    has_chart: true,
    image_path: "tsmc-esg-2024/page-042.webp",
    cosine_similarity: 0.84,
    rrf_score: 0.032,
  },
  {
    report_id: "mediatek-esg-2024",
    company: "MediaTek",
    report_year: 2024,
    report_title: "MediaTek 2024 Sustainability Report",
    source_url: "https://example.com/mediatek-2024.pdf",
    dataset_version: "esg-2026-11-v1",
    page_number: 18,
    section_title: "Carbon Footprint",
    visual_summary: "Table: Scope 1 and Scope 2 emissions in tCO2e.",
    has_chart: true,
    image_path: "mediatek-esg-2024/page-018.webp",
    cosine_similarity: 0.61,
    rrf_score: 0.025,
  },
];

const fakeImageUrl = (path: string) => `https://cdn.example.com/pages/${path}`;

describe("T06 Grounding guard & Supabase retrieval client", () => {
  it("refuses when candidates are empty or below similarity threshold", () => {
    expect(evaluateRetrievalGate([]).passed).toBe(false);

    const lowScorePages = SAMPLE_PAGES.map((p) => ({ ...p, cosine_similarity: 0.2 }));
    const gate = evaluateRetrievalGate(lowScorePages, 0.35);
    expect(gate.passed).toBe(false);
    expect(gate.refusalReason).toContain("相關度不足");
  });

  it("keeps verified citations and drops fabricated page citations", () => {
    const decision = applyGroundingGuard({
      modelRefused: false,
      rawAnswer: "依據 2024 年報告，再生能源比例為 14.1%。",
      citedRefs: [
        { report_id: "tsmc-esg-2024", page_number: 42 },
        { report_id: "tsmc-esg-2024", page_number: 999 }, // fabricated
      ],
      candidates: SAMPLE_PAGES,
      buildImageUrl: fakeImageUrl,
    });

    expect(decision.status).toBe("grounded");
    expect(decision.citations).toHaveLength(1);
    expect(decision.citations[0]?.page_number).toBe(42);
    expect(decision.droppedCitationCount).toBe(1);
  });

  it("refuses when all model citations are fabricated", () => {
    const decision = applyGroundingGuard({
      modelRefused: false,
      rawAnswer: "憑空捏造的回答",
      citedRefs: [{ report_id: "unknown-report", page_number: 1 }],
      candidates: SAMPLE_PAGES,
      buildImageUrl: fakeImageUrl,
    });

    expect(decision.status).toBe("refused");
    expect(decision.citations).toHaveLength(0);
    expect(decision.droppedCitationCount).toBe(1);
  });

  it("validates embedding dimension and parses Supabase RPC rows", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify(SAMPLE_PAGES), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const store = new SupabaseRetrievalStore(
      {
        supabaseUrl: "https://synthetic.supabase.co",
        supabaseAnonKey: "synthetic-anon-key",
      },
      fakeFetch,
    );

    await expect(
      store.matchPages({ queryEmbedding: [0.1, 0.2], queryText: "再生能源" }),
    ).rejects.toThrow(/dimension/);

    const validEmbedding = new Array<number>(EMBEDDING_DIMENSION).fill(0.01);
    const matched = await store.matchPages({
      queryEmbedding: validEmbedding,
      queryText: "再生能源",
      matchCount: 2,
    });

    expect(matched).toHaveLength(2);
    expect(store.buildPublicImageUrl("tsmc-esg-2024/page-042.webp")).toBe(
      "https://synthetic.supabase.co/storage/v1/object/public/esg-pages/tsmc-esg-2024/page-042.webp",
    );
  });
});
