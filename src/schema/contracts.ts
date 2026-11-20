export const EMBEDDING_DIMENSION = 1024;

export interface ReportDTO {
  readonly id: string;
  readonly company: string;
  readonly report_year: number;
  readonly title: string;
  readonly source_url: string;
  readonly dataset_version: string;
  readonly total_indexed_pages: number;
}

export interface MatchedReportPageDTO {
  readonly report_id: string;
  readonly company: string;
  readonly report_year: number;
  readonly report_title: string;
  readonly source_url: string;
  readonly dataset_version: string;
  readonly page_number: number;
  readonly section_title: string | null;
  readonly visual_summary: string;
  readonly has_chart: boolean;
  readonly image_path: string;
  readonly cosine_similarity: number;
  readonly rrf_score: number;
}

function assertRecord(input: unknown, label: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`${label} must be a non-null object`);
  }
  return input as Record<string, unknown>;
}

function readNonEmptyString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid field "${key}": expected non-empty string`);
  }
  return value;
}

function readNullableString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid field "${key}": expected string or null`);
  }
  return value;
}

function readFiniteNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid field "${key}": expected finite number`);
  }
  return value;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new Error(`Invalid field "${key}": expected boolean`);
  }
  return value;
}

export function parseReportRow(input: unknown): ReportDTO {
  const record = assertRecord(input, "ReportRow");
  const reportYear = readFiniteNumber(record, "report_year");
  const totalIndexedPages = readFiniteNumber(record, "total_indexed_pages");
  const sourceUrl = readNonEmptyString(record, "source_url");

  if (!Number.isInteger(reportYear) || reportYear < 2000 || reportYear > 2100) {
    throw new Error(`Invalid field "report_year": ${reportYear}`);
  }
  if (!Number.isInteger(totalIndexedPages) || totalIndexedPages < 0) {
    throw new Error(`Invalid field "total_indexed_pages": ${totalIndexedPages}`);
  }
  if (!sourceUrl.startsWith("https://") && !sourceUrl.startsWith("http://")) {
    throw new Error(`Invalid field "source_url": must start with http:// or https://`);
  }

  return {
    id: readNonEmptyString(record, "id"),
    company: readNonEmptyString(record, "company"),
    report_year: reportYear,
    title: readNonEmptyString(record, "title"),
    source_url: sourceUrl,
    dataset_version: readNonEmptyString(record, "dataset_version"),
    total_indexed_pages: totalIndexedPages,
  };
}

export function parseMatchedPageRow(input: unknown): MatchedReportPageDTO {
  const record = assertRecord(input, "MatchedReportPageRow");
  const pageNumber = readFiniteNumber(record, "page_number");
  const reportYear = readFiniteNumber(record, "report_year");

  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new Error(`Invalid field "page_number": ${pageNumber}`);
  }
  if (!Number.isInteger(reportYear) || reportYear < 2000 || reportYear > 2100) {
    throw new Error(`Invalid field "report_year": ${reportYear}`);
  }

  return {
    report_id: readNonEmptyString(record, "report_id"),
    company: readNonEmptyString(record, "company"),
    report_year: reportYear,
    report_title: readNonEmptyString(record, "report_title"),
    source_url: readNonEmptyString(record, "source_url"),
    dataset_version: readNonEmptyString(record, "dataset_version"),
    page_number: pageNumber,
    section_title: readNullableString(record, "section_title"),
    visual_summary: readNonEmptyString(record, "visual_summary"),
    has_chart: readBoolean(record, "has_chart"),
    image_path: readNonEmptyString(record, "image_path"),
    cosine_similarity: readFiniteNumber(record, "cosine_similarity"),
    rrf_score: readFiniteNumber(record, "rrf_score"),
  };
}
