import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
// Scan release candidates, not ignored private operator artifacts. Never print matched values.
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const patterns = [
  /sk-(?:proj-)?[A-Za-z0-9_-]{30,}/,
  /re_[A-Za-z0-9]{28,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /GOCSPX-[A-Za-z0-9_-]{20,}/,
  /AIza[A-Za-z0-9_-]{30,}/,
];
const sensitiveFiles = files.filter(
  (f) =>
    (/(^|\/)\.env(?:\.|$)/.test(f) && f !== ".env.example") ||
    /\.dpapi$|(^|\/)(?:\.acceptance|\.incidents|\.backups)\//.test(f),
);
const patternFiles = files.filter((f) =>
  patterns.some((p) => p.test(readFileSync(f, "utf8"))),
);
const result = {
  scanned_files: files.length,
  private_environment_files: sensitiveFiles,
  credential_pattern_files: patternFiles,
  scope:
    "All tracked/non-ignored release candidates including docs, fixtures and generated published evidence; no matched values logged",
};
console.log(JSON.stringify(result));
if (sensitiveFiles.length || patternFiles.length) process.exitCode = 1;
