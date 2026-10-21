// Each *_ENABLED name has one VariableDeclaration under src/ and scripts/.
// The check parses with the TypeScript compiler so JSX text, mid-line
// statements, and split declarators stay visible. A second const, let, or
// var with the same name — any scope, this file or another — fails the check.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const ROOTS = ["src", "scripts"];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".output", ".wrangler", "coverage", "out", ".next", ".turbo"]);

const SCRIPT_KIND = {
  ".ts": ts.ScriptKind.TS,
  ".tsx": ts.ScriptKind.TSX,
  ".js": ts.ScriptKind.JS,
  ".jsx": ts.ScriptKind.JSX,
  ".mjs": ts.ScriptKind.JS,
};

export function collectFlagDeclarations(root) {
  const byName = new Map();
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) return byName;
  for (const file of walk(root)) {
    for (const decl of declarationsIn(file)) {
      const sites = byName.get(decl.name) ?? [];
      sites.push(`${file}:${decl.line}`);
      byName.set(decl.name, sites);
    }
  }
  return byName;
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP_DIRS.has(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return EXTENSIONS.has(extname(name)) ? [path] : [];
  });
}

function declarationsIn(file) {
  const kind = SCRIPT_KIND[extname(file)];
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, kind);
  const found = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text.endsWith("_ENABLED")) {
      const { line } = source.getLineAndCharacterOfPosition(node.name.getStart(source));
      found.push({ name: node.name.text, line: line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function selfTest() {
  const root = mkdtempSync(join(tmpdir(), "flag-single-source-"));
  try {
    const cases = [
      {
        label: "duplicate in a tsx file with an apostrophe in JSX text",
        file: "view.tsx",
        flag: "APOSTROPHE_ENABLED",
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
        source: ["export const MID_ENABLED = false;", "const a=1; const MID_ENABLED = true;", ""].join("\n"),
      },
      {
        label: "two-line split declaration",
        file: "split.ts",
        flag: "SPLIT_ENABLED",
        source: ["export const SPLIT_ENABLED = false;", "const", "  SPLIT_ENABLED = true;", ""].join("\n"),
      },
      {
        label: "js file",
        file: "plain.js",
        flag: "JS_ENABLED",
        source: ["const JS_ENABLED = false;", "function inner() { var JS_ENABLED = true; }", ""].join("\n"),
      },
    ];
    for (const item of cases) {
      const dir = join(root, item.flag);
      mkdirSync(dir);
      writeFileSync(join(dir, item.file), item.source);
      const sites = collectFlagDeclarations(dir).get(item.flag) ?? [];
      assert.equal(sites.length, 2, `${item.label} should be caught, saw ${sites.length}: ${sites.join(", ")}`);
    }
    const clean = join(root, "clean");
    mkdirSync(clean);
    writeFileSync(
      join(clean, "copy.tsx"),
      [
        "export const ONLY_ENABLED = false;",
        "export function View() {",
        "  return <p>you're reading const TEXT_ENABLED = true</p>;",
        "}",
        "",
      ].join("\n"),
    );
    const cleanFlags = collectFlagDeclarations(clean);
    assert.deepEqual([...cleanFlags.keys()], ["ONLY_ENABLED"]);
    assert.equal(cleanFlags.get("ONLY_ENABLED").length, 1);
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

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  selfTest();
  console.log("flag-single-source: self-test passed");
  const byName = scanWorkspace();
  const dupes = [...byName.entries()].filter(([, sites]) => sites.length > 1).sort(([a], [b]) => a.localeCompare(b));
  if (dupes.length) {
    const lines = dupes.map(([name, sites]) => `  ${name}\n    ${sites.join("\n    ")}`);
    console.error(
      `flag-single-source: ${byName.size} flag names, ${dupes.length} declared more than once:\n` + lines.join("\n"),
    );
    process.exit(1);
  }
  console.log(`flag-single-source: OK (${byName.size} flags, one declaration each)`);
}
