import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EMBEDDING_DIMENSION,
  parseMatchedPageRow,
  parseReportRow,
} from "../../src/schema/contracts";

describe("T02 Supabase schema migration & DTO contracts", () => {
  it("defines pgvector 1024-dim schema, RLS, and match_report_pages RPC in 0001_init.sql", () => {
    const sql = readFileSync(resolve(process.cwd(), "migrations/0001_init.sql"), "utf8");
    expect(sql).toContain("create extension if not exists vector");
    expect(sql).toContain("create table if not exists public.reports");
    expect(sql).toContain("create table if not exists public.report_pages");
    expect(sql).toContain(`embedding vector(${EMBEDDING_DIMENSION}) not null`);
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("create or replace function public.match_report_pages");
  });

  it("parses a valid ReportRow fixture", () => {
    const row = parseReportRow({
      id: "tsmc-esg-2024",
      company: "TSMC",
      report_year: 2024,
      title: "TSMC 2024 Sustainability Report (Synthetic Fixture)",
      source_url: "https://example.com/reports/tsmc-esg-2024.pdf",
      dataset_version: "esg-2026-11-v1",
      total_indexed_pages: 72,
    });

    expect(row.id).toBe("tsmc-esg-2024");
    expect(row.total_indexed_pages).toBe(72);
  });

  it("rejects ReportRow with invalid source_url or negative page count", () => {
    expect(() =>
      parseReportRow({
        id: "bad-report",
        company: "ExampleCorp",
        report_year: 2024,
        title: "Bad URL Report",
        source_url: "javascript:alert(1)",
        dataset_version: "v1",
        total_indexed_pages: 10,
      }),
    ).toThrow(/source_url/);

    expect(() =>
      parseReportRow({
        id: "bad-pages",
        company: "ExampleCorp",
        report_year: 2024,
        title: "Negative Pages",
        source_url: "https://example.com/r.pdf",
        dataset_version: "v1",
        total_indexed_pages: -1,
      }),
    ).toThrow(/total_indexed_pages/);
  });

  it("parses a valid MatchedReportPageRow fixture and rejects invalid page_number", () => {
    const page = parseMatchedPageRow({
      report_id: "tsmc-esg-2024",
      company: "TSMC",
      report_year: 2024,
      report_title: "TSMC 2024 Sustainability Report",
      source_url: "https://example.com/reports/tsmc-esg-2024.pdf",
      dataset_version: "esg-2026-11-v1",
      page_number: 42,
      section_title: null,
      visual_summary: "Bar chart showing renewable energy share from 2022 to 2024 (%).",
      has_chart: true,
      image_path: "tsmc-esg-2024/page-042.webp",
      cosine_similarity: 0.87,
      rrf_score: 0.032,
    });

    expect(page.page_number).toBe(42);
    expect(page.section_title).toBeNull();
    expect(page.has_chart).toBe(true);

    expect(() =>
      parseMatchedPageRow({
        ...page,
        page_number: 0,
      }),
    ).toThrow(/page_number/);
  });
});
