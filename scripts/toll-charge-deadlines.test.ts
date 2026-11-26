// Pay By, overdue pills, statement due dates, and Payment Link matching.
// No database, no Stripe, no network. Run: bun test scripts/toll-charge-deadlines.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";

import { oneOffIdentity, type OneOffIdentity } from "../src/lib/one-off-payment.ts";
import { insertMatchedOneOff } from "../src/lib/one-off-payment.server.ts";
import { linkPaidTollCharge } from "../src/lib/toll-charge-sync.server.ts";
import { mapHeaders, parseTollStatement } from "../src/lib/toll-import.ts";
import {
  AGENCY_DUE_SOON_DAYS,
  PAY_BY_LEAD_DAYS,
  chargeDeadlineFlags,
  defaultRenterPayBy,
  pickTollChargeMatch,
  resolveChargeDeadlines,
  shouldLinkPaidTollCharge,
} from "../src/lib/toll-charge-deadlines.ts";

const RENTAL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const APP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VEH = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

type Row = Record<string, any>;

describe("pay by", () => {
  it("defaults to the agency due date minus the lead days", () => {
    assert.equal(PAY_BY_LEAD_DAYS, 7);
    assert.equal(defaultRenterPayBy("2026-11-30"), "2026-11-23");
    assert.equal(defaultRenterPayBy("2026-01-03"), "2025-12-27");
    assert.equal(defaultRenterPayBy("2026-03-01"), "2026-02-22");
    assert.equal(defaultRenterPayBy("2024-03-01"), "2024-02-23");
    assert.equal(defaultRenterPayBy("2026-11-30T15:00:00Z"), "2026-11-23");
  });

  it("returns null when there is no agency date", () => {
    assert.equal(defaultRenterPayBy(null), null);
    assert.equal(defaultRenterPayBy(""), null);
    assert.equal(defaultRenterPayBy("not-a-date"), null);
    assert.equal(defaultRenterPayBy("2026-02-31"), null);
  });

  it("honors a different lead time without changing the exported default", () => {
    assert.equal(defaultRenterPayBy("2026-11-30", 10), "2026-11-20");
    assert.equal(defaultRenterPayBy("2026-11-30", 0), "2026-11-30");
    assert.equal(PAY_BY_LEAD_DAYS, 7);
  });

  it("keeps an edited pay-by and fills the default only when pay-by is omitted", () => {
    assert.deepEqual(resolveChargeDeadlines({ agencyDueDate: "2026-11-30" }), {
      agency_due_date: "2026-11-30",
      renter_pay_by: "2026-11-23",
    });
    assert.deepEqual(resolveChargeDeadlines({ agencyDueDate: "2026-11-30", renterPayBy: "2026-11-28" }), {
      agency_due_date: "2026-11-30",
      renter_pay_by: "2026-11-28",
    });
    assert.deepEqual(resolveChargeDeadlines({ agencyDueDate: "2026-11-30", renterPayBy: null }), {
      agency_due_date: "2026-11-30",
      renter_pay_by: null,
    });
    assert.equal(resolveChargeDeadlines({}), null);
    assert.equal(resolveChargeDeadlines({ agencyDueDate: null, renterPayBy: null }), null);
  });
});

describe("overdue", () => {
  const today = "2026-11-26";

  it("is overdue only after pay-by, and only while the charge is unpaid", () => {
    assert.equal(AGENCY_DUE_SOON_DAYS, 3);
    assert.deepEqual(chargeDeadlineFlags({ status: "assigned", renter_pay_by: "2026-11-25", agency_due_date: "2026-12-01" }, today), {
      overdue: true,
      agencyDueSoon: false,
    });
    assert.equal(chargeDeadlineFlags({ status: "assigned", renter_pay_by: today }, today).overdue, false);
    assert.equal(chargeDeadlineFlags({ status: "rebilled", renter_pay_by: "2026-11-20" }, today).overdue, true);
    assert.equal(chargeDeadlineFlags({ status: "disputed", renter_pay_by: "2026-11-20" }, today).overdue, true);
    assert.equal(chargeDeadlineFlags({ status: "paid", renter_pay_by: "2026-11-20" }, today).overdue, false);
    assert.equal(chargeDeadlineFlags({ status: "written_off", renter_pay_by: "2026-11-20" }, today).overdue, false);
    assert.equal(chargeDeadlineFlags({ status: "assigned", renter_pay_by: null }, today).overdue, false);
  });

  it("flags agency due soon for today through three days out", () => {
    assert.equal(chargeDeadlineFlags({ status: "assigned", agency_due_date: today }, today).agencyDueSoon, true);
    assert.equal(chargeDeadlineFlags({ status: "assigned", agency_due_date: "2026-11-29" }, today).agencyDueSoon, true);
    assert.equal(chargeDeadlineFlags({ status: "assigned", agency_due_date: "2026-11-30" }, today).agencyDueSoon, false);
    assert.equal(chargeDeadlineFlags({ status: "assigned", agency_due_date: "2026-11-25" }, today).agencyDueSoon, false);
    assert.equal(chargeDeadlineFlags({ status: "paid", agency_due_date: "2026-11-28" }, today).agencyDueSoon, false);
  });

  it("can be overdue and agency-due-soon at the same time", () => {
    assert.deepEqual(
      chargeDeadlineFlags({ status: "assigned", renter_pay_by: "2026-11-20", agency_due_date: "2026-11-28" }, today),
      { overdue: true, agencyDueSoon: true },
    );
  });
});

