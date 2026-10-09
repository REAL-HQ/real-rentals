// Smart Agreement Upload + Service Area: `bun scripts/agreement-import.test.ts`. Synthetic data only.
import { readFileSync, existsSync } from "fs";
import { extractPdf, extractDocx, kindOf } from "../src/lib/agreement-extract";
import { analyzeAgreement, applyMappings, wordingPreserved } from "../src/lib/agreement-import";
import { writeTerms, readTerms } from "../src/lib/agreement-builder";
import { acknowledgmentsOf, LIBRARY } from "../src/lib/agreement-library";
import { renderTemplate } from "../src/lib/agreement-merge";
import { parseLayout } from "../src/lib/agreement-layout";
import { composeServiceArea, parseServiceArea } from "../src/lib/service-area";
import { applyPrep, EMPTY_PREP } from "../src/lib/agreement-prep";

let fails = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) fails++; };
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

console.log("PDF UPLOAD (both supplied agreements)");
const UP = "/mnt/user-uploads/";
const files = [
  { f: "REAL-RENTALS-Vehicle-Rental-Agreement-v1.6_no_insurance-2.pdf", acks: 13, ins: false },
  { f: "REAL-RENTALS-Vehicle-Rental-Agreement-v1.10.2_insurance_required.pdf", acks: 15, ins: true },
];
for (const x of files) {
  const p = UP + x.f;
  if (!existsSync(p)) { console.log(`SKIP ${x.f} (not mounted)`); continue; }
  const bytes = new Uint8Array(readFileSync(p));
  ok(kindOf(x.f, bytes) === "pdf", `${x.f}: recognized as PDF`);
  const a = analyzeAgreement(await extractPdf(bytes, pdfjs));
  ok(a.acknowledgments === x.acks, `${x.f}: ${x.acks} initials detected (${a.acknowledgments})`);
  ok(a.signatureBlock, `${x.f}: signature block placed`);
  ok(a.coverage >= 0.99 && !a.needsManualReview, `${x.f}: ≥99% of text carried over (${(a.coverage * 100).toFixed(1)}%)`);
  ok(!a.detections.some((d) => d.target.t === "none"), `${x.f}: every field mapped`);
  const m = applyMappings(a.raw, a.detections);
  ok(m.problems.length === 0 && wordingPreserved(a.raw, m.source), `${x.f}: mappings applied, wording preserved`);
  const body = writeTerms(m.source, m.terms);
  ok(acknowledgmentsOf(body).length === x.acks, `${x.f}: signing checklist = ${x.acks}`);
  ok(parseLayout(body).filter((b) => b.k === "sig").length === 1, `${x.f}: exactly one signature block`);
  ok(/\{\{insurance_carrier\}\}/.test(body) && (x.ins ? !/If Any/.test(body) : /If Any/.test(body)), `${x.f}: insurance rows kept as written`);
  ok(m.source.includes("{{company_name}} d/b/a REAL RENTALS"), `${x.f}: [Legal Entity Name] → Company settings`);
  ok(m.source.includes("| Mileage Out / Fuel Out | To Be Completed At Pickup"), `${x.f}: pickup field left for staff`);
  // Mapping correction: Owner maps the "[24]" reusable value to a contract setting.
  const d24 = a.detections.find((d) => d.original === "[24]")!;
  const corrected = a.detections.map((d) => (d.id === d24.id ? { ...d, target: { t: "term" as const, key: "report_hours" }, source: "Owner" as const } : d));
  const m2 = applyMappings(a.raw, corrected);
  ok(!m2.source.includes("[24]") && m2.terms.report_hours === "[24]" && wordingPreserved(a.raw, m2.source), `${x.f}: Owner correction maps [24] to a setting without changing wording`);
  const rendered = renderTemplate(writeTerms(m2.source, m2.terms), {} as any);
  ok(rendered.includes("within [24] hours"), `${x.f}: corrected value still prints [24]`);
}

