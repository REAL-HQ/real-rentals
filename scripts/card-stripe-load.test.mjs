/**
 * Stripe.js stays unloaded until getStripe() runs.
 * The card page imports this module for Link Expired, so the import itself
 * must not inject https://js.stripe.com.
 */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";

const stripeSrc = readFileSync("src/lib/stripe.ts", "utf8");
assert.match(stripeSrc, /from '@stripe\/stripe-js\/pure'/);
assert.doesNotMatch(stripeSrc, /from '@stripe\/stripe-js'/);
assert.equal(stripeSrc.split("loadStripe(").length - 1, 1);
assert.match(stripeSrc, /function getStripe\(\)[\s\S]*loadStripe\(/);

const callers = [
  ["src/routes/card.$applicationId.tsx", "getStripe()"],
  ["src/components/admin/DriversPanel.tsx", "getStripeEnvironment()"],
  ["src/routes/portal.tsx", "getStripeEnvironment()"],
];
for (const [file, needle] of callers) {
  const text = readFileSync(file, "utf8");
  assert.equal(text.includes(needle), true, file);
  assert.equal(text.includes("loadStripe"), false, file);
}
const cardRoute = readFileSync("src/routes/card.$applicationId.tsx", "utf8");
const formAt = cardRoute.indexOf("screen.kind === 'form'");
assert.ok(cardRoute.indexOf("getStripe()") > formAt);
assert.equal(cardRoute.split("getStripe()").length - 1, 1);

function browserDocument() {
  const scripts = [];
  const document = {
    head: { appendChild(el) { scripts.push(el); return el; } },
    body: { appendChild(el) { scripts.push(el); return el; } },
    querySelectorAll() { return []; },
    createElement() {
      return { src: "", addEventListener() {}, removeEventListener() {} };
    },
  };
  return { document, scripts };
}

async function bundle(entrySource, outfile, token) {
  await build({
    stdin: {
      contents: entrySource,
      resolveDir: process.cwd(),
      sourcefile: "stripe-probe.ts",
      loader: "ts",
    },
    bundle: true,
    format: "iife",
    globalName: "StripeProbe",
    platform: "browser",
    outfile,
    define: {
      "import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN": JSON.stringify(token),
    },
  });
  return readFileSync(outfile, "utf8");
}

function run(code) {
  const { document, scripts } = browserDocument();
  const context = vm.createContext({
    console,
    Promise,
    Date,
    setTimeout,
    clearTimeout,
  });
  context.window = context;
  context.document = document;
  context.self = context;
  vm.runInContext(code, context);
  return { context, scripts };
}

const out = mkdtempSync(join(tmpdir(), "rr-stripe-load-"));
try {
  const pure = await bundle(
    `import { getStripe, getStripeEnvironment } from "./src/lib/stripe.ts";
     export { getStripe, getStripeEnvironment };`,
    join(out, "pure.js"),
    "pk_test_dummy_card_on_file_build",
  );
  assert.equal(pure.includes("setLoadParameters"), true);
  assert.equal(pure.includes("script injection after a tick"), false);

  const loaded = run(pure);
  await Promise.resolve();
  assert.equal(loaded.scripts.length, 0);
  assert.equal(loaded.context.StripeProbe.getStripeEnvironment(), "sandbox");
  assert.equal(loaded.scripts.length, 0);
  const pending = loaded.context.StripeProbe.getStripe();
  assert.equal(loaded.scripts.length, 1);
  assert.match(loaded.scripts[0].src, /^https:\/\/js\.stripe\.com\/[^/]+\/stripe\.js$/);
  assert.equal(pending instanceof Promise, true);

  const live = run(await bundle(
    `import { getStripeEnvironment } from "./src/lib/stripe.ts";
     export { getStripeEnvironment };`,
    join(out, "live.js"),
    "pk_live_dummy_card_on_file_build",
  ));
  await Promise.resolve();
  assert.equal(live.context.StripeProbe.getStripeEnvironment(), "live");
  assert.equal(live.scripts.length, 0);

  const sideEffect = run(await bundle(
    `import { loadStripe } from "@stripe/stripe-js";
     export { loadStripe };`,
    join(out, "side.js"),
    "pk_test_dummy_card_on_file_build",
  ));
  assert.equal(sideEffect.scripts.length, 0);
  await Promise.resolve();
  assert.equal(sideEffect.scripts.length, 1);
  assert.match(sideEffect.scripts[0].src, /^https:\/\/js\.stripe\.com\//);
} finally {
  rmSync(out, { recursive: true, force: true });
}

const outputRoot = process.env.CARD_STRIPE_OUTPUT;
if (outputRoot) {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (/\.(?:m?js|html)$/.test(name) && stat.size < 4_000_000) files.push(path);
    }
  };
  walk(outputRoot);
  const stripeFiles = files.filter((path) => readFileSync(path, "utf8").includes("js.stripe.com"));
  assert.ok(stripeFiles.length > 0, "built card bundle should still contain the loader");
  for (const path of stripeFiles) {
    const text = readFileSync(path, "utf8");
    assert.equal(text.includes("setLoadParameters"), true, path);
    assert.equal(text.includes("script injection after a tick"), false, path);
  }
  const cardChunks = files.filter((path) => readFileSync(path, "utf8").includes("Link Expired"));
  assert.ok(cardChunks.length > 0, "card page chunk");
  for (const path of cardChunks) {
    const text = readFileSync(path, "utf8");
    assert.equal(text.includes("script injection after a tick"), false, path);
  }
}

const htmlPath = process.env.CARD_STRIPE_HTML;
if (htmlPath) {
  const html = readFileSync(htmlPath, "utf8").replaceAll("\u0000", "");
  assert.equal(html.toLowerCase().includes("js.stripe.com"), false);
  assert.equal(html.includes("Save Your Card on File"), false);
  assert.equal(html.toLowerCase().includes("googletagmanager"), false);
}

console.log("card stripe load checks passed");
