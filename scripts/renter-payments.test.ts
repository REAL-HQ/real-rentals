import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  applicationIdOf,
  extractPaymentReceiptFields,
  formatPaymentAmount,
  formatPaymentDateEt,
  isSuccessfulPaymentAmount,
  matchRenterPayment,
  paidDateOf,
  shouldNotifyRenter,
  subscriptionIdOf,
  toRenterPaymentListItem,
  visibleRenterPayments,
} from "../src/lib/renter-payments.ts";

const RENTAL = "83668a8d-1868-45c5-bb20-38f54491ab6c";
const APP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const APP2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const invoice = {
  id: "in_1Uazl0GsNNO50lXbay3VpfNc",
  number: "M5F0G0N6-0001",
  customer: "cus_VcEDuYOeYmG1MF",
  hosted_invoice_url: "https://invoice.stripe.com/i/example",
  invoice_pdf: "https://pay.stripe.com/invoice/example/pdf",
  payment_intent: "pi_3Uazl8GsNNO50lXb0tuVRsRP",
  amount_paid: 35000,
  created: 1794496666,
  status_transitions: { paid_at: 1794497023 },
  metadata: { application_id: "baa6dacd-fcfe-47b7-84a1-04952903f514" },
  charge: {
    id: "ch_3Uazl8GsNNO50lXb0MLfQVff",
    receipt_url: "https://pay.stripe.com/receipts/invoices/example",
  },
};

describe("extractPaymentReceiptFields", () => {
  it("stores invoice number, hosted and pdf links, and a charge receipt url", () => {
    const fields = extractPaymentReceiptFields(invoice);
    assert.equal(fields.stripe_invoice_id, invoice.id);
    assert.equal(fields.stripe_invoice_number, "M5F0G0N6-0001");
    assert.equal(fields.stripe_hosted_invoice_url, invoice.hosted_invoice_url);
    assert.equal(fields.stripe_invoice_pdf_url, invoice.invoice_pdf);
    assert.equal(fields.stripe_receipt_url, invoice.charge.receipt_url);
    assert.equal(fields.stripe_charge_id, invoice.charge.id);
    assert.equal(fields.stripe_customer_id, "cus_VcEDuYOeYmG1MF");
    assert.equal(fields.stripe_payment_intent_id, invoice.payment_intent);
    assert.equal(fields.stripe_paid_at, new Date(1794497023 * 1000).toISOString());
  });

  it("reads a 2026 invoice subscription and a py_ charge id", () => {
    const fields = extractPaymentReceiptFields({
      id: "in_1UaHCP",
      parent: { subscription_details: { subscription: "sub_1UaHCfGsNNO50lXb8na9TVzS" } },
      latest_charge: { id: "py_3UaH9iGsNNO50lXb0TLOUrbz", receipt_url: "https://pay.stripe.com/receipts/py" },
    });
    assert.equal(fields.stripe_subscription_id, "sub_1UaHCfGsNNO50lXb8na9TVzS");
    assert.equal(fields.stripe_charge_id, "py_3UaH9iGsNNO50lXb0TLOUrbz");
    assert.equal(fields.stripe_receipt_url, "https://pay.stripe.com/receipts/py");
  });
});