console.log("DOCX UPLOAD (synthetic)");
function zipStore(entries: Record<string, string>): Uint8Array {
  const enc = new TextEncoder(); const parts: Uint8Array[] = []; const central: Uint8Array[] = []; let off = 0;
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  for (const [name, text] of Object.entries(entries)) {
    const n = enc.encode(name), d = enc.encode(text), c = crc(d);
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, c, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, n.length, true);
    const cd = new DataView(new ArrayBuffer(46)); cd.setUint32(0, 0x02014b50, true); cd.setUint16(6, 20, true); cd.setUint32(16, c, true); cd.setUint32(20, d.length, true); cd.setUint32(24, d.length, true); cd.setUint16(28, n.length, true); cd.setUint32(42, off, true);
    parts.push(new Uint8Array(h.buffer), n, d); central.push(new Uint8Array(cd.buffer), n); off += 30 + n.length + d.length;
  }
  const csize = central.reduce((s, b) => s + b.length, 0);
  const e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, Object.keys(entries).length, true); e.setUint16(10, Object.keys(entries).length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)]; const out = new Uint8Array(all.reduce((s, b) => s + b.length, 0)); let p = 0; for (const b of all) { out.set(b, p); p += b.length; } return out;
}
const P = (t: string) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const TR = (a: string, b: string) => `<w:tr><w:tc>${P(a)}</w:tc><w:tc>${b ? P(b) : "<w:p/>"}</w:tc></w:tr>`;
const docXml = `<?xml version="1.0"?><w:document><w:body>${P("SYNTHETIC RENTALS")}${P("Synthetic Rental Agreement (v9)")}${P("This Agreement is between [Legal Entity Name] and the renter. Call [phone] with questions.")}
<w:tbl>${TR("Renter Name", "")}${TR("Color / VIN", "")}${TR("Weekly Rate", "")}${TR("Favorite Color", "")}</w:tbl>
${P("1. Payment")}${P("You pay weekly &amp; on time. Late fees are $[40] per day.")}
${P("Renter Acknowledgments")}${P("Initial Renter Acknowledgment")}${P("I read the agreement.")}${P("I will pay on time.")}${P("I will return the car.")}
${P("Signatures")}${P("Renter Signature")}${P("Date &amp; Time")}</w:body></w:document>`;
const docx = zipStore({ "[Content_Types].xml": "<Types/>", "word/document.xml": docXml });
ok(kindOf("synthetic.docx", docx) === "docx" && kindOf("synthetic.zip", docx) === null, "DOCX recognized by content + extension");
const da = analyzeAgreement(await extractDocx(docx));
ok(da.acknowledgments === 3 && da.signatureBlock, `DOCX: 3 initials and signature found (${da.acknowledgments})`);
ok(da.raw.includes("| Renter Name |") && da.raw.includes("You pay weekly & on time."), "DOCX: table rows and entities preserved");
const fav = da.detections.find((d) => d.label === "Favorite Color");
ok(!!fav && fav.target.t === "none", "DOCX: unknown field flagged Unmapped (never guessed)");
ok(applyMappings(da.raw, da.detections).problems.some((p) => p.includes("Favorite Color")), "Unmapped field blocks saving");
const fixed = da.detections.map((d) => (d.id === fav!.id ? { ...d, target: { t: "merge" as const, value: "{{vehicle_color}}" } } : d));
ok(applyMappings(da.raw, fixed).problems.length === 0, "Owner correction clears the block");
ok(da.detections.some((d) => d.original === "[phone]" && d.target.t === "merge"), "DOCX: [phone] → Company phone");
let threw = false; try { await extractDocx(zipStore({ "other.xml": "<x/>" })); } catch { threw = true; }
ok(threw, "Non-Word zip refused");

console.log("SCANNED / UNREADABLE");
const { PDFDocument } = await import("pdf-lib");
const blank = await PDFDocument.create(); blank.addPage(); blank.addPage();
const sa = analyzeAgreement(await extractPdf(await blank.save(), pdfjs));
ok(sa.needsManualReview && sa.warnings.some((w) => /scanned|manual review/i.test(w)), "image-only PDF flagged for manual review");

console.log("SERVICE AREA & MILEAGE (separate rules)");
const { composeMileage, parseMileage, excessFeeFor } = await import("../src/lib/service-area");
ok(composeServiceArea({ mode: "unset" }) === "", "service area unset stays blank (no default restriction)");
ok(composeServiceArea({ mode: "radius", miles: 50, center: "Orlando, FL", region: "Florida" }) === "50-mile radius of Orlando, FL; Florida only", "geographic radius");
ok(composeServiceArea({ mode: "region", region: "Florida, Georgia" }) === "Florida, Georgia only", "permitted states/regions");
ok(composeServiceArea({ mode: "none" }) === "No geographic restriction", "no restriction only when chosen");
ok(composeServiceArea({ mode: "radius", miles: 0, center: "X", region: "" }) === "", "incomplete radius stays blank");
ok(parseServiceArea("50-mile radius of Orlando, FL; Florida only").mode === "radius" && parseServiceArea("[100]-mile radius of Tampa, FL; Florida only").mode === "custom", "existing wording read back, never rewritten");
ok(composeMileage({ mode: "unset" }) === "" && composeMileage({ mode: "unlimited" }) === "Unlimited miles", "mileage: unset blank, unlimited explicit");
for (const [p, w] of [["day", "day"], ["week", "week"], ["month", "month"], ["rental", "rental"]] as const)
  ok(composeMileage({ mode: "limited", miles: 1500, period: p }) === `1,500 miles per ${w}`, `mileage limited per ${w}`);
