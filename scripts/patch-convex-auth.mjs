import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const root = new URL("../node_modules/@convex-dev/auth/", import.meta.url);
const version = JSON.parse(
  readFileSync(new URL("package.json", root), "utf8"),
).version;
if (version !== "0.0.95")
  throw new Error(
    "Review the Convex Auth memory-storage fix before upgrading.",
  );
const marker =
  "// Glara: keep memory storage reads current during forced token refresh.";
for (const file of ["src/react/client.tsx", "dist/react/client.js"]) {
  const url = new URL(file, root);
  const source = readFileSync(url, "utf8");
  if (source.includes(marker)) continue;
  const start = source.indexOf("function useInMemoryStorage() {");
  const end = source.indexOf("// In the browser,", start);
  if (start < 0 || end < 0)
    throw new Error("Unexpected Convex Auth source layout.");
  const original = source.slice(start, end);
  const expected = file.endsWith("tsx")
    ? "fda1ca6d093de6aeeb8a4e055e19a47f5ff40a297bd5f3741b687269d1f1a880"
    : "aec7eb6f4be9c50404d710423e9760698524dab6bde0f4822712cc9f5d12d75c";
  if (
    createHash("sha256")
      .update(original.replaceAll("\r\n", "\n"))
      .digest("hex") !== expected
  )
    throw new Error(
      "Convex Auth memory-storage source changed; review required.",
    );
  const replacement = `function useInMemoryStorage() {
  ${marker}
  const values = useRef${file.endsWith("tsx") ? "<Record<string, string>>" : ""}({});
  return () => ({
    getItem: (key${file.endsWith("tsx") ? ": string" : ""}) => values.current[key],
    setItem: (key${file.endsWith("tsx") ? ": string" : ""}, value${file.endsWith("tsx") ? ": string" : ""}) => { values.current[key] = value; },
    removeItem: (key${file.endsWith("tsx") ? ": string" : ""}) => { delete values.current[key]; },
  });
}

`;
  writeFileSync(url, source.slice(0, start) + replacement + source.slice(end));
}
console.log("Convex Auth in-memory storage fix verified.");
