import { execFileSync } from "node:child_process";
const git = (...args) =>
  execFileSync("git", args, {
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 128 * 1024 * 1024,
  });
const objects = git("rev-list", "--objects", "--all")
  .toString("utf8")
  .trim()
  .split("\n")
  .filter(Boolean);
const ids = [...new Set(objects.map((row) => row.split(" ")[0]))];
const data = execFileSync("git", ["cat-file", "--batch"], {
  input: ids.join("\n") + "\n",
  maxBuffer: 128 * 1024 * 1024,
  stdio: ["pipe", "pipe", "pipe"],
});
const patterns = [
  /sk-(?:proj-)?[A-Za-z0-9_-]{30,}/,
  /re_[A-Za-z0-9]{28,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /GOCSPX-[A-Za-z0-9_-]{20,}/,
  /AIza[A-Za-z0-9_-]{30,}/,
];
const identities = JSON.parse(process.env.GLARA_CONVEX_IDENTITIES ?? "{}");
const known = Object.values(identities)
  .map((x) => x.password)
  .filter((x) => typeof x === "string" && x.length >= 12);
let offset = 0,
  blobs = 0,
  patternMatches = 0,
  knownMatches = 0;
while (offset < data.length) {
  const end = data.indexOf(10, offset);
  if (end < 0) throw Error("Invalid history stream");
  const [, type, rawSize] = data
    .subarray(offset, end)
    .toString("utf8")
    .split(" ");
  const size = Number(rawSize);
  if (!Number.isSafeInteger(size) || size < 0 || end + size + 2 > data.length)
    throw Error("Invalid history object");
  if (type === "blob") {
    blobs++;
    const text = data.subarray(end + 1, end + 1 + size).toString("utf8");
    if (patterns.some((p) => p.test(text))) patternMatches++;
    if (known.some((value) => text.includes(value))) knownMatches++;
  }
  offset = end + 1 + size + 1;
}
const privatePaths = objects.filter(
  (row) =>
    / (?:.*\/)?(?:\.env(?:\.[^/]+)?|[^/]+\.dpapi)$/.test(row) &&
    !row.endsWith(" .env.example"),
).length;
console.log(
  JSON.stringify({
    scope:
      "All reachable local Git refs; unreachable objects and remote refs not fetched are excluded",
    objects: ids.length,
    blobs,
    credential_pattern_blobs: patternMatches,
    known_credential_blobs: knownMatches,
    private_path_objects: privatePaths,
    matched_values_logged: false,
  }),
);
if (patternMatches || knownMatches || privatePaths) process.exitCode = 1;
