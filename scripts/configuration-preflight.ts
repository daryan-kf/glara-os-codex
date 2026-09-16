import { readFileSync } from "node:fs";
import { evaluateConfiguration } from "../src/lib/security/preflight";
// Offline only. Input is a non-secret plan, never an environment file.
let result: ReturnType<typeof evaluateConfiguration>;
try {
  result = evaluateConfiguration(
    JSON.parse(readFileSync(process.argv[2], "utf8")),
  );
} catch {
  result = { valid: false, issues: ["PLAN_UNREADABLE"], features: [] };
}
console.log(JSON.stringify(result));
if (!result.valid) process.exitCode = 1;
