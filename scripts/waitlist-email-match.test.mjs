/**
 * The public waitlist duplicate check must not treat _ or % as wildcards.
 * No SQL and no network. This is a live behavior change.
 */
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const out = mkdtempSync(join(tmpdir(), "rr-waitlist-email-"));
let passed = 0;
function check(cond, label) {
  assert.equal(cond, true, label);
  passed += 1;
  console.log("PASS", label);
}

try {
  await build({
    entryPoints: ["src/lib/waitlist.functions.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(out, "handler.mjs"),
    alias: { "@": resolve("src") },
    plugins: [{
      name: "stub-server",
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => {
          if (args.path === "zod") return null;
          if (args.path.startsWith("@/") || args.path.startsWith("@tanstack/")) {
            return { path: args.path, namespace: "stub" };
          }
        });
        b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
          contents: `
            export const createServerFn = () => {
              const api = { middleware: () => api, inputValidator: () => api, handler: (fn) => fn };
              return api;
            };
            export const requireSupabaseAuth = {};
            export const requireStaff = async () => ({});
            export const requireManager = async () => ({});
            export const logAudit = async () => {};
            export const completeRead = async () => [];
            export const readInBatches = async () => [];
          `,
          loader: "js",
        }));
      },
    }],
  });
  const { literalIlike } = await import(pathToFileURL(join(out, "handler.mjs")).href);

  check(literalIlike("sam_rivera%@example.com") === "sam\\_rivera\\%@example.com", "underscore and percent are escaped");
  check(literalIlike("a\\b") === "a\\\\b", "a backslash is escaped before the wildcard escapes");
  check(literalIlike("sam@example.com") === "sam@example.com", "a plain address is unchanged");

  const fn = readFileSync("src/lib/waitlist.functions.ts", "utf8");
  const duplicate = fn.slice(fn.indexOf("const { data: existing }"), fn.indexOf("if (existing?.length)"));
  check(duplicate.includes("literalIlike(data.email)"), "joinWaitlist escapes the duplicate-email filter");
  check(!duplicate.includes('.ilike("email", data.email)'), "the duplicate check does not pass the raw address to ilike");
  const conflict = fn.slice(fn.indexOf("phone conflict review"));
  check(conflict.includes('.ilike("email", w.email.trim())'), "the conflict resolver lookup is unchanged");

  console.log(`${passed} email match checks passed`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
