import type { CitationRef } from "../grounding/grounding-guard";
import type { MatchedReportPageDTO } from "../schema/contracts";
import type { ValidatedUploadImage } from "../query/image-validation";

export class VlmRateLimitError extends Error {
  constructor(message = "VLM free tier rate limit exceeded") {
    super(message);
    this.name = "VlmRateLimitError";
  }
}

export interface Embedder {
  embedQuery(text: string): Promise<number[]>;
}

export interface VlmAnswerOutput {
  readonly refused: boolean;
  readonly refusalReason: string | null;
  readonly answer: string;
  readonly citedRefs: CitationRef[];
}

export interface VlmClient {
  extractImageQuery(image: ValidatedUploadImage, userQuestion: string): Promise<string>;
  generateGroundedAnswer(params: {
    readonly question: string;
    readonly uploadedImage: ValidatedUploadImage | null;
    readonly candidates: readonly MatchedReportPageDTO[];
    readonly buildImageUrl: (imagePath: string) => string;
  }): Promise<VlmAnswerOutput>;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

export class WorkersAiBgeM3Embedder implements Embedder {
  constructor(private readonly ai: { run(model: string, input: { text: string[] }): Promise<{ data?: number[][] }> }) {}

  async embedQuery(text: string): Promise<number[]> {
    const result = await this.ai.run("@cf/baai/bge-m3", { text: [text] });
    const vector = result.data?.[0];
    if (!vector || !Array.isArray(vector)) {
      throw new Error("workers_ai_embedding_empty");
    }
    return vector;
  }
}

export class GeminiVlmClient implements VlmClient {
  private readonly model: string;

  constructor(
    private readonly apiKey: string,
    model = "gemini-2.5-flash",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.model = model;
  }

  private async callGemini(parts: unknown[]): Promise<string> {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const res = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      }),
    });

    if (res.status === 429) {
      throw new VlmRateLimitError("Gemini API 429 rate limit");
    }
    if (!res.ok) {
      throw new Error(`gemini_api_error:${res.status}`);
    }

    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error("gemini_empty_response");
    }
    return text;
  }

  async extractImageQuery(image: ValidatedUploadImage, userQuestion: string): Promise<string> {
    const prompt = [
      "你是台灣上市企業 ESG 報告書圖表檢索助手。",
      "請辨識這張圖片中的企業名稱、年度、圖表標題、ESG 指標名稱與關鍵數值，產出一段簡短的繁體中文檢索關鍵詞。",
      `使用者補充問題：${userQuestion}`,
      '請只回傳 JSON：{"search_query": "..."}',
    ].join("\n");

    const raw = await this.callGemini([
      { text: prompt },
      {
        inlineData: {
          mimeType: image.mimeType,
          data: bytesToBase64(image.bytes),
        },
      },
    ]);

    const parsed = JSON.parse(raw) as { search_query?: string };
    return parsed.search_query?.trim() || userQuestion;
  }

  async generateGroundedAnswer(params: {
    readonly question: string;
    readonly uploadedImage: ValidatedUploadImage | null;
    readonly candidates: readonly MatchedReportPageDTO[];
    readonly buildImageUrl: (imagePath: string) => string;
  }): Promise<VlmAnswerOutput> {
    const contextLines = params.candidates.map(
      (c, idx) =>
        `[候選 ${idx + 1}] report_id=${c.report_id}, company=${c.company}, year=${c.report_year}, page=${c.page_number}\n摘要：${c.visual_summary}`,
    );

    const prompt = [
      "你是嚴謹的台灣企業 ESG 報告書多模態分析助手，必須完全依據提供的官方報告頁證據作答。",
      "規則：",
      "1. 每個數值必須標明公司、年度與單位；禁止使用未出現在證據中的數字。",
      "2. 若證據不足以回答問題，請將 refused 設為 true 並說明原因。",
      "3. cited_pages 只能引用上方候選列表中的 report_id 與 page_number。",
      `使用者問題：${params.question}`,
      "候選官方報告頁：",
      ...contextLines,
      '請只回傳 JSON：{"refused": boolean, "refusal_reason": string | null, "answer": string, "cited_pages": [{"report_id": string, "page_number": number}]}',
    ].join("\n");

    const parts: unknown[] = [{ text: prompt }];
    if (params.uploadedImage) {
      parts.push({
        inlineData: {
          mimeType: params.uploadedImage.mimeType,
          data: bytesToBase64(params.uploadedImage.bytes),
        },
      });
    }

    const raw = await this.callGemini(parts);
    const parsed = JSON.parse(raw) as {
      refused?: boolean;
      refusal_reason?: string | null;
      answer?: string;
      cited_pages?: CitationRef[];
    };

    return {
      refused: Boolean(parsed.refused),
      refusalReason: parsed.refusal_reason ?? null,
      answer: typeof parsed.answer === "string" ? parsed.answer : "",
      citedRefs: Array.isArray(parsed.cited_pages) ? parsed.cited_pages : [],
    };
  }
}
