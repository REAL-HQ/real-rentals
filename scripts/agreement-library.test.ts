// Agreement Template Library: run with `bun scripts/agreement-library.test.ts`.
import { LIBRARY, libraryTemplate, acknowledgmentsOf, V110_SOURCE, V1102_INS_SOURCE } from "../src/lib/agreement-library";
import { V16_BODY, readTerms, resolveTerms, unknownTermsIn, writeTerms, stripTerms } from "../src/lib/agreement-builder";
import { MERGE_FIELDS, renderTemplate } from "../src/lib/agreement-merge";
import { parseLayout } from "../src/lib/agreement-layout";

let fails = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) fails++; };

const ni = libraryTemplate("no_insurance")!, ir = libraryTemplate("insurance_required")!;
ok(LIBRARY.length === 3 && new Set(LIBRARY.map((t) => t.key)).size === 3, "three independent template keys");
ok(acknowledgmentsOf(ni.body).length === 13, "No Insurance: 13 acknowledgments");
ok(acknowledgmentsOf(ir.body).length === 15, "Insurance Required: 15 acknowledgments");
ok(acknowledgmentsOf(V16_BODY).length === 13, "existing v1.6 still 13");
ok(ni.body !== ir.body && ni.body !== V16_BODY, "distinct bodies → distinct fingerprints");
ok(V110_SOURCE.includes("(v1.10)") && V1102_INS_SOURCE.includes("(v1.10.2, Insurance Required)"), "titles match the PDFs");
ok(!ni.body.includes("Insurance Verification") && !ni.body.includes("Lapse in Coverage"), "No Insurance has no insurance-required clauses");
ok(!ir.body.includes("does not require you to carry insurance") && !ir.body.includes("If Any"), "Insurance Required has no no-insurance wording");
ok(ni.body.includes("does not require you to carry insurance"), "No Insurance keeps its no-insurance wording");
for (const t of LIBRARY) {
  ok(unknownTermsIn(t.source).length === 0, `${t.key}: all terms known`);
  const known = new Set(MERGE_FIELDS.map((f) => f.key));
  ok([...t.source.matchAll(/\{\{(\w+)\}\}/g)].every((m) => known.has(m[1])), `${t.key}: all merge fields known`);
  // v1.14 (Insurance Included) is a separate document with its own checks below.
  if (t.insuranceIncluded) continue;
  ok(parseLayout(t.body).filter((b) => b.k === "page").length === 2 && parseLayout(t.body).some((b) => b.k === "sig"), `${t.key}: page breaks and one signature block`);
  ok(!/processing_fee/.test(t.source), `${t.key}: no 3.5% toll processing fee (v1.10 charges tolls at cost)`);
  const terms = readTerms(t.body)!;
  ok(terms.service_area === "" && terms.reservation_line === "", `${t.key}: blank rows stay blank (nothing invented)`);
  ok(JSON.stringify(readTerms(writeTerms(stripTerms(t.body), terms))) === JSON.stringify(terms), `${t.key}: terms roundtrip`);
  const r = renderTemplate(resolveTerms(t.body), { company_name: "Synthetic LLC" } as any);
  ok(r.includes("Synthetic LLC d/b/a REAL RENTALS"), `${t.key}: company name merges from Settings`);
}
ok(readTerms(ir.body)!.insurance_notice_hours === "[24]" && readTerms(ni.body)!.insurance_notice_hours === undefined, "insurance-only term only in the insurance template");
// Legacy v1.6 body is byte-identical (its fingerprint must not change).
ok(!("fee_citation_admin" in readTerms(V16_BODY)!), "v1.6 body unchanged by new terms");

