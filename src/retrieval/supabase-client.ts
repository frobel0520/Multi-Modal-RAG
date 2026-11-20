import {
  EMBEDDING_DIMENSION,
  parseMatchedPageRow,
  parseReportRow,
  type MatchedReportPageDTO,
  type ReportDTO,
} from "../schema/contracts";

export interface MatchPagesParams {
  readonly queryEmbedding: readonly number[];
  readonly queryText: string;
  readonly filterCompany?: string | null;
  readonly filterYear?: number | null;
  readonly filterDatasetVersion?: string | null;
  readonly matchCount?: number;
}

export interface RetrievalStore {
  listReports(): Promise<ReportDTO[]>;
  matchPages(params: MatchPagesParams): Promise<MatchedReportPageDTO[]>;
  buildPublicImageUrl(imagePath: string): string;
}

export interface SupabaseStoreConfig {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly storageBucket?: string;
}

const DEFAULT_STORAGE_BUCKET = "esg-pages";

export class SupabaseRetrievalStore implements RetrievalStore {
  private readonly baseUrl: string;
  private readonly anonKey: string;
  private readonly storageBucket: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: SupabaseStoreConfig, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = config.supabaseUrl.replace(/\/+$/, "");
    this.anonKey = config.supabaseAnonKey;
    this.storageBucket = config.storageBucket ?? DEFAULT_STORAGE_BUCKET;
    this.fetchImpl = fetchImpl;
  }

  private headers(): Record<string, string> {
    return {
      apikey: this.anonKey,
      Authorization: `Bearer ${this.anonKey}`,
      "Content-Type": "application/json",
    };
  }

  buildPublicImageUrl(imagePath: string): string {
    const cleanPath = imagePath.replace(/^\/+/, "");
    return `${this.baseUrl}/storage/v1/object/public/${this.storageBucket}/${cleanPath}`;
  }

  async listReports(): Promise<ReportDTO[]> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/rest/v1/reports?select=id,company,report_year,title,source_url,dataset_version,total_indexed_pages&order=company.asc,report_year.desc`,
      { method: "GET", headers: this.headers() },
    );

    if (!res.ok) {
      throw new Error(`supabase_list_reports_failed:${res.status}`);
    }

    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows)) {
      throw new Error("supabase_list_reports_invalid_payload");
    }
    return rows.map((row) => parseReportRow(row));
  }

  async matchPages(params: MatchPagesParams): Promise<MatchedReportPageDTO[]> {
    if (params.queryEmbedding.length !== EMBEDDING_DIMENSION) {
      throw new Error(
        `Invalid queryEmbedding dimension: expected ${EMBEDDING_DIMENSION}, got ${params.queryEmbedding.length}`,
      );
    }

    const res = await this.fetchImpl(`${this.baseUrl}/rest/v1/rpc/match_report_pages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        query_embedding: `[${params.queryEmbedding.join(",")}]`,
        query_text: params.queryText,
        filter_company: params.filterCompany ?? null,
        filter_year: params.filterYear ?? null,
        filter_dataset_version: params.filterDatasetVersion ?? null,
        match_count: params.matchCount ?? 3,
      }),
    });

    if (!res.ok) {
      throw new Error(`supabase_match_pages_failed:${res.status}`);
    }

    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows)) {
      throw new Error("supabase_match_pages_invalid_payload");
    }
    return rows.map((row) => parseMatchedPageRow(row));
  }
}
