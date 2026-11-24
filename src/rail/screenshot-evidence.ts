export const RAIL_CHART_CODE = {
  "tra-taipei": "TRA",
  "metro-taipei": "METRO",
  "hsr-taipei": "HSR",
} as const;

export type RailSeriesId = keyof typeof RAIL_CHART_CODE;

export interface ScreenshotRow {
  readonly year: number;
  readonly value: number;
}

export interface ScreenshotEvidence {
  readonly codes: readonly string[];
  readonly rows: readonly ScreenshotRow[];
}

/** Keep only chart codes and annual rows. Other recognized text stays in the browser. */
export function parseScreenshotText(text: string): ScreenshotEvidence {
  const codes = new Set<string>();
  const rows: ScreenshotRow[] = [];
  for (const line of text.normalize("NFKC").split("\n")) {
    const heading = /\bRAIL\s+(TRA|METRO|HSR)\b/i.exec(line);
    if (heading?.[1]) codes.add(heading[1].toUpperCase());

    const row = /^\s*(\d{4})\s+([0-9,]+)(?=\s|$)/.exec(line);
    if (!row?.[1] || !row[2]) continue;
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(row[2])) continue;
    const value = Number(row[2].replaceAll(",", ""));
    if (Number.isSafeInteger(value)) rows.push({ year: Number(row[1]), value });
  }
  return { codes: [...codes], rows: codes.size === 1 ? rows : [] };
}
