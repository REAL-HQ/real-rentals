/**
 * Controls on what an anonymous applicant can push into a query.
 *
 * The lead form is the one endpoint on this system that an unauthenticated
 * stranger can POST to, and its payload reaches duplicate detection, which
 * decides whose application row gets patched. These assertions run the real
 * validator; the source guard below covers the query-construction half.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { applicantPhone } from "../.readiness-build/applicant-validation.js";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

console.log("THE PHONE FIELD CANNOT CARRY QUERY SYNTAX");
for (const hostile of [
  "1234567,status.eq.new",
  "1234567,id.gte.0",
  "1234567,status.neq.zzz",
  "*,status.eq.approved",
  "1234567)&limit=1",
  "1234567,or(id.gte.0)",
  '1234567,phone.like."%"',
  "1234567\nstatus.eq.new",
]) {
  ok(!applicantPhone.safeParse(hostile).success, `rejected: ${JSON.stringify(hostile)}`);
}

console.log("\nAND STILL ACCEPTS A PHONE NUMBER");
for (const good of [
  "8135551234",
  "+1 (813) 555-1234",
  "813-555-1234",
  "813.555.1234",
  " 813 555 1234 ",
  "+447700900123",
]) {
  ok(applicantPhone.safeParse(good).success, `accepted: ${JSON.stringify(good)}`);
}
ok(!applicantPhone.safeParse("12345").success, "too short is still rejected");
ok(!applicantPhone.safeParse("1".repeat(31)).success, "too long is still rejected");

console.log("\nNO APPLICANT INPUT IS SPLICED INTO A POSTGREST FILTER");
{
  const walk = (dir) => {
    const out = [];
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else if (/\.tsx?$/.test(name)) out.push(p);
    }
    return out;
  };
  // `.or(`…${…}…`)` — a template literal with a substitution, inside a filter.
  const offenders = [];
  for (const file of walk("src")) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        // A comment describing the old bug is not the old bug.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (/\.(or|filter)\(\s*`[^`]*\$\{/.test(line)) offenders.push(`${file}:${i + 1} ${line.trim()}`);
      });
  }
  // Nav.tsx composes a filter from the signed-in user's own auth UUID, which is
  // issued by Supabase and never attacker-chosen. Listed so that a NEW one
  // shows up here rather than hiding in a count.
  // esign.server.ts interpolates a server-computed ISO timestamp; the payments
  // webhook interpolates a Stripe id from a signature-verified event and a
  // status from a fixed enum. None is applicant input.
  // fleet-inbox.functions.ts interpolates a stored VIN only after an
  // alphanumeric whitelist plus a DB uuid; safe-autofill.server.ts a column
  // name from the fixed AUTO_FIELDS list; photo-enhance.functions.ts a
  // server-computed ISO timestamp.
  const ALLOWED = ["src/components/site/Nav.tsx", "src/lib/esign.server.ts", "src/routes/api/public/payments/webhook.ts", "src/lib/fleet-inbox.functions.ts", "src/lib/safe-autofill.server.ts", "src/lib/photo-enhance.functions.ts"];
  // Two lines in lead-priorities.functions.ts interpolate `today`. That value
  // is leadToday() in src/lib/lead-priorities.ts: an America/New_York
  // YYYY-MM-DD built from Intl.DateTimeFormat parts, not a request field.
  // A hyphen is not a PostgREST clause separator. Any other interpolation in
  // that file is still a finding.
  const leadSrc = readFileSync("src/lib/lead-priorities.functions.ts", "utf8");
  const leadPure = readFileSync("src/lib/lead-priorities.ts", "utf8");
  ok(/const today = leadToday\(\)/.test(leadSrc), "lead priorities date is leadToday()");
  ok(/export function leadToday/.test(leadPure) && /LEAD_TIME_ZONE = "America\/New_York"/.test(leadPure) && /timeZone: LEAD_TIME_ZONE/.test(leadPure),
     "leadToday is the Eastern calendar date");
  // paymentSnapshot interpolates `id` only after /^pi_[A-Za-z0-9]+$/. The
  // handlers that call it throw unless STRIPE_RECONCILIATION_ENABLED === "true".
  const recon = readFileSync("src/lib/stripe-reconciliation.server.ts", "utf8");
  const snap = recon.slice(recon.indexOf("export async function paymentSnapshot"), recon.indexOf("export async function ingestSnapshot"));
  const guardAt = snap.search(/if \(!\/\^pi_\[A-Za-z0-9\]\+\$\/\.test\(id\)\)/);
  const orAt = snap.indexOf(".or(`");
  ok(guardAt >= 0 && orAt > guardAt, "payment intent id is checked for pi_ before the filter");
  ok(/STRIPE_RECONCILIATION_ENABLED !== 'true'/.test(recon), "reconciliation throws unless the flag is exactly true");
  const lineReviewed = (offender) => {
    if (/^src\/lib\/lead-priorities\.functions\.ts:\d+ /.test(offender)) {
      return /q = q\.or\(`contact_follow_up_on\.is\.null,contact_follow_up_on\.gt(?:e)?\.\$\{today\}`\);$/.test(offender);
    }
    if (/^src\/lib\/stripe-reconciliation\.server\.ts:\d+ /.test(offender)) {
      return offender.includes("stripe_payment_intent_id.eq.${id}") && offender.includes("stripe_collection_reference.eq.${id}");
    }
    return false;
  };
  const unexpected = offenders.filter((o) => !ALLOWED.some((a) => o.startsWith(a)) && !lineReviewed(o));
  ok(unexpected.length === 0, `no unreviewed interpolated filter (found ${unexpected.length})`);
  for (const o of unexpected) console.log(`       ${o}`);
}

console.log("\nEVERY APPLICATION ENDPOINT NAMES ITS AUTHORIZATION");
{
  /*
   * An application UUID is not a credential. It appears in staff URLs, in
   * emails and in anything that quotes one, and before the resume tokens
   * three endpoints took one as their only authorization — submit, read the
   * rental info, complete the profile. They are gone, and this is the check
   * that keeps a fourth from appearing: every server function in the module
   * is either token-gated (the applicant), middleware-gated (staff), or one
   * of the named anonymous entry points.
   */
  const src = readFileSync("src/lib/applications.functions.ts", "utf8");
  const parts = src.split(/\nexport const (\w+) = createServerFn/);
  // The public lead forms have to be callable by a stranger: that is what a
  // lead form is. It creates a row, and on a match it writes nothing and
  // returns no token — see resume-payload.test.mjs.
  //
  // requestApplicationLink is the public Continue Application form. It accepts
  // only {email}, returns the same neutral answer for a match, a miss and a
  // recent send, and emails only the address already on file. It is not a
  // credential. Adding middleware would take the form off the public site.
  const ANONYMOUS_BY_DESIGN = new Set(["savePartialApplication", "requestApplicationLink"]);
  let checked = 0;
  for (let i = 1; i < parts.length; i += 2) {
    const [name, body] = [parts[i], parts[i + 1]];
    checked++;
    if (ANONYMOUS_BY_DESIGN.has(name)) {
      ok(true, `${name} is anonymous by design`);
      continue;
    }
    // Either spelling — updateApplicationStep destructures `token` out of
    // `data` before resolving it — but the argument must still be the one
    // that came off the request body, never an id.
    //
    // exchangeResumeToken is the open-link gate (hash lookup, expiry,
    // revocation, then consume a recovery credential before issuing a
    // session). This matches that call. It is not an allowlist of the
    // function name. Recovery links must not pass resolveResumeToken: that
    // function rejects recovery-lifetime tokens, so every emailed link would
    // be refused.
    const tokenGated = /(resolveResumeToken|exchangeResumeToken)\(supabaseAdmin, (data\.token|token)\)/.test(body);
    const staffGated = /\.middleware\(/.test(body);
    ok(tokenGated || staffGated,
       `${name} is ${tokenGated ? "token-gated" : staffGated ? "staff-gated" : "UNGATED"}`);
    // The token-gated ones must take their id from the token, never the caller.
    if (tokenGated) {
      ok(!/data\.(applicationId|application_id|id)\b/.test(body),
         `  and takes no application id from the caller`);
    }
  }
  ok(checked >= 8, `every endpoint in the module was checked (${checked})`);
}

console.log(fail ? `\n${fail} FAILURE(S)` : "\nall assertions passed");
process.exit(fail ? 1 : 0);
