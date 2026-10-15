import assert from "node:assert/strict";
import {
  rejectInlineSuppression,
  approvedFixture,
  compareDiagnostics,
  protectConfiguration,
  validateResult,
} from "./lint-correspondence.mjs";
let count = 0;
const pass = (name, fn) => {
  fn();
  console.log("PASS", name);
  count++;
};
const deny = (name, fn, reason) => pass(name, () => assert.throws(fn, reason));
const source = "function original(\n  input: any,\n) { return input; }\n";
const m = {
  line: 2,
  endLine: 2,
  column: 10,
  endColumn: 13,
  ruleId: "@typescript-eslint/no-explicit-any",
  severity: 2,
  message: "Unexpected any.",
};
pass("unchanged occurrence retained", () =>
  assert.equal(compareDiagnostics(source, source, [m], [m], ""), 1),
);
pass("insertion before unchanged occurrence maps correctly", () =>
  assert.equal(
    compareDiagnostics(
      source,
      "const value = 1;\n" + source,
      [m],
      [{ ...m, line: 3, endLine: 3 }],
      "@@ -0,0 +1 @@",
    ),
    1,
  ),
);
deny(
  "same diagnostic moved to another function",
  () => compareDiagnostics(source, source.replace("original", "another"), [m], [m], "@@ -1 +1 @@"),
  /changed_or_ambiguous_code_occurrence/,
);
deny(
  "removed diagnostic reintroduced elsewhere",
  () => compareDiagnostics(source, source, [m], [{ ...m, line: 3, endLine: 3 }], "@@ -2 +2,2 @@"),
  /changed_diagnostic_region/,
);
const duplicate = source + source;
deny(
  "identical source at different locations",
  () => compareDiagnostics(duplicate, duplicate, [m], [m], ""),
  /changed_or_ambiguous_code_occurrence/,
);
deny(
  "multiline edit changes containing function",
  () =>
    compareDiagnostics(source, source.replace("return input", "return 0"), [m], [m], "@@ -3 +3 @@"),
  /changed_or_ambiguous_code_occurrence/,
);
deny(
  "overlapping diff hunks",
  () => compareDiagnostics(source, source, [m], [m], "@@ -1,2 +1,2 @@\n@@ -2 +2 @@"),
  /overlapping_diff_regions/,
);
deny(
  "lower total cannot hide new occurrence",
  () =>
    compareDiagnostics(
      source,
      source.replace("original", "replacement"),
      [m, { ...m, line: 3 }],
      [m],
      "@@ -1 +1 @@",
    ),
  /changed_or_ambiguous_code_occurrence/,
);
for (const file of [
  "eslint.config.js",
  ".eslintrc.json",
  ".eslintignore",
  "nested/eslint.config.mjs",
  "package.json",
  "bun.lock",
  "tsconfig.json",
  ".prettierrc",
])
  deny(
    "protect " + file,
    () => protectConfiguration([file]),
    /lint_configuration_or_toolchain_changed/,
  );
pass("ordinary source edit allowed for subsequent lint", () =>
  protectConfiguration(["src/lib/maintenance-rules.ts"]),
);
deny(
  "ignored or unconfigured file",
  () =>
    validateResult(
      [{ fatalErrorCount: 0, messages: [{ ruleId: null, severity: 1, message: "File ignored" }] }],
      0,
    ),
  /lint_file_ignored_or_unconfigured/,
);
deny(
  "inline rule suppression warning",
  () =>
    validateResult(
      [
        {
          fatalErrorCount: 0,
          messages: [
            {
              ruleId: null,
              severity: 1,
              message: "eslint-disable has no effect with noInlineConfig",
            },
          ],
        },
      ],
      0,
    ),
  /lint_file_ignored_or_unconfigured/,
);
deny(
  "suppressed diagnostic list",
  () => validateResult([{ fatalErrorCount: 0, messages: [], suppressedMessages: [m] }], 0),
  /lint_suppression_detected/,
);
deny("missing file result", () => validateResult([], 0), /lint_result_missing/);
deny("tool failure", () => validateResult([], 2), /lint_tool_execution_failed/);
deny(
  "parser failure",
  () => validateResult([{ fatalErrorCount: 1, messages: [] }], 1),
  /lint_parser_error/,
);
deny(
  "UUID edit has no normalization exception",
  () =>
    compareDiagnostics(
      source,
      source.replace("return input", 'return "00000000-0000-0000-0000-000000000001"'),
      [m],
      [m],
      "@@ -3 +3 @@",
    ),
  /changed_or_ambiguous_code_occurrence/,
);
for (const [name, file, before, after, messages] of [
  ["fixture exception rejects other file", "src/other.ts", source, source, [m]],
  [
    "fixture exception rejects extra UUID edits",
    "scripts/maintenance-rules.test.ts",
    source,
    source + "// extra UUID",
    [m],
  ],
  [
    "fixture exception rejects new diagnostic",
    "scripts/maintenance-rules.test.ts",
    source,
    source,
    [m, m],
  ],
])
  pass(name, () => assert.equal(approvedFixture(file, before, after, messages), false));
deny(
  "actual suppression comment",
  () => rejectInlineSuppression("/* eslint-disable */\nconst x = 1;"),
  /inline_lint_configuration_forbidden/,
);
pass("suppression string is not a directive", () =>
  rejectInlineSuppression('const text = "eslint-disable";'),
);
console.log(`${count} lint correspondence controls passed`);