// Library drafts: values only, never wording, never agreements.
import("fs").then(() => {});
const tplSrc = (await import("fs")).readFileSync("src/lib/agreement-templates.functions.ts", "utf8");
const save = tplSrc.slice(tplSrc.indexOf("export const saveLibraryDraft"));
ok(/await owner\(context\.userId\)/.test(save), "library draft save is Owner-only");
ok(/writeTerms\(lib\.source, terms\)/.test(save) && !/from\("agreements"\)|from\("agreement_templates"\)/.test(save), "draft keeps fixed wording; never touches sent/signed agreements or approval rows");
ok(/Unknown contract values/.test(save) && /\[\.\.\.used\]\.map/.test(save), "only values the agreement uses are saved; unknown keys refused");
const agr = (await import("fs")).readFileSync("src/lib/agreements.functions.ts", "utf8");
ok(/libraryWithDraft/.test(agr) && /approvalStatus: "draft"/.test(agr), "Prepare Agreement uses saved draft values and stays unsendable (draft)");
const edited = writeTerms(ni.source, { ...ni.terms, notice_hours: "48", service_area: "Florida only" });
ok(acknowledgmentsOf(edited).length === 13 && stripTerms(edited) === stripTerms(ni.body), "editing values keeps wording and 13 initials");
const editedIr = writeTerms(ir.source, { ...ir.terms, insurance_notice_hours: "24" });
ok(acknowledgmentsOf(editedIr).length === 15 && stripTerms(editedIr) === stripTerms(ir.body), "editing values keeps wording and 15 initials");

