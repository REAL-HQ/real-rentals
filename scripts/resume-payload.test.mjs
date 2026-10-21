/**
 * What a resume token is allowed to see, and what an anonymous form post can
 * make happen. Source-level where the shape is the control, executed where
 * behaviour is.
 */
import { readFileSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };
const src = readFileSync("src/lib/applications.functions.ts", "utf8");
const payload = src.slice(
  src.indexOf("export const getApplicationForWizard"),
  src.indexOf("/**\n * Hand the browser a one-time signed URL"),
);
// Only the object literal the handler returns, not the classification comment.
const returned = payload.slice(payload.indexOf("    return {"));

console.log("THE RESUME PAYLOAD RETURNS NO SENSITIVE VALUE");
for (const [field, why] of [
  ["insurance_policy_number", "policy number"],
  ["license_number", "licence number"],
  ["license_state", "licence state"],
  ["license_expiration", "licence expiry"],
  ["dob", "date of birth"],
  ["email", "email"],
  ["phone", "phone"],
  ["notes", "staff notes"],
  ["doc_request_note", "staff note"],
  ["ai_summary", "AI assessment"],
  ["ai_score", "AI score"],
  ["ai_tier", "AI tier"],
  ["ai_flags", "AI flags"],
  ["score", "legacy score"],
  ["status", "application status"],
  ["user_id", "linked account"],
  ["card_last4", "payment detail"],
  ["stripe_customer_id", "payment identifier"],
  ["weekly_rent", "commercial terms"],
  ["deposit_amount", "commercial terms"],
  ["contract_start_date", "contract date"],
  ["contract_end_date", "contract date"],
  ["reviewed_by", "internal review"],
  ["primary_application_id", "internal id"],
  ["market_id", "internal id"],
]) {
  ok(!new RegExp(`^\\s*${field}:`, "m").test(returned), `does not return ${why} (${field})`);
}
ok(!/^\s*id:/m.test(returned), "does not return the application id");

console.log("\nDOCUMENTS ARE PRESENCE, NOT PATHS");
for (const f of ["license_photo_url", "insurance_doc_url", "profile_screenshot_url"]) {
  ok(!new RegExp(`^\\s*${f}:`, "m").test(returned), `no storage path for ${f}`);
}
for (const f of ["license_photo_on_file", "insurance_doc_on_file", "profile_screenshot_on_file"]) {
  ok(new RegExp(`^\\s*${f}:`, "m").test(returned), `  presence flag ${f} is returned instead`);
}
ok(/trip_screenshot_names:.*split\("\/"\).pop/.test(returned.replace(/\n/g, " ")),
   "trip screenshots return display names only, never their folder");
ok(!/^\s*trip_screenshots:/m.test(returned), "  and never the stored array");

