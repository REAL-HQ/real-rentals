// Agreement Template Library: run with `bun scripts/agreement-library.test.ts`.
import { LIBRARY, libraryTemplate, acknowledgmentsOf, V110_SOURCE, V1102_INS_SOURCE } from "../src/lib/agreement-library";
import { V16_BODY, readTerms, resolveTerms, unknownTermsIn, writeTerms, stripTerms } from "../src/lib/agreement-builder";
import { MERGE_FIELDS, renderTemplate } from "../src/lib/agreement-merge";
import { parseLayout } from "../src/lib/agreement-layout";

let fails = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) fails++; };

const ni = libraryTemplate("no_insurance")!, ir = libraryTemplate("insurance_required")!;
ok(LIBRARY.length === 2 && new Set(LIBRARY.map((t) => t.key)).size === 2, "two independent template keys");
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

if (fails) { console.error(`${fails} failed`); process.exit(1); }
console.log("All agreement-library checks passed");
