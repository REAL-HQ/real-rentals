// Stored Stripe method labels and the Payments column text.
// Run: bun test scripts/stripe-payment-method.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { paymentSource, type OwnerPaymentLink } from "../src/lib/owner-pnl.ts";
import { invoicePaymentMethod, paymentMethodLabel, stripeChargePaymentMethod } from "../src/lib/stripe-payment-method.ts";

function pay(over: Partial<OwnerPaymentLink>): OwnerPaymentLink {
  return { id: "p", vehicleId: null, type: "rent", paymentIntentId: null, invoiceId: null, subscriptionId: null, ...over };
}

describe("stripe charge payment method", () => {
  it("maps the types staff see on a charge", () => {
    assert.equal(stripeChargePaymentMethod({ payment_method_details: { type: "card" } }), "card");
    assert.equal(stripeChargePaymentMethod({ payment_method_details: { type: "link" } }), "link");
    assert.equal(stripeChargePaymentMethod({ payment_method_details: { type: "us_bank_account" } }), "ach");
    assert.equal(stripeChargePaymentMethod({ payment_method_details: { type: "cashapp" } }), "cash_app");
    assert.equal(stripeChargePaymentMethod({ payment_method_details: { type: "klarna" } }), "klarna");
    assert.equal(stripeChargePaymentMethod({ payment_method_details: { type: "  CARD " } }), "card");
  });

  it("stays blank when the charge has no type", () => {
    assert.equal(stripeChargePaymentMethod(null), null);
    assert.equal(stripeChargePaymentMethod({}), null);
    assert.equal(stripeChargePaymentMethod({ payment_method_details: null }), null);
    assert.equal(stripeChargePaymentMethod({ payment_method_details: { type: "" } }), null);
  });

  it("reads an invoice charge and falls back to card", () => {
    assert.equal(invoicePaymentMethod({ charge: { payment_method_details: { type: "link" } } }), "link");
    assert.equal(invoicePaymentMethod({ charge: "ch_1" }), "card");
    assert.equal(invoicePaymentMethod({}), "card");
    assert.equal(invoicePaymentMethod({
      payments: { data: [{ payment: { charge: { payment_method_details: { type: "us_bank_account" } } } }] },
    }), "ach");
  });
});

describe("payment method label", () => {
  it("title-cases stored labels", () => {
    assert.equal(paymentMethodLabel("card"), "Card");
    assert.equal(paymentMethodLabel("link"), "Link");
    assert.equal(paymentMethodLabel("ach"), "ACH");
    assert.equal(paymentMethodLabel("cash_app"), "Cash App");
    assert.equal(paymentMethodLabel("cashapp"), "Cash App");
    assert.equal(paymentMethodLabel("zelle"), "Zelle");
    assert.equal(paymentMethodLabel("klarna"), "Klarna");
  });

  it("shows Stripe when a blank method still has a Stripe id", () => {
    assert.equal(paymentMethodLabel(null, { stripe_payment_intent_id: "pi_1" }), "Stripe");
    assert.equal(paymentMethodLabel("", { stripe_invoice_id: "in_1" }), "Stripe");
    assert.equal(paymentMethodLabel(null, {}), "—");
    assert.equal(paymentMethodLabel(null, { stripe_payment_intent_id: "  " }), "—");
    assert.equal(paymentMethodLabel("card", { stripe_payment_intent_id: "pi_1" }), "Card");
  });
});

describe("owner P&L still treats Stripe methods as Stripe", () => {
  it("keeps Link, ACH and Stripe Cash App with the charge, and staff Cash App separate", () => {
    assert.equal(paymentSource(pay({ paymentMethod: "link", paymentIntentId: "pi_1" })), "stripe");
    assert.equal(paymentSource(pay({ paymentMethod: "ach", paymentIntentId: "pi_1" })), "stripe");
    assert.equal(paymentSource(pay({ paymentMethod: "cash_app", paymentIntentId: "pi_1" })), "stripe");
    assert.equal(paymentSource(pay({ paymentMethod: "cash_app" })), "cash_app");
    assert.equal(paymentSource(pay({ paymentMethod: "zelle" })), "zelle");
    assert.equal(paymentSource(pay({ paymentMethod: "klarna", paymentIntentId: "pi_1" })), "stripe");
    assert.equal(paymentSource(pay({ paymentMethod: null, paymentIntentId: "pi_1" })), "stripe");
  });
});
