// Charge metadata required on every Stripe payment the site creates.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  buildChargeMetadata,
  CARD_SETUP_NOT_A_CHARGE,
  StripeMetadataError,
  withCheckoutChargeMetadata,
  withPaymentIntentMetadata,
} from "../src/lib/stripe-charge-metadata";

const full = {
  rentalId: "11111111-1111-4111-8111-111111111111",
  leadId: "22222222-2222-4222-8222-222222222222",
  reason: "rent",
  forDate: "2026-11-20",
  renter: "Regina Littles",
  plate: "cz-06da",
};

describe("stripe charge metadata", () => {
  test("an active rental charge requires every field on both Checkout slots", () => {
    const meta = buildChargeMetadata(full, { kind: "rental" });
    expect(meta.plate).toBe("CZ06DA");
    expect(meta.rentalId).toBe(full.rentalId);
    expect(meta.applicationId).toBe(full.leadId);
    const session = withCheckoutChargeMetadata(
      { mode: "payment", metadata: { paymentIds: "p1" }, payment_intent_data: { setup_future_usage: "off_session", metadata: { paymentIds: "p1" } } },
      meta,
      { kind: "rental" },
    );
    expect(session.metadata.rental_id).toBe(full.rentalId);
    expect(session.payment_intent_data.metadata.for_date).toBe("2026-11-20");
    expect(session.payment_intent_data.metadata.paymentIds).toBe("p1");
    expect(() => buildChargeMetadata({ ...full, plate: "" }, { kind: "rental" })).toThrow(StripeMetadataError);
    expect(() => withPaymentIntentMetadata({ metadata: { reason: "rent" } }, {}, { kind: "rental" })).toThrow(/plate/);
  });

  test("a pre-rental Reservation Fee may omit rental_id and a missing plate", () => {
    const meta = buildChargeMetadata(
      { leadId: "app1", reason: "reservation_fee", forDate: "2026-11-16", renter: "Test Renter" },
      { kind: "pre_rental", allowBlankPlate: true },
    );
    expect(meta.rental_id).toBeUndefined();
    expect(meta.plate).toBeUndefined();
    expect(meta.lead_id).toBe("app1");
    expect(() => buildChargeMetadata(
      { leadId: "app1", reason: "reservation_fee", forDate: "2026-11-16", renter: "Test Renter" },
      { kind: "pre_rental" },
    )).toThrow(/plate/);
    expect(() => buildChargeMetadata(
      { reason: "reservation_fee", forDate: "2026-11-16", renter: "Test Renter", plate: "ABC123" },
      { kind: "pre_rental", allowBlankPlate: true },
    )).toThrow(/lead_id/);
  });

  test("card setup is marked as not a charge", () => {
    expect(CARD_SETUP_NOT_A_CHARGE).toBe("card_setup");
  });

  test("every Stripe create site stamps charge metadata or is a card setup", () => {
    const root = join(import.meta.dir, "../src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith(".ts")) files.push(path);
      }
    };
    walk(root);
    const create = /paymentLinks\.create|checkout\.sessions\.create|paymentIntents\.create|subscriptions\.create|invoices\.create\(/;
    const marker = /buildChargeMetadata|chargeMetadataForRental|CARD_SETUP_NOT_A_CHARGE|withCheckoutChargeMetadata|withPaymentIntentMetadata|subscriptionChargeMetadata|invoiceChargeMetadata/;
    const creators = files.filter((path) => create.test(readFileSync(path, "utf8")));
    expect(creators.length).toBeGreaterThan(0);
    for (const path of creators) {
      expect(readFileSync(path, "utf8")).toMatch(marker);
    }
  });
});
