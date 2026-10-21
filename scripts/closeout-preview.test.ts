// Closeout preview stays dark, manager-only, and read-only.
// Run: bun scripts/closeout-preview.test.ts
import { readFileSync } from "node:fs";
import { CLOSEOUT_PREVIEW_ENABLED, showsCloseoutPreview } from "../src/lib/closeout-preview-flag";
import { OUTSTANDING_STATUSES } from "../src/lib/payment-collection.server";
import {
  CLOSED_INCIDENT_HOLD,
  CLOSEOUT_PREVIEW_NOTE,
  POSSIBLE_DOUBLE_COUNT,
  buildCloseoutPreview,
  easternCalendarDate,
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

ok(
  /import\s*\{[^}]*\bOUTSTANDING_STATUSES\b[^}]*\bowedOn\b[^}]*\}\s*from\s*"@\/lib\/payment-collection\.server"/.test(rules) ||
    /import\s*\{[^}]*\bowedOn\b[^}]*\bOUTSTANDING_STATUSES\b[^}]*\}\s*from\s*"@\/lib\/payment-collection\.server"/.test(rules),
  "owedOn and outstanding statuses are imported from the payments reader",
);
ok(!/function owedOn\(/.test(rules) && !/export const OUTSTANDING_STATUSES/.test(rules), "owedOn and outstanding statuses are not copied");
ok(
  payments.includes(
    'export const OUTSTANDING_STATUSES = ["pending", "failed", "late", "overdue", "past_due", "unpaid", "collections", "current"]',
  ) && OUTSTANDING_STATUSES.join() === "pending,failed,late,overdue,past_due,unpaid,collections,current",
  "outstanding statuses match the payments reader",
);
ok(drawer.includes('from "@/lib/closeout-preview-flag"') && !drawer.includes('from "@/lib/closeout-preview"'), "the booking drawer imports the preview gate from the flag module");
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
ok(figure(money, "tickets").value === "2 · $48.00", "parking is a ticket, so the ticket line is the citation plus parking");
ok(!money.figures.some((item) => item.key === "other-charges"), "parking is no longer an other charge");
ok(figure(money, "incident-costs").value === "$250.00", "an unset actual cost falls through to the estimate, and a closed incident with no driver amount is not added");
ok(figure(money, "incidents").explanation.includes("not drivable"), "an incident marked not drivable is named");
ok(figure(money, "billing").state === "Needs Attention" && figure(money, "billing").explanation.includes("No provider request was made."), "billing names autopay and does not call the provider");
ok(
  figure(money, "proposed-refund").value === "$0.00" && figure(money, "balance-due").value === "$368.00",
  "settlement subtracts the return-day balance, open tolls and tickets, and uncovered driver responsibility",
);
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
ok(figure(badDate, "proposed-refund").value === "No Proposal", "a payment with no due date blocks a settlement proposal");

const truncated = buildCloseoutPreview(input({ payments: { ok: true, rows: [], truncated: true } }));
ok(figure(truncated, "charges").value === "Unknown", "a truncated payment read is unknown rather than a short total");

const weird = buildCloseoutPreview(
  input({
    payments: loaded([{ status: "processing", amount: 10, balance_due: null, type: "rent", due_date: "2026-10-21" }]),
  }),
);
ok(figure(weird, "charges").state === "Unknown", "a payment status outside the outstanding list does not become a balance");

const blankPayment = buildCloseoutPreview(
  input({
    payments: loaded([{ status: "pending", amount: null, balance_due: null, type: "rent", due_date: "2026-10-21" }]),
  }),
);
ok(figure(blankPayment, "charges").value === "Unknown", "a payment with both balance_due and amount null is unknown");
ok(figure(blankPayment, "unpaid-rent").value === "Unknown", "unpaid rent is unknown when the rent row has no amount");
ok(figure(blankPayment, "proposed-refund").value === "No Proposal", "a blank payment blocks a settlement proposal");

const probe = buildCloseoutPreview(
  input({
    payments: loaded([{ status: "pending", amount: 375, balance_due: 375, type: "rent", due_date: "2026-10-21" }]),
    tolls: loaded([
      { status: "open", amount: 15, admin_fee: 0, charge_type: "toll" },
      { status: "open", amount: 100, admin_fee: 0, charge_type: "speeding" },
    ]),
    rentalIncidents: loaded([
      { id: "inc-probe", status: "open", actual_cost: 900, estimated_cost: 900, driver_responsible_amount: 200, drivable: true },
    ]),
    deductions: loaded([{ amount: 120 }]),
  }),
);
ok(figure(probe, "charges").value === "$375.00", "the probe keeps unpaid rent inside the payment balance");
ok(figure(probe, "tolls").value === "1 · $15.00", "the probe toll stays on the toll line");
ok(figure(probe, "tickets").value === "1 · $100.00", "a speeding charge is a ticket");
const namedTickets = buildCloseoutPreview(
  input({
    tolls: loaded([
      { status: "open", amount: 1, admin_fee: 0, charge_type: "red_light" },
      { status: "open", amount: 2, admin_fee: 0, charge_type: "impound" },
    ]),
  }),
);
ok(figure(namedTickets, "tickets").value === "2 · $3.00" && !namedTickets.figures.some((item) => item.key === "other-charges"), "red light and impound are tickets");
ok(
  figure(probe, "proposed-refund").value === "$0.00" && figure(probe, "balance-due").value === "$310.00",
  "deposit 500 minus deductions 120, rent 375, toll 15, speeding 100, and driver amount 200 is balance due 310",
);

const rebilled = buildCloseoutPreview(
  input({
    payments: loaded([{ status: "pending", amount: 15, balance_due: 15, type: "toll", due_date: "2026-10-21" }]),
    tolls: loaded([{ status: "rebilled", amount: 15, admin_fee: 0, charge_type: "toll", payment_id: "pay-toll" }]),
  }),
);
ok(figure(rebilled, "tolls").value.startsWith("0"), "a rebilled toll is not an open toll");
ok(
  figure(rebilled, "proposed-refund").value === "$485.00" && figure(rebilled, "balance-due").value === "$0.00",
  "a rebilled toll is subtracted once, through its payment row",
);

const postedOpen = buildCloseoutPreview(
  input({
    payments: loaded([{ status: "pending", amount: 15, balance_due: 15, type: "toll", due_date: "2026-10-21" }]),
    tolls: loaded([{ status: "open", amount: 15, admin_fee: 0, charge_type: "toll", payment_id: "pay-toll" }]),
  }),
);
ok(
  figure(postedOpen, "proposed-refund").value === "$485.00",
  "a toll that already has a payment id is not subtracted again",
);

const futureRent = buildCloseoutPreview(
  input({
    payments: loaded([
      { status: "pending", amount: 100, balance_due: 100, type: "rent", due_date: "2026-10-21" },
      { status: "pending", amount: 400, balance_due: 400, type: "rent", due_date: "2026-10-28" },
    ]),
  }),
);
ok(figure(futureRent, "charges").value === "$500.00", "outstanding charges still include rent due after the return day");
ok(figure(futureRent, "unpaid-rent").value === "$100.00", "unpaid rent stops at the return day");
ok(
  figure(futureRent, "proposed-refund").value === "$400.00" && figure(futureRent, "balance-due").value === "$0.00",
  "settlement excludes rent due after the return day",
);

const linked = buildCloseoutPreview(
  input({
    rentalIncidents: loaded([
      { id: "inc-1", status: "open", actual_cost: 200, estimated_cost: 200, driver_responsible_amount: 200, drivable: true },
    ]),
    deductions: loaded([{ amount: 120, incident_id: "inc-1" }]),
  }),
);
ok(
  figure(linked, "proposed-refund").value === "$300.00" && figure(linked, "balance-due").value === "$0.00",
  "a deduction linked to an incident covers that much of the driver amount",
);

const paymentsUnread = buildCloseoutPreview(input({ payments: failed() }));
ok(figure(paymentsUnread, "proposed-refund").value === "No Proposal", "no settlement is proposed when payments could not be read");

const incidentSelect = fn.match(/from\("incidents"\)[\s\S]*?\.select\("([^"]+)"/);
ok(
  incidentSelect?.[1] === "id,status,actual_cost,estimated_cost,driver_responsible_amount,drivable",
  "the rental incident read uses the live columns and does not select payment_id",
);
const incidentInput = rules.slice(rules.indexOf("rentalIncidents:"), rules.indexOf("payments:"));
ok(!incidentInput.includes("payment_id"), "the incident input has no payment_id field");
ok(!rules.includes("linkedPaymentId"), "a closed incident is not skipped through a payment id the table does not have");

function heldMatches(preview: ReturnType<typeof buildCloseoutPreview>, deposit = 500): boolean {
  const costs = Number(figure(preview, "incident-costs").value.replace(/[$,]/g, ""));
  const refund = Number(figure(preview, "proposed-refund").value.replace(/[$,]/g, ""));
  const due = Number(figure(preview, "balance-due").value.replace(/[$,]/g, ""));
  return Math.round((deposit - refund + due) * 100) === Math.round(costs * 100);
}

const liveIncident = {
  id: "inc-live",
  status: "closed" as const,
  actual_cost: 999,
  estimated_cost: 999,
  driver_responsible_amount: 200,
  drivable: true,
};

const closedAlone = buildCloseoutPreview(
  input({
    rentalIncidents: loaded([liveIncident]),
  }),
);
ok(figure(closedAlone, "incident-costs").value === "$200.00", "a closed incident shows its driver amount, not a zero and not the unused repair cost");
ok(figure(closedAlone, "incident-costs").explanation.includes(CLOSED_INCIDENT_HOLD), "a closed incident is labeled for confirmation before refund");
ok(!figure(closedAlone, "incident-costs").explanation.includes(POSSIBLE_DOUBLE_COUNT), "a closed incident alone is not a double count");
ok(
  figure(closedAlone, "proposed-refund").value === "$300.00" && figure(closedAlone, "balance-due").value === "$0.00",
  "a closed $200 incident on a $500 deposit leaves a $300 refund",
);
ok(figure(closedAlone, "proposed-refund").explanation.includes(CLOSED_INCIDENT_HOLD), "the refund names the same closed-incident hold");
ok(heldMatches(closedAlone), "Incident Costs matches the amount held from the refund for a closed incident alone");

const closedPending = buildCloseoutPreview(
  input({
    payments: loaded([{ status: "pending", amount: 200, balance_due: 200, type: "damage", due_date: "2026-10-21" }]),
    rentalIncidents: loaded([{ ...liveIncident, id: "inc-pending" }]),
  }),
);
ok(figure(closedPending, "charges").value === "$200.00", "the pending damage payment stays visible as an outstanding charge");
ok(figure(closedPending, "incident-costs").value === "$200.00", "Incident Costs stays at the closed incident amount when a damage payment is also pending");
ok(figure(closedPending, "incident-costs").explanation.includes(CLOSED_INCIDENT_HOLD), "the pending-damage case still labels the closed incident");
ok(figure(closedPending, "incident-costs").explanation.includes(POSSIBLE_DOUBLE_COUNT), "a closed incident plus a pending damage payment warns of a possible double count");
ok(figure(closedPending, "proposed-refund").explanation.includes(POSSIBLE_DOUBLE_COUNT), "the refund warning is shown to the manager");
ok(
  figure(closedPending, "proposed-refund").value === "$300.00" && figure(closedPending, "balance-due").value === "$0.00",
  "a closed $200 incident plus a pending $200 damage payment does not subtract $400",
);
ok(heldMatches(closedPending), "Incident Costs matches the amount held from the refund when a damage payment is pending");

const closedPaid = buildCloseoutPreview(
  input({
    payments: loaded([{ status: "paid", amount: 200, balance_due: 0, type: "damage", due_date: "2026-10-18" }]),
    rentalIncidents: loaded([{ ...liveIncident, id: "inc-paid" }]),
  }),
);
ok(figure(closedPaid, "charges").value === "$0.00", "a paid damage payment is not an outstanding charge");
ok(figure(closedPaid, "incident-costs").value === "$200.00", "a paid damage payment does not remove the closed incident from Incident Costs");
ok(figure(closedPaid, "incident-costs").explanation.includes(POSSIBLE_DOUBLE_COUNT), "a paid damage payment beside a closed incident warns of a possible double count");
ok(
  figure(closedPaid, "proposed-refund").value === "$300.00" && figure(closedPaid, "balance-due").value === "$0.00",
  "a paid damage payment is not subtracted again, and the closed incident is still held",
);
ok(heldMatches(closedPaid), "Incident Costs matches the amount held from the refund when the damage payment is paid");

const openIncident = buildCloseoutPreview(
  input({
    rentalIncidents: loaded([
      { id: "inc-open", status: "open", actual_cost: 200, estimated_cost: 200, driver_responsible_amount: 200, drivable: true },
    ]),
  }),
);
ok(figure(openIncident, "incidents").value === "1", "an open incident is counted as open");
ok(figure(openIncident, "incident-costs").value === "$200.00", "an open incident shows its recorded cost");
ok(!figure(openIncident, "incident-costs").explanation.includes(CLOSED_INCIDENT_HOLD), "an open incident does not use the closed-incident label");
ok(!figure(openIncident, "proposed-refund").explanation.includes(POSSIBLE_DOUBLE_COUNT), "an open incident alone is not a double count");
ok(
  figure(openIncident, "proposed-refund").value === "$300.00" && figure(openIncident, "balance-due").value === "$0.00",
  "an open $200 incident on a $500 deposit leaves a $300 refund",
);
ok(heldMatches(openIncident), "Incident Costs matches the amount held from the refund for an open incident");

const openAndDamage = buildCloseoutPreview(
  input({
    payments: loaded([{ status: "pending", amount: 200, balance_due: 200, type: "damage", due_date: "2026-10-21" }]),
    rentalIncidents: loaded([
      { id: "inc-open-pay", status: "open", actual_cost: 200, estimated_cost: 200, driver_responsible_amount: 200, drivable: true },
    ]),
  }),
);
ok(
  figure(openAndDamage, "proposed-refund").value === "$100.00" &&
    !figure(openAndDamage, "proposed-refund").explanation.includes(POSSIBLE_DOUBLE_COUNT),
  "an open incident and a damage payment are both still subtracted",
);

const damageOnly = buildCloseoutPreview(
  input({
    payments: loaded([{ status: "pending", amount: 200, balance_due: 200, type: "damage", due_date: "2026-10-21" }]),
  }),
);
ok(
  figure(damageOnly, "proposed-refund").value === "$300.00" && !figure(damageOnly, "proposed-refund").explanation.includes(POSSIBLE_DOUBLE_COUNT),
  "a damage payment with no closed incident is still subtracted once",
);

const depositCharge = buildCloseoutPreview(
  input({
    payments: loaded([
      { status: "pending", amount: 500, balance_due: 500, type: "deposit", due_date: "2026-10-21" },
      { status: "pending", amount: 40, balance_due: 40, type: "rent", due_date: "2026-10-21" },
    ]),
  }),
);
ok(figure(depositCharge, "charges").value === "$540.00", "an outstanding deposit row is still a recorded charge");
ok(
  figure(depositCharge, "proposed-refund").value === "$460.00" && figure(depositCharge, "balance-due").value === "$0.00",
  "an outstanding deposit row is not subtracted from the deposit refund",
);

const disputedToll = buildCloseoutPreview(
  input({
    tolls: loaded([{ status: "disputed", amount: 15, admin_fee: 0, charge_type: "toll" }]),
  }),
);
ok(figure(disputedToll, "tolls").value === "1 disputed", "a disputed toll is shown as disputed");
ok(figure(disputedToll, "tolls").state === "Ready", "a disputed toll is informational and does not need settlement attention");
ok(figure(disputedToll, "tolls").explanation.toLowerCase().includes("not subtracted"), "the disputed toll line says it is not subtracted");
ok(
  figure(disputedToll, "proposed-refund").value === "$500.00" && figure(disputedToll, "balance-due").value === "$0.00",
  "a disputed toll is not subtracted from the refund",
);
ok(figure(disputedToll, "charges").value === "$0.00", "a disputed toll is not counted as an unposted charge");

const disputedBesideOpen = buildCloseoutPreview(
  input({
    tolls: loaded([
      { status: "open", amount: 10, admin_fee: 0, charge_type: "toll" },
      { status: "disputed", amount: 15, admin_fee: 0, charge_type: "toll" },
    ]),
  }),
);
ok(figure(disputedBesideOpen, "tolls").value === "1 · $10.00", "an open toll is still totaled when a disputed toll sits beside it");
ok(figure(disputedBesideOpen, "tolls").explanation.toLowerCase().includes("disputed"), "the open toll line still names the disputed toll");
ok(figure(disputedBesideOpen, "proposed-refund").value === "$490.00", "only the open toll is subtracted when another toll is disputed");

console.log(fails ? `\n${fails} failed` : "\ncloseout preview checks passed");
process.exit(fails ? 1 : 0);