console.log("\nTHE POLICY NUMBER IS MASKED, NOT RETURNED");
ok(/insurance_policy_last4: lastFour/.test(returned), "only the last four are returned");
ok(/insurance_policy_on_file: Boolean/.test(returned), "  with a flag so the UI can say Already Provided");
const wiz = readFileSync("src/components/site/ApplicationWizard.tsx", "utf8");
ok(/Already Provided/.test(wiz), "the wizard says Already Provided");
ok(/insurance_policy_last4/.test(wiz), "  and shows the last four");
ok(/setReplacingPolicy\(true\)/.test(wiz), "  with an Update action to replace it");
ok(/state\.insurance_policy_number\s*\n?\s*\?\s*\{ insurance_policy_number/.test(wiz.replace(/\s+/g, " ").replace(/ /g, " ")) ||
   /\.\.\.\(state\.insurance_policy_number/.test(wiz),
   "  and only sends a policy number when one was typed");

console.log("\nA NEW COLUMN CANNOT WANDER INTO THE PAYLOAD");
{
  /*
   * The query names its columns. A column added to `applications` tomorrow —
   * a staff note, a risk score, a partner's identifier — is not selected, so
   * it cannot be returned by accident. The only way in is to write its name
   * in RESUME_COLUMNS, which is a decision somebody has to make on purpose.
   */
  ok(/\.select\(RESUME_COLUMNS\.join\(","\)\)/.test(payload),
     "the query selects an explicit column list");
  ok(!/\.select\(\s*["'`]\*/.test(payload), "  and never select(*)");
  const listed = (src.match(/const RESUME_COLUMNS = \[([\s\S]*?)\] as const;/) ?? [])[1] ?? "";
  const names = [...listed.matchAll(/"([a-z_0-9]+)"/g)].map((m) => m[1]);
  ok(names.length > 0 && names.length <= 30,
     `RESUME_COLUMNS names ${names.length} columns, not a table`);
  // Four of them are read only so they can be reduced to a flag, a last four
  // or a filename. Those must not be returned under their own names, which
  // the section above already asserts one by one.
  for (const reduced of ["insurance_policy_number", "license_photo_url",
                         "insurance_doc_url", "profile_screenshot_url", "trip_screenshots"]) {
    ok(names.includes(reduced), `  ${reduced} is read (to be reduced, not returned)`);
  }
}

console.log("\nAN ANONYMOUS DEDUPE MATCH YIELDS NO CREDENTIAL");
const save = src.slice(src.indexOf("export const savePartialApplication"), src.indexOf("export const updateApplicationStep"));
const dedupe = save.slice(save.indexOf("if (existing) {"), save.indexOf("const { data: row, error }"));
ok(!/issueResumeToken/.test(dedupe), "the dedupe branch never mints a token");
ok(/token: null/.test(dedupe), "  it returns a null token");
// The send moved into emailLinkToAddressOnFile, which the same-email path
// reaches through sendRecoveryLink. The handler no longer names the mailer,
// so the check follows the helper: it still has to read the address on the
// matched row and send there, not to whatever the form submitted.
ok(/sendRecoveryLink\(/.test(dedupe), "  and mails the link instead");
const mailer = src.slice(
  src.indexOf("async function emailLinkToAddressOnFile"),
  src.indexOf("async function sendRecoveryLink"),
);
ok(/\.select\("email, full_name"\)[\s\S]{0,500}sendApplicationResumeEmail\(\{ to: onFile\.email/.test(mailer),
   "  to the address on the matched record, not the submitted one");
// Stronger than excluding the identity fields, which is what this used to
// check: nothing the caller submitted is applied to a record they merely
// matched. sms_consent was the one that mattered — an anonymous POST could
// flip a stranger's recorded consent — but city, state, pickup date, market
// and the attribution set all went the same way.
//
// The first `.eq("id", primaryId)` in this branch is the history read for a
// phone conflict, which now sits above the update. Slicing from the update to
// that eq produced an empty string and the check passed without seeing a
// write. Read the update objects themselves: the inline conflict update, and
// the helper the same-email path calls.
const conflictUpdates = [...dedupe.matchAll(/\.update\(\{([\s\S]*?)\}\s*as any\)/g)].map((m) => m[1]);
const recovery = src.slice(
  src.indexOf("async function sendRecoveryLink"),
  src.indexOf("export const requestApplicationLink"),
);
const recoveryUpdate = (recovery.match(/\.update\(\{([\s\S]*?)\}\s*as any\)/) ?? [])[1] ?? "";
const written = [...(conflictUpdates[0] ?? "").matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]).sort();
ok(conflictUpdates.length === 1 && recoveryUpdate.includes("resubmission_history") && recoveryUpdate.includes("...extra"),
   "the conflict path updates once, and recovery writes history plus the caller's extra columns");
ok(String(written) === "resubmission_count,resubmission_history,updated_at",
   `the patch writes only the counter and the history (writes: ${written.join(", ") || "nothing"})`);
const extraArg = dedupe.slice(dedupe.lastIndexOf("{ resubmission_count"), dedupe.indexOf(");", dedupe.lastIndexOf("{ resubmission_count")));
ok(/^[\s\S]*resubmission_count:[\s\S]*updated_at:[\s\S]*$/.test(extraArg) && !/[a-z_]+:/.test(extraArg.replace(/resubmission_count:|updated_at:/g, "")),
   "  recovery is asked to set only the counter and the timestamp");
const patch = conflictUpdates.join("\n") + "\n" + recoveryUpdate + "\n" + extraArg;
ok(!/data\.(full_name|phone|email|sms_consent|city|state|market_id|pickup_date|source|referrer|landing_page|gclid|utm_)/.test(patch),
   "  no submitted field reaches the matched row");
ok(/submitted_full_name|submitted_email/.test(dedupe), "  but recorded in resubmission_history");
const recoveryMod = readFileSync("src/lib/application-recovery.server.ts", "utf8");
const recoverySql = readFileSync("drizzle/migrations/0023_application_resume_atomic_security.sql", "utf8");
ok(/applicationResumeAtomicEnabled\(\)/.test(recovery) && /sendAtomicRecoveryLink\(/.test(src),
   "atomic recovery runs only when the flag is on");
ok(!/reserve_application_recovery|finish_application_recovery/.test(src),
   "the history module does not name the reservation RPCs");
ok(/to: attempt\.email/.test(recoveryMod) && /'email', a\.email/.test(recoverySql),
   "atomic delivery mails the address on the locked record");
ok(/APPLICATION_RESUME_ATOMIC_ENABLED === "true"/.test(recoveryMod),
   "atomic delivery stays off unless the flag is exactly true");

console.log("\nUPLOAD AUTHORIZATION");
const upRaw = src.slice(src.indexOf("export const requestUploadUrl"), src.indexOf("export const reissueApplicantLink"));
// Code only. A comment explaining why a category is unreachable is not the
// category being reachable.
const up = upRaw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
ok(/resolveResumeToken\(supabaseAdmin, data\.token\)/.test(up), "a valid resume token is required");
ok(/\.eq\("id", id\)/.test(up), "  and the application comes from the token, not the caller");
ok(/z\.enum\(\["license", "insurance", "gig_profile", "trip_history"\]\)/.test(up),
   "the document category is an allowlist");
ok(!/verification_recording/.test(up), "  and cannot be verification_recording");
ok(/z\.enum\(\["jpg", "jpeg", "png", "webp", "heic", "heif", "pdf"\]\)/.test(up),
   "the extension is an explicit MIME-shaped allowlist");
ok(/const path = `\$\{id\}\//.test(up), "the path is server-generated under the application's own folder");
ok(!/data\.path|data\.bucket|data\.filename/.test(up), "  nothing about the destination comes from the caller");
ok(/decided\.includes/.test(up), "a decided application stops accepting uploads");
ok(/MAX_GRANTS_PER_WINDOW/.test(up), "issuance is rate limited");
ok(/applicant_upload_grants/.test(up), "  against a durable record");

console.log(fail ? `\n${fail} FAILURE(S)` : "\nall assertions passed");
process.exit(fail ? 1 : 0);
