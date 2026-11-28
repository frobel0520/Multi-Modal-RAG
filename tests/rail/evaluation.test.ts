import { describe, expect, it } from "vitest";
import { signPayload, SESSION_COOKIE } from "../../src/auth/session-cookie";
import { parseScreenshotText } from "../../src/rail/screenshot-evidence";
import type { RailCitation } from "../../src/rail/rail-query";
import { handleRequest, type Env } from "../../src/worker/index";

const origin = "https://rail-evaluation.example.com";
const owner = "owner@example.com";
const sessionSecret = "synthetic-session-fixture-only-20261128";
const now = 1795824000;
const edition = "2026-11-24";
// Independent golden values from the reviewed 15-row government snapshot.
const references = {
  tra: { chart: "tra-taipei", dataset: 133177 },
  metro: { chart: "metro-taipei", dataset: 132092 },
  hsr: { chart: "hsr-taipei", dataset: 133177 },
} as const;

type Fact = readonly [series: keyof typeof references, year: number, value: number];
interface EvaluationCase {
  id: string;
  question: string;
  ocr?: string;
  expected: readonly Fact[];
}
const corpus: EvaluationCase[] = [
  { id: "tra-roc", question: "民國１１０年台灣鐵路客運人次？", expected: [["tra", 2021, 44135469]] },
  { id: "tra-recent", question: "請問 2025 年臺鐵有多少人次？", expected: [["tra", 2025, 73992790]] },
  { id: "metro-roc", question: "民國111年臺北捷運全線有多少人次？", expected: [["metro", 2022, 587257852]] },
  { id: "metro-recent", question: "2025 年北捷全線運量是多少？", expected: [["metro", 2025, 767120668]] },
  { id: "hsr-scope", question: "2023 年臺北市高鐵進站人次？", expected: [["hsr", 2023, 19152912]] },
  { id: "hsr-recent", question: "2025 年台北市車站高速鐵路進站人次？", expected: [["hsr", 2025, 21270153]] },
  { id: "ocr-tra", question: "圖中 2022 年客運人次？", ocr: "RAIL TRA\n2022  50,213,690", expected: [["tra", 2022, 50213690]] },
  { id: "ocr-metro", question: "圖中 2024 年人次？", ocr: "RAIL METRO\n2024  741,824,511", expected: [["metro", 2024, 741824511]] },
  { id: "ocr-hsr", question: "", ocr: "RAIL HSR\n2021  11,716,163\n2023  19,152,912", expected: [["hsr", 2021, 11716163], ["hsr", 2023, 19152912]] },
  { id: "ocr-normalization", question: "", ocr: "ＲＡＩＬ ＭＥＴＲＯ\n２０２１  ５３１，１２０，３３５", expected: [["metro", 2021, 531120335]] },
  { id: "national", question: "2025 年全國臺鐵客運人次？", expected: [] },
  { id: "wrong-series-scope", question: "2024 年臺北市北捷客運人次？", expected: [] },
  { id: "wrong-metric", question: "2023 年高鐵出站人次？", expected: [] },
  { id: "wrong-year", question: "2026 年北捷全線運量？", expected: [] },
  { id: "two-years", question: "2021 年與 2025 年臺鐵運量？", expected: [] },
  { id: "two-series", question: "2022 年臺鐵和北捷總計？", expected: [] },
  { id: "missing-year", question: "台鐵有多少人次？", expected: [] },
  { id: "ocr-wrong-value", question: "2025 年高鐵進站人次？", ocr: "RAIL HSR\n2025  21,270,154", expected: [] },
  { id: "ocr-wrong-chart", question: "2024 年臺鐵人次？", ocr: "RAIL METRO\n2024  741,824,511", expected: [] },
  { id: "ocr-two-charts", question: "圖中 2021 年人次？", ocr: "RAIL TRA\nRAIL HSR\n2021  44,135,469", expected: [] },
  { id: "ocr-missing-row", question: "圖中 2022 年人次？", ocr: "RAIL METRO\n2023  710,185,578", expected: [] },
  { id: "ocr-missing-code", question: "2025 年北捷人次？", ocr: "2025  767,120,668", expected: [] },
];

