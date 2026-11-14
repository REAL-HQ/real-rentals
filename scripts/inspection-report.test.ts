// Printable Vehicle Inspection Report: run with `bun scripts/inspection-report.test.ts`.
import { writeFileSync } from "node:fs";
import { inspectionReportHtml, reportPartTitle, reportStatement, escapeHtml, type InspectionReportInput } from "../src/lib/inspection-report";

let fails = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) fails++; };
const fmt = (iso: string) => `T(${iso})`;
const angles = [{ key: "front", label: "Front" }, { key: "odometer", label: "Odometer" }, { key: "other", label: "Other" }];
const base: InspectionReportInput = {
  inspectionType: "pre_delivery", status: "passed", vehicleLabel: "2019 Ford Fusion · ABC123",
  odometer: 81234, fuelLevel: "3/4", exteriorNotes: "Scuff on <rear> bumper", interiorNotes: null, notes: null,
  inspectorName: "Synthetic Inspector", startedAt: "2026-11-13T15:00:00Z", completedAt: "2026-11-13T15:20:00Z",
  renterSignatureName: "Synthetic Renter", renterSignedAt: "2026-11-13T15:25:00Z", renterNotes: null,
  items: [
    { section: "Tires", label: "Tread depth above 4/32\" on all four tires", result: "pass", notes: null },
    { section: "Tires", label: "Tire pressure set to door-jamb spec", result: "na", notes: "checked" },
    { section: "Docs", label: "Insurance card in glovebox and unexpired", result: "pending", notes: null },
  ],
  photoAngles: ["front", "front", "odometer", null], angles,
};

const html = inspectionReportHtml(base, fmt);
ok(html.includes("Vehicle Inspection Report") && !/Condition Report/.test(html), "named Vehicle Inspection Report");
ok(html.includes("At Pickup") && html.includes("Mileage Out") && html.includes("Rental Start Date &amp; Time"), "pickup wording for a pre-delivery inspection");
ok(/<th>Inspection Date &amp; Time<\/th><td>T\(2026-11-13T15:20:00Z\)<\/td>/.test(html) && /<th>Rental Start Date &amp; Time<\/th><td><\/td>/.test(html), "inspection time is recorded; the rental start time is a write-in, never assumed");
ok(html.includes("81,234") && html.includes("3/4"), "prints the recorded odometer and fuel level");
ok(html.includes("Scuff on &lt;rear&gt; bumper") && !html.includes("<rear>"), "recorded text is escaped");
ok(html.includes("/s/ Synthetic Renter") && html.includes("signed electronically") && html.includes("T(2026-11-13T15:25:00Z)"), "shows the renter's electronic sign-off and its time");
ok(html.includes("Front: <b>2</b>") && html.includes("Odometer: <b>1</b>") && html.includes("Other: <b>1</b>"), "counts photos on file by angle");
ok((html.match(/class="sec"/g) ?? []).length === 2, "checklist grouped by section");
ok(html.includes(">Pass<") && html.includes(">N/A<") && !/>pending</.test(html), "results print as Pass / N/A; an unanswered item stays blank");
ok(html.includes(escapeHtml(reportStatement("pre_delivery"))), "pickup statement printed");

const unsigned = inspectionReportHtml({ ...base, status: "in_progress", completedAt: null, renterSignatureName: null, renterSignedAt: null, odometer: null, fuelLevel: null }, fmt);
ok(!unsigned.includes("/s/") && !unsigned.includes("signed electronically"), "unsigned: a blank signature line, nothing invented");
ok(/<th>Mileage Out<\/th><td><\/td>/.test(unsigned) && /<th>Fuel Level Out<\/th><td><\/td>/.test(unsigned), "missing readings stay blank to fill in by hand");
ok(!unsigned.includes("Synthetic Inspector</div>"), "no representative signature before the inspection is complete");

const ret = inspectionReportHtml({ ...base, inspectionType: "return" }, fmt);
ok(ret.includes("At Return") && ret.includes("Mileage In") && ret.includes("Return Date &amp; Time") && ret.includes(reportStatement("return")), "return wording for a return inspection");
ok(reportPartTitle("damage_check") === "Damage Check", "other inspection types print in Title Case");
ok(!/[–—]/.test(html), "no em or en dashes");

if (process.env.WRITE_REPORT_HTML) writeFileSync(process.env.WRITE_REPORT_HTML, html);
if (fails) { console.error(`${fails} failed`); process.exit(1); }
console.log("All inspection-report checks passed");