describe("statement due dates", () => {
  it("maps a due-date header to the agency date and leaves amount due alone", () => {
    assert.deepEqual(mapHeaders(["Amount Due", "Due Date"]), ["amount", "agencyDue"]);
    assert.deepEqual(mapHeaders(["Due"]), ["amount"]);
    assert.deepEqual(mapHeaders(["Transaction Date", "Due Date"]), ["occurredAt", "agencyDue"]);
    assert.deepEqual(mapHeaders(["Toll Due", "Date"]), ["amount", "occurredAt"]);

    const parsed = parseTollStatement(
      "License Plate,Transaction Date,Amount Due,Due Date,Plaza,Transaction ID\nABC1234,01/05/2026 8:15 AM,$12.50,02/01/2026,Veterans,SP-100\n",
    );
    assert.equal(parsed.rows[0].amount, 12.5);
    assert.equal(parsed.rows[0].agencyDueDate, "2026-02-01");
    assert.ok(parsed.rows[0].occurredAt?.startsWith("2026-01-05"));
    assert.equal(parsed.rows[0].reference, "SP-100");
    assert.deepEqual(parsed.rows[0].errors, []);
    assert.ok(!parsed.unmappedHeaders.includes("Due Date"));
    assert.ok(!parsed.unmappedHeaders.includes("Amount Due"));

    const amountOnly = parseTollStatement("Plate,Date,Due\nABC1234,01/05/2026,4.50\n");
    assert.equal(amountOnly.rows[0].amount, 4.5);
    assert.equal(amountOnly.rows[0].agencyDueDate, null);
    assert.deepEqual(amountOnly.rows[0].errors, []);
  });
});

