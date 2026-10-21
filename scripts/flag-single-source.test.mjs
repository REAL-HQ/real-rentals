// Each *_ENABLED name has one declaration under src/, outside test files.
// scripts/ and test fixtures may repeat a flag name. Those copies are not
// duplicates: a test constant is allowed to mention the same flag the app
// declares, and counting them turned one src/ flag into a false failure.
// They are excluded from the duplicate rule. On RC12 the reported count is
// the production declarations in src/ (63). scripts/ declares none of them,
// so that count is not test fixtures being scanned in.
//
// The check parses with the TypeScript compiler so JSX text, mid-line
// statements, split declarators, object and array binding patterns,
// parameters (including defaults), class properties, and aliases stay
// visible. A second const, let, var, parameter, class property, or alias
// that introduces the same _ENABLED name in src/ fails the check. A plain
// same-name re-export (`export { X_ENABLED }`
// or `export { X_ENABLED } from "..."`) does not, and neither does a
// same-name import. Passing an existing flag as a default value
// (`function f(on = X_ENABLED)`) is a use, not a second declaration.
//
// A production declaration must be initialized with literal `false` or
// `false as boolean`, and it must be `const`. `let` and `var` are rejected
// even when initialized with `false`, so `export let NEW_ENABLED = false`
// cannot be reassigned later. Aliases, binding patterns, and parameters are
// non-literal even when a parameter default is `false`, so they fail.
// Object properties (`{ X_ENABLED: true }`) are declarations. A shorthand
// `{ X_ENABLED }` is a declaration only when that name is not an import and
// not an in-scope binding; otherwise it is a use
// (`import { FLEET_CALENDAR_ENABLED }` then `{ FLEET_CALENDAR_ENABLED }`).
// PropertyAccessExpression assignment targets (`globalThis.X_ENABLED = …`)
// are declarations whose initializer is the assigned expression. An identifier
// assignment (`NEW_ENABLED = true`, or `= false`) is always a non-literal
// declaration, so it fails.
// Element access (`obj["X_ENABLED"] = …`), computed property names,
// compound assignments (`+=`), and property signatures in types
// (`interface Flags { X_ENABLED: boolean }` and `{ X_ENABLED?: string }`)
// are out of scope. A type field names a shape; it does not declare the flag.
//
// LIVE_TRUE_FLAGS and LIVE_ENV_GATED_FLAGS live in scripts/live-enabled-flags.mjs,
// shared with enabled-flags-no-env. LIVE_TRUE_FLAGS may be literal `true`.
// On 7e3e6eb the only `*_ENABLED = true` under src/ is STRIPE_COLLECTIONS_ENABLED.
// LIVE_ENV_GATED_FLAGS is live env-gated, owner-controlled: the two alert flags
// plus STRIPE_RECONCILIATION_ENABLED, APPLICATION_RESUME_ATOMIC_ENABLED, and
// RENTER_LIFECYCLE_NOTICES_ENABLED. Those exist and read process.env on 7e3e6eb.
// DOCUMENT_EXPIRY_NOTICES_ENABLED does not exist on 7e3e6eb and is not listed.
// Any other *_ENABLED name whose initializer is not literal false still fails.
//
// Hidden boolean gates that are not named *_ENABLED (for example
// `filtersOn = false as boolean`) are not declarations and are not a failure.
// Search for them with rg before treating a tree as having a single flag
// source. A top-level const in src/ whose name does not end in _ENABLED, and
// whose initializer is `false`, `false as boolean`, or `false && ...`, is
// printed as a warning only.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { LIVE_ENV_GATED_FLAGS as LIVE_ENV_GATED_FLAG_LIST, LIVE_TRUE_FLAGS as LIVE_TRUE_FLAG_LIST } from "./live-enabled-flags.mjs";

// Literal `true` only. Names come from scripts/live-enabled-flags.mjs.
const LIVE_TRUE_FLAGS = new Set(LIVE_TRUE_FLAG_LIST);

// LIVE env-gated, owner-controlled. Same module as enabled-flags-no-env.
// Do not add a name here; add it to that module only if it is env-gated on 7e3e6eb.
const LIVE_ENV_GATED_FLAGS = new Set(LIVE_ENV_GATED_FLAG_LIST.map((flag) => flag.name));

const ROOTS = ["src"];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".output", ".wrangler", "coverage", "out", ".next", ".turbo"]);

const SCRIPT_KIND = {
  ".ts": ts.ScriptKind.TS,
  ".tsx": ts.ScriptKind.TSX,
  ".mts": ts.ScriptKind.TS,
  ".cts": ts.ScriptKind.TS,
  ".js": ts.ScriptKind.JS,
  ".jsx": ts.ScriptKind.JSX,
  ".mjs": ts.ScriptKind.JS,
  ".cjs": ts.ScriptKind.JS,
};

export function collectFlagDeclarations(root) {
  const byName = new Map();
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) return byName;
  for (const file of walk(root)) {
    for (const decl of declarationsIn(file)) {
      const sites = byName.get(decl.name) ?? [];
      sites.push({ file, line: decl.line, initializer: decl.initializer });
      byName.set(decl.name, sites);
    }
  }
  return byName;
}

