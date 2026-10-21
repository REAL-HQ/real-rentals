// Return Inspection stays dark, manager-only, and read-only (run: bun scripts/return-inspection-view.test.ts).
import { readFileSync } from "node:fs";
import { railEntries, resolveAdminTab, TABS, visibleTabs } from "../src/components/admin/nav-config";
import { RETURN_INSPECTION_VIEW_ENABLED } from "../src/lib/return-inspection-flag";
import {
  RETURN_INSPECTION_NOT_IN_SCHEMA,
  buildReturnInspection,
  type ReturnInspectionInput,
  type ReturnInspectionRental,
} from "../src/lib/return-inspection";

let fails = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`);
  if (!c) fails++;
};

const fn = readFileSync("src/lib/return-inspection.functions.ts", "utf8");
const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");
const admin = readFileSync("src/routes/admin.tsx", "utf8");
const panel = readFileSync("src/components/admin/ReturnInspection.tsx", "utf8");
const board = readFileSync("src/lib/return-inspection.ts", "utf8");
const flag = readFileSync("src/lib/return-inspection-flag.ts", "utf8");

ok(RETURN_INSPECTION_VIEW_ENABLED === false, "RETURN_INSPECTION_VIEW_ENABLED is false");
ok(!/process\.env/.test(flag), "no environment variable can open the flag");

function handler(name: string): string {
  const start = fn.indexOf(`export const ${name}`);
  const next = fn.indexOf("export const ", start + 10);
  const chunk = fn.slice(start, next === -1 ? fn.length : next);
  return chunk.slice(chunk.indexOf(".handler"));
}

for (const name of ["listReturnInspectionRentals", "getReturnInspection"]) {
  const body = handler(name);
  const thrown = body.indexOf('if (!RETURN_INSPECTION_VIEW_ENABLED) throw new Error("Return Inspection is off")');
  const role = body.indexOf("requireManager");
  const read = body.indexOf("supabaseAdmin");
  ok(thrown >= 0 && thrown < role && role < read, `${name} throws before requireManager and before supabaseAdmin`);
  ok(thrown < body.indexOf("import("), `${name} throws before any dynamic import`);
}

const beforeExports = fn.slice(0, fn.indexOf("export const listReturnInspectionRentals"));
ok(!beforeExports.includes("roles.server"), "the role module is not a static import");
ok(!beforeExports.includes("client.server"), "the admin client is not a static import");
ok(!/\.(insert|update|delete|upsert|rpc)\(/.test(fn), "the server functions do not write");
ok(!/\.(insert|update|delete|upsert|rpc)\(/.test(board), "the view rules do not write");
ok(!/\.or\(/.test(fn) && !/\.filter\(/.test(fn), "the reads do not use or or filter");
ok(!/select\(\s*["'`]\*/.test(fn), "the reads name their columns");
ok(!fn.includes("storage_path") && !/stripe/i.test(fn) && !/card_/.test(fn), "storage paths, Stripe, and card fields stay out of the read");
ok(!fn.includes("fuel_type") && !/fuelType/.test(board), "return fuel is not the vehicle fuel type");
ok(!/vehicleReadinessChecks\(/.test(fn + board + panel + nav + admin), "this feature does not call the readiness helper");
ok(fn.includes('.eq("inspection_type", "return")'), "only return inspections are loaded");
ok(fn.includes('.in("source_type", ["rental_return", "rental_checkout"])'), "mileage reads return and pickup sources with an eq list");
ok(fn.includes('.in("phase", ["checkin", "damage"])'), "return photos are checkin and damage files");
ok(fn.includes('.in("type", ["damage", "fee"])'), "charges are damage and fee payments");
ok(fn.includes("vehicleIds.length") && fn.includes("applicationIds.length") && fn.includes("inspectionIds.length"), "empty id lists are not sent");

ok(!TABS.some((t) => t.id === "return_inspection"), "Return Inspection is not in TABS");
for (const tier of ["coordinator", "manager", "owner"] as const) {
  ok(!visibleTabs(tier).some((t) => t.id === "return_inspection"), `${tier} nav has no Return Inspection tab while the flag is off`);
  ok(!railEntries(tier).some((t) => t.id === "return_inspection" || t.label === "Return Inspection"), `${tier} rail has no Return Inspection tab while the flag is off`);
}
ok(visibleTabs("owner").length === TABS.length, "owner still sees exactly the dark-build destinations");
ok(
  railEntries("owner").map((entry) => entry.label).join(",") ===
    "Overview,Drivers,Bookings,Payments,Vehicles,Fleet Inbox,Service,Incidents,Driver Issues,Expenses,Partners",
  "the owner rail is unchanged while the flag is off",
);
ok(admin.includes('RETURN_INSPECTION_VIEW_ENABLED && tab === "return_inspection" && <ReturnInspection rentalId={urlRecordId} />'), "the panel mounts only while the flag is on");
ok(panel.includes("if (!RETURN_INSPECTION_VIEW_ENABLED) return null"), "the panel renders nothing while the flag is off");
ok(!/uppercase|text-transform/.test(panel), "labels are Title Case in the strings");
ok(nav.includes("RETURN_INSPECTION_VIEW_ENABLED") && nav.includes('id: "return_inspection"'), "the nav knows the tab and gates it on the flag");

const resolver = nav.slice(nav.indexOf("export function resolveAdminTab"), nav.indexOf("export const WORKSPACE_TABS"));
ok(resolver.indexOf('args.urlTab === "return_inspection"') >= 0 && resolver.indexOf('args.urlTab === "return_inspection"') < resolver.indexOf("TABS.some"), "a direct link is decided before the known-tab list");
ok(
  resolveAdminTab({ urlTab: "return_inspection", tier: "manager", navTabs: [{ id: "return_inspection" }] }) === "overview",
  "a direct Return Inspection link falls back to Overview while the flag is off",
);
ok(
  resolveAdminTab({ urlTab: "return_inspection", tier: null, navTabs: [] }) === "overview",
  "the direct-link fallback does not wait for the role lookup",
);
ok(
  resolveAdminTab({ urlTab: "return_inspection", tier: "coordinator", navTabs: [] }) === "overview",
  "a coordinator direct link falls back to Overview",
);
ok(resolveAdminTab({ urlTab: "finance", tier: "owner", navTabs: [] }) === "overview", "Unified Finance still falls back while its flag is off");
ok(resolveAdminTab({ urlTab: "settings", tier: "coordinator", navTabs: [] }) === "settings", "Settings stays reachable");
ok(resolveAdminTab({ urlTab: "drivers", tier: "manager", navTabs: [{ id: "drivers" }] }) === "drivers", "a known tab still opens");
ok(
  resolveAdminTab({ urlTab: "payments", tier: "coordinator", navTabs: [{ id: "overview" }] }) === "overview",
  "a tab this tier cannot open still falls back to Overview",
);
ok(resolveAdminTab({ urlTab: "missing", tier: "owner", navTabs: TABS }) === "overview", "an unknown tab falls back to Overview");
ok(/id: \[[^\]]*"inspections"[^\]]*"return_inspection"[^\]]*\]/.test(admin), "the selected rental id stays on Return Inspection, and Inspections still owns id");

