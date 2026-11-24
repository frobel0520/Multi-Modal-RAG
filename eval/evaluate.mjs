import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const thresholds = { recall_at_5: 0.85, legal_citation_rate: 1, correct_refusal_rate: 0.9 };
const kinds = new Set(["single_page_chart", "cross_company", "screenshot", "refusal"]);
const statuses = new Set(["grounded", "refused", "degraded_retrieval_only"]);

function pageKey(reference) {
  if (!reference || typeof reference.report_id !== "string" || !reference.report_id ||
      !Number.isInteger(reference.page_number) || reference.page_number < 1) {
    throw new Error("Invalid evidence page");
  }
  return JSON.stringify([reference.report_id, reference.page_number]);
}

function pagesInManifest(manifest) {
  const pages = new Set();
  for (const report of manifest.reports) {
    if (!Number.isInteger(report.page_count) || !Array.isArray(report.page_ranges)) {
      throw new Error("Invalid report page ranges");
    }
    for (const { first_page, last_page } of report.page_ranges) {
      if (!Number.isInteger(first_page) || !Number.isInteger(last_page) ||
          first_page < 1 || last_page < first_page || last_page > report.page_count) {
        throw new Error("Page range is outside the report");
      }
      for (let page_number = first_page; page_number <= last_page; page_number++) {
        const key = pageKey({ report_id: report.id, page_number });
        if (pages.has(key)) throw new Error("Duplicate source page in manifest");
        pages.add(key);
      }
    }
  }
  return pages;
}

function metric(value, samples, target) {
  const rate = samples === 0 ? null : value / samples;
  return { value: rate, samples, target, status: rate === null ? "not_scored" : (rate >= target ? "passed" : "failed") };
}

/** Score recorded query traces without making model or database calls. */
export function evaluate(manifest, questionSet, observations) {
  const version = manifest.dataset_version;
  const mode = questionSet.mode;
  if (typeof version !== "string" || !version || questionSet.dataset_version !== version ||
      observations.dataset_version !== version || observations.mode !== mode ||
      (mode !== "fixture" && mode !== "real")) {
    throw new Error("Dataset version or evaluation mode does not match");
  }
  if (!Array.isArray(manifest.reports) || !Array.isArray(questionSet.questions) ||
      !Array.isArray(observations.results)) {
    throw new Error("Expected report, question and result arrays");
  }
  if (mode === "real" && (manifest.pending_sources?.length ||
      typeof observations.index_evidence !== "string" || !observations.index_evidence.trim() ||
      questionSet.questions.length < 30 || questionSet.questions.length > 40)) {
    throw new Error("Real evaluation requires a complete source manifest, index evidence and 30–40 questions");
  }
  const indexed = pagesInManifest(manifest);
  const resultById = new Map(observations.results.map((result) => [result.id, result]));
  if (resultById.size !== observations.results.length ||
      resultById.size !== questionSet.questions.length) {
    throw new Error("Expected exactly one result per question");
  }

  const coveredKinds = new Set();
  const failures = [];
  let answerable = 0;
  let recallTotal = 0;
  let references = 0;
  let legalReferences = 0;
  let refusalCases = 0;
  let correctRefusals = 0;

  for (const question of questionSet.questions) {
    const { id, kind, expected_pages: expectedPages } = question;
    const result = resultById.get(id);
    if (typeof id !== "string" || !id || !result || !kinds.has(kind) ||
        typeof question.question !== "string" || !question.question.trim() ||
        typeof question.answer_basis !== "string" || !question.answer_basis.trim() ||
        !Array.isArray(expectedPages) || !statuses.has(result.status) ||
        !Array.isArray(result.retrieved) || !Array.isArray(result.citation_candidates) ||
        !Array.isArray(result.citations)) {
      throw new Error("Question or observation is incomplete");
    }
    resultById.delete(id);
    coveredKinds.add(kind);

    const expected = new Set(expectedPages.map(pageKey));
    const candidates = new Set();
    for (const reference of result.retrieved) {
      const key = pageKey(reference);
      if (!indexed.has(key) || candidates.has(key)) {
        throw new Error("Retrieved pages must be unique and present in the selected corpus");
      }
      candidates.add(key);
    }
    const topFive = new Set([...candidates].slice(0, 5));
    const citationCandidates = new Set(result.citation_candidates.map(pageKey));
    if (citationCandidates.size !== result.citation_candidates.length ||
        [...citationCandidates].some((key) => !candidates.has(key))) {
      throw new Error("Citation candidates must be unique retrieved pages");
    }
    if ([...expected].some((key) => !indexed.has(key)) || expected.size !== expectedPages.length ||
        (kind === "refusal" ? expected.size !== 0 : expected.size === 0)) {
      throw new Error("Expected evidence must use unique selected corpus pages");
    }
    if (kind === "cross_company" && new Set(expectedPages.map((page) => page.report_id)).size < 2) {
      throw new Error("Cross-company question needs evidence from multiple reports");
    }

    if (kind === "refusal") {
      refusalCases++;
      if (result.status === "refused" && result.citations.length === 0) correctRefusals++;
      else failures.push({ id, metric: "correct_refusal_rate" });
    } else {
      answerable++;
      const hits = [...expected].filter((key) => topFive.has(key)).length;
      recallTotal += hits / expected.size;
      if (hits < expected.size) failures.push({ id, metric: "recall_at_5" });
    }

    for (const citation of result.citations) {
      references++;
      const key = pageKey(citation);
      if (citationCandidates.has(key)) legalReferences++;
      else failures.push({ id, metric: "legal_citation_rate", citation });
    }
  }
  if (mode === "real" && coveredKinds.size !== kinds.size) {
    throw new Error("Real questions must cover all four required kinds");
  }

  const metrics = {
    recall_at_5: metric(recallTotal, answerable, thresholds.recall_at_5),
    legal_citation_rate: metric(legalReferences, references, thresholds.legal_citation_rate),
    correct_refusal_rate: metric(correctRefusals, refusalCases, thresholds.correct_refusal_rate),
  };
  return {
    mode, dataset_version: version, question_count: questionSet.questions.length,
    metrics, failures,
    human_answer_review: "not_scored",
    machine_gate: mode === "real" && Object.values(metrics).every((item) => item.status === "passed")
      ? "passed" : (mode === "fixture" ? "not_scored" : "not_passed"),
  };
}

async function runCli(paths) {
  if (paths.length !== 3) throw new Error("Usage: node eval/evaluate.mjs <sources.json> <questions.json> <results.json>");
  const [manifest, questionSet, observations] = await Promise.all(paths.map(async (path) =>
    JSON.parse(await readFile(path, "utf8"))
  ));
  const result = evaluate(manifest, questionSet, observations);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result.mode === "real" && result.machine_gate !== "passed") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli(process.argv.slice(2));
}
