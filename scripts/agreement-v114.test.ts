// v1.14 Insurance Included agreement. Run: bun scripts/agreement-v114.test.ts [out.pdf]
import { readFileSync, writeFileSync } from "fs";
import { LIBRARY, libraryTemplate, acknowledgmentsOf } from "../src/lib/agreement-library";
import { V114_SOURCE } from "../src/lib/agreement-v114";
import { readTerms, resolveTerms, stripTerms, termsIn, unknownTermsIn, writeTerms } from "../src/lib/agreement-builder";
import { MERGE_FIELDS, renderTemplate } from "../src/lib/agreement-merge";
import { parseLayout } from "../src/lib/agreement-layout";
import { applyPrep, EMPTY_PREP, PrepSchema } from "../src/lib/agreement-prep";
import { applyRentalTerms, EMPTY_RENTAL_TERMS, POLICY_PENDING, type RentalTerms } from "../src/lib/agreement-rental-terms";
import { renderPreviewPdf } from "../src/lib/esign-pdf.server";

let fail = 0;
const ok = (c: unknown, m: string) => { console.log(c ? "  ok  " : "  FAIL", m); if (!c) fail++; };

console.log("WORDING");
const t = libraryTemplate("insurance_included")!;
ok(t && t.displayVersion === "1.14" && t.insuranceIncluded && !t.insuranceRequired, "family insurance_included v1.14");
const blocks = parseLayout(t.body);
ok(blocks.filter((b) => b.k === "h2").length === 33, "28 numbered sections + 5 headed blocks");
ok(blocks.filter((b) => b.k === "page").length === 2 && blocks.filter((b) => b.k === "sig").length === 1, "two page breaks, one signature block");
const acks = acknowledgmentsOf(t.body);
ok(acks.length === 16, "16 initials: Damage Waiver + 15 section initials lines");
ok(acks[0].startsWith("Optional Damage Waiver ($35 per week, Section 7.5)"), "Damage Waiver choice is initialed");
for (const n of ["3", "4", "5", "6", "7", "8", "10", "14", "15", "17.2", "20", "21", "22", "23", "27"])
  ok(acks.some((a) => a.startsWith(`Section ${n}`)), `initials line after Section ${n}`);
const known = new Set(MERGE_FIELDS.map((f) => f.key));
ok([...V114_SOURCE.matchAll(/\{\{(\w+)\}\}/g)].every((m) => known.has(m[1])), "every merge field is known");
ok(unknownTermsIn(V114_SOURCE).length === 0 && termsIn(V114_SOURCE).sort().join() === "min_term_weeks,min_term_words,reservation_line,service_area", "template values: minimum term, reservation fee, service area");
ok(!/[☐☐]/.test(V114_SOURCE) && !/[^\x00-\x7E§]/.test(V114_SOURCE.replace(/—/g, "")), "only characters the PDF font prints");
// Distinctive sentences from the PDF, verbatim.
for (const s of [
  "is primary for the limits of liability and personal injury protection coverage required by ss. 324.021(7) and 627.736, Florida Statutes.",
  "There is no security deposit. If a charge is declined, you authorize us to retry it",
  "| Late payment | $50 for each day a payment is late",
  "| Additional approved driver | $50 per week, per driver, + any added Renter Policy premium",
  "| Unauthorized driver or subleasing | $500 per occurrence + all resulting losses",
  "We set it up after you sign this Agreement, and you may not take or drive the Vehicle until we tell you it is in effect.",
  "REAL RENTALS is not an insurance company or insurance agent and does not guarantee that any claim will be paid.",
  "h. give the insurance company and its agents the information they need",
  "The Damage Waiver is not insurance. It is our agreement to give up our right to collect from you for damage to the Vehicle.",
  "| You pay the full cost | You pay $0. No deductible.",
  "under Section 934.425, Florida Statutes",
  "For non-payment, we will do so only when a payment is more than 48 hours past due and after texting or emailing you at least 24 hours ahead.",
  "are evidence of abandonment or refusal to redeliver the property, punishable in accordance with section 812.155, Florida Statutes.",
  "The parties intend that 49 U.S.C. § 30106 applies to this rental.",
  "is limited to the rent you paid in the 4 weeks before the claim arose.",
  "Before disputing any charge with your bank or card company, you will contact us at {{company_email}} and give us 10 business days to resolve it.",
  "under the federal ESIGN Act and Section 668.50, Florida Statutes.",
  "YOU AND REAL RENTALS EACH KNOWINGLY AND VOLUNTARILY WAIVE ANY RIGHT TO A TRIAL BY JURY",
  "**Vehicle Owner.** Any Vehicle Owner is a Protected Party and may enforce Sections 7, 20, and 21.",
  "| Insurance ID Card & Registration in Vehicle (Y/N) |",
]) ok(V114_SOURCE.includes(s), `verbatim: ${s.slice(0, 70)}`);
ok(readTerms(t.body)!.min_term_weeks === "4" && readTerms(t.body)!.min_term_words === "four (4)" && readTerms(t.body)!.service_area === "", "minimum term 4 weeks; Service Area left for the Owner");

