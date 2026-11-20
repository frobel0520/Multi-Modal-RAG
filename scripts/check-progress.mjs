import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MAX_LINES = 100;
const progressPath = resolve(process.cwd(), "progress.md");
const content = readFileSync(progressPath, "utf8");
const lineCount = content.split(/\r?\n/).length;

if (lineCount > MAX_LINES) {
  console.error(`ERROR: progress.md has ${lineCount} lines (limit: ${MAX_LINES}).`);
  process.exit(1);
}

console.log(`OK: progress.md has ${lineCount} lines (limit: ${MAX_LINES}).`);
