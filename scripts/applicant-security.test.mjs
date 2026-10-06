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
  const ALLOWED = ["src/components/site/Nav.tsx", "src/lib/esign.server.ts", "src/routes/api/public/payments/webhook.ts"];
  const unexpected = offenders.filter((o) => !ALLOWED.some((a) => o.startsWith(a)));
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
  const ANONYMOUS_BY_DESIGN = new Set(["savePartialApplication"]);
  let checked = 0;
  for (let i = 1; i < parts.length; i += 2) {
    const [name, body] = [parts[i], parts[i + 1]];
    checked++;
    if (ANONYMOUS_BY_DESIGN.has(name)) {
      ok(true, `${name} is anonymous by design (the public lead form)`);
      continue;
    }
    // Either spelling — updateApplicationStep destructures `token` out of
    // `data` before resolving it — but the argument must still be the one
    // that came off the request body, never an id.
    const tokenGated = /resolveResumeToken\(supabaseAdmin, (data\.token|token)\)/.test(body);
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