console.log("RENTAL TERMS (staff entries)");
const ctx = { startIso: "2026-11-17", weeklyRate: 325, todayIso: "2026-11-12" };
const full: RentalTerms = {
  ...EMPTY_RENTAL_TERMS, startTime: "10:00", schedule: "weekly", paymentMethod: "card_autopay",
  platforms: { rideshare: true, delivery: false }, damageWaiver: "accepted", vehicleOwner: "REAL RENTALS LLC",
  licenseInspectedBy: "Sam Staff", licenseInspectedOn: "2026-11-12",
};
let r = applyRentalTerms(null, ctx);
ok(r.blockers.length === 1 && r.blockers[0].field === "rental_terms", "no entries: one blocker, nothing printed");
r = applyRentalTerms(EMPTY_RENTAL_TERMS, ctx);
ok(["start_datetime", "payment_schedule", "damage_waiver", "payment_method", "platform_use", "vehicle_owner", "license_inspected"].every((f) => r.blockers.some((b) => b.field === f)), "every missing entry blocks");
r = applyRentalTerms(full, ctx);
ok(!r.blockers.length, "complete entries: no blockers");
ok(r.merge.start_datetime === "Nov 17, 2026, 10:00 AM", `start date & time (${r.merge.start_datetime})`);
ok(r.merge.amount_due === "$360.00 / Tuesday", `weekly rate + $35 waiver, due on the start weekday (${r.merge.amount_due})`);
ok(r.merge.payment_schedule === "Weekly" && r.merge.payment_method === "Card Autopay", "schedule and method");
ok(r.merge.platform_use === "[X] Rideshare (Uber, Lyft)   [ ] Delivery" && r.merge.damage_waiver === "[X] Accepted   [ ] Declined", "checkboxes");
ok(r.merge.license_inspected === "Sam Staff / Nov 12, 2026" && r.merge.vehicle_owner === "REAL RENTALS LLC", "inspection and owner");
ok(r.merge.renter_policy === POLICY_PENDING && r.merge.renter_policy_dates === POLICY_PENDING, "policy not yet bound prints Section 5.1 status");
r = applyRentalTerms({ ...full, schedule: "every_4_weeks", damageWaiver: "declined" }, ctx);
ok(r.merge.amount_due === "$1,300.00 / Tuesday, every 4 weeks" && r.merge.damage_waiver === "[ ] Accepted   [X] Declined", `4-week schedule without waiver (${r.merge.amount_due})`);
r = applyRentalTerms(full, { ...ctx, weeklyRate: null });
ok(r.merge.amount_due === "", "no weekly rate on record: amount left blank (blocks via template field check)");
r = applyRentalTerms({ ...full, startTime: "25:00" }, ctx);
ok(r.blockers.some((b) => b.field === "start_datetime") && r.merge.start_datetime === "", "invalid time blocks");
r = applyRentalTerms({ ...full, paymentMethod: "other", paymentMethodOther: "" }, ctx);
ok(r.blockers.some((b) => b.field === "payment_method"), "Other needs a name");
r = applyRentalTerms({ ...full, paymentMethod: "other", paymentMethodOther: "Check" }, ctx);
ok(r.merge.payment_method === "Other: Check", "Other prints its name");
r = applyRentalTerms({ ...full, licenseInspectedOn: "2026-11-13" }, ctx);
ok(r.blockers.some((b) => b.field === "license_inspected") && r.merge.license_inspected === "", "future inspection date blocks");
r = applyRentalTerms({ ...full, licenseInspectedBy: "Sam" }, ctx);
ok(r.blockers.some((b) => b.field === "license_inspected"), "inspector needs a full name");
r = applyRentalTerms({ ...full, policyCompany: "Acme Mutual" }, ctx);
ok(r.blockers.some((b) => b.field === "renter_policy"), "half-entered policy blocks");
r = applyRentalTerms({ ...full, policyCompany: "Acme Mutual", policyNumber: "P-1", policyEffective: "2026-11-17", policyClaimsPhone: "800-555-0100" }, ctx);
ok(!r.blockers.length && r.merge.renter_policy === "Acme Mutual / P-1" && r.merge.renter_policy_dates === "Nov 17, 2026 / 800-555-0100", "bound policy prints");
ok(PrepSchema.safeParse({ ...EMPTY_PREP, rental: full }).success && PrepSchema.safeParse(EMPTY_PREP).success, "schema accepts with and without rental terms");
ok(applyPrep(EMPTY_PREP, { startIso: "2026-11-17", depositClause: "" }).merge._prep === JSON.stringify(EMPTY_PREP), "other templates' recorded prep is unchanged (no rental key)");

