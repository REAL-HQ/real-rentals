import assert from "node:assert/strict";
import ts from "typescript";
import { createHash } from "node:crypto";
export function protectConfiguration(paths) {
  const protectedPath = (p) =>
    /(^|\/)(eslint\.config\.[^/]+|\.eslintrc[^/]*|\.eslintignore|\.prettier[^/]*|prettier\.config\.[^/]+|tsconfig[^/]*\.json|\.npmrc|\.yarnrc[^/]*|bunfig\.toml)$/.test(
      p,
    ) || /^(package\.json|package-lock\.json|bun\.lockb?|yarn\.lock|pnpm-lock\.yaml)$/.test(p);
  assert.ok(!paths.some(protectedPath), "lint_configuration_or_toolchain_changed");
}
export function validateResult(result, status) {
  assert.ok(status === 0 || status === 1, "lint_tool_execution_failed");
  assert.ok(Array.isArray(result) && result.length === 1, "lint_result_missing");
  const r = result[0];
  assert.equal(r.fatalErrorCount, 0, "lint_parser_error");
  assert.ok(!r.suppressedMessages?.length, "lint_suppression_detected");
  assert.ok(
    r.messages.every((m) => typeof m.ruleId === "string"),
    "lint_file_ignored_or_unconfigured",
  );
  return r.messages.filter((m) => m.severity > 0);
}
function units(source) {
  const sf = ts.createSourceFile(
    "input.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  assert.equal(sf.parseDiagnostics.length, 0, "source_parse_error");
  return sf.statements.map((s) => ({
    start: s.getStart(sf),
    end: s.end,
    text: s.getText(sf),
    name: s.name?.getText(sf),
  }));
}
function offset(source, line, column) {
  const lines = source.split("\n");
  assert.ok(line >= 1 && line <= lines.length, "invalid_diagnostic_location");
  return lines.slice(0, line - 1).reduce((n, s) => n + s.length + 1, 0) + column - 1;
}
export function compareDiagnostics(before, after, oldMessages, newMessages, diff) {
  const oldUnits = units(before),
    newUnits = units(after);
  // Reordered named declarations are ambiguous movement, not grandfathered occurrences.
  const oldNames = oldUnits.map((u) => u.name).filter(Boolean),
    newNames = newUnits.map((u) => u.name).filter(Boolean);
  assert.deepEqual(
    oldNames.filter((n) => newNames.includes(n)),
    newNames.filter((n) => oldNames.includes(n)),
    "moved_declaration",
  );
  const hunks = [...diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map((m) => ({
    old: Number(m[1]),
    oldN: Number(m[2] ?? 1),
    now: Number(m[3]),
    nowN: Number(m[4] ?? 1),
  }));
  let previousEnd = 0;
  for (const h of hunks) {
    assert.ok(h.now >= previousEnd, "overlapping_diff_regions");
    previousEnd = h.now + h.nowN;
  }
  function corresponding(line) {
    let delta = 0;
    for (const h of hunks) {
      if (h.nowN === 0) {
        if (line > h.now) delta += h.oldN;
        continue;
      }
      if (line >= h.now && line < h.now + h.nowN) return null;
      if (line >= h.now + h.nowN) delta += h.oldN - h.nowN;
    }
    return line + delta;
  }
  const consumed = new Set();
  for (const m of newMessages) {
    const endLine = m.endLine ?? m.line,
      endColumn = m.endColumn ?? m.column;
    const start = offset(after, m.line, m.column),
      end = offset(after, endLine, endColumn);
    const oldLine = corresponding(m.line),
      oldEnd = corresponding(endLine);
    assert.ok(
      oldLine !== null && oldEnd !== null && oldEnd - oldLine === endLine - m.line,
      "changed_diagnostic_region",
    );
    for (let l = m.line; l <= endLine; l++)
      assert.equal(corresponding(l), oldLine + l - m.line, "changed_multiline_region");
    const unit = newUnits.find((u) => u.start <= start && u.end >= end);
    assert.ok(unit, "unmapped_diagnostic_context");
    const candidates = oldUnits.filter((u) => u.text === unit.text);
    assert.equal(candidates.length, 1, "changed_or_ambiguous_code_occurrence");
    assert.equal(
      newUnits.filter((u) => u.text === unit.text).length,
      1,
      "duplicate_code_occurrence",
    );
    const oldStart = offset(before, oldLine, m.column);
    assert.equal(oldStart - candidates[0].start, start - unit.start, "moved_code_occurrence");
    const i = oldMessages.findIndex(
      (o, i) =>
        !consumed.has(i) &&
        o.line === oldLine &&
        (o.endLine ?? o.line) === oldEnd &&
        o.column === m.column &&
        (o.endColumn ?? o.column) === endColumn &&
        o.ruleId === m.ruleId &&
        o.severity === m.severity &&
        o.message === m.message,
    );
    assert.ok(i >= 0, "new_lint_diagnostic");
    consumed.add(i);
  }
  return newMessages.length;
}

// Exact reviewed maintenance fixture, not UUID or source normalization.
export function approvedFixture(file, before, after, messages) {
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  const diagnostics = messages.map(
    ({ ruleId, severity, message, line, column, endLine, endColumn }) => ({
      ruleId,
      severity,
      message,
      line,
      column,
      endLine,
      endColumn,
    }),
  );
  return (
    file === "scripts/maintenance-rules.test.ts" &&
    hash(before) === "b4f651c9c50c11e6f91d5b292e253bb0c73dd9f514757643fb25afa110d5ca48" &&
    hash(after) === "af10352b4a70a605a534f3c62a471593eb6bf22ec1951627d1af65796070d2c5" &&
    hash(JSON.stringify(diagnostics)) ===
      "62bbe62efd3f0a868fa388003a7a4ca5b1fe92eb370f2b29f404cfba89ec4c75"
  );
}

export function rejectInlineSuppression(source) {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    source,
  );
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    )
      assert.ok(
        !/\beslint(?:-disable|-enable|\s)/.test(scanner.getTokenText()),
        "inline_lint_configuration_forbidden",
      );
  }
}
