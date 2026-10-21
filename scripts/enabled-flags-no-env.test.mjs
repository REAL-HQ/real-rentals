// A *_ENABLED flag must not read process.env or import.meta.env.
// Dark screens are hard-false constants. Names that stay on the environment
// are the live env-gated flags in scripts/live-enabled-flags.mjs (the same
// module the flag scanner imports). A new env read fails. An allowlisted
// name that stops reading the environment fails too, so the list cannot go stale.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { LIVE_ENV_GATED_FLAGS } from "./live-enabled-flags.mjs";

const ALLOWED = new Map(LIVE_ENV_GATED_FLAGS.map((flag) => [flag.name, flag.reason]));

const ENABLED = /^[A-Z][A-Z0-9_]*_ENABLED$/;

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : walk(path);
    return /\.(tsx|ts|jsx|js|mjs|cjs|mts|cts)$/.test(name) ? [path] : [];
  });

function kindFor(file) {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.endsWith(".mts")) return ts.ScriptKind.TS;
  if (file.endsWith(".cts")) return ts.ScriptKind.TS;
  if (/\.(js|mjs|cjs)$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function isProcessEnv(node) {
  return ts.isPropertyAccessExpression(node)
    && node.name.text === "env"
    && ts.isIdentifier(node.expression)
    && node.expression.text === "process";
}

function isImportMetaEnv(node) {
  return ts.isPropertyAccessExpression(node)
    && node.name.text === "env"
    && ts.isMetaProperty(node.expression)
    && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword
    && node.expression.name.text === "meta";
}

function isEnvObject(node) {
  return isProcessEnv(node) || isImportMetaEnv(node);
}

function propertyName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) return node.argumentExpression.text;
  return null;
}

function bindingNames(name, into) {
  if (!name) return;
  if (ts.isIdentifier(name)) into.push(name);
  else if (ts.isObjectBindingPattern(name)) {
    for (const element of name.elements) {
      if (!ts.isBindingElement(element)) continue;
      if (element.propertyName && (ts.isIdentifier(element.propertyName) || ts.isStringLiteral(element.propertyName))) into.push(element.propertyName);
      else bindingNames(element.name, into);
    }
  } else if (ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) bindingNames(element.name, into);
    }
  }
}

function envReads(source, fileName) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kindFor(fileName));
  const aliases = new Set();
  const hits = [];
  const note = (name, node) => {
    if (!ENABLED.test(name)) return;
    const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    hits.push({ name, at: `${fileName}:${pos.line + 1}` });
  };
  const rememberAlias = (name, initializer) => {
    if (initializer && isEnvObject(initializer) && ts.isIdentifier(name)) aliases.add(name.text);
    if (initializer && isEnvObject(initializer)) {
      const names = [];
      bindingNames(name, names);
      for (const id of names) note(id.text, id);
    }
  };
  const visit = (node) => {
    if (ts.isParameter(node)) rememberAlias(node.name, node.initializer);
    if (ts.isVariableDeclaration(node)) rememberAlias(node.name, node.initializer);
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = propertyName(node);
      if (name && (isEnvObject(node.expression) || (ts.isIdentifier(node.expression) && aliases.has(node.expression.text)))) {
        note(name, node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

function assertConstant(file, name, expected) {
  const source = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kindFor(file));
  let found = 0;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      found += 1;
      const text = node.initializer ? node.initializer.getText(sf) : "";
      if (text !== expected) {
        console.error(`enabled-flags-no-env: ${file} declares ${name} = ${text || "(missing)"}, expected ${expected}`);
        process.exit(1);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (found !== 1) {
    console.error(`enabled-flags-no-env: ${file} declares ${name} ${found} times`);
    process.exit(1);
  }
}

function expectHit(label, source, name) {
  const hits = envReads(source, label);
  if (!hits.some((hit) => hit.name === name)) {
    console.error(`enabled-flags-no-env: detector missed ${name} in ${label}`);
    process.exit(1);
  }
}

expectHit("param.ts", "export function f(env = process.env) { return env.SAMPLE_DARK_ENABLED === \"true\"; }\n", "SAMPLE_DARK_ENABLED");
expectHit("direct.ts", "export const on = process.env.SAMPLE_DARK_ENABLED === \"true\";\n", "SAMPLE_DARK_ENABLED");
expectHit("meta.ts", "export const on = import.meta.env.SAMPLE_DARK_ENABLED === \"true\";\n", "SAMPLE_DARK_ENABLED");
expectHit("bind.ts", "const { SAMPLE_DARK_ENABLED } = process.env;\n", "SAMPLE_DARK_ENABLED");
expectHit("rename.ts", "const { SAMPLE_DARK_ENABLED: on } = process.env;\n", "SAMPLE_DARK_ENABLED");
expectHit("index.ts", "const on = process.env[\"SAMPLE_DARK_ENABLED\"] === \"true\";\n", "SAMPLE_DARK_ENABLED");
if (envReads("export const SAMPLE_DARK_ENABLED = false;\n", "hard.ts").length) {
  console.error("enabled-flags-no-env: detector flagged a hard-false constant");
  process.exit(1);
}
if (envReads("const on = import.meta.env.DEV && STRIPE_COLLECTIONS_TEST_MODE;\n", "dev.ts").some((hit) => hit.name.endsWith("_ENABLED"))) {
  console.error("enabled-flags-no-env: detector treated import.meta.env.DEV as an enabled flag");
  process.exit(1);
}

const hits = walk("src").flatMap((file) => envReads(readFileSync(file, "utf8"), file));
const byName = new Map();
for (const hit of hits) {
  const list = byName.get(hit.name) ?? [];
  list.push(hit.at);
  byName.set(hit.name, list);
}

const unexpected = [...byName.keys()].filter((name) => !ALLOWED.has(name));
const missing = [...ALLOWED.keys()].filter((name) => !byName.has(name));
if (unexpected.length || missing.length) {
  if (unexpected.length) {
    console.error("enabled-flags-no-env: a *_ENABLED flag reads the environment:\n" + unexpected.map((name) => `  ${name}\n    ${byName.get(name).join("\n    ")}`).join("\n"));
  }
  if (missing.length) {
    console.error("enabled-flags-no-env: an allowlisted flag no longer reads the environment:\n" + missing.map((name) => `  ${name}`).join("\n"));
  }
  process.exit(1);
}

assertConstant("src/lib/stripe-collections.ts", "STRIPE_COLLECTIONS_ENABLED", "true");
assertConstant("src/lib/manual-payments.ts", "MANUAL_PAYMENTS_LIVE", "false");
assertConstant("src/lib/stripe-collections.test-mode.ts", "STRIPE_COLLECTIONS_TEST_MODE", "false");
assertConstant("src/lib/roadside-sms-flag.ts", "ROADSIDE_SMS_ALERTS_ENABLED", "false");

const lines = [...ALLOWED.entries()].map(([name, reason]) => `  ${name} (${byName.get(name).length}) — ${reason}`);
console.log(`enabled-flags-no-env: OK (${hits.length} env reads, ${ALLOWED.size} production flags left alone)\n${lines.join("\n")}`);
