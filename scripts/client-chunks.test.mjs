/**
 * Every interactive route must still ship a browser bundle.
 *
 * The /admin outage was not a build failure. `vehicles.functions.ts` imported
 * the audit helper, which imported `@tanstack/react-start/server`, which the
 * import-protection plugin denies in the client environment — so the route's
 * client chunk was simply never emitted. The build stayed green, the server
 * rendered the page, and nothing hydrated: links worked because they are
 * anchors, every button was dead.
 *
 * That failure mode is invisible to a typecheck and to any test that reads
 * source. The only reliable signal is the build output, so this compares the
 * route files against the chunks that were actually emitted. It is the whole
 * class, not the one module that happened to break.
 *
 * Needs `npm run build` first; says so rather than passing quietly.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const ASSETS = ".output/public/assets";
console.log("EVERY INTERACTIVE ROUTE SHIPS A CLIENT CHUNK");
if (!existsSync(ASSETS)) {
  console.log("  SKIP  no build output. Run `npm run build` first — this check reads");
  console.log("        .output/public/assets, which is the only place the missing-chunk");
  console.log("        failure is visible.");
  process.exit(0);
}

const chunks = readdirSync(ASSETS).filter((f) => f.endsWith(".js"));
// Vite replaces the $ of a dynamic segment with _ in the chunk name.
const chunkFor = (base) =>
  chunks.some((c) => new RegExp(`^${base.replace(/\$/g, "_").replace(/\./g, "\\.")}-[A-Za-z0-9_-]+\\.js$`).test(c));

const routes = readdirSync("src/routes")
  .filter((f) => f.endsWith(".tsx") && f !== "__root.tsx")
  .sort();

for (const f of routes) {
  const src = readFileSync(`src/routes/${f}`, "utf8");
  const base = f.replace(/\.tsx$/, "");
  // A route with no component renders nothing and needs no bundle.
  const interactive = /component:/.test(src);
  if (!interactive) {
    console.log(`  n/a   ${f} — no component (redirect or loader only)`);
    continue;
  }
  ok(chunkFor(base), `${f} hydrates`);
}

console.log("\nNO SERVER-ONLY IDENTIFIER REACHED THE BROWSER");
{
  const all = chunks.map((c) => readFileSync(`${ASSETS}/${c}`, "utf8")).join("\n");
  for (const id of [
    "supabaseAdmin",
    "SUPABASE_SERVICE_ROLE",
    "service_role",
    "hashResumeToken",
    "resolveResumeToken",
    "issueResumeToken",
  ]) {
    ok(!all.includes(id), `no ${id} in any client chunk`);
  }
  // Any JWT at all: the publishable key is injected at runtime, so a token
  // baked into a chunk is something nobody intended to ship.
  ok(!/eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}/.test(all), "no JWT is baked into a chunk");
}

console.log(fail ? `\n${fail} FAILURE(S)` : "\nall assertions passed");
process.exit(fail ? 1 : 0);
