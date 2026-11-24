import {
  RAIL_DATASET_VERSION, RAIL_LICENSE, RAIL_PUBLISHER, railChartUrl, railSeries, railSeriesTitle,
} from "./rail-corpus";
import { RAIL_CHART_CODE, type RailSeriesId, type ScreenshotEvidence } from "./screenshot-evidence";

const ALIASES: Record<RailSeriesId, RegExp> = {
  "tra-taipei": /臺鐵|台鐵|臺灣鐵路|台灣鐵路/g,
  "metro-taipei": /臺北捷運|台北捷運|北捷|捷運/g,
  "hsr-taipei": /臺灣高鐵|台灣高鐵|高速鐵路|高鐵/g,
};
const YEAR = /(?:民國\s*(\d{2,3})\s*年|(?<!\d)(\d{4})(?!\d)\s*年?)/g;
const SUPPORTED_TERMS = /臺北市(?:車站)?|台北市(?:車站)?|全線|進站人次|年度|客運量|運量|客運人次|搭乘人次|旅運量|旅客人次|人次|是多少|多少|有幾人|有幾|有多少|有|查詢|請問|這張(?:圖表|圖|截圖)|圖中|圖上|的|是|哪一年|西元|總計|合計/g;
const HELP = "目前收錄 2021–2025 年臺北市臺鐵客運人次、北捷全線客運人次和臺北市高鐵進站人次。請指定一種運具與年度；也可以上傳含圖表代碼及年度數值的收錄圖表。";

export interface RailCitation {
  readonly chart_id: string;
  readonly title: string;
  readonly year: number;
  readonly value: number;
  readonly unit: "人次";
  readonly source_title: string;
  readonly source_url: string;
  readonly publisher: string;
  readonly license_label: string;
  readonly license_url: string;
  readonly dataset_version: string;
  readonly image_url: string;
}

interface RailQueryInput {
  readonly question: string;
  readonly seriesFilter: string | null;
  readonly yearFilter: number | null;
  readonly screenshot: ScreenshotEvidence | null;
}

interface RailQueryAnswer {
  readonly status: "grounded" | "refused";
  readonly answer: string;
  readonly refusal_reason: string | null;
  readonly citations: readonly RailCitation[];
}

function refuse(reason: string): RailQueryAnswer {
  return { status: "refused", answer: "", refusal_reason: `${reason}${HELP}`, citations: [] };
}

export function answerRailQuery(input: RailQueryInput): RailQueryAnswer {
  const question = input.question.normalize("NFKC");
  const selectedSeries = railSeries.filter(({ id }) => question.match(ALIASES[id]));
  const years = new Set(Array.from(question.matchAll(YEAR), ([, roc, western]) =>
    roc ? Number(roc) + 1911 : Number(western),
  ));
  if (input.yearFilter !== null) years.add(input.yearFilter);
  const remaining = Object.values(ALIASES).reduce((text, alias) => text.replace(alias, ""), question)
    .replace(YEAR, "").replace(SUPPORTED_TERMS, "").replace(/[\s？?。！!、，,：:]/g, "");
  if (remaining || selectedSeries.length > 1 || years.size > 1) {
    return refuse("這個問題超出支援的單一運具、年度人次查詢。");
  }

  const byFilter = railSeries.find(({ id }) => id === input.seriesFilter);
  const byQuestion = selectedSeries[0];
  const screenshot = input.screenshot;
  const byScreenshot = screenshot?.codes.length === 1
    ? railSeries.find(({ id }) => RAIL_CHART_CODE[id] === screenshot.codes[0])
    : undefined;
  if (screenshot && (!byScreenshot || screenshot.rows.length === 0)) {
    return refuse("無法辨識截圖中的單一圖表代碼與年度數值。");
  }
  const series = byQuestion ?? byFilter ?? byScreenshot;
  if (!series || (input.seriesFilter && !byFilter) || (byFilter && byFilter.id !== series.id)) {
    return refuse("無法確認單一運具，或運具超出可查範圍。");
  }
  if ((series.id === "metro-taipei" && /臺北市(?:車站)?|台北市(?:車站)?/.test(question)) ||
      (series.id !== "metro-taipei" && question.includes("全線")) ||
      (series.id !== "hsr-taipei" && question.includes("進站人次"))) {
    return refuse("指定的地理範圍或統計口徑與收錄資料不同。");
  }
  const requestedYear = [...years][0];
  if (requestedYear !== undefined && !series.values.some(({ year }) => year === requestedYear)) {
    return refuse("指定年度沒有收錄。");
  }

  const verifiedYears = new Set<number>();
  if (screenshot) {
    if (byScreenshot?.id !== series.id) {
      return refuse("截圖圖表與指定運具不同。");
    }
    for (const row of screenshot.rows) {
      if (!series.values.some(({ year, value }) => year === row.year && value === row.value)) {
        return refuse("截圖辨識出的年度或數值與收錄資料不符。");
      }
      verifiedYears.add(row.year);
    }
    if (requestedYear !== undefined && !verifiedYears.has(requestedYear)) {
      return refuse("截圖中沒有可核對的指定年度數值。");
    }
  } else if (requestedYear === undefined) {
    return refuse("請提供要查詢的年度。");
  }

  const facts = series.values.filter(({ year }) =>
    requestedYear === undefined ? verifiedYears.has(year) : year === requestedYear,
  );
  const citations = facts.map(({ year, value }): RailCitation => ({
    chart_id: series.chart_id,
    title: railSeriesTitle(series),
    year,
    value,
    unit: "人次",
    source_title: series.source.title,
    source_url: series.source.url,
    publisher: RAIL_PUBLISHER,
    license_label: RAIL_LICENSE.label,
    license_url: RAIL_LICENSE.url,
    dataset_version: RAIL_DATASET_VERSION,
    image_url: railChartUrl(series),
  }));
  return {
    status: "grounded",
    answer: `${railSeriesTitle(series)}，${facts.map(({ year, value }) =>
      `${year} 年 ${value.toLocaleString("en-US")} 人次`).join("、")}。`,
    refusal_reason: null,
    citations,
  };
}
