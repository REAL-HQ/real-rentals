// Closeout preview stays dark, manager-only, and read-only.
// Run: bun scripts/closeout-preview.test.ts
import { readFileSync } from "node:fs";
import { CLOSEOUT_PREVIEW_ENABLED } from "../src/lib/closeout-preview-flag";
import {
  CLOSEOUT_PREVIEW_NOTE,
  OUTSTANDING_STATUSES,
  buildCloseoutPreview,
  easternCalendarDate,
  owedOn,
  showsCloseoutPreview,
  type CloseoutPreviewInput,
  type RowLoad,
} from "../src/lib/closeout-preview";

let fails = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`);
  if (!c) fails++;
};

const flag = readFileSync("src/lib/closeout-preview-flag.ts", "utf8");
const rules = readFileSync("src/lib/closeout-preview.ts", "utf8");
const fn = readFileSync("src/lib/closeout-preview.functions.ts", "utf8");
const ui = readFileSync("src/components/admin/CloseoutPreview.tsx", "utf8");
const drawer = readFileSync("src/components/admin/BookingDetails.tsx", "utf8");
const payments = readFileSync("src/lib/payment-collection.server.ts", "utf8");
const phases = readFileSync("src/lib/bookings-list.ts", "utf8");
const recorded = readFileSync("src/components/admin/RecordedRentalCloseout.tsx", "utf8");
const endRental = readFileSync("src/lib/rentals.functions.ts", "utf8");

ok(CLOSEOUT_PREVIEW_ENABLED === false, "CLOSEOUT_PREVIEW_ENABLED is false");
ok(flag.includes("export const CLOSEOUT_PREVIEW_ENABLED = false;"), "the flag is a hard false constant");
ok(!/process\.env/.test(flag), "no environment variable can open the flag");

const handlerStart = fn.indexOf("export const getRentalCloseoutPreview");
const body = fn.slice(handlerStart);
const thrown = body.indexOf('if (!CLOSEOUT_PREVIEW_ENABLED) throw new Error("Closeout Preview is off")');
const role = body.indexOf("requireManager");
const read = body.indexOf("supabaseAdmin");
ok(thrown >= 0 && thrown < role && role < read, "getRentalCloseoutPreview throws before requireManager and before supabaseAdmin");
ok(thrown < body.indexOf("import("), "the flag throws before any dynamic import");
ok(!fn.slice(0, handlerStart).includes("roles.server"), "the role module is not a static import");
ok(!fn.slice(0, handlerStart).includes("client.server"), "the admin client is not a static import");
ok(body.indexOf("showsCloseoutPreview") < body.indexOf('.from("inspections")'), "a rental that is not active or ended is returned before other reads");

const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
for (const [name, src] of [
  ["rules", rules],
  ["server", fn],
  ["ui", ui],
] as const) {
  const bare = code(src);
  for (const forbidden of [".insert(", ".update(", ".delete(", ".rpc(", "settleDeposit", "addDepositDeduction", "endRental", "end_rental_tx", "stripe.subscriptions", "stripe.paymentIntents"]) {
    ok(!bare.includes(forbidden), `${name} does not call ${forbidden}`);
  }
}
ok(!ui.includes("stripe_subscription_id"), "the card does not receive a subscription id");
ok(!rules.includes("stripe_subscription_id"), "the math does not receive a subscription id");
ok(fn.includes("subscriptionLinked: !!rental.stripe_subscription_id"), "the server keeps the subscription id and passes only whether it is present");
ok(ui.includes("if (!CLOSEOUT_PREVIEW_ENABLED) return null;"), "the card renders nothing while the flag is off");
ok(!/text-transform/.test(ui), "labels are Title Case in the strings");
ok(drawer.includes("CLOSEOUT_PREVIEW_ENABLED && d.canManage && showsCloseoutPreview(b.status)"), "the booking mounts the card only for a manager on an active or ended rental, and only while the flag is on");
ok(recorded.includes("endRental"), "RecordedRentalCloseout remains the versioned closeout writer");
ok(endRental.includes("end_rental_tx"), "endRental remains the lifecycle writer");
ok(!drawer.includes("endRental"), "the booking drawer still does not end a rental itself");

function fnBody(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  const brace = src.indexOf("{", start);
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(brace, i + 1).replace(/\s+/g, " ");
    }
  }
  return "";
}
ok(fnBody(rules, "owedOn") === fnBody(payments, "owedOn") && fnBody(rules, "owedOn").length > 0, "owedOn matches the payments reader");
ok(
  payments.includes(
    'export const OUTSTANDING_STATUSES = ["pending", "failed", "late", "overdue", "past_due", "unpaid", "collections", "current"]',
  ) && OUTSTANDING_STATUSES.join() === "pending,failed,late,overdue,past_due,unpaid,collections,current",
  "outstanding statuses match the payments reader",
);
const completed = phases.match(/completed: \[([^\]]+)\]/)?.[1] ?? "";
for (const status of completed.match(/"([^"]+)"/g) ?? []) {
  ok(showsCloseoutPreview(status.slice(1, -1)), `ended status ${status} is in the preview`);
}
ok(showsCloseoutPreview("active"), "an active rental is in the preview");
ok(!showsCloseoutPreview("cancelled") && !showsCloseoutPreview("reserved") && !showsCloseoutPreview("pending"), "cancelled and reserved rentals are not in the preview");
ok(easternCalendarDate(new Date("2026-10-21T03:30:00Z")) === "2026-10-20", "Eastern calendar date is the day before UTC just after midnight");
ok(easternCalendarDate(new Date("2026-10-21T04:30:00Z")) === "2026-10-21", "Eastern calendar date rolls at midnight Eastern");

const loaded = <T>(rows: T[]): RowLoad<T> => ({ ok: true, rows, truncated: false });
const failed = <T>(): RowLoad<T> => ({ ok: false });

function input(overrides: Partial<CloseoutPreviewInput> = {}): CloseoutPreviewInput {
  return {
    status: "active",
    today: "2026-10-21",
    endDate: null,
    rentalVehicleId: "veh-1",
    inspection: loaded([]),
    items: loaded([]),
    vehicle: { ok: true, status: "rented", rentalReadyMissing: [] },
    vehicleIncidents: loaded([]),
    rentalIncidents: loaded([]),
    payments: loaded([]),
    tolls: loaded([]),
    deductions: loaded([]),
    billing: { autopay: false, subscriptionLinked: false },
    deposit: { amount: 500, held: true, status: "held", settledAt: null, refundAmount: null },
    ...overrides,
  };
}

function figure(preview: ReturnType<typeof buildCloseoutPreview>, key: string) {
  if (!preview.shown) throw new Error(`expected ${key} on a shown preview`);
  const found = preview.figures.find((item) => item.key === key);
  if (!found) throw new Error(`missing figure ${key}`);
  return found;
}

const hidden = buildCloseoutPreview(input({ status: "cancelled" }));
ok(hidden.shown === false, "a cancelled rental produces no figures");

const missing = buildCloseoutPreview(input());
ok(missing.shown === true && missing.note === CLOSEOUT_PREVIEW_NOTE, "an active rental carries the manual settlement note");
ok(figure(missing, "inspection").value === "Pending" && figure(missing, "inspection").state === "Needs Attention", "a missing return inspection needs attention");
ok(figure(missing, "vehicle").state === "Unknown" && figure(missing, "vehicle").value === "rented", "a rented vehicle with no open incidents is not certified clear");
ok(figure(missing, "damage").value === "Unknown", "damage is unknown when no return inspection is recorded");
ok(figure(missing, "incidents").value === "0" && figure(missing, "incidents").state === "Ready", "no open incidents is a real zero");
ok(figure(missing, "tolls").value.startsWith("0"), "no open tolls is a real zero");
ok(figure(missing, "tickets").value.startsWith("0"), "no open tickets is a real zero");
ok(!missing.figures.some((item) => item.key === "other-charges"), "other charges stay off the card when there are none");
ok(figure(missing, "charges").value === "$0.00" && figure(missing, "charges").state === "Ready", "no unpaid payments is a real zero");
ok(figure(missing, "unpaid-rent").value === "$0.00", "no unpaid rent through today is a real zero");
ok(figure(missing, "billing").state === "Unknown" && figure(missing, "billing").value.includes("Not Linked"), "billing with autopay off and no subscription stays unknown");
ok(figure(missing, "proposed-refund").value === "$500.00", "a held deposit with no deductions proposes the deposit as a refund");
ok(figure(missing, "balance-due").value === "$0.00", "a held deposit with no deductions proposes no balance due");
ok(!JSON.stringify(missing).includes("sub_"), "the preview payload has no subscription id");

const passed = buildCloseoutPreview(
  input({
    inspection: loaded([
      {
        id: "insp-1",
        status: "passed",
        completed_at: "2026-10-21T15:00:00Z",
        vehicle_id: "veh-1",
        exterior_notes: null,
        interior_notes: null,
      },
    ]),
    items: loaded([
      { label: "Tires", result: "pass", is_critical: true },
      { label: "Spare", result: "na", is_critical: false },
    ]),
  }),
);
ok(figure(passed, "inspection").state === "Ready" && figure(passed, "inspection").value === "Done", "a passed return checklist is ready");
ok(figure(passed, "damage").value === "None Recorded", "a clean checklist records no damage");

const damaged = buildCloseoutPreview(
  input({
    inspection: loaded([
      {
        id: "insp-2",
        status: "failed",
        completed_at: "2026-10-21T15:00:00Z",
        vehicle_id: "veh-1",
        exterior_notes: "scratch",
        interior_notes: null,
      },
    ]),
    items: loaded([
      { label: "Bumper", result: "fail", is_critical: true },
      { label: "Mirror", result: "fail", is_critical: false },
    ]),
  }),
);
ok(figure(damaged, "inspection").value === "Failed" && figure(damaged, "inspection").criticalFailures?.join() === "Bumper", "critical checklist failures are named");
ok(figure(damaged, "damage").value === "Bumper, Mirror", "damage lists every failed item, including non-critical ones");

const mismatch = buildCloseoutPreview(
  input({
    inspection: loaded([
      {
        id: "insp-3",
        status: "passed",
        completed_at: "2026-10-21T15:00:00Z",
        vehicle_id: "other-vehicle",
        exterior_notes: null,
        interior_notes: null,
      },
    ]),
    items: loaded([{ label: "Tires", result: "pass", is_critical: true }]),
  }),
);
ok(figure(mismatch, "inspection").state === "Unknown", "an inspection for a different vehicle does not clear this rental");

const unread = buildCloseoutPreview(
  input({
    payments: failed(),
    tolls: failed(),
    rentalIncidents: failed(),
    deductions: failed(),
    vehicle: { ok: false },
  }),
);
ok(figure(unread, "charges").value === "Unknown" && figure(unread, "charges").state === "Unknown", "a failed charges read is unknown, not zero");
ok(figure(unread, "tolls").value === "Unknown", "a failed toll read is unknown, not zero");
ok(figure(unread, "incidents").value === "Unknown", "a failed incident read is unknown, not zero");
ok(figure(unread, "deductions").value === "Unknown", "a failed deductions read is unknown, not zero");
ok(figure(unread, "proposed-refund").value === "No Proposal", "no settlement is proposed when deductions could not be read");

const money = buildCloseoutPreview(
  input({
    status: "ended",
    endDate: "2026-10-20",
    today: "2026-10-21",
    payments: loaded([
      { status: "pending", amount: 100, balance_due: 80, type: "rent", due_date: "2026-10-18" },
      { status: "pending", amount: 50, balance_due: null, type: "rent", due_date: "2026-10-25" },
      { status: "paid", amount: 200, balance_due: 0, type: "rent", due_date: "2026-10-01" },
      { status: "late", amount: 25, balance_due: null, type: "late_fee", due_date: "2026-10-10" },
    ]),
    tolls: loaded([
      { status: "open", amount: 12, admin_fee: 3, charge_type: "toll" },
      { status: "open", amount: 40, admin_fee: 0, charge_type: "ticket" },
      { status: "rebilled", amount: 9, admin_fee: 0, charge_type: "toll" },
      { status: "open", amount: 7, admin_fee: 1, charge_type: "parking" },
    ]),
    rentalIncidents: loaded([
      { id: "i1", status: "open", actual_cost: 0, estimated_cost: 250, driver_responsible_amount: 100, drivable: false },
      { id: "i2", status: "closed", actual_cost: 999, estimated_cost: 999, driver_responsible_amount: 0, drivable: true },
    ]),
    deductions: loaded([{ amount: 600 }]),
    billing: { autopay: true, subscriptionLinked: true },
    deposit: { amount: 500, held: true, status: "held", settledAt: null, refundAmount: null },
  }),
);
ok(figure(money, "unpaid-rent").value === "$80.00", "unpaid rent uses the balance due and stops at the recorded end date");
ok(figure(money, "charges").value === "$155.00", "outstanding charges keep every unpaid recorded payment, including rent due after the end date");
ok(figure(money, "tolls").value === "1 · $15.00", "open tolls add the admin fee and skip rebilled rows");
ok(figure(money, "tickets").value === "1 · $40.00", "open tickets are separate from tolls");
ok(figure(money, "other-charges").value === "1 · $8.00", "another open charge type is shown on its own line");
ok(figure(money, "incident-costs").value === "$250.00", "an unset actual cost falls through to the estimate, and a closed incident is excluded");
ok(figure(money, "incidents").explanation.includes("not drivable"), "an incident marked not drivable is named");
ok(figure(money, "billing").state === "Needs Attention" && figure(money, "billing").explanation.includes("No provider request was made."), "billing names autopay and does not call the provider");
ok(figure(money, "proposed-refund").value === "$0.00" && figure(money, "balance-due").value === "$100.00", "deductions above the deposit propose a balance due, not a refund");
ok(figure(money, "balance-due").explanation.includes("Staff must settle manually."), "the balance due line says staff must settle manually");

const settled = buildCloseoutPreview(
  input({
    deposit: { amount: 500, held: true, status: "refunded", settledAt: "2026-10-20T12:00:00Z", refundAmount: 500 },
  }),
);
ok(figure(settled, "proposed-refund").value === "No Proposal", "a recorded settlement does not propose another refund");
ok(figure(settled, "deposit").explanation.includes("not proof of money returned"), "a recorded refund is not treated as confirmation");

const badDate = buildCloseoutPreview(
  input({
    payments: loaded([{ status: "pending", amount: 10, balance_due: null, type: "rent", due_date: null }]),
  }),
);
ok(figure(badDate, "unpaid-rent").value === "Unknown", "rent with no due date is unknown rather than assumed due");

const truncated = buildCloseoutPreview(input({ payments: { ok: true, rows: [], truncated: true } }));
ok(figure(truncated, "charges").value === "Unknown", "a truncated payment read is unknown rather than a short total");

const weird = buildCloseoutPreview(
  input({
    payments: loaded([{ status: "processing", amount: 10, balance_due: null, type: "rent", due_date: "2026-10-21" }]),
  }),
);
ok(figure(weird, "charges").state === "Unknown", "a payment status outside the outstanding list does not become a balance");

console.log(fails ? `\n${fails} failed` : "\ncloseout preview checks passed");
process.exit(fails ? 1 : 0);