describe("matchRenterPayment", () => {
  const rental = {
    id: RENTAL,
    application_id: APP,
    vehicle_id: "vvvvvvvv-vvvv-4vvv-8vvv-vvvvvvvvvvvv",
    status: "active",
    stripe_subscription_id: "sub_1UWam8GsNNO50lXbvvIo4ZQI",
    stripe_customer_id: "cus_VXg511exteJySE",
  };

  it("matches a rental by subscription first", () => {
    const match = matchRenterPayment(
      { subscriptionId: rental.stripe_subscription_id, customerId: "cus_other" },
      { rentals: [rental], applications: [] },
    );
    assert.equal(match.via, "subscription");
    assert.equal(match.rentalId, RENTAL);
    assert.equal(match.driverId, APP);
    assert.equal(shouldNotifyRenter(match), true);
  });

  it("matches a rental by customer when the subscription has moved on", () => {
    const match = matchRenterPayment(
      { subscriptionId: "sub_1UQwOjGsNNO50lXbq8y8hkVs", customerId: rental.stripe_customer_id },
      { rentals: [rental], applications: [] },
    );
    assert.equal(match.via, "customer_rental");
    assert.equal(match.rentalId, RENTAL);
  });

  it("matches an application by customer when there is no rental yet", () => {
    const match = matchRenterPayment(
      { subscriptionId: "sub_1UaHCfGsNNO50lXb8na9TVzS", customerId: "cus_VbU7iYF9nlh0cR" },
      { rentals: [], applications: [{ id: APP, stripe_customer_id: "cus_VbU7iYF9nlh0cR" }] },
    );
    assert.equal(match.via, "customer_application");
    assert.equal(match.rentalId, null);
    assert.equal(match.driverId, APP);
    assert.equal(shouldNotifyRenter(match), false);
  });

  it("matches a one-time invoice from metadata.application_id", () => {
    const match = matchRenterPayment(
      { customerId: "cus_VcEDuYOeYmG1MF", applicationId: applicationIdOf(invoice) },
      { rentals: [], applications: [{ id: "baa6dacd-fcfe-47b7-84a1-04952903f514" }] },
    );
    assert.equal(match.via, "application_metadata");
    assert.equal(match.driverId, "baa6dacd-fcfe-47b7-84a1-04952903f514");
    assert.equal(shouldNotifyRenter(match), false);
  });

  it("reuses a prior payment's renter for a historical customer", () => {
    const match = matchRenterPayment(
      { customerId: "cus_VRq4RFWitpMvSV", subscriptionId: "sub_1UQwOjGsNNO50lXbq8y8hkVs" },
      {
        rentals: [rental],
        applications: [],
        priorPayments: [{ rental_id: RENTAL, driver_id: APP, vehicle_id: rental.vehicle_id, stripe_customer_id: "cus_VRq4RFWitpMvSV" }],
      },
    );
    assert.equal(match.via, "prior_payment");
    assert.equal(match.rentalId, RENTAL);
  });

  it("does not notify when the invoice is for a different subscription than the rental", () => {
    const match = matchRenterPayment(
      { subscriptionId: "sub_old", customerId: "cus_VXg511exteJySE" },
      { rentals: [rental], applications: [] },
    );
    assert.equal(match.rentalId, RENTAL);
    assert.equal(match.rentalSubscriptionId, rental.stripe_subscription_id);
    assert.equal(shouldNotifyRenter(match), false);
  });

  it("keeps an unmatched payment visible instead of dropping it", () => {
    const match = matchRenterPayment(
      { invoiceId: "in_unknown", customerId: "cus_unknown" },
      { rentals: [rental], applications: [] },
    );
    assert.equal(match.via, "unmatched");
    assert.equal(match.rentalId, null);
    assert.equal(match.driverId, null);
    assert.equal(shouldNotifyRenter(match), false);
  });

  it("does not assign a renter when two applications share a customer", () => {
    const match = matchRenterPayment(
      { customerId: "cus_shared" },
      {
        rentals: [],
        applications: [
          { id: APP, stripe_customer_id: "cus_shared" },
          { id: APP2, stripe_customer_id: "cus_shared" },
        ],
      },
    );
    assert.equal(match.ambiguous, true);
    assert.equal(match.driverId, null);
    assert.equal(shouldNotifyRenter(match), false);
  });
});

describe("display and filters", () => {
  it("formats the paid date in Eastern Time and hides zero-dollar rows", () => {
    assert.equal(formatPaymentDateEt("2026-11-12", "2026-11-12T15:23:43.000Z"), "Nov 12, 2026");
    assert.equal(formatPaymentAmount(350), "$350.00");
    assert.equal(isSuccessfulPaymentAmount(350), true);
    assert.equal(isSuccessfulPaymentAmount(0), false);
    const rows = visibleRenterPayments([
      { amount: 350, status: "paid" },
      { amount: 0, status: "paid" },
      { amount: 350, status: "failed" },
    ]);
    assert.equal(rows.length, 1);
    const item = toRenterPaymentListItem({
      id: "p1",
      paid_date: "2026-11-12",
      amount: 350,
      stripe_invoice_number: "M5F0G0N6-0001",
      status: "paid",
      rental_id: null,
      driver_id: null,
    });
    assert.equal(item.unmatched, true);
    assert.equal(item.invoiceNumber, "M5F0G0N6-0001");
  });

  it("uses the invoice paid_at timestamp for the Eastern date", () => {
    assert.equal(paidDateOf(invoice), "2026-11-12");
    assert.equal(subscriptionIdOf({ parent: { subscription_details: { subscription: "sub_x" } } }), "sub_x");
  });
});

describe("backfill and reminder safety", () => {
  it("prepares a backfill that is idempotent, marked already noticed, and not run", () => {
    const sql = readFileSync("proposed/payment-receipts-backfill-2026-11-12.sql", "utf8");
    assert.match(sql, /PREPARED, NOT RUN/i);
    assert.match(sql, /notified_status/);
    assert.match(sql, /'paid'/);
    assert.match(sql, /NOT EXISTS \([\s\S]*p\.stripe_invoice_id = m\.invoice_id/);
    assert.match(sql, /stripe_charge_id/);
    assert.doesNotMatch(sql, /INSERT INTO public\.rent_reminder_log/i);
    assert.doesNotMatch(sql, /\bperform\s+net\.http/i);
  });

  it("late fees and past-due reminders only read unpaid payment statuses", () => {
    const late = readFileSync("src/lib/late-fees.server.ts", "utf8");
    assert.match(late, /\.in\("status", \["failed", "overdue", "past_due", "unpaid", "late", "current"\]\)/);
    assert.doesNotMatch(late, /"paid"/);
    const reminders = readFileSync("src/routes/api/public/cron/ops-reminders.ts", "utf8");
    assert.match(reminders, /UNPAID_STATUSES/);
    const paymentReminders = readFileSync("src/lib/rent-reminders.server.ts", "utf8");
    assert.match(paymentReminders, /eq\("status", "paid"\)/);
  });
});
