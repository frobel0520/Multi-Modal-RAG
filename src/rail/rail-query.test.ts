import { describe, expect, it } from "vitest";
import { answerRailQuery } from "./rail-query";
import { parseScreenshotText } from "./screenshot-evidence";

const expected = [
  ["臺鐵", "TRA", "133177", [44135469, 50213690, 66232663, 72680645, 73992790]],
  ["北捷", "METRO", "132092", [531120335, 587257852, 710185578, 741824511, 767120668]],
  ["高鐵", "HSR", "133177", [11716163, 14524303, 19152912, 20303064, 21270153]],
] as const;
const inputs = { seriesFilter: null, yearFilter: null, screenshot: null };

describe("rail answers against checked government figures", () => {
  for (const [label, code, sourceId, values] of expected) {
    it(`answers all five ${label} annual figures with matching citations in both modes`, () => {
      values.forEach((value, offset) => {
        const year = 2021 + offset;
        const formatted = value.toLocaleString("en-US");
        const text = answerRailQuery({ ...inputs, question: `${year} 年${label}人次是多少？` });
        const screenshot = answerRailQuery({
          ...inputs,
          question: `圖中 ${year} 年的人次？`,
          screenshot: parseScreenshotText(`RAIL ${code}\n${year}  ${formatted}`),
        });
        expect(screenshot).toEqual(text);
        expect(text.status).toBe("grounded");
        expect(text.answer).toContain(`${year} 年 ${formatted} 人次`);
        expect(text.citations).toEqual([expect.objectContaining({
          year,
          value,
          unit: "人次",
          publisher: "臺北市政府主計處",
          source_url: `https://data.gov.tw/dataset/${sourceId}`,
          dataset_version: "2026-11-24",
          license_url: "https://data.gov.tw/license",
        })]);
      });
    });
  }

  it("accepts a Republic of China year and the corresponding western-year filter", () => {
    const result = answerRailQuery({ ...inputs, question: "民國１１４年台鐵人次？", yearFilter: 2025 });
    expect(result.citations[0]?.value).toBe(73992790);
  });

  it.each([
    "2025 年全國高鐵運量", "2025 年桃園捷運人次", "2025 年臺北市北捷人次",
    "2025 年臺鐵進站人次", "2025 年高鐵出站人次", "2025 年高鐵全線客運量",
    "2026 年北捷運量", "2020 年臺鐵運量", "2025 年 8 月北捷人次",
    "2025 年高鐵臺北站人次", "2025 年臺鐵與高鐵合計", "2024–2025 年北捷人次",
    "北捷人次", "2025 年公路運量", "2025 年北捷營收",
  ])("refuses unsupported text with no citation: %s", (question) => {
    const result = answerRailQuery({ ...inputs, question });
    expect(result).toMatchObject({ status: "refused", answer: "", citations: [] });
    expect(result.refusal_reason).toContain("2021–2025");
  });

  it.each([
    ["missing heading", "2025  767,120,668", "2025 年北捷人次"],
    ["changed value", "RAIL METRO\n2025  767,120,669", "2025 年北捷人次"],
    ["wrong chart", "RAIL METRO\n2025  767,120,668", "2025 年高鐵人次"],
    ["missing year", "RAIL METRO\n2025  767,120,668", "2024 年北捷人次"],
    ["mixed charts", "RAIL HSR\nRAIL METRO\n2025  767,120,668", ""],
    ["mixed values", "RAIL METRO\n2025  767,120,668\n2024  1", ""],
  ])("refuses screenshots with %s", (_scenario, ocr, question) => {
    const result = answerRailQuery({ ...inputs, question, screenshot: parseScreenshotText(ocr) });
    expect(result).toMatchObject({ status: "refused", answer: "", citations: [] });
  });

  it("returns all verified years for image-only queries and ignores unrelated OCR text", () => {
    const result = answerRailQuery({
      ...inputs, question: "",
      screenshot: parseScreenshotText("RAIL HSR\nother text\n2021  11,716,163\n2025  21,270,153"),
    });
    expect(result.status).toBe("grounded");
    expect(result.citations.map(({ year, value }) => [year, value])).toEqual([
      [2021, 11716163], [2025, 21270153],
    ]);
  });
});
