/**
 * A signed agreement may not carry blanks where its terms belong.
 *
 * The blocker guard validated the row it had just read while the body being
 * stored was the staff member's preview text, rendered minutes earlier with
 * "__________" in the date and address slots. The guard passed and the
 * applicant signed the blanks.
 */
import { readFileSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };
const src = readFileSync("src/lib/agreements.functions.ts", "utf8");
const card = readFileSync("src/components/admin/AgreementsCard.tsx", "utf8");

console.log("THE STORED BODY CANNOT CONTAIN UNRESOLVED BLANKS");
ok(/const BLANK = "_{6,}"/.test(src), "the placeholder is named");
// Updated: the editable draft was intentionally removed — the browser can no
// longer supply contract text, so the server always re-renders and refuses blanks.
ok(!/opts\.body/.test(src), "no browser-supplied body is accepted at all");
ok(/if \(body\.includes\(BLANK\)\) throw/.test(src), "a rendered body still carrying blanks is refused");
ok(!/const body = opts\.body \?\?/.test(src), "  the unconditional override is gone, in any spelling");

console.log("\nA BLOCKED AGREEMENT OFFERS NO SENDABLE DRAFT");
ok(/body: blockers\.length \? null :/.test(src), "the preview withholds the body while blocked");
ok(/blockers/.test(card), "the card reads blockers");
ok(/This agreement cannot be sent yet/.test(card), "  and says so plainly");
// Updated: there is no editable draft; Send is disabled while blocked and the
// server re-checks blockers + fingerprint.
ok(!/<textarea/i.test(card), "  with no editable draft to press Send on");
ok(/canSend: !blockers\.length && !refusal/.test(src), "  and the server marks a blocked agreement unsendable");
ok(/disabled=\{busy \|\| !preview\.canSend/.test(card), "  and the Send button honours it");

console.log("\nDATES COME FROM A LIVE RENTAL, OR THE AGREED FALLBACK");
ok(/\.eq\("status", "active"\)/.test(src), "only an active rental is authoritative");
ok(/\(fromRental \? rental\.end_date : null\) \?\? app\.contract_end_date/.test(src),
   "an open-ended live rental falls back to the agreed end date rather than blocking forever");
ok(/endDate <= startDate/.test(src), "an end on or before the start is a blocker");
ok(/!app\.address \|\|[^\n]*!app\.zip/.test(src), "a missing address is a blocker");
ok(/tab: "payments"/.test(src), "  and the message names where staff can fix it");

console.log("\nAPPLICATION INTENT NEVER BECOMES A CONTRACTUAL DATE");
ok(!/app\.pickup_date/.test(src), "pickup_date is not read");
ok(!/app\.return_date/.test(src), "return_date is not read");
ok(!/expected_duration/.test(src), "expected_duration is not read");

console.log(fail ? `\n${fail} FAILURE(S)` : "\nall assertions passed");
process.exit(fail ? 1 : 0);
