import {
  applyGroundingGuard,
  DEFAULT_MIN_SIMILARITY,
  evaluateRetrievalGate,
  toCitation,
  type Citation,
  type QueryStatus,
} from "../grounding/grounding-guard";
import { VlmRateLimitError, type Embedder, type VlmClient } from "../llm/gemini-client";
import type { RetrievalStore } from "../retrieval/supabase-client";
import type { ValidatedUploadImage } from "./image-validation";
import type { RateLimiter } from "./rate-limiter";

export interface QueryInput {
  readonly userKey: string;
  readonly question: string;
  readonly uploadedImage: ValidatedUploadImage | null;
  readonly filterCompany?: string | null;
  readonly filterYear?: number | null;
  readonly filterDatasetVersion?: string | null;
}

export interface QueryResponseDTO {
  readonly request_id: string;
  readonly status: QueryStatus;
  readonly answer: string;
  readonly refusal_reason: string | null;
  readonly extracted_image_query: string | null;
  readonly citations: Citation[];
  readonly latency_ms: number;
}

export interface QueryPipelineDeps {
  readonly rateLimiter: RateLimiter;
  readonly embedder: Embedder;
  readonly retrievalStore: RetrievalStore;
  readonly vlmClient: VlmClient;
  readonly minSimilarity?: number;
  readonly topK?: number;
}

export class RateLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitExceededError";
  }
}

const DEFAULT_IMAGE_ONLY_QUESTION =
  "請辨識此圖表內容，找出對應的官方 ESG 報告頁面並核對數據。";

export async function executeMultiModalQuery(
  input: QueryInput,
  deps: QueryPipelineDeps,
): Promise<QueryResponseDTO> {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();

  const limitResult = await deps.rateLimiter.consume(input.userKey);
  if (!limitResult.allowed) {
    throw new RateLimitExceededError(limitResult.reason ?? "今日查詢額度已達上限");
  }

  const effectiveQuestion =
    input.question.trim().length > 0 ? input.question.trim() : DEFAULT_IMAGE_ONLY_QUESTION;

  let extractedImageQuery: string | null = null;
  let retrievalQueryText = effectiveQuestion;
  let vlmRateLimitedDuringImageExtract = false;

  if (input.uploadedImage) {
    try {
      extractedImageQuery = await deps.vlmClient.extractImageQuery(
        input.uploadedImage,
        effectiveQuestion,
      );
      retrievalQueryText = `${effectiveQuestion}\n${extractedImageQuery}`;
    } catch (err) {
      if (err instanceof VlmRateLimitError) {
        vlmRateLimitedDuringImageExtract = true;
      } else {
        throw err;
      }
    }
  }

  const queryEmbedding = await deps.embedder.embedQuery(retrievalQueryText);
  const candidates = await deps.retrievalStore.matchPages({
    queryEmbedding,
    queryText: retrievalQueryText,
    filterCompany: input.filterCompany ?? null,
    filterYear: input.filterYear ?? null,
    filterDatasetVersion: input.filterDatasetVersion ?? null,
    matchCount: deps.topK ?? 3,
  });

  const buildImageUrl = (imagePath: string) =>
    deps.retrievalStore.buildPublicImageUrl(imagePath);

  const gate = evaluateRetrievalGate(candidates, deps.minSimilarity ?? DEFAULT_MIN_SIMILARITY);
  if (!gate.passed) {
    return {
      request_id: requestId,
      status: "refused",
      answer: "",
      refusal_reason: gate.refusalReason,
      extracted_image_query: extractedImageQuery,
      citations: [],
      latency_ms: Date.now() - startedAt,
    };
  }

  if (vlmRateLimitedDuringImageExtract) {
    return {
      request_id: requestId,
      status: "degraded_retrieval_only",
      answer: "目前 VLM 免費額度暫時達上限，已降級回傳最相關的官方報告原頁與摘要供參考。",
      refusal_reason: null,
      extracted_image_query: null,
      citations: candidates.map((page) => toCitation(page, buildImageUrl)),
      latency_ms: Date.now() - startedAt,
    };
  }

  try {
    const vlmOutput = await deps.vlmClient.generateGroundedAnswer({
      question: effectiveQuestion,
      uploadedImage: input.uploadedImage,
      candidates,
      buildImageUrl,
    });

    const grounded = applyGroundingGuard({
      modelRefused: vlmOutput.refused,
      modelRefusalReason: vlmOutput.refusalReason,
      rawAnswer: vlmOutput.answer,
      citedRefs: vlmOutput.citedRefs,
      candidates,
      buildImageUrl,
    });

    return {
      request_id: requestId,
      status: grounded.status,
      answer: grounded.answer,
      refusal_reason: grounded.refusalReason,
      extracted_image_query: extractedImageQuery,
      citations: grounded.citations,
      latency_ms: Date.now() - startedAt,
    };
  } catch (err) {
    if (err instanceof VlmRateLimitError) {
      return {
        request_id: requestId,
        status: "degraded_retrieval_only",
        answer: "目前 VLM 免費額度暫時達上限，已降級回傳最相關的官方報告原頁與摘要供參考。",
        refusal_reason: null,
        extracted_image_query: extractedImageQuery,
        citations: candidates.map((page) => toCitation(page, buildImageUrl)),
        latency_ms: Date.now() - startedAt,
      };
    }
    throw err;
  }
}
