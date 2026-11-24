import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluate } from "./evaluate.mjs";

function example(name) {
  return JSON.parse(readFileSync(new URL("./fixtures/" + name + ".json", import.meta.url), "utf8"));
}

test("CLI computes macro recall, candidate citation legality and strict refusal", () => {
  const output = execFileSync(process.execPath, [
    "eval/evaluate.mjs", "eval/fixtures/sources.json", "eval/fixtures/questions.json", "eval/fixtures/results.json",
  ], { encoding: "utf8" });
  const result = JSON.parse(output);
  assert.equal(result.mode, "fixture");
  assert.equal(result.machine_gate, "not_scored");
  assert.deepEqual(result.metrics, {
    recall_at_5: { value: 2.5 / 3, samples: 3, target: 0.85, status: "failed" },
    legal_citation_rate: { value: 0.75, samples: 4, target: 1, status: "failed" },
    correct_refusal_rate: { value: 1, samples: 1, target: 0.9, status: "passed" },
  });
  assert.deepEqual(result.failures.map(({ id, metric }) => [id, metric]), [
    ["Q2", "recall_at_5"], ["Q3", "legal_citation_rate"],
  ]);
});

test("rejects false real labeling, missing traces and mixed versions", () => {
  const sources = example("sources");
  const questions = example("questions");
  const results = example("results");
  assert.throws(() => evaluate(sources, { ...questions, mode: "real" }, { ...results, mode: "real" }),
    /requires a complete source manifest/);
  assert.throws(() => evaluate(sources, questions, { ...results, dataset_version: "different" }),
    /version or evaluation mode/);
  assert.throws(() => evaluate(sources, questions, { ...results, results: results.results.slice(1) }),
    /one result per question/);
});

test("zero citation samples are unscored, and quota degradation is not a refusal", () => {
  const sources = example("sources");
  const questions = example("questions");
  const results = example("results");
  const outcome = evaluate(sources, {...questions, questions: questions.questions.slice(-1)}, {
    ...results, results: [{ ...results.results.at(-1), status: "degraded_retrieval_only" }],
  });
  assert.equal(outcome.metrics.legal_citation_rate.status, "not_scored");
  assert.equal(outcome.metrics.recall_at_5.status, "not_scored");
  assert.equal(outcome.metrics.correct_refusal_rate.value, 0);
});
