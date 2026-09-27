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

console.log("\nAN ANONYMOUS DEDUPE MATCH YIELDS NO CREDENTIAL");
const save = src.slice(src.indexOf("export const savePartialApplication"), src.indexOf("export const updateApplicationStep"));
const dedupe = save.slice(save.indexOf("if (existing) {"), save.indexOf("const { data: row, error }"));
ok(!/issueResumeToken/.test(dedupe), "the dedupe branch never mints a token");
ok(/token: null/.test(dedupe), "  it returns a null token");
ok(/sendApplicationResumeEmail/.test(dedupe), "  and mails the link instead");
ok(/\.select\("email, full_name"\)[\s\S]{0,200}sendApplicationResumeEmail/.test(dedupe),
   "  to the address on the matched record, not the submitted one");
ok(/IDENTITY = new Set\(\["full_name", "phone", "email"\]\)/.test(dedupe),
   "identity fields are excluded from the patch");
ok(/if \(IDENTITY\.has\(k\)\) continue;/.test(dedupe), "  and skipped when building it");
ok(/submitted_full_name|submitted_email/.test(dedupe), "  but recorded in resubmission_history");

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
