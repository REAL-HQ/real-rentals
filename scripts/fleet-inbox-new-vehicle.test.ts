// Fleet Inbox new-vehicle detection regression. Run: bun scripts/fleet-inbox-new-vehicle.test.ts
// Synthetic equivalent of a real title + title application + DMV receipt for
// one car. No real VIN, address, title number or payment details are used.
import { buildProposal } from "../src/lib/fleet-inbox";
import { groupInboxVehicles, newVehiclePrefill, memberVinMatches, suggestOwnership } from "../src/lib/fleet-inbox-groups";

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fail++; };
const VIN = "3FA6P0HD8ER123457"; // synthetic, valid check digit
const F = (o: Record<string, string>, conf: "high" | "medium" | "low" = "high") =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v, confidence: conf }]));
const T0 = "2026-10-13T16:01:00.000Z", T1 = "2026-10-13T16:01:05.000Z", T2 = "2026-10-13T16:01:09.000Z";

const items: any[] = [
  { id: "i1", document_id: "d1", file_name: "title.jpg", doc_class: "title", status: "ready", created_at: T0 },
  { id: "i2", document_id: "d2", file_name: "title-application.jpg", doc_class: "title_application", status: "ready", created_at: T1 },
  { id: "i3", document_id: "d3", file_name: "dmv-receipt.jpg", doc_class: "receipt", status: "ready", created_at: T2,
    extraction: { financial: { amount: { value: "449.85" }, date: { value: "2026-10-12" }, vehicleHints: { vin: VIN.toLowerCase() } } } },
];
const titleFields = F({ vin: VIN, year: "2016", make: "FORD", color: "WHI", body_type: "4D", title_number: "T-SYNTH-1", current_odometer: "109,483" });
const mk = (id: string, item: string, fields: any) => {
  const d = buildProposal({ fields }, "title", []);
  return { id, item_id: item, kind: d.kind, status: "pending", vin: d.vin, vin_check: d.vinCheck, fields };
};
const proposals = [mk("p1", "i1", titleFields), mk("p2", "i2", titleFields)];
const finance = [{ proposal_id: "p1", field: "legal_owner", value: "REAL RENTALS LLC" }];

ok(proposals.every((p) => p.kind === "new"), "Unknown valid VIN → each title proposal is 'new'");
let r = groupInboxVehicles({ proposals, items, finance, fleetByVin: {} });
ok(r.groups.length === 1, "Three documents with one VIN → exactly one New Vehicle Detected suggestion");
const g = r.groups[0];
ok(g.members.length === 3 && g.members.map((m) => m.docClass).join() === "title,title_application,receipt", "All three originals kept with distinct classifications");
ok(g.members.map((m) => m.uploadedAt).join() === [T0, T1, T2].join(), "Each file keeps its own original upload timestamp");
ok(g.existingVehicleId === null, "No fleet match → offer Create Vehicle");
const pre = newVehiclePrefill(g);
ok(pre.vin === VIN && pre.year === "2016" && /^ford$/i.test(pre.make) && pre.current_odometer === "109483", "Prefill: VIN, year, make, mileage");
ok(pre.color === "White", "DMV colour code WHI → White");
ok(!("model" in pre) && !("trim" in pre), "Model and trim are never guessed");
ok(pre.ownership_type === "owned" && g.ownershipSuggestion === "owned", "Company ownership suggested from registered owner (staff confirm)");
ok(suggestOwnership("JANE DOE") === null && suggestOwnership(null) === null, "Other owners → no ownership guess (Partner chosen by staff)");
const receipt = g.members.find((m) => m.docClass === "receipt")!;
ok(receipt.expenseCandidate?.amount === "449.85" && receipt.proposalId === null, "Receipt → expense-review candidate only, no vehicle proposal");

// Existing match / retry after creation
r = groupInboxVehicles({ proposals, items, finance, fleetByVin: { [VIN]: "veh-1" } });
ok(r.groups.length === 1 && r.groups[0].existingVehicleId === "veh-1", "VIN now in fleet (retry / later upload) → Attach, never a second Create");

// Duplicate upload of the same file
const dupItems = [...items, { id: "i4", document_id: "d1", file_name: "title (1).jpg", doc_class: "title", status: "duplicate", created_at: T2 }];
r = groupInboxVehicles({ proposals: [...proposals, mk("p4", "i4", titleFields)], items: dupItems, finance, fleetByVin: {} });
ok(r.groups.length === 1 && r.groups[0].members.length === 3, "Duplicate upload is not a second member or a second vehicle");

// Uncertain / invalid VIN
const bad = F({ vin: "3FA6P0HD5ER12345O", year: "2016", make: "Ford" });
const low = F({ vin: VIN }, "low");
r = groupInboxVehicles({ proposals: [mk("p5", "i1", bad), mk("p6", "i2", low)], items, fleetByVin: {} });
ok(r.groups.length === 0 || r.groups.every((x) => x.members.every((m) => m.proposalId === null)), "Invalid or low-confidence VIN never becomes a Create suggestion");
ok(r.uncertain.length === 2, "Both uncertain VINs are flagged for staff review");

// Applied proposals drop out
r = groupInboxVehicles({ proposals: proposals.map((p) => ({ ...p, status: "applied" })), items: items.slice(0, 2), fleetByVin: {} });
ok(r.groups.length === 0, "Applied proposals are not offered again");

// Server attach check
ok(memberVinMatches(VIN.toLowerCase(), VIN) && !memberVinMatches("1FAHP3F28CL148530", VIN) && !memberVinMatches(null, VIN), "Attach re-check: only a document carrying the vehicle's VIN joins it");

console.log(fail ? `\n${fail} failed` : "\nall assertions passed");
process.exit(fail ? 1 : 0);