/** scripts/, *.test.*, *.spec.*, and fixture folders do not fail the duplicate rule. */
export function isTestOrScript(file) {
  const parts = file.replaceAll("\\", "/").split("/");
  const dirs = parts.slice(0, -1);
  if (dirs.includes("scripts") || dirs.includes("__fixtures__") || dirs.includes("fixtures") || dirs.includes("__tests__")) return true;
  const base = parts.at(-1) ?? "";
  return /\.(?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/.test(base);
}

export function productionSites(sites) {
  return sites.filter((site) => !isTestOrScript(site.file));
}

/**
 * Production declarations whose initializer is not literal `false` or
 * `false as boolean`. LIVE_TRUE_FLAGS may be literal `true`.
 * LIVE_ENV_GATED_FLAGS may be a non-literal env read. Any other name fails.
 * Non-empty means the scanner exits 1.
 */
export function initializerFailures(byName) {
  const failures = [];
  for (const [name, sites] of byName) {
    for (const site of productionSites(sites)) {
      if (site.initializer === "false" || site.initializer === "false as boolean") continue;
      if (LIVE_TRUE_FLAGS.has(name) && site.initializer === "true") continue;
      if (LIVE_ENV_GATED_FLAGS.has(name) && site.initializer === "non-literal") continue;
      failures.push([name, site]);
    }
  }
  return failures.sort(([a], [b]) => a.localeCompare(b));
}

/** Non-empty means the scanner exits 1. */
export function duplicateFailures(byName) {
  const dupes = [];
  for (const [name, sites] of byName) {
    const counted = productionSites(sites);
    if (counted.length > 1) dupes.push([name, counted]);
  }
  return dupes.sort(([a], [b]) => a.localeCompare(b));
}

export function falseConstWarnings(root) {
  const warnings = [];
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) return warnings;
  for (const file of walk(root)) {
    const norm = file.replaceAll("\\", "/");
    if (isTestOrScript(file) || !/(^|\/)src\//.test(norm)) continue;
    warnings.push(...falseConstsIn(file));
  }
  return warnings;
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP_DIRS.has(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return EXTENSIONS.has(extname(name)) ? [path] : [];
  });
}

function sourceFile(file) {
  const kind = SCRIPT_KIND[extname(file)] ?? ts.ScriptKind.TS;
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, kind);
}

function declarationsIn(file) {
  const source = sourceFile(file);
  const found = [];
  const scopes = [new Set()];
  const push = (nameNode, initializer = "non-literal") => {
    const text = nameNode && (ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode)) ? nameNode.text : null;
    if (!text || !text.endsWith("_ENABLED")) return;
    const { line } = source.getLineAndCharacterOfPosition(nameNode.getStart(source));
    found.push({ name: text, line: line + 1, initializer });
  };
  const bindings = (name) => {
    if (!name) return;
    if (ts.isIdentifier(name)) {
      push(name, "non-literal");
      return;
    }
    if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const element of name.elements) {
        if (ts.isBindingElement(element)) bindings(element.name);
      }
    }
  };
  const bindName = (name) => {
    const collect = (node) => {
      if (!node) return;
      if (ts.isIdentifier(node)) scopes.at(-1).add(node.text);
      else if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) {
        for (const element of node.elements) {
          if (ts.isBindingElement(element)) collect(element.name);
        }
      }
    };
    collect(name);
  };
  const bindStatement = (stmt) => {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) bindName(decl.name);
    } else if ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) && stmt.name) {
      scopes.at(-1).add(stmt.name.text);
    }
  };
  const bindImports = (sf) => {
    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt)) continue;
      const clause = stmt.importClause;
      if (!clause || clause.isTypeOnly) continue;
      if (clause.name) scopes.at(-1).add(clause.name.text);
      const named = clause.namedBindings;
      if (!named) continue;
      if (ts.isNamespaceImport(named)) scopes.at(-1).add(named.name.text);
      else if (ts.isNamedImports(named)) {
        for (const spec of named.elements) {
          if (!spec.isTypeOnly) scopes.at(-1).add(spec.name.text);
        }
      }
    }
  };
  const visible = (name) => scopes.some((scope) => scope.has(name));
  const isConst = (node) => ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0;
  const recordProperty = (node) => {
    if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) push(node.name, classifyInitializer(node.initializer));
  };
  const visit = (node) => {
    if (ts.isSourceFile(node)) {
      bindImports(node);
      for (const stmt of node.statements) bindStatement(stmt);
      for (const stmt of node.statements) visit(stmt);
      return;
    }
    if (ts.isBlock(node) || ts.isModuleBlock(node)) {
      scopes.push(new Set());
      for (const stmt of node.statements) bindStatement(stmt);
      for (const stmt of node.statements) visit(stmt);
      scopes.pop();
      return;
    }
    if (ts.isFunctionLike(node)) {
      for (const param of node.parameters) {
        if (param.initializer) visit(param.initializer);
      }
      scopes.push(new Set());
      for (const param of node.parameters) bindName(param.name);
      if (node.body) visit(node.body);
      scopes.pop();
      for (const param of node.parameters) bindings(param.name);
      return;
    }
    if (ts.isCatchClause(node)) {
      scopes.push(new Set());
      if (node.variableDeclaration) bindName(node.variableDeclaration.name);
      visit(node.block);
      scopes.pop();
      if (node.variableDeclaration) bindings(node.variableDeclaration.name);
      return;
    }
    if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) {
      scopes.push(new Set());
      const init = node.initializer;
      if (init && ts.isVariableDeclarationList(init)) {
        for (const decl of init.declarations) bindName(decl.name);
      }
      if (ts.isForStatement(node)) {
        if (node.initializer) visit(node.initializer);
        if (node.condition) visit(node.condition);
        if (node.incrementor) visit(node.incrementor);
      } else {
        visit(node.initializer);
        visit(node.expression);
      }
      visit(node.statement);
      scopes.pop();
      return;
    }
    if (ts.isVariableDeclaration(node)) {
      if (ts.isIdentifier(node.name)) push(node.name, isConst(node) ? classifyInitializer(node.initializer) : "non-literal");
      else bindings(node.name);
    } else if (ts.isParameter(node)) bindings(node.name);
    else if (ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node)) recordProperty(node);
    else if (ts.isShorthandPropertyAssignment(node)) {
      if (!visible(node.name.text)) push(node.name, "non-literal");
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = unwrap(node.left);
      if (ts.isPropertyAccessExpression(left)) push(left.name, classifyInitializer(node.right));
      else if (ts.isIdentifier(left)) push(left, "non-literal");
    } else if (ts.isImportDeclaration(node)) recordImport(node, push);
    else if (ts.isExportDeclaration(node)) recordExport(node, push);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** `false`, `false as boolean`, `true`, or non-literal. Parentheses are ignored. */