function rental(over: Partial<ReturnInspectionRental> = {}): ReturnInspectionRental {
  return {
    id: "rental-1",
    status: "active",
    startDate: "2026-10-01",
    endDate: "2026-10-21",
    vehicleLabel: "#12 2020 Honda Civic",
    driverName: "Ada Driver",
    depositStatus: "none",
    depositAmount: null,
    depositHeld: null,
    depositRefundAmount: null,
    depositSettledAt: null,
    depositNotes: null,
    pickupReadingId: null,
    returnReadingId: null,
    ...over,
  };
}

function input(over: Partial<ReturnInspectionInput> = {}): ReturnInspectionInput {
  return {
    rental: rental(),
    readings: [],
    inspections: [],
    items: [],
    photos: [],
    incidents: [],
    payments: [],
    deductions: [],
    ...over,
  };
}

const empty = buildReturnInspection(input());
ok(
  empty.missing.join("|") === "Return Mileage|Return Fuel|Return Photos|Damage Notes|Damage Fees And Other Fees|Deposit Closeout",
  "an empty rental lists every missing return and closeout fact",
);
ok(empty.notInSchema === RETURN_INSPECTION_NOT_IN_SCHEMA, "schema gaps are listed for every rental");
ok(
  empty.notInSchema.some((line) => line.includes("vehicles.fuel_type")) &&
    empty.notInSchema.some((line) => line.includes("no cleaning column")) &&
    empty.notInSchema.some((line) => line.includes("no closeout table")) &&
    empty.notInSchema.some((line) => line.includes("repair amounts")),
  "the schema list names fuel type, cleaning, closeout, and repair amounts",
);

