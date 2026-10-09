// Driver Agreement Preparation rules. Run: bun scripts/agreement-prep.test.ts
import { applyPrep, EMPTY_PREP, PrepSchema, type AgreementPrep } from "../src/lib/agreement-prep";
import { V16_BODY, readTerms, writeTerms, stripTerms } from "../src/lib/agreement-builder";
import { renderTemplate } from "../src/lib/agreement-merge";
import { renderPreviewPdf, renderCompletedPdf } from "../src/lib/esign-pdf.server";
import { readFileSync } from "fs";

let fail = 0;
const ok = (c: unknown, m: string) => { console.log(c ? "  ok  " : "  FAIL", m); if (!c) fail++; };
const NO = "There is no security deposit.";
const ctx = { startIso: "2026-10-12", depositClause: NO };
const p = (x: Partial<AgreementPrep>): AgreementPrep => ({ ...EMPTY_PREP, ...x });
const drv = { name: "Sam Q Helper", licenseNumber: "h123", licenseState: "fl", licenseExpiration: "2028-01-01", verified: true };

console.log("AUTHORIZED DRIVERS");
let r = applyPrep(EMPTY_PREP, ctx);
ok(r.merge.additional_drivers === "None Authorized" && !r.blockers.length, "none prints None Authorized");
r = applyPrep(p({ drivers: { mode: "listed", list: [drv] } }), ctx);
ok(!r.blockers.length && r.merge.additional_drivers.includes("Sam Q Helper (FL DL H123, exp. 01-01-2028)"), "verified driver printed");
r = applyPrep(p({ drivers: { mode: "listed", list: [{ ...drv, verified: false }] } }), ctx);
ok(r.blockers.some((b) => /verification/.test(b.label)), "unverified driver blocks");
r = applyPrep(p({ drivers: { mode: "listed", list: [{ ...drv, licenseExpiration: "2026-10-01" }] } }), ctx);
ok(r.blockers.some((b) => /valid on the start/.test(b.label)), "license expiring before start blocks");
r = applyPrep(p({ drivers: { mode: "listed", list: [{ ...drv, name: "Sam" }] } }), ctx);
ok(r.blockers.some((b) => /legal name/.test(b.label)), "single-word name blocks");
r = applyPrep(p({ drivers: { mode: "listed", list: [] } }), ctx);
ok(r.blockers.length === 1, "Add selected with no driver blocks");

console.log("RESERVATION FEE");
r = applyPrep(EMPTY_PREP, ctx);
ok(/\[X\] Not required/.test(r.reservationLine), "not required checked");
r = applyPrep(p({ reservation: { mode: "required", amount: 150 } }), ctx);
ok(/\[X\] Required: \$150\.00/.test(r.reservationLine) && !r.blockers.length, "required amount printed");
ok(!/paid/.test(r.reservationLine), "  and never claims it was paid");
ok(r.merge.deposit_amount === "$0", "  and is separate from the deposit");
r = applyPrep(p({ reservation: { mode: "required", amount: null } }), ctx);
ok(r.blockers.some((b) => b.field === "reservation_fee"), "required without amount blocks");

console.log("SECURITY DEPOSIT");
r = applyPrep(p({ deposit: { mode: "required", amount: 500, reason: "" } }), ctx);
ok(r.blockers.some((b) => /Owner-approved deposit wording/.test(b.label)), "required + no-deposit template blocks");
r = applyPrep(p({ deposit: { mode: "required", amount: 500, reason: "" } }), { ...ctx, depositClause: "Approved deposit clause." });
ok(!r.blockers.length && r.merge.deposit_amount === "$500.00", "required allowed once deposit wording exists");
r = applyPrep(p({ deposit: { mode: "waived", amount: null, reason: "" } }), ctx);
ok(r.blockers.some((b) => /waiving/.test(b.label)), "waived needs a reason");
r = applyPrep(p({ deposit: { mode: "waived", amount: null, reason: "Returning driver, good history" } }), ctx);
ok(!r.blockers.length && r.merge.deposit_amount === "$0", "waived with reason keeps $0");

console.log("FINGERPRINT INPUT");
ok(applyPrep(EMPTY_PREP, ctx).merge._prep !== applyPrep(p({ reservation: { mode: "required", amount: 1 } }), ctx).merge._prep, "any choice changes the fingerprinted merge data");
ok(!PrepSchema.safeParse({ ...EMPTY_PREP, deposit: { mode: "required", amount: -5, reason: "" } }).success, "negative amounts rejected");

console.log("RENDERED AGREEMENT");
const terms = readTerms(V16_BODY)!;
const rr = applyPrep(p({ drivers: { mode: "listed", list: [drv] }, reservation: { mode: "required", amount: 150 } }), ctx);
const tpl = writeTerms(stripTerms(V16_BODY), { ...terms, reservation_line: rr.reservationLine });
const body = renderTemplate(tpl, { ...rr.merge, driver_name: "Jane Q Testdriver", agreement_number: "Assigned When Sent" });
ok(body.includes("| Approved Additional Driver(s) | Sam Q Helper") && body.includes("[X] Required: $150.00"), "choices land in the Rental & Vehicle Information table");
ok(body.includes("Assigned When Sent"), "preview never consumes an agreement number");
const pv = await renderPreviewPdf({ title: "T", body, fingerprint: "a".repeat(64), templateLabel: "x", companySignerName: "C", companySignerTitle: null, generatedAt: "2026-10-09T00:00:00Z" });
const sg = await renderCompletedPdf({ id: "x", title: "T", body, bodySha256: "b", signerName: "Jane Q Testdriver", signerEmail: null, signedAt: "2026-10-12T00:00:00Z", createdAt: null, sentAt: null, viewedAt: null, ip: null, userAgent: null, authMethod: "email_link", companySignerName: "C", companySignerTitle: null });
const pages = (b: Uint8Array) => (Buffer.from(b).toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length;
ok(pages(pv) === 6 && pages(sg) === 7, `preview 6 pages, signed 6 + certificate (${pages(pv)}/${pages(sg)})`);

console.log("SERVER WIRING");
const fn = readFileSync("src/lib/agreements.functions.ts", "utf8");
ok(/prep: PrepSchema\.optional\(\)/.test(fn) && (fn.match(/prep: PrepSchema\.optional\(\)/g) ?? []).length === 2, "preview and send both accept validated choices");
ok(/prepareAgreement\(admin, applicationId, opts\.prep\)/.test(fn), "send re-renders from the same choices (fingerprint check)");
ok(/if \(prep\.numberingPending\) throw/.test(fn), "v1.6 send refused until agreement numbering exists");
ok(!/RR-\$\{/.test(fn), "no improvised agreement number");
ok(/requireTierFor\(context\.userId, "manager"\)/.test(fn), "Manager+ only");

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
