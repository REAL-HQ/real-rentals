/**
 * THE RULE THIS FILE EXISTS FOR:
 *
 *   THE STAGING WORKER TALKS TO STAGING AND NOBODY ELSE. NO PUBLIC
 *   INGRESS, NO SCHEDULED WORK, NO LIVE COMMUNICATION PROVIDER, NO
 *   PRODUCTION DESTINATION, AND NO SECRET IN THE REPOSITORY.
 *
 * A staging eSign run mints signing links and sends them. If the config
 * drifted toward production — a real site URL, a live Resend key, a cron
 * trigger firing archive retry against the wrong database — a synthetic
 * acceptance test would reach a real renter with a real contract. So the
 * config is checked rather than described.
 *
 * Run: node scripts/esign-staging-worker.test.mjs   (npm run test:esign-staging-worker)
 */
import { readFileSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

const PATH = "scripts/esign-staging/worker/wrangler.staging.jsonc";
const raw = readFileSync(PATH, "utf8");
// Strip // comments so the JSONC parses. Nothing here contains a URL inside a
// string that could be mistaken for a comment except https://, so the regex
// is anchored to a line start or whitespace that is not a colon.
const cfg = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"));

const STAGING_REF = "bhpdppyxnkokzhlkgcsc";
const PROD_REF = "yuyzdsnrbfhkmfzpvhwx";

console.log("\nthe backend is staging, and only staging");
for (const k of ["SUPABASE_URL", "VITE_SUPABASE_URL"])
  ok(String(cfg.vars?.[k] ?? "").includes(STAGING_REF), `${k} names the staging project (${cfg.vars?.[k]})`);
for (const k of ["SUPABASE_PROJECT_ID", "VITE_SUPABASE_PROJECT_ID"])
  ok(cfg.vars?.[k] === STAGING_REF, `${k} = ${cfg.vars?.[k]}`);
ok(!raw.includes(PROD_REF), "the production project ref appears nowhere in the config");

console.log("\nno production destination");
for (const host of ["drivereal.com", "www.drivereal.com", PROD_REF + ".supabase.co"])
  ok(!raw.includes(host), `no reference to ${host}`);
for (const k of ["PUBLIC_SITE_URL", "SITE_URL"]) {
  const v = String(cfg.vars?.[k] ?? "");
  ok(v.length > 0, `${k} is set`);
  ok(!/drivereal\.com/.test(v), `  ${k} does not point at the live site (${v})`);
  ok(/\.invalid$|staging/i.test(v), `  ${k} is unmistakably a staging host (${v})`);
}

console.log("\nno public ingress");
ok(cfg.workers_dev === false, "workers_dev is false");
ok(cfg.preview_urls === false, "preview_urls is false");
ok(Array.isArray(cfg.routes) && cfg.routes.length === 0, "routes is empty");
ok(cfg.route === undefined, "no single-route shorthand");
ok(cfg.zone_id === undefined && cfg.zone_name === undefined, "no zone binding");

console.log("\nno scheduled work");
ok(cfg.triggers === undefined, "no triggers block");
ok(!/\bcrons?\b/.test(raw.replace(/^\s*\/\/.*$/gm, "")), "no cron schedule anywhere in the config");

console.log("\ncommunications are capture-only");
ok(cfg.vars?.ESIGN_DELIVERY_MODE === "capture_only", "delivery mode is capture_only");
ok(cfg.vars?.EMAIL_CAPTURE_ONLY === "1", "email capture-only flag is set");
ok(cfg.vars?.SMS_CAPTURE_ONLY === "1", "sms capture-only flag is set");

console.log("\nno secret is committed");
// A key would arrive as a var; secrets belong in `wrangler secret put`.
const SECRET_KEYS = [
  "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY",
  "RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "RESEND_INBOUND_API_KEY", "RESEND_INBOUND_WEBHOOK_SECRET",
  "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "TWILIO_MESSAGING_SERVICE_SID",
  "STRIPE_SECRET_KEY", "ANTHROPIC_API_KEY", "DATABASE_URL",
];
for (const k of SECRET_KEYS) ok(cfg.vars?.[k] === undefined, `${k} is not a committed var`);
for (const shape of [/\bsb_secret_[A-Za-z0-9_-]{10,}/, /\bre_[A-Za-z0-9]{20,}/, /\bSK[0-9a-f]{30,}/, /\bsk_live_[A-Za-z0-9]{10,}/, /\beyJ[A-Za-z0-9_-]{30,}\./])
  ok(!shape.test(raw), `no credential matching ${shape} in the file`);

console.log("\nthe app code is not forked for staging");
{
  // The staging Worker must run the same bundle as production. If this
  // config ever names a different entrypoint, the acceptance run stops
  // proving anything about what would ship.
  ok(cfg.main === "index.mjs", `entrypoint is the ordinary build output (${cfg.main})`);
  ok(cfg.assets?.directory === "../public", "assets come from the ordinary build output");
  ok(Array.isArray(cfg.compatibility_flags) && cfg.compatibility_flags.includes("nodejs_compat"),
    "nodejs_compat is kept, as the production config has it");
}

console.log("\nthe README does not contradict the config");
{
  const readme = readFileSync("scripts/esign-staging/worker/README.md", "utf8");
  ok(/Google/.test(readme), "the Google access gate is documented");
  ok(/Cloudflare Access/.test(readme), "  as a Cloudflare Access application");
  const flat = readme.replace(/\s+/g, " ");
  ok(/no global auth settings are touched|left exactly as they are/i.test(flat),
    "and it says global Auth settings are untouched");
  ok(!new RegExp(PROD_REF).test(readme), "the README names no production project ref");
}

console.log(fail ? `\n${fail} BLOCKER(S)` : "\nall staging worker checks pass");
process.exit(fail ? 1 : 0);