const full = buildReturnInspection(input({
  rental: rental({
    depositStatus: "refunded",
    depositAmount: 500,
    depositHeld: false,
    depositRefundAmount: 350,
    depositSettledAt: "2026-10-22",
    depositNotes: "Scratch deducted",
    returnReadingId: "return-reading",
    pickupReadingId: "pickup-reading",
  }),
  readings: [
    { id: "pickup-reading", mileage: 10000, observedOn: "2026-10-01", sourceType: "rental_checkout", note: null },
    { id: "return-reading", mileage: 11250, observedOn: "2026-10-21", sourceType: "rental_return", note: "Lot" },
  ],
  inspections: [
    {
      id: "insp-return",
      inspectionType: "return",
      status: "passed",
      odometer: 11260,
      fuelLevel: "half",
      exteriorNotes: "Scratch on the bumper",
      interiorNotes: null,
      notes: null,
      driverNotes: null,
      completedAt: "2026-10-21",
      startedAt: "2026-10-21",
    },
    {
      id: "insp-pre",
      inspectionType: "pre_delivery",
      status: "passed",
      odometer: 10000,
      fuelLevel: "full",
      exteriorNotes: "Pickup was clean",
      interiorNotes: null,
      notes: null,
      driverNotes: null,
      completedAt: "2026-10-01",
      startedAt: "2026-10-01",
    },
  ],
  items: [
    { id: "item-fail", inspectionId: "insp-return", label: "Bumper", notes: null, result: "fail", section: "exterior" },
    { id: "item-pre", inspectionId: "insp-pre", label: "Pickup Bumper", notes: "Fine", result: "pass", section: "exterior" },
  ],
  photos: [
    { id: "photo-in", fileName: "bumper.jpg", caption: "Bumper", phase: "checkin", mediaType: "image", createdAt: "2026-10-21", inspectionId: "insp-return" },
    { id: "photo-damage", fileName: "scratch.jpg", caption: null, phase: "damage", mediaType: "image", createdAt: "2026-10-21", inspectionId: null },
    { id: "photo-out", fileName: "pickup.jpg", caption: "Pickup", phase: "checkout", mediaType: "image", createdAt: "2026-10-01", inspectionId: "insp-return" },
    { id: "photo-other", fileName: "extra.jpg", caption: null, phase: "other", mediaType: "image", createdAt: "2026-10-21", inspectionId: "insp-return" },
    { id: "photo-loose", fileName: "loose.jpg", caption: null, phase: "other", mediaType: "image", createdAt: "2026-10-21", inspectionId: null },
  ],
  incidents: [
    {
      id: "incident-1",
      incidentType: "damage",
      description: "Bumper contact",
      notes: "Reported at return",
      severity: "minor",
      status: "open",
      occurredAt: "2026-10-20",
      driverResponsibleAmount: 150,
      estimatedCost: 400,
      actualCost: 0,
    },
  ],
  payments: [
    { id: "pay-damage", type: "damage", amount: 200, status: "paid", netCollected: 200, notes: "Bumper", dueDate: "2026-10-22", paidDate: "2026-10-22", balanceDue: 0 },
    { id: "pay-fee", type: "fee", amount: 40, status: "pending", netCollected: null, notes: "Cleaning", dueDate: "2026-10-22", paidDate: null, balanceDue: 40 },
    { id: "pay-rent", type: "rent", amount: 250, status: "paid", netCollected: 250, notes: "Week", dueDate: "2026-10-01", paidDate: "2026-10-01", balanceDue: 0 },
  ],
  deductions: [{ id: "deduction-1", reason: "Scratch", amount: 150, notes: "From the deposit" }],
}));