console.log("OTHER FAMILIES UNCHANGED");
for (const k of ["no_insurance", "insurance_required"]) {
  const o = LIBRARY.find((x) => x.key === k)!;
  ok(!/start_datetime|damage_waiver|renter_policy|toll_transponder/.test(o.source), `${k}: no v1.14 fields`);
}

console.log("SERVER WIRING");
const agr = readFileSync("src/lib/agreements.functions.ts", "utf8");
const prepFn = agr.slice(agr.indexOf("async function prepareAgreement"));
ok(prepFn.indexOf("insuranceIncludedTerms(prep, built)") > 0 && prepFn.indexOf("insuranceIncludedTerms(prep, built)") < prepFn.indexOf("templateFieldBlockers("), "v1.14 entries applied before the template field check");
ok(/v1\.14 has an Additional Driver signature line/.test(agr) && /v1\.14 says there is no security deposit/.test(agr), "additional drivers and deposits refused for v1.14");
ok(/need\[k\] = \{ label, why: v114 \}/.test(agr), "blank v1.14 fields block every path (incl. approval auto-send)");
ok(/toll_transponder_id/.test(agr) && /"None on file"/.test(agr), "toll transponder from the vehicle record");
ok(/approvalStatus: "draft"/.test(agr) && /numberingPending/.test(agr), "still unsendable: library draft and agreement numbering refusals unchanged");

console.log("RENDER");
const terms = { ...readTerms(t.body)!, service_area: "Tampa Bay area, Florida", reservation_line: "None" };
const body = writeTerms(stripTerms(t.body), terms);
const sample: Record<string, string> = {
  company_name: "REAL RENTALS LLC", company_address: "19046 Bruce B Downs Blvd, STE B6 #890, Tampa, FL 33647", company_email: "team@drivereal.com", company_phone: "(888) 833-8280",
  agreement_number: "Assigned When Sent", driver_name: "Sample Renter", driver_phone: "(813) 555-0100", driver_email: "renter@example.com",
  license_number: "S123-456-78-900-0", license_state: "FL", license_expiration: "Jan 1, 2030", driver_dob: "Jan 2, 1990",
  driver_address: "1 Sample St, Tampa, FL, 33601", vehicle: "2022 Toyota Camry SE", vehicle_color: "Silver", vehicle_vin: "4T1G11AK0NU000000",
  license_plate: "ABC1234 / FL", weekly_rate: "$325", min_term_end: "Dec 15, 2026", card_on_file: "VISA ending 4242",
  additional_drivers: "None Authorized", toll_transponder: "None on file", ...applyRentalTerms(full, ctx).merge,
};
const rendered = renderTemplate(resolveTerms(body), sample);
ok(!rendered.includes("__________"), "complete data: no blanks");
const pdf = await renderPreviewPdf({ title: "Vehicle Rental Agreement", body: rendered, fingerprint: "0".repeat(64), templateLabel: "Vehicle Rental Agreement — Insurance Included v1.14 — Sample Fields", companySignerName: "Sample Owner", companySignerTitle: "Owner", generatedAt: "2026-11-12T15:00:00Z" });
const pages = (Buffer.from(pdf).toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
ok(pdf.length > 20000 && pages >= 10, `renders through the eSign PDF renderer (${pages} pages)`);
if (process.argv[2]) { writeFileSync(process.argv[2], pdf); console.log(`  wrote ${process.argv[2]}`); }

if (fail) { console.error(`${fail} failed`); process.exit(1); }
console.log("ALL PASS");