function classifyInitializer(node) {
  const expr = unwrap(node);
  if (!expr) return "non-literal";
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return "false";
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return "true";
  if ((ts.isAsExpression(expr) || ts.isTypeAssertionExpression(expr)) && unwrap(expr.expression)?.kind === ts.SyntaxKind.FalseKeyword && isBooleanType(expr.type)) {
    return "false as boolean";
  }
  return "non-literal";
}

function recordImport(node, push) {
  const clause = node.importClause;
  if (!clause || clause.isTypeOnly) return;
  if (clause.name) push(clause.name);
  const bindings = clause.namedBindings;
  if (!bindings) return;
  if (ts.isNamespaceImport(bindings)) {
    push(bindings.name);
    return;
  }
  if (!ts.isNamedImports(bindings)) return;
  for (const spec of bindings.elements) {
    if (spec.isTypeOnly) continue;
    const local = spec.name.text;
    const imported = spec.propertyName?.text ?? local;
    if (local.endsWith("_ENABLED") && imported !== local) push(spec.name);
  }
}

function recordExport(node, push) {
  if (node.isTypeOnly) return;
  const clause = node.exportClause;
  if (!clause) return;
  if (ts.isNamespaceExport(clause)) {
    push(clause.name);
    return;
  }
  if (!ts.isNamedExports(clause)) return;
  for (const spec of clause.elements) {
    if (spec.isTypeOnly) continue;
    const exported = spec.name.text;
    const local = spec.propertyName?.text ?? exported;
    if (exported.endsWith("_ENABLED") && local !== exported) push(spec.name);
  }
}

