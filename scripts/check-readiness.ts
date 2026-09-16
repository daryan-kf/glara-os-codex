import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  evaluateReadiness,
  validateCoverage,
  controlsSchema,
  type Evidence,
} from "../src/lib/readiness/model";
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const git = (...args: string[]) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const head = git("rev-parse", "HEAD");
const controls = read("docs/M10A-readiness-controls.json"),
  evidence = read("docs/M10A-evidence-register.json");
const calendar = read("docs/deferred-integrations.json").integrations.find(
  (x: { id: string }) => x.id === "m9-google-calendar",
);
const validCommit = (e: Evidence) => {
  try {
    git("cat-file", "-e", e.source_commit + "^{commit}");
    git("merge-base", "--is-ancestor", e.source_commit, head);
    return true;
  } catch {
    return false;
  }
};
const result = evaluateReadiness(controls, evidence, {
  now: Date.now(),
  sourceCommit: head,
  calendar,
  referenceExists: (e) =>
    validCommit(e) &&
    (e.artifact_reference.startsWith("restricted-evidence:")
      ? false
      : existsSync(resolve(e.artifact_reference))),
  sourceIsCurrent: (e) =>
    validCommit(e) && !git("diff", e.source_commit, "--", ...e.source_paths),
});
const parsedControls = controlsSchema.safeParse(controls);
const coverageErrors = parsedControls.success
  ? validateCoverage(
      read("docs/M10A-control-map.json"),
      parsedControls.data.controls,
    )
  : ["INVALID_CONTROL_REGISTER"];
if (coverageErrors.length) {
  result.errors.push(...coverageErrors);
  result.valid = false;
  result.m10a_pass = false;
  result.m10b_entry = false;
}
// Explicitly surfaced, never assumed: inaccessible private evidence needs independent attestation.
if (process.argv.includes("--write"))
  writeFileSync(
    "docs/M10A-readiness-summary.json",
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        evaluated_source_commit: head,
        ...result,
      },
      null,
      2,
    ) + "\n",
  );
console.log(JSON.stringify(result));
if (
  !result.valid ||
  (process.argv.includes("--require-pass") && !result.m10a_pass)
)
  process.exitCode = 1;
