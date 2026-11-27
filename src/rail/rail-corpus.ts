import snapshot from "../../data/rail/passengers.json";
import { RAIL_CHART_CODE, type RailSeriesId } from "./screenshot-evidence";

export const RAIL_DATASET_VERSION = snapshot.edition;
export const RAIL_PUBLISHER = snapshot.publisher;
export const RAIL_LICENSE = snapshot.license;

export interface RailSeries {
  readonly id: RailSeriesId;
  readonly label: string;
  readonly scope: string;
  readonly metric: string;
  readonly chart_id: string;
  readonly source: { readonly url: string; readonly title: string };
  readonly values: readonly { readonly year: number; readonly value: number }[];
}

export function isRailSeriesId(id: string): id is RailSeriesId {
  return Object.hasOwn(RAIL_CHART_CODE, id);
}

export const railSeries: readonly RailSeries[] = snapshot.series.map((series) => {
  if (!isRailSeriesId(series.id)) throw new Error(`Unexpected rail series: ${series.id}`);
  return { ...series, id: series.id };
});

export function railChartUrl(series: RailSeries): string {
  return `/api/rail/charts/${series.chart_id}.svg`;
}

export function railSeriesTitle(series: RailSeries): string {
  return `${series.label}｜${series.scope}${series.metric}`;
}

function escapeXml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function renderRailChart(series: RailSeries): string {
  const max = Math.max(...series.values.map(({ value }) => value), 1);
  const rows = series.values.map(({ year, value }, index) => {
    const y = 125 + index * 52;
    return `
      <text x="40" y="${y}" font-size="26" font-family="monospace" xml:space="preserve">${year}  ${value.toLocaleString("en-US")}</text>
      <rect x="315" y="${y - 21}" width="${220 * value / max}" height="25" rx="4" fill="#157568"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="432" viewBox="0 0 640 432" role="img">
    <title>${escapeXml(railSeriesTitle(series))}</title>
    <rect width="640" height="432" fill="#fff"/>
    <g font-family="system-ui,sans-serif" fill="#142525">
      <text x="40" y="38" font-size="24">${escapeXml(railSeriesTitle(series))}</text>
      <text x="40" y="80" font-size="27" font-weight="700">RAIL ${RAIL_CHART_CODE[series.id]}</text>
      ${rows}
      <text x="40" y="379" font-size="15">${escapeXml(RAIL_PUBLISHER)}　${escapeXml(series.source.title)}</text>
      <text x="40" y="406" font-size="15">${escapeXml(RAIL_LICENSE.label)}　${RAIL_DATASET_VERSION}</text>
    </g>
  </svg>`;
}