describe("webhook matching", () => {
  it("reads the notice and the qualifying reason off the payment link", () => {
    const id = oneOffIdentity({
      paymentIntent: { id: "pi_toll", amount_received: 7500, currency: "usd", metadata: {} },
      paymentLink: { id: "plink_toll", metadata: { reason: "school_zone_ticket", notice: "NZ-44" } },
    });
    assert.equal(id?.reason, "school_zone_ticket");
    assert.equal(id?.notice, "NZ-44");
    assert.equal(id?.paymentLinkId, "plink_toll");
    assert.equal(shouldLinkPaidTollCharge(id?.reason, id?.notice), true);
    assert.equal(shouldLinkPaidTollCharge("fee", "N-1"), true);
    assert.equal(shouldLinkPaidTollCharge("toll", null), false);
    assert.equal(shouldLinkPaidTollCharge("fee", "  "), false);
    assert.equal(shouldLinkPaidTollCharge("rent", "N-1"), false);
    assert.equal(shouldLinkPaidTollCharge("daily_50", "N-1"), false);
  });

  it("prefers the payment link, then the notice plus the rental, and refuses ambiguity", () => {
    const link = pickTollChargeMatch(
      [
        { id: "by-link", stripe_payment_link_id: "plink_1", rental_id: OTHER, reference_number: "OTHER" },
        { id: "by-notice", rental_id: RENTAL, reference_number: "NZ-44" },
      ],
      { paymentLinkId: "plink_1", notice: "NZ-44", rentalId: RENTAL, paymentId: "pay-1" },
    );
    assert.deepEqual(link, { ok: true, id: "by-link", by: "payment_link" });

    const notice = pickTollChargeMatch(
      [{ id: "by-notice", rental_id: RENTAL, reference_number: "nz-44", status: "assigned" }],
      { paymentLinkId: "plink_missing", notice: "NZ-44", rentalId: RENTAL, paymentId: "pay-1" },
    );
    assert.deepEqual(notice, { ok: true, id: "by-notice", by: "notice" });

    assert.equal(
      pickTollChargeMatch(
        [{ id: "other-rental", rental_id: OTHER, reference_number: "NZ-44" }],
        { notice: "NZ-44", rentalId: RENTAL, paymentId: "pay-1" },
      ).ok,
      false,
    );
    assert.deepEqual(
      pickTollChargeMatch(
        [
          { id: "a", stripe_payment_link_id: "plink_1" },
          { id: "b", stripe_payment_link_id: "plink_1" },
        ],
        { paymentLinkId: "plink_1", notice: "NZ-44", rentalId: RENTAL, paymentId: "pay-1" },
      ),
      { ok: false, why: "ambiguous_link" },
    );
    assert.deepEqual(
      pickTollChargeMatch(
        [
          { id: "a", rental_id: RENTAL, reference_number: "NZ-44" },
          { id: "b", rental_id: RENTAL, reference_number: "NZ-44" },
        ],
        { notice: "NZ-44", rentalId: RENTAL, paymentId: "pay-1" },
      ),
      { ok: false, why: "ambiguous_notice" },
    );
    assert.deepEqual(
      pickTollChargeMatch(
        [{ id: "paid", status: "paid", payment_id: "other", stripe_payment_link_id: "plink_1" }],
        { paymentLinkId: "plink_1", paymentId: "pay-1" },
      ),
      { ok: false, why: "already_paid" },
    );
    assert.equal(pickTollChargeMatch([], { notice: "NZ-44", rentalId: RENTAL }).ok, false);
  });

  it("marks the matching charge paid and does not create one", async () => {
    const db = fakeAdmin({
      toll_charges: [
        { id: "c-link", status: "assigned", payment_id: null, reference_number: "NO", rental_id: OTHER, stripe_payment_link_id: "plink_toll" },
        { id: "c-notice", status: "assigned", payment_id: null, reference_number: "NZ-44", rental_id: RENTAL },
      ],
    });
    const result = await linkPaidTollCharge(db, {
      paymentId: "pay-9",
      paymentLinkId: "plink_toll",
      notice: "NZ-44",
      rentalId: RENTAL,
      reason: "school_zone_ticket",
    });
    assert.deepEqual(result, { linked: true, id: "c-link", by: "payment_link" });
    assert.equal(db.state.toll_charges.length, 2);
    assert.deepEqual(
      db.state.toll_charges.find((row) => row.id === "c-link"),
      { id: "c-link", status: "paid", payment_id: "pay-9", reference_number: "NO", rental_id: OTHER, stripe_payment_link_id: "plink_toll" },
    );
    assert.equal(db.state.toll_charges.find((row) => row.id === "c-notice")?.status, "assigned");
    assert.deepEqual(Object.keys(db.updates[0].payload).sort(), ["payment_id", "status"]);
  });

  it("matches notice plus rental when the link id is not on a charge", async () => {
    const db = fakeAdmin({
      toll_charges: [{ id: "c1", status: "rebilled", payment_id: "rebill-1", reference_number: "NZ-44", rental_id: RENTAL }],
    });
    const result = await linkPaidTollCharge(db, {
      paymentId: "pay-9",
      paymentLinkId: "plink_new",
      notice: " nz-44 ",
      rentalId: RENTAL,
      reason: "fee",
    });
    assert.deepEqual(result, { linked: true, id: "c1", by: "notice" });
    assert.equal(db.state.toll_charges[0].status, "paid");
    assert.equal(db.state.toll_charges[0].payment_id, "pay-9");
    assert.equal(db.state.toll_charges.length, 1);
  });

  it("leaves every charge alone when nothing matches or the match is ambiguous", async () => {
    const none = fakeAdmin({
      toll_charges: [{ id: "c1", status: "assigned", reference_number: "OTHER", rental_id: RENTAL }],
    });
    const missed = await linkPaidTollCharge(none, {
      paymentId: "pay-9",
      paymentLinkId: "plink_x",
      notice: "NZ-44",
      rentalId: RENTAL,
      reason: "citation",
    });
    assert.equal(missed.linked, false);
    assert.equal(none.updates.length, 0);
    assert.equal(none.state.toll_charges[0].status, "assigned");
    assert.equal(none.state.toll_charges.length, 1);

    const ambiguous = fakeAdmin({
      toll_charges: [
        { id: "a", status: "assigned", stripe_payment_link_id: "plink_x", rental_id: RENTAL },
        { id: "b", status: "assigned", stripe_payment_link_id: "plink_x", rental_id: RENTAL },
      ],
    });
    const both = await linkPaidTollCharge(ambiguous, {
      paymentId: "pay-9",
      paymentLinkId: "plink_x",
      notice: "NZ-44",
      rentalId: RENTAL,
      reason: "red_light",
    });
    assert.deepEqual(both, { linked: false, why: "ambiguous_link" });
    assert.equal(ambiguous.updates.length, 0);
    assert.equal(ambiguous.state.toll_charges[0].status, "assigned");
    assert.equal(ambiguous.state.toll_charges[1].status, "assigned");
  });

  it("does not query when the payment is not a noticed toll, ticket, or fee", async () => {
    const admin = { from() { throw new Error("queried"); } };
    const result = await linkPaidTollCharge(admin, {
      paymentId: "pay-9",
      paymentLinkId: "plink_x",
      notice: "NZ-44",
      rentalId: RENTAL,
      reason: "rent",
    });
    assert.deepEqual(result, { linked: false, why: "not_applicable" });
  });

  it("falls back to the notice when the payment-link column is not installed", async () => {
    const db = fakeAdmin(
      { toll_charges: [{ id: "c1", status: "assigned", payment_id: null, reference_number: "NZ-44", rental_id: RENTAL }] },
      { missingLinkColumn: true },
    );
    const result = await linkPaidTollCharge(db, {
      paymentId: "pay-9",
      paymentLinkId: "plink_toll",
      notice: "NZ-44",
      rentalId: RENTAL,
      reason: "ticket",
    });
    assert.deepEqual(result, { linked: true, id: "c1", by: "notice" });
    assert.equal(db.state.toll_charges[0].status, "paid");
    assert.equal(db.state.toll_charges[0].payment_id, "pay-9");
  });

  it("does not replace a charge already paid by a different payment", async () => {
    const db = fakeAdmin({
      toll_charges: [{ id: "c1", status: "paid", payment_id: "pay-old", reference_number: "NZ-44", rental_id: RENTAL, stripe_payment_link_id: "plink_toll" }],
    });
    const result = await linkPaidTollCharge(db, {
      paymentId: "pay-new",
      paymentLinkId: "plink_toll",
      notice: "NZ-44",
      rentalId: RENTAL,
      reason: "toll",
    });
    assert.deepEqual(result, { linked: false, why: "already_paid" });
    assert.equal(db.updates.length, 0);
    assert.equal(db.state.toll_charges[0].payment_id, "pay-old");
  });

  it("links the charge from the one-off payment recorder", async () => {
    const db = fakeAdmin({
      toll_charges: [{ id: "c1", status: "assigned", payment_id: null, reference_number: "NZ-44", rental_id: RENTAL }],
    });
    const written = await insertMatchedOneOff(db, tollIdentity(), { id: RENTAL, application_id: APP, vehicle_id: VEH, status: "active" }, "metadata");
    assert.equal(written.inserted, true);
    assert.ok(written.paymentId);
    assert.equal(db.state.payments.length, 1);
    assert.equal(db.state.payments[0].type, "fee");
    assert.equal(db.state.toll_charges.length, 1);
    assert.equal(db.state.toll_charges[0].status, "paid");
    assert.equal(db.state.toll_charges[0].payment_id, written.paymentId);
  });
});