// ---------------------------------------------------------------- v1.14 Insurance Included
{
  const { V114_SOURCE, V114_TERM_DEFAULTS } = await import("../src/lib/agreement-v114");
  const { missingTerms } = await import("../src/lib/agreement-builder");
  const { applyPrep, paymentRows, parseUsd, EMPTY_PREP, PrepSchema } = await import("../src/lib/agreement-prep");
  const ii = libraryTemplate("insurance_included")!;
  ok(ii.displayVersion === "1.14" && ii.insuranceIncluded === true && !ii.insuranceRequired, "v1.14: Insurance Included family");
  ok(V114_SOURCE.includes("(v1.14)"), "v1.14: title matches the PDF");
  const blocks = parseLayout(ii.body);
  ok(blocks.filter((b) => b.k === "sig").length === 1, "v1.14: one signature block");
  const notices = blocks.filter((b) => b.k === "notice") as any[];
  ok(notices.length === 2 && /627\.7263/.test(notices[0].lead) && /812\.155\(6\)/.test(notices[1].lead), "v1.14: both Florida statutory notices are boxed notices");
  ok(blocks.findIndex((b) => b.k === "notice") < blocks.findIndex((b) => b.k === "h2"), "v1.14: s. 627.7263 notice is on the face, before any section");
  ok(blocks.filter((b) => b.k === "highlight").length === 1, "v1.14: Damage Waiver benefit is highlighted once");
  ok(acknowledgmentsOf(ii.body).length === 16, "v1.14: 16 initials (Damage Waiver choice + 15 sections)");
  ok(/Damage Waiver/.test(acknowledgmentsOf(ii.body)[0]) && /\{\{damage_waiver\}\}/.test(acknowledgmentsOf(ii.body)[0]), "v1.14: renter initials the Damage Waiver choice");
  const miss = missingTerms(V114_TERM_DEFAULTS, V114_SOURCE);
  ok(miss.length === 1 && miss[0] === "service_area", "v1.14: only Service Area is left for the Owner to set");
  ok(!Object.values(V114_TERM_DEFAULTS).some((v) => /\[[^\]]*\]/.test(v)), "v1.14: no bracketed open values");
  ok(!/\[ \]|_{4,}|confirm/i.test(V114_SOURCE.replace(/\[\[[a-z0-9_]+\]\]/g, "")), "v1.14: no blanks, checkboxes or confirm wording");
  ok(/\*\*Vehicle Damage Claims\.\*\* Only REAL RENTALS decides whether to make an insurance claim for damage to/.test(V114_SOURCE), "v1.14: only REAL RENTALS decides on vehicle-damage claims (Section 8)");
  ok(!/OneStepGPS|Approved Platform Use|declarations page to you/i.test(V114_SOURCE), "v1.14: removed items stay removed");
  ok(!/[\u2013\u2014]/.test(V114_SOURCE), "v1.14: no dashes the PDF font cannot print");
  ok(/no security deposit/i.test(V114_TERM_DEFAULTS.deposit_clause), "v1.14: no-deposit wording");
  for (const [k, v] of [["fee_late_payment", "$50 for each day a payment is late"], ["fee_additional_driver", "$50 per week, per driver, + any added Renter Policy premium"], ["damage_waiver_fee", "$35"], ["notice_hours", "48"]])
    ok(V114_TERM_DEFAULTS[k] === v, `v1.14: ${k} as agreed`);
  ok(stripTerms(ii.body).length < 60000, "v1.14: fits the saved-template size limit");

  // Money rows.
  const base = PrepSchema.parse({ ...EMPTY_PREP, damageWaiver: "declined", payment: { schedule: "weekly", method: "Card Autopay" }, vehicleOwner: "Synthetic Owner LLC" });
  const ctx = { weeklyRate: parseUsd("$375.00"), waiverFee: parseUsd(V114_TERM_DEFAULTS.damage_waiver_fee) };
  let rows = paymentRows(base, ctx);
  ok(rows.payment_amount === "$375.00 weekly" && rows.balance_due === "$375.00", "no fee, declined: balance is the first week");
  rows = paymentRows({ ...base, reservation: { mode: "required", amount: 50 } }, ctx);
  ok(rows.balance_due === "$325.00", "Reservation Fee is applied to the first payment");
  rows = paymentRows({ ...base, damageWaiver: "accepted", reservation: { mode: "required", amount: 100 } }, ctx);
  ok(rows.payment_amount === "$410.00 weekly ($375.00 rent + $35.00 Damage Waiver)" && rows.balance_due === "$310.00", "accepted waiver is charged with rent; any fee amount works");
  rows = paymentRows({ ...base, damageWaiver: "accepted", payment: { schedule: "every_4_weeks", method: "Zelle" } }, ctx);
  ok(rows.payment_amount === "$1,640.00 every 4 weeks ($1,500.00 rent + $140.00 Damage Waiver)" && rows.balance_due === "$1,640.00", "every 4 weeks covers 28 days");
  rows = paymentRows({ ...base, reservation: { mode: "required", amount: 500 } }, ctx);
  ok(rows.balance_due === "" && rows.blockers.length === 1, "a fee above the first payment blocks instead of printing a negative balance");
  rows = paymentRows({ ...EMPTY_PREP }, ctx);
  ok(rows.payment_amount === "" && rows.balance_due === "" && rows.blockers.length === 0, "nothing is calculated until staff choose");
  const applied = applyPrep(base, { startIso: null, depositClause: V114_TERM_DEFAULTS.deposit_clause });
  ok(applied.merge.damage_waiver === "Declined" && applied.merge.payment_method === "Card Autopay" && applied.merge.vehicle_owner === "Synthetic Owner LLC", "staff choices become merge values");
  ok(!("damage_waiver" in applyPrep(EMPTY_PREP, { startIso: null, depositClause: "" }).merge), "no choice, no value (the template gate then blocks)");
  ok(PrepSchema.safeParse(EMPTY_PREP).success, "earlier preps without the new choices still validate");

  // Rendered through the one canonical PDF renderer.
  const { renderPreviewPdf } = await import("../src/lib/esign-pdf.server");
  const data: Record<string, string> = Object.fromEntries(MERGE_FIELDS.map((f) => [f.key, `[${f.label}]`]));
  Object.assign(data, { company_name: "Synthetic LLC", weekly_rate: "$375.00", balance_due: "$325.00", payment_amount: "$375.00 weekly", damage_waiver: "Declined" });
  const filled = writeTerms(V114_SOURCE, { ...V114_TERM_DEFAULTS, service_area: "Florida", reservation_line: "$50.00" });
  const text = renderTemplate(filled, data as any);
  ok(!/__________|\{\{|\[\[/.test(text), "v1.14: every field and value resolves");
  ok(text.includes('Synthetic LLC ("REAL RENTALS," "we," "us")'), "v1.14: company name merges from Settings");
  const pdf = await renderPreviewPdf({ title: "Vehicle Rental Agreement", body: text, fingerprint: "abc".repeat(22), templateLabel: "Test", companySignerName: "Synthetic Signer", companySignerTitle: "Authorized Representative", generatedAt: new Date(0).toISOString() } as any);
  ok(pdf.length > 20000, "v1.14: renders to a PDF");
  if (process.env.WRITE_V114_PDF) (await import("fs")).writeFileSync(process.env.WRITE_V114_PDF, pdf);
  // Earlier bodies are untouched by the new layout blocks.
  ok(!parseLayout(V16_BODY).some((b) => b.k === "notice" || b.k === "highlight"), "v1.6 has no boxed blocks (its layout is unchanged)");
}

if (fails) { console.error(`${fails} failed`); process.exit(1); }
console.log("All agreement-library checks passed");