ok(full.missing.length === 0, "a complete return lists nothing missing");
ok(full.mileage.map((row) => `${row.sourceLabel}:${row.mileage}`).join("|") === "Return Reading:11250|Return Inspection:11260", "return mileage comes from the return reading and the return inspection");
ok(full.pickupMileage.length === 1 && full.pickupMileage[0].mileage === 10000, "pickup mileage stays labeled as pickup");
ok(full.fuel.length === 1 && full.fuel[0].label === "Half" && full.fuel[0].raw === "half", "half a tank is Half");
ok(full.photos.map((row) => row.fileName).join("|") === "bumper.jpg|scratch.jpg|extra.jpg", "checkin, damage, and return-linked photos stay, and checkout does not");
ok(
  full.damageNotes.some((row) => row.text === "Scratch on the bumper") &&
    full.damageNotes.some((row) => row.source === "Failed Item" && row.label === "Bumper") &&
    full.damageNotes.some((row) => row.text === "Bumper contact") &&
    !full.damageNotes.some((row) => row.text === "Pickup was clean"),
  "damage notes are the return inspection, the failed item, and the incident",
);
ok(
  full.fees.map((row) => row.kind).join("|") === "Damage|Fee|Deposit Deduction|Driver Responsible",
  "fees are damage, fee, deposit deductions, and driver responsibility",
);
ok(!full.fees.some((row) => row.amount === 250), "rent is not a return fee");
ok(full.repairAmounts.length === 1 && full.repairAmounts[0].kind === "Estimated Repair" && full.repairAmounts[0].amount === 400, "estimated repair cost is labeled as a repair amount");
ok(full.closeout.statusLabel === "Refunded" && full.closeout.refundAmount === 350 && full.closeout.notes === "Scratch deducted", "deposit closeout shows the recorded disposition");

const pickupOnly = buildReturnInspection(input({
  readings: [{ id: "pickup-only", mileage: 9000, observedOn: "2026-10-01", sourceType: "rental_checkout", note: null }],
}));
ok(pickupOnly.missing.includes("Return Mileage") && pickupOnly.mileage.length === 0 && pickupOnly.pickupMileage.length === 1, "pickup mileage does not satisfy Return Mileage");

const pointed = buildReturnInspection(input({
  rental: rental({ returnReadingId: "manual-return" }),
  readings: [{ id: "manual-return", mileage: 13000, observedOn: "2026-10-21", sourceType: "manual", note: null }],
}));
ok(pointed.mileage.length === 1 && pointed.mileage[0].sourceLabel === "Manual" && !pointed.missing.includes("Return Mileage"), "a reading named by return_reading_id counts as return mileage");

const oddFuel = buildReturnInspection(input({
  inspections: [
    {
      id: "insp-odd",
      inspectionType: "return",
      status: "passed",
      odometer: null,
      fuelLevel: "diesel",
      exteriorNotes: null,
      interiorNotes: null,
      notes: null,
      driverNotes: null,
      completedAt: null,
      startedAt: "2026-10-21",
    },
  ],
}));
ok(oddFuel.fuel[0].raw === "diesel" && oddFuel.fuel[0].label === "Recorded", "an unrecognised fuel value stays raw and is labeled Recorded");

const repairOnly = buildReturnInspection(input({
  incidents: [
    {
      id: "incident-repair",
      incidentType: "accident",
      description: null,
      notes: null,
      severity: "major",
      status: "open",
      occurredAt: "2026-10-20",
      driverResponsibleAmount: 0,
      estimatedCost: 800,
      actualCost: 640,
    },
  ],
}));
ok(repairOnly.missing.includes("Damage Fees And Other Fees") && repairOnly.repairAmounts.length === 2, "repair amounts do not count as fees");

const notedCloseout = buildReturnInspection(input({
  rental: rental({ depositNotes: "Held pending photos" }),
}));
ok(!notedCloseout.missing.includes("Deposit Closeout") && notedCloseout.missing.includes("Return Mileage"), "deposit notes record a closeout without inventing mileage");

console.log(fails ? `\n${fails} FAILURE(S)` : "\nall return inspection checks pass");
process.exit(fails ? 1 : 0);