describe("staff and portal dates", () => {
  it("shows the agency deadline beside Pay By for staff, and only Pay By for the renter", () => {
    const panel = readFileSync("src/components/admin/ChargesPanel.tsx", "utf8");
    assert.match(panel, /Agency Deadline/);
    assert.match(panel, /Pay By/);
    assert.match(panel, /testId="charge-deadlines"/);
    assert.match(panel, /testId="charge-detail-deadlines"/);
    assert.match(panel, /data-testid=\{testId\}/);
    assert.match(panel, /Charge Detail/);
    assert.equal(panel.includes("md:hidden"), false);
    const cardStart = panel.indexOf("function DeadlinePair");
    const cardEnd = panel.indexOf("function DeadlineColumn");
    const pair = panel.slice(cardStart, cardEnd);
    assert.match(pair, /grid-cols-2/);
    assert.match(pair, /Agency Deadline/);
    assert.match(pair, /Pay By/);

    const portal = readFileSync("src/routes/portal.tsx", "utf8");
    const start = portal.indexOf("function MyChargesCard");
    const end = portal.indexOf("function DriverReceiptsGate");
    const card = portal.slice(start, end);
    assert.match(card, /Pay By/);
    assert.equal(card.includes("agency_due_date"), false);
    assert.equal(card.includes("Agency Deadline"), false);
  });
});

