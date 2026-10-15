import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
const base = process.argv[2];
assert.match(base ?? "", /^[0-9a-f]{40}$/);
const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
const files = git("diff", "--name-only", "--diff-filter=ACMR", base, "HEAD")
  .trim()
  .split("\n")
  .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f));
function lint(file, source) {
  const r = spawnSync(
    "node",
    ["node_modules/eslint/bin/eslint.js", "--stdin", "--stdin-filename", file, "-f", "json"],
    { input: source, encoding: "utf8" },
  );
  assert.ok(r.status === 0 || r.status === 1, `ESLint tooling failure: ${r.stderr}`);
  const [result] = JSON.parse(r.stdout);
  assert.ok(result);
  assert.equal(result.fatalErrorCount, 0);
  return result.messages.filter((m) => m.severity > 0);
}
// Match diagnostics by rule and the full affected source line, not aggregate counts.
// The sole normalization is the reviewed addition of stable UUID fixture properties.
const normalize = (s) =>
  s.replace(/\bid:\s*"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}",?\s*/gi, "").trim();
function keys(source, messages) {
  const lines = source.split("\n");
  return messages.map((m) => `${m.ruleId}|${normalize(lines[m.line - 1] ?? "")}|${m.severity}`);
}
let retained = 0;
for (const file of files) {
  const current = readFileSync(file, "utf8");
  let previous = "";
  try {
    previous = git("show", `${base}:${file}`);
  } catch {
    /* New file: no baseline allowance. */
  }
  const allowance = new Map();
  for (const key of previous ? keys(previous, lint(file, previous)) : [])
    allowance.set(key, (allowance.get(key) ?? 0) + 1);
  for (const key of keys(current, lint(file, current))) {
    assert.ok((allowance.get(key) ?? 0) > 0, `New lint diagnostic in ${file}: ${key}`);
    allowance.set(key, allowance.get(key) - 1);
    retained++;
  }
}
console.log(
  `No new diagnostics across ${files.length} changed files; ${retained} baseline diagnostics retained`,
);