function makeEnv(): Env {
  const store = new Map<string, string>();
  return {
    APP_VERSION: "fixture",
    DATASET_VERSION: edition,
    OWNER_EMAIL_ALLOWLIST: owner,
    SESSION_SECRET: sessionSecret,
    RATE_LIMIT_KV: {
      async get(key) { return store.get(key) ?? null; },
      async put(key, value) { store.set(key, value); },
    },
  };
}

interface EvaluationResponse {
  status: "grounded" | "refused";
  answer: string;
  refusal_reason: string | null;
  citations: RailCitation[];
}

describe("CR-001 offline rail evaluation", () => {
  it("scores the signed HTTP query and verifies each cited chart", async () => {
    const token = await signPayload({ sub: owner, iat: now, exp: now + 60 }, sessionSecret);
    const headers = { cookie: `${SESSION_COOKIE}=${token}`, origin };
    const env = makeEnv();
    const deps = { nowSeconds: () => now };
    const score = {
      text: { passed: 0, total: 0 },
      screenshotFixture: { passed: 0, total: 0 },
      citations: { passed: 0, total: 0 },
      refusal: { passed: 0, total: 0 },
    };
    const charts = new Map<string, string>();
    const failures: string[] = [];
    for (const test of corpus) {
      const response = await handleRequest(new Request(origin + "/api/query", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          question: test.question,
          ...(test.ocr === undefined ? {} : { screenshot_evidence: parseScreenshotText(test.ocr) }),
        }),
      }), env, deps);
      expect(response.status, test.id).toBe(200);
      const reply = await response.json() as EvaluationResponse;
      if (!test.expected.length) {
        score.refusal.total++;
        if (reply.status === "refused" && reply.answer === "" && reply.refusal_reason && reply.citations.length === 0) {
          score.refusal.passed++;
        } else failures.push(`${test.id}: refusal`);
        continue;
      }

      const track = test.ocr === undefined ? score.text : score.screenshotFixture;
      track.total++;
      const numericMatch = reply.status === "grounded"
        && reply.refusal_reason === null
        && reply.citations.length === test.expected.length
        && test.expected.every(([, year, value], i) =>
          reply.citations[i]?.year === year && reply.citations[i]?.value === value
          && reply.answer.includes(`${year} 年 ${value.toLocaleString("en-US")} 人次`),
        );
      if (numericMatch) track.passed++;
      else failures.push(`${test.id}: numeric result`);

      for (const [position, [series, year, value]] of test.expected.entries()) {
        const expected = references[series];
        const chartId = `${expected.chart}-${edition}`;
        const path = `/api/rail/charts/${chartId}.svg`;
        const citation = reply.citations[position];
        if (!charts.has(path)) {
          const chart = await handleRequest(new Request(origin + path, { headers }), env, deps);
          expect(chart.status, path).toBe(200);
          expect(chart.headers.get("content-type")).toContain("image/svg+xml");
          charts.set(path, await chart.text());
        }
        score.citations.total++;
        if (citation?.chart_id === chartId && citation.image_url === path && citation.year === year
          && citation.value === value && citation.unit === "人次"
          && citation.source_url === `https://data.gov.tw/dataset/${expected.dataset}`
          && citation.publisher === "臺北市政府主計處" && citation.dataset_version === edition
          && citation.license_url === "https://data.gov.tw/license"
          && charts.get(path)?.includes(`${year}  ${value.toLocaleString("en-US")}`)) {
          score.citations.passed++;
        } else failures.push(`${test.id}: citation ${position + 1}`);
      }
      if (reply.citations.length > test.expected.length) failures.push(`${test.id}: unexpected citations`);
    }
    console.log(JSON.stringify({ evaluation: "rail-2026-11-28", dataset: edition, ...score }));
    expect(failures).toEqual([]);
    expect(Object.values(score).every(({ passed, total }) => total > 0 && passed === total)).toBe(true);
  });
});