describe("migration", () => {
  const sql = readFileSync("supabase/migrations/20261126200000_toll_charge_deadlines.sql", "utf8");

  it("adds the deadline columns and does not touch RLS", () => {
    for (const column of ["agency_due_date", "renter_pay_by", "escalation", "escalated_at", "stripe_payment_link_id"]) {
      assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
    }
    assert.match(sql, /CHECK \(escalation IN \('none', 'disputed', 'affidavit_filed', 'transferred'\)\)/);
    assert.match(sql, /DEFAULT 'none'/);
    assert.doesNotMatch(sql, /CREATE POLICY/i);
    assert.doesNotMatch(sql, /DROP POLICY/i);
    assert.doesNotMatch(sql, /ROW LEVEL SECURITY/i);
    assert.doesNotMatch(sql, /\bGRANT\b/i);
    assert.doesNotMatch(sql, /\bREVOKE\b/i);
  });
});

function tollIdentity(): OneOffIdentity {
  return {
    paymentIntentId: "pi_toll_notice",
    chargeId: "ch_toll_notice",
    sessionId: "cs_toll_notice",
    paymentLinkId: "plink_toll_notice",
    rentalId: RENTAL,
    applicationIds: [],
    plates: [],
    forDate: null,
    weeks: [],
    renterName: null,
    customerIds: [],
    emails: [],
    phones: [],
    billingNames: [],
    amountCents: 7500,
    currency: "usd",
    paidAt: null,
    purpose: null,
    reason: "school_zone_ticket",
    notice: "NZ-44",
    receiptUrl: null,
    paymentMethod: "card",
  };
}

function fakeAdmin(seed: { toll_charges?: Row[]; payments?: Row[] }, opts: { missingLinkColumn?: boolean } = {}) {
  const state: Record<string, Row[]> = {
    toll_charges: (seed.toll_charges ?? []).map((row) => ({ ...row })),
    payments: (seed.payments ?? []).map((row) => ({ ...row })),
    notifications: [],
  };
  const updates: Array<{ table: string; payload: Row }> = [];
  let nextId = 1;
  function from(table: string) {
    state[table] ??= [];
    let op: "select" | "insert" | "update" = "select";
    let payload: Row | null = null;
    let errored: { code: string; message: string } | null = null;
    const filters: Array<(row: Row) => boolean> = [];
    const b: any = {
      select(cols?: string) {
        if (op === "select" && opts.missingLinkColumn && String(cols ?? "").includes("stripe_payment_link_id")) {
          errored = { code: "42703", message: "column stripe_payment_link_id does not exist" };
        }
        return b;
      },
      insert(row: Row) {
        op = "insert";
        payload = row;
        return b;
      },
      update(row: Row) {
        op = "update";
        payload = row;
        return b;
      },
      eq(column: string, value: unknown) {
        filters.push((row) => row[column] === value);
        return b;
      },
      ilike(column: string, pattern: string) {
        const raw = pattern.replace(/\\([\\%_])/g, "$1");
        filters.push((row) => String(row[column] ?? "").toLowerCase() === raw.toLowerCase());
        return b;
      },
      then(resolve: any, reject: any) {
        return Promise.resolve(run()).then(resolve, reject);
      },
    };
    function run() {
      if (errored) return { data: null, error: errored };
      const hit = () => state[table].filter((row) => filters.every((filter) => filter(row)));
      if (op === "insert") {
        if (table === "toll_charges") return { data: null, error: { message: "refusing to create a toll charge" } };
        const row = { id: `gen-${nextId++}`, ...payload };
        state[table].push(row);
        return { data: [row], error: null };
      }
      if (op === "update") {
        const rows = hit();
        for (const row of rows) Object.assign(row, payload);
        updates.push({ table, payload: payload ?? {} });
        return { data: rows.map((row) => ({ id: row.id })), error: null };
      }
      return { data: hit(), error: null };
    }
    return b;
  }
  return { from, state, updates };
}