function unwrap(node) {
  let current = node;
  while (current && ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function isBooleanType(typeNode) {
  return typeNode?.kind === ts.SyntaxKind.BooleanKeyword;
}

/** `false`, `false as boolean`, or `false && ...`. Other shapes still need rg. */
function hiddenFalseKind(node) {
  const expr = unwrap(node);
  if (!expr) return null;
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return "false";
  if ((ts.isAsExpression(expr) || ts.isTypeAssertionExpression(expr)) && unwrap(expr.expression)?.kind === ts.SyntaxKind.FalseKeyword && isBooleanType(expr.type)) {
    return "false as boolean";
  }
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && unwrap(expr.left)?.kind === ts.SyntaxKind.FalseKeyword) {
    return "false &&";
  }
  return null;
}

function falseConstsIn(file) {
  const source = sourceFile(file);
  const warnings = [];
  for (const stmt of source.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    if ((stmt.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.name.text.endsWith("_ENABLED")) continue;
      const kind = hiddenFalseKind(decl.initializer);
      if (!kind) continue;
      const { line } = source.getLineAndCharacterOfPosition(decl.name.getStart(source));
      warnings.push({ file, line: line + 1, name: decl.name.text, kind });
    }
  }
  return warnings;
}

function formatSite(site) {
  return `${site.file}:${site.line}`;
}

function scannerExit(dir) {
  const script = fileURLToPath(import.meta.url);
  const result = spawnSync(process.execPath, [script, "--scan", dir], { encoding: "utf8" });
  assert.equal(result.error, undefined, result.error?.message);
  return { status: result.status, stderr: result.stderr };
}

function selfTest() {
  const root = mkdtempSync(join(tmpdir(), "flag-single-source-"));
  const duplicateExits = [];
  const cleanExits = [];
  try {
    const duplicates = [
      {
        label: "duplicate in a tsx file with an apostrophe in JSX text",
        file: "view.tsx",
        flag: "APOSTROPHE_ENABLED",
        count: 2,
        source: [
          "export const APOSTROPHE_ENABLED = false;",
          "export function View() {",
          "  return <p>you're not done</p>;",
          "}",
          "export const APOSTROPHE_ENABLED = true;",
          "",
        ].join("\n"),
      },
      {
        label: "mid-line declaration",
        file: "mid.ts",
        flag: "MID_ENABLED",
        count: 2,
        source: ["export const MID_ENABLED = false;", "const a=1; const MID_ENABLED = true;", ""].join("\n"),
      },
      {
        label: "two-line split declaration",
        file: "split.ts",
        flag: "SPLIT_ENABLED",
        count: 2,
        source: ["export const SPLIT_ENABLED = false;", "const", "  SPLIT_ENABLED = true;", ""].join("\n"),
      },
      {
        label: "js file",
        file: "plain.js",
        flag: "JS_ENABLED",
        count: 2,
        source: ["const JS_ENABLED = false;", "function inner() { var JS_ENABLED = true; }", ""].join("\n"),
      },
      {
        label: "object and array binding patterns",
        file: "bind.ts",
        flag: "BIND_ENABLED",
        count: 3,
        source: [
          "const bag = { BIND_ENABLED: false };",
          "const { BIND_ENABLED } = bag;",
          "const [BIND_ENABLED] = [true];",
          "const { nested: { BIND_ENABLED: inner } } = { nested: {} };",
          "",
        ].join("\n"),
      },
      {
        label: "renamed binding introduces the flag name",
        file: "rename.ts",
        flag: "RENAME_ENABLED",
        count: 2,
        source: ["const { t: RENAME_ENABLED } = {};", "const { ...RENAME_ENABLED } = {};", ""].join("\n"),
      },
      {
        label: "export alias",
        file: "export-alias.ts",
        flag: "EXPORT_ALIAS_ENABLED",
        count: 2,
        source: ["const local = false;", "export { local as EXPORT_ALIAS_ENABLED };", "export { local as EXPORT_ALIAS_ENABLED };", ""].join("\n"),
      },
      {
        label: "import alias",
        file: "import-alias.ts",
        flag: "IMPORT_ALIAS_ENABLED",
        count: 2,
        source: ["import { t as IMPORT_ALIAS_ENABLED } from './a';", "import { u as IMPORT_ALIAS_ENABLED } from './b';", ""].join("\n"),
      },
      {
        label: "renamed re-export",
        file: "reexport-alias.ts",
        flag: "REEXPORT_ALIAS_ENABLED",
        count: 2,
        source: ["export { t as REEXPORT_ALIAS_ENABLED } from './a';", "export { u as REEXPORT_ALIAS_ENABLED } from './b';", ""].join("\n"),
      },
      {
        label: "namespace re-export alias",
        file: "ns.ts",
        flag: "NS_ENABLED",
        count: 2,
        source: ["export * as NS_ENABLED from './a';", "export * as NS_ENABLED from './b';", ""].join("\n"),
      },
      {
        label: "default and namespace import bindings",
        file: "def.ts",
        flag: "DEFAULT_ENABLED",
        count: 2,
        source: ["import DEFAULT_ENABLED from './a';", "import * as DEFAULT_ENABLED from './b';", ""].join("\n"),
      },
      {
        label: "function parameter",
        file: "param.ts",
        flag: "PARAM_ENABLED",
        count: 3,
        source: ["function f(PARAM_ENABLED) { return PARAM_ENABLED; }", "const g = (PARAM_ENABLED) => PARAM_ENABLED;", "class C { m(PARAM_ENABLED) { return PARAM_ENABLED; } }", ""].join("\n"),
      },
      {
        label: "parameter binding pattern",
        file: "param-bind.ts",
        flag: "PARAM_BIND_ENABLED",
        count: 2,
        source: ["function f({ PARAM_BIND_ENABLED }) { return PARAM_BIND_ENABLED; }", "function g([PARAM_BIND_ENABLED]) { return PARAM_BIND_ENABLED; }", ""].join("\n"),
      },
      {
        label: "parameter with a default",
        file: "param-default.ts",
        flag: "DEFAULT_PARAM_ENABLED",
        count: 3,
        source: [
          "function f(DEFAULT_PARAM_ENABLED = false) { return DEFAULT_PARAM_ENABLED; }",
          "const g = (DEFAULT_PARAM_ENABLED = true) => DEFAULT_PARAM_ENABLED;",
          "function h({ DEFAULT_PARAM_ENABLED = false } = {}) { return DEFAULT_PARAM_ENABLED; }",
          "function usedAsDefault(other = DEFAULT_PARAM_ENABLED) { return other; }",
          "",
        ].join("\n"),
      },
      {
        label: "mts file",
        file: "mod.mts",
        flag: "MTS_ENABLED",
        count: 2,
        source: ["export const MTS_ENABLED = false;", "export function f(MTS_ENABLED) { return MTS_ENABLED; }", ""].join("\n"),
      },
      {
        label: "cts file",
        file: "mod.cts",
        flag: "CTS_ENABLED",
        count: 2,
        source: ["export const CTS_ENABLED = false;", "export const CTS_ENABLED = true;", ""].join("\n"),
      },
      {
        label: "cjs file",
        file: "mod.cjs",
        flag: "CJS_ENABLED",
        count: 2,
        source: ["const CJS_ENABLED = false;", "function f(CJS_ENABLED) { return CJS_ENABLED; }", ""].join("\n"),
      },
      {
        label: "class static property",
        file: "calendar.ts",
        flag: "FLEET_CALENDAR_ENABLED",
        count: 2,
        source: ["export const FLEET_CALENDAR_ENABLED = false;", "class Calendar { static FLEET_CALENDAR_ENABLED = false; }", ""].join("\n"),
      },
    ];
    for (const item of duplicates) {
      const dir = join(root, item.flag);
      mkdirSync(dir);
      writeFileSync(join(dir, item.file), item.source);
      const byName = collectFlagDeclarations(dir);
      const dupes = duplicateFailures(byName);
      const hit = dupes.find(([name]) => name === item.flag);
      assert.ok(hit, `${item.label} should be a duplicate`);
      assert.equal(hit[1].length, item.count, `${item.label} declaration count`);
      const ran = scannerExit(dir);
      assert.equal(ran.status, 1, `${item.label} should exit 1, exited ${ran.status}\n${ran.stderr}`);
      duplicateExits.push(`${item.label} exit ${ran.status}`);
    }

    const badValues = [
      {
        label: "literal true",
        file: "true.ts",
        flag: "BRAND_NEW_ENABLED",
        initializer: "true",
        source: "export const BRAND_NEW_ENABLED = true;\n",
      },
      {
        label: "class property true",
        file: "class-true.ts",
        flag: "CLASS_TRUE_ENABLED",
        initializer: "true",
        source: "class Calendar { static CLASS_TRUE_ENABLED = true; }\n",
      },
      {
        label: "object property true",
        file: "object-true.ts",
        flag: "OBJECT_ENABLED",
        initializer: "true",
        source: "const bag = { OBJECT_ENABLED: true };\n",
      },
      {
        label: "string object property true",
        file: "object-string.ts",
        flag: "STRING_OBJECT_ENABLED",
        initializer: "true",
        source: "const bag = { \"STRING_OBJECT_ENABLED\": true };\n",
      },
      {
        label: "shorthand object property",
        file: "shorthand.ts",
        flag: "SHORTHAND_ENABLED",
        initializer: "non-literal",
        source: "const bag = { SHORTHAND_ENABLED };\n",
      },
      {
        label: "globalThis assignment",
        file: "global.ts",
        flag: "GLOBAL_ENABLED",
        initializer: "true",
        source: "globalThis.GLOBAL_ENABLED = true;\n",
      },
      {
        label: "binding is non-literal",
        file: "binding.ts",
        flag: "BIND_VALUE_ENABLED",
        initializer: "non-literal",
        source: "const { BIND_VALUE_ENABLED } = {};\n",
      },
      {
        label: "parameter default false is non-literal",
        file: "param-value.ts",
        flag: "PARAM_VALUE_ENABLED",
        initializer: "non-literal",
        source: "function f(PARAM_VALUE_ENABLED = false) { return PARAM_VALUE_ENABLED; }\n",
      },
      {
        label: "import alias is non-literal",
        file: "alias-value.ts",
        flag: "ALIAS_VALUE_ENABLED",
        initializer: "non-literal",
        source: "import { t as ALIAS_VALUE_ENABLED } from './a';\n",
      },
      {
        label: "env expression is not literal false",
        file: "env.ts",
        flag: "ENV_EXPR_ENABLED",
        initializer: "non-literal",
        source: "export const ENV_EXPR_ENABLED = process.env.ENV_EXPR_ENABLED === \"true\";\n",
      },
      {
        label: "document expiry is not a live env flag",
        file: "expiry.ts",
        flag: "DOCUMENT_EXPIRY_NOTICES_ENABLED",
        initializer: "non-literal",
        source: "export const DOCUMENT_EXPIRY_NOTICES_ENABLED = process.env.DOCUMENT_EXPIRY_NOTICES_ENABLED === \"true\";\n",
      },
    ];
    for (const item of badValues) {
      const dir = join(root, `value-${item.flag}`);
      mkdirSync(dir);
      writeFileSync(join(dir, item.file), item.source);
      const byName = collectFlagDeclarations(dir);
      assert.equal(duplicateFailures(byName).length, 0, `${item.label} is one declaration`);
      const bad = initializerFailures(byName);
      assert.equal(bad.length, 1, `${item.label} should fail the value check`);
      assert.equal(bad[0][0], item.flag);
      assert.equal(bad[0][1].initializer, item.initializer, `${item.label} initializer`);
      const ran = scannerExit(dir);
      assert.equal(ran.status, 1, `${item.label} should exit 1, exited ${ran.status}\n${ran.stderr}`);
      assert.match(ran.stderr, new RegExp(item.flag));
      duplicateExits.push(`${item.label} exit ${ran.status}`);
    }

    const goodValues = [
      { label: "literal false", source: "export const OK_FALSE_ENABLED = false;\n" },
      { label: "false as boolean", source: "export const OK_CAST_ENABLED = false as boolean;\n" },
      { label: "parenthesized false", source: "export const OK_PAREN_ENABLED = (false);\n" },
      { label: "class static false", source: "class Calendar { static OK_CLASS_ENABLED = false; }\n" },
      { label: "class static false as boolean", source: "class Calendar { static OK_CLASS_CAST_ENABLED = false as boolean; }\n" },
      { label: "object property false", source: "const bag = { OK_OBJECT_ENABLED: false };\n" },
      { label: "assignment false", source: "globalThis.OK_ASSIGN_ENABLED = false;\n" },
      { label: "live true allowlist", source: "export const STRIPE_COLLECTIONS_ENABLED = true;\n" },
      {
        label: "live env-gated allowlist",
        source: `${[...LIVE_ENV_GATED_FLAGS].map((name) => `export const ${name} = process.env.${name} === "true";`).join("\n")}\n`,
      },
      {
        label: "shorthand of an import or in-scope binding is a use",
        source: [
          "import { FLEET_CALENDAR_ENABLED } from './flag';",
          "export const FLEET_CALENDAR_ENABLED = false;",
          "const view = { FLEET_CALENDAR_ENABLED };",
          "function panel() { return { FLEET_CALENDAR_ENABLED }; }",
          "",
        ].join("\n"),
      },
      {
        label: "type signature is not a declaration",
        source: [
          "export const SHAPE_ENABLED = false;",
          "interface Flags { SHAPE_ENABLED?: boolean; }",
          "type Alias = { SHAPE_ENABLED: boolean };",
          "function f(env: { SHAPE_ENABLED?: string } = process.env) { return env.SHAPE_ENABLED; }",
          "",
        ].join("\n"),
      },
    ];
    for (const item of goodValues) {
      const dir = join(root, `good-${item.label.replaceAll(" ", "-")}`);
      mkdirSync(dir);
      writeFileSync(join(dir, "ok.ts"), item.source);
      assert.equal(initializerFailures(collectFlagDeclarations(dir)).length, 0, `${item.label} should be an accepted initializer`);
      const ran = scannerExit(dir);
      assert.equal(ran.status, 0, `${item.label} should exit 0\n${ran.stderr}`);
      cleanExits.push(`${item.label} exit ${ran.status}`);
    }
    assert.deepEqual(
      [...LIVE_ENV_GATED_FLAGS].sort(),
      [
        "APPLICATION_RESUME_ATOMIC_ENABLED",
        "DRIVER_ISSUE_ALERTS_ENABLED",
        "RENTER_LIFECYCLE_NOTICES_ENABLED",
        "ROADSIDE_SMS_ALERTS_ENABLED",
        "STRIPE_RECONCILIATION_ENABLED",
      ],
      "the env allowlist is the live env-gated names on 7e3e6eb",
    );
    assert.deepEqual([...LIVE_TRUE_FLAGS], ["STRIPE_COLLECTIONS_ENABLED"]);
    const shorthandUse = join(root, "shorthand-use");
    mkdirSync(shorthandUse);
    writeFileSync(
      join(shorthandUse, "use.ts"),
      [
        "import { FLEET_CALENDAR_ENABLED } from './flag';",
        "export const FLEET_CALENDAR_ENABLED = false;",
        "const view = { FLEET_CALENDAR_ENABLED };",
        "function panel() { return { FLEET_CALENDAR_ENABLED }; }",
        "",
      ].join("\n"),
    );
    const shorthandFlags = collectFlagDeclarations(shorthandUse);
    assert.equal(productionSites(shorthandFlags.get("FLEET_CALENDAR_ENABLED")).length, 1, "a shorthand use is not a second declaration");
    assert.equal(scannerExit(shorthandUse).status, 0);
    const letReassign = join(root, "let-reassign");
    mkdirSync(letReassign);
    writeFileSync(join(letReassign, "let.ts"), "export let NEW_ENABLED = false;\nNEW_ENABLED = true;\n");
    assert.equal(scannerExit(letReassign).status, 1, "let plus identifier assignment must fail");
    const letOnly = join(root, "let-only");
    mkdirSync(letOnly);
    writeFileSync(join(letOnly, "let.ts"), "export let LET_ONLY_ENABLED = false;\n");
    assert.equal(initializerFailures(collectFlagDeclarations(letOnly))[0][1].initializer, "non-literal");
    assert.equal(scannerExit(letOnly).status, 1, "let is rejected even when initialized false");
    const varOnly = join(root, "var-only");
    mkdirSync(varOnly);
    writeFileSync(join(varOnly, "var.ts"), "export var VAR_ONLY_ENABLED = false;\n");
    assert.equal(scannerExit(varOnly).status, 1, "var is rejected even when initialized false");
    const identAssign = join(root, "ident-assign");
    mkdirSync(identAssign);
    writeFileSync(join(identAssign, "assign.ts"), "export const ASSIGN_ID_ENABLED = false;\nASSIGN_ID_ENABLED = false;\n");
    const assignHits = initializerFailures(collectFlagDeclarations(identAssign));
    assert.equal(assignHits.length, 1, "an identifier assignment is non-literal even when the right-hand side is false");
    assert.equal(assignHits[0][1].initializer, "non-literal");
    assert.equal(scannerExit(identAssign).status, 1);
    const liveEnvButTrue = join(root, "live-env-true");
    mkdirSync(liveEnvButTrue);
    writeFileSync(liveEnvButTrue + "/true.ts", "export const DRIVER_ISSUE_ALERTS_ENABLED = true;\n");
    assert.equal(initializerFailures(collectFlagDeclarations(liveEnvButTrue)).length, 1, "an env-gated name set to literal true is not on the live-true allowlist");
    assert.equal(scannerExit(liveEnvButTrue).status, 1);

    const liveButBound = join(root, "live-bound");
    mkdirSync(liveButBound);
    writeFileSync(liveButBound + "/bound.ts", "const { STRIPE_COLLECTIONS_ENABLED } = {};\n");
    assert.equal(initializerFailures(collectFlagDeclarations(liveButBound)).length, 1, "a live flag name in a binding is still non-literal");
    assert.equal(scannerExit(liveButBound).status, 1);

    const clean = join(root, "clean");
    mkdirSync(clean);
    writeFileSync(
      join(clean, "copy.tsx"),
      [
        "export const ONLY_ENABLED = false;",
        "export { ONLY_ENABLED };",
        "export { ONLY_ENABLED } from './flag';",
        "export { ONLY_ENABLED as other };",
        "import { ONLY_ENABLED } from './flag';",
        "import { ONLY_ENABLED as otherName } from './flag';",
        "import type { t as TYPE_IMPORT_ENABLED } from './flag';",
        "import { type t as TYPE_SPEC_ENABLED } from './flag';",
        "export type { t as TYPE_EXPORT_ENABLED };",
        "const { ONLY_ENABLED: renamed } = {};",
        "function passed(on = ONLY_ENABLED) { return on; }",
        "export function View() {",
        "  return <p>you're reading const TEXT_ENABLED = true</p>;",
        "}",
        "",
      ].join("\n"),
    );
    const cleanFlags = collectFlagDeclarations(clean);
    assert.deepEqual([...cleanFlags.keys()], ["ONLY_ENABLED"]);
    assert.equal(productionSites(cleanFlags.get("ONLY_ENABLED")).length, 1);
    assert.equal(duplicateFailures(cleanFlags).length, 0, "a same-name re-export is not a second declaration");
    const cleanRun = scannerExit(clean);
    assert.equal(cleanRun.status, 0, cleanRun.stderr);
    cleanExits.push(`same-name re-export exit ${cleanRun.status}`);

    const mixed = join(root, "mixed");
    mkdirSync(join(mixed, "src", "lib"), { recursive: true });
    mkdirSync(join(mixed, "scripts"));
    mkdirSync(join(mixed, "src", "feature"));
    writeFileSync(join(mixed, "src", "lib", "flag.ts"), "export const SHARED_ENABLED = false;\n");
    writeFileSync(join(mixed, "scripts", "helper.ts"), "const SHARED_ENABLED = true;\nconst SHARED_ENABLED = false;\n");
    writeFileSync(join(mixed, "src", "feature", "flag.test.ts"), "const SHARED_ENABLED = true;\n");
    const mixedFlags = new Map();
    for (const dir of ["src", "scripts"]) {
      for (const [name, sites] of collectFlagDeclarations(join(mixed, dir))) {
        const list = mixedFlags.get(name) ?? [];
        list.push(...sites);
        mixedFlags.set(name, list);
      }
    }
    assert.equal(mixedFlags.get("SHARED_ENABLED").length, 4);
    assert.equal(duplicateFailures(mixedFlags).length, 0, "scripts/ and test fixtures must not fail the duplicate rule");
    const mixedRun = scannerExit(mixed);
    assert.equal(mixedRun.status, 0, mixedRun.stderr);
    cleanExits.push(`scripts and test copies exit ${mixedRun.status}`);

    const scriptsOnly = join(root, "scripts-only");
    mkdirSync(join(scriptsOnly, "scripts"), { recursive: true });
    writeFileSync(join(scriptsOnly, "scripts", "helper.ts"), "const TEST_CONST_ENABLED = true;\nconst TEST_CONST_ENABLED = false;\n");
    const scriptsRun = scannerExit(scriptsOnly);
    assert.equal(scriptsRun.status, 0, scriptsRun.stderr);
    cleanExits.push(`scripts-only constants exit ${scriptsRun.status}`);

    const testOnly = join(root, "test-only", "src", "feature");
    mkdirSync(testOnly, { recursive: true });
    writeFileSync(join(testOnly, "flag.test.ts"), "const TEST_CONST_ENABLED = true;\nconst TEST_CONST_ENABLED = false;\n");
    mkdirSync(join(root, "test-only", "src", "__fixtures__"), { recursive: true });
    writeFileSync(join(root, "test-only", "src", "__fixtures__", "flag.ts"), "const FIXTURE_ENABLED = true;\nconst FIXTURE_ENABLED = false;\n");
    mkdirSync(join(root, "test-only", "src", "__tests__"), { recursive: true });
    writeFileSync(join(root, "test-only", "src", "__tests__", "flag.ts"), "export const SUITE_ENABLED = false;\nexport const SUITE_ENABLED = true;\n");
    const testRun = scannerExit(join(root, "test-only"));
    assert.equal(testRun.status, 0, testRun.stderr);
    cleanExits.push(`test and fixture files exit ${testRun.status}`);

    const gateDir = join(root, "src", "components");
    mkdirSync(gateDir, { recursive: true });
    mkdirSync(join(root, "src", "lib"), { recursive: true });
    writeFileSync(
      join(gateDir, "Gate.tsx"),
      [
        "export const filtersOn = false;",
        "export const REAL_ENABLED = false;",
        "let notConst = false;",
        "export function inner() { const hidden = false; return hidden; }",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(root, "src", "lib", "gates.ts"),
      [
        "export const castOff = false as boolean;",
        "export const shortCircuit = false && true;",
        "export const CAST_FLAG_ENABLED = false as boolean;",
        "export const andFlag = false && check();",
        "let castLet = false as boolean;",
        "export function nested() { const hiddenCast = false as boolean; return hiddenCast; }",
        "export const compared = value === false && other;",
        "",
      ].join("\n"),
    );
    const warnings = falseConstWarnings(join(root, "src"));
    assert.deepEqual(
      warnings.map((item) => `${item.name}:${item.kind}`).sort(),
      ["andFlag:false &&", "castOff:false as boolean", "filtersOn:false", "shortCircuit:false &&"],
      "top-level false, false as boolean, and false && consts in src/ are warnings",
    );
    const gateRun = scannerExit(join(root, "src"));
    assert.equal(gateRun.status, 0, gateRun.stderr);
    cleanExits.push(`hidden const false exit ${gateRun.status}`);
    console.log(`flag-single-source: duplicate fixtures ${duplicateExits.join("; ")}`);
    console.log(`flag-single-source: allowed copies ${cleanExits.join("; ")}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function scanWorkspace() {
  const byName = new Map();
  for (const root of ROOTS) {
    for (const [name, sites] of collectFlagDeclarations(root)) {
      const list = byName.get(name) ?? [];
      list.push(...sites);
      byName.set(name, list);
    }
  }
  return byName;
}

function reportDuplicates(dupes, flagCount) {
  const lines = dupes.map(([name, sites]) => `  ${name}\n    ${sites.map(formatSite).join("\n    ")}`);
  console.error(`flag-single-source: ${flagCount} flag names, ${dupes.length} declared more than once:\n` + lines.join("\n"));
}

function reportInitializers(failures) {
  const lines = failures.map(([name, site]) => `  ${name} ${formatSite(site)} initializer ${site.initializer}`);
  console.error(
    `flag-single-source: ${failures.length} *_ENABLED declarations are not literal false or false as boolean:\n` + lines.join("\n"),
  );
}

function rejectScan(byName) {
  const dupes = duplicateFailures(byName);
  const bad = initializerFailures(byName);
  if (!dupes.length && !bad.length) return false;
  const flagCount = [...byName.values()].filter((sites) => productionSites(sites).length > 0).length;
  if (dupes.length) reportDuplicates(dupes, flagCount);
  if (bad.length) reportInitializers(bad);
  return true;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const scanAt = process.argv.indexOf("--scan");
  if (scanAt !== -1) {
    const dir = process.argv[scanAt + 1];
    if (!dir) {
      console.error("flag-single-source: --scan requires a directory");
      process.exit(2);
    }
    const byName = collectFlagDeclarations(dir);
    if (rejectScan(byName)) process.exit(1);
    process.exit(0);
  }
  selfTest();
  console.log("flag-single-source: self-test passed");
  const byName = scanWorkspace();
  const flagCount = [...byName.values()].filter((sites) => productionSites(sites).length > 0).length;
  const warnings = falseConstWarnings("src");
  if (warnings.length) {
    const lines = warnings.map((item) => `  ${item.file}:${item.line} ${item.name} (${item.kind})`);
    console.error(
      `flag-single-source: warning: top-level const in src/ initialized with false, false as boolean, or false && (not a failure; rg for other hidden gates):\n` +
        lines.join("\n"),
    );
  }
  if (rejectScan(byName)) process.exit(1);
  console.log(
    `flag-single-source: OK (${flagCount} flags in src/, one declaration each; scripts/ and test files are not part of the duplicate rule)`,
  );
}
