import type { MatchedReportPageDTO } from "../schema/contracts";

export const DEFAULT_MIN_SIMILARITY = 0.35;

export type QueryStatus = "grounded" | "refused" | "degraded_retrieval_only";

export interface CitationRef {
  readonly report_id: string;
  readonly page_number: number;
}

export interface Citation {
  readonly report_id: string;
  readonly company: string;
  readonly report_year: number;
  readonly page_number: number;
  readonly section_title: string | null;
  readonly image_url: string;
  readonly source_url: string;
  readonly relevance_score: number;
  readonly visual_excerpt: string;
}

export interface RetrievalGateResult {
  readonly passed: boolean;
  readonly refusalReason: string | null;
  readonly topSimilarity: number;
}

export interface GroundedDecision {
  readonly status: QueryStatus;
  readonly answer: string;
  readonly refusalReason: string | null;
  readonly citations: Citation[];
  readonly droppedCitationCount: number;
}

export function evaluateRetrievalGate(
  candidates: readonly MatchedReportPageDTO[],
  minSimilarity = DEFAULT_MIN_SIMILARITY,
): RetrievalGateResult {
  if (candidates.length === 0) {
    return {
      passed: false,
      refusalReason: "目前收錄的 ESG 報告書中查無相關頁面，無法回答此問題。",
      topSimilarity: 0,
    };
  }

  const topSimilarity = candidates.reduce(
    (max, page) => (page.cosine_similarity > max ? page.cosine_similarity : max),
    -1,
  );

  if (topSimilarity < minSimilarity) {
    return {
      passed: false,
      refusalReason: "檢索結果與問題的相關度不足，為避免臆測已拒答。",
      topSimilarity,
    };
  }

  return {
    passed: true,
    refusalReason: null,
    topSimilarity,
  };
}

export function toCitation(
  page: MatchedReportPageDTO,
  buildImageUrl: (imagePath: string) => string,
): Citation {
  return {
    report_id: page.report_id,
    company: page.company,
    report_year: page.report_year,
    page_number: page.page_number,
    section_title: page.section_title,
    image_url: buildImageUrl(page.image_path),
    source_url: page.source_url,
    relevance_score: Number(page.cosine_similarity.toFixed(4)),
    visual_excerpt: page.visual_summary.slice(0, 240),
  };
}

export function applyGroundingGuard(params: {
  readonly modelRefused: boolean;
  readonly modelRefusalReason?: string | null;
  readonly rawAnswer: string;
  readonly citedRefs: readonly CitationRef[];
  readonly candidates: readonly MatchedReportPageDTO[];
  readonly buildImageUrl: (imagePath: string) => string;
}): GroundedDecision {
  if (params.modelRefused) {
    return {
      status: "refused",
      answer: "",
      refusalReason:
        params.modelRefusalReason?.trim() || "提供的報告原頁證據不足以回答此問題。",
      citations: [],
      droppedCitationCount: 0,
    };
  }

  const candidateMap = new Map<string, MatchedReportPageDTO>();
  for (const page of params.candidates) {
    candidateMap.set(`${page.report_id}#${page.page_number}`, page);
  }

  const verifiedCitations: Citation[] = [];
  const seenKeys = new Set<string>();
  let droppedCitationCount = 0;

  for (const ref of params.citedRefs) {
    const key = `${ref.report_id}#${ref.page_number}`;
    const matched = candidateMap.get(key);
    if (!matched) {
      droppedCitationCount += 1;
      continue;
    }
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      verifiedCitations.push(toCitation(matched, params.buildImageUrl));
    }
  }

  if (verifiedCitations.length === 0 || params.rawAnswer.trim().length === 0) {
    return {
      status: "refused",
      answer: "",
      refusalReason: "模型回應缺少可驗證的報告頁碼引用，已依 Grounding 守門規則拒答。",
      citations: [],
      droppedCitationCount,
    };
  }

  return {
    status: "grounded",
    answer: params.rawAnswer.trim(),
    refusalReason: null,
    citations: verifiedCitations,
    droppedCitationCount,
  };
}
