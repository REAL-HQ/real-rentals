import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  rejectInlineSuppression,
  approvedFixture,
  protectConfiguration,
  validateResult,
  compareDiagnostics,
} from "./lint-correspondence.mjs";
const base = process.argv[2];
assert.match(base ?? "", /^[0-9a-f]{40}$/);
const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
const paths = git("diff", "--name-only", "-z", base, "HEAD").split("\0").filter(Boolean);
protectConfiguration(paths);
// Test-only tooling is approved at these exact reviewed bytes; no silent tool drift.
const { createHash } = await import("node:crypto");
for (const [file, hash] of Object.entries({
  "scripts/ci/tooling/package.json":
    "25a917e29dcc3d20ec8aff082da7f983422d436d991b7427f9a3513f8d6bef66",
  "scripts/ci/tooling/package-lock.json":
    "0fb14581c888d6b4525d2f95c50fc1d84620d1912ce9b6b6cd78c084b1b76966",
}))
  assert.equal(
    createHash("sha256").update(readFileSync(file)).digest("hex"),
    hash,
    "ci_toolchain_changed",
  );
const files = git("diff", "--name-only", "--diff-filter=ACMR", "-z", base, "HEAD")
  .split("\0")
  .filter((f) => /\.(ts|tsx|mjs|js|mts|cts|cjs)$/.test(f));
function lint(file, source) {
  const r = spawnSync(
    "node",
    [
      "node_modules/eslint/bin/eslint.js",
      "--no-inline-config",
      "--stdin",
      "--stdin-filename",
      file,
      "-f",
      "json",
    ],
    { input: source, encoding: "utf8" },
  );
  assert.ok(r.status === 0 || r.status === 1, "lint_tool_execution_failed");
  return validateResult(JSON.parse(r.stdout), r.status);
}
let retained = 0;
for (const file of files) {
  const current = readFileSync(file, "utf8");
  rejectInlineSuppression(current);
  const exists = spawnSync("git", ["cat-file", "-e", `${base}:${file}`]);
  assert.ok(exists.status === 0 || exists.status === 128, "baseline_lookup_failed");
  const previous = exists.status === 0 ? git("show", `${base}:${file}`) : "";
  const messages = lint(file, current);
  if (!previous) {
    assert.equal(messages.length, 0, "new_file_diagnostics");
    continue;
  }
  if (approvedFixture(file, previous, current, messages)) {
    retained += messages.length;
    continue;
  }
  retained += compareDiagnostics(
    previous,
    current,
    lint(file, previous),
    messages,
    git("diff", "--no-ext-diff", "--no-renames", "--unified=0", base, "HEAD", "--", file),
  );
}
console.log(
  `No new diagnostics across ${files.length} changed files; ${retained} baseline diagnostics retained`,
);