ok(parseMileage("1,500 miles per week").mode === "limited" && parseMileage("Unlimited miles").mode === "unlimited", "mileage read back");
ok(excessFeeFor("Unlimited miles", "$0.25/mile") === "" && excessFeeFor("1,500 miles per week", "$0.25/mile") === "$0.25/mile", "unlimited never carries an excess fee");
for (const t of LIBRARY) {
  ok(t.source.includes("| Service Area / Mileage Limit | [[service_area]]; [[mileage_allowance]]") && readTerms(t.body)!.mileage_allowance === "", `${t.key}: service area and mileage are separate values, both blank`);
  ok(!t.source.includes("excess_mileage_fee"), `${t.key}: excess-mileage fee not printed (no approved clause)`);
  const out = renderTemplate(writeTerms(t.source, { ...t.terms, service_area: "Florida only", mileage_allowance: "1,500 miles per week" }), {} as any);
  ok(out.includes("| Service Area / Mileage Limit | Florida only; 1,500 miles per week"), `${t.key}: preview shows both values`);
}
for (const t of LIBRARY) ok(readTerms(t.body)!.service_area === "", `${t.key}: Service Area not restored to old Tampa value`);
const tplFn = readFileSync("src/lib/agreement-templates.functions.ts", "utf8");
ok(/missingTerms\(readTerms\(v\.body\)/.test(tplFn), "approval refuses while any contract value (incl. Service Area) is blank");

console.log("SHARED SERVICE AREA CONTROL");
{
  const { areaConfigFrom, composeAreaConfig } = await import("../src/lib/service-area");
  const c0 = areaConfigFrom(undefined, "100-mile radius of Tampa, FL");
  ok(c0.mode === "radius" && c0.radius.miles === 100 && c0.radius.center === "Tampa, FL", "saved radius text reopens as Geographic Radius");
  const c1 = areaConfigFrom(undefined, "Tampa, FL");
  ok(c1.mode === "custom" && c1.custom === "Tampa, FL", "plain text reopens as Custom (never forced into a radius)");
  const typed = { ...c0, region: "Florida, Georgia", custom: "Tampa Bay counties only" };
  ok(composeAreaConfig({ ...typed, mode: "region" }) === "Florida, Georgia only" && composeAreaConfig({ ...typed, mode: "custom" }) === "Tampa Bay counties only", "switching modes prints only the selected mode");
  ok(composeAreaConfig({ ...typed, mode: "radius" }) === "100-mile radius of Tampa, FL", "switching back restores the radius inputs (nothing discarded)");
  const saved = JSON.stringify({ ...typed, mode: "custom" });
  const back = areaConfigFrom(saved, "Tampa Bay counties only");
  ok(back.mode === "custom" && back.radius.miles === 100 && back.region === "Florida, Georgia", "saved selection reopens exactly, with other modes' inputs kept");
  ok(composeAreaConfig({ ...c0, mode: "custom", custom: "Pinellas only" }) === "Pinellas only", "custom restriction needs no radius");
  ok(composeAreaConfig({ ...c0, mode: "radius", radius: { miles: 0, center: "Tampa, FL", region: "" } }) === "", "incomplete radius never prints a partial value");
}
const fieldSrc = readFileSync("src/components/admin/ServiceAreaField.tsx", "utf8");
const builderSrc = readFileSync("src/components/admin/AgreementBuilder.tsx", "utf8");
ok((builderSrc.match(/<ServiceAreaField /g) ?? []).length === 1 && (builderSrc.match(/<MileageField /g) ?? []).length === 1, "one shared Service Area and one Mileage control for every template");
ok(["Geographic Radius", "Permitted States / Regions", "Custom Geographic Restriction", "No Geographic Restriction"].every((l) => fieldSrc.includes(`>${l}<`)), "the four required choices");

console.log("RESERVATION FEE");
const req = applyPrep({ ...EMPTY_PREP, reservation: { mode: "required", amount: 150 } }, { startIso: "2026-10-12", depositClause: "There is no security deposit." });
ok(!/paid/i.test(req.reservationLine), "v1.6 line never says Paid");
const fnSrc = readFileSync("src/lib/agreements.functions.ts", "utf8");
ok(/: "None"\)/.test(fnSrc) && !/Paid/.test(fnSrc.slice(fnSrc.indexOf("reservationStyle"), fnSrc.indexOf("reservationStyle") + 400)), "v1.10 prints the amount or None — never Paid");

console.log("PERMISSIONS & SAFETY (source checks)");
const up = tplFn.slice(tplFn.indexOf("export const storeTemplateUpload"));
ok(/await owner\(context\.userId\)/.test(up), "upload is Owner-only (requireOwner)");
ok(/from\("rental-agreements"\)/.test(up) && !/from\("agreements"\)|from\("agreement_templates"\)/.test(up), "upload stores the original privately; never touches agreements or templates");
const dlg = readFileSync("src/components/admin/TemplateUploadDialog.tsx", "utf8");
ok(/Save As Draft<\/Button>/.test(dlg) && /disabled title=/.test(dlg) && !/approveTemplateVersion|sendAgreement/.test(dlg), "upload screen cannot approve, send or save until the database update");

if (fails) { console.error(`${fails} failed`); process.exit(1); }
console.log("All agreement-import checks passed");
