// Record Rental bootstrap: configuration is explicit and the download reader only
// reads finalized signed agreements. No database or provider is contacted.
import assert from "node:assert/strict";
import { buildRecordResources, readRecordRentalConfig } from "../src/lib/record-rental-resources.server";

assert.throws(() => readRecordRentalConfig({}), /RECORD_RENTAL_ISSUER_DATABASE_URL, RECORD_RENTAL_STRIPE_ENVIRONMENT/);
assert.throws(() => readRecordRentalConfig({ RECORD_RENTAL_ISSUER_DATABASE_URL: "postgres://x", RECORD_RENTAL_STRIPE_ENVIRONMENT: "test" }));
assert.deepEqual(readRecordRentalConfig({ RECORD_RENTAL_ISSUER_DATABASE_URL: "postgres://rr_evidence_transport:p@127.0.0.1/rr", RECORD_RENTAL_STRIPE_ENVIRONMENT: "live" }),
  { issuerUrl: "postgres://rr_evidence_transport:p@127.0.0.1/rr", stripeEnvironment: "live", currency: "usd" });

// A wrong login is refused when resources are built, before any request is served.
const stripe = { accounts: { retrieve: async () => ({ id: "acct_x" }) }, subscriptions: { retrieve: async () => null, list: async () => ({ data: [], has_more: false }) } };
assert.throws(() => buildRecordResources({ issuerUrl: "postgres://postgres:p@127.0.0.1/rr", stripeEnvironment: "live", currency: "usd" }, { stripe, download: async () => new Uint8Array() }), /rr_evidence_transport/);

const reads: string[] = [];
const r = buildRecordResources({ issuerUrl: "postgres://rr_evidence_transport:p@127.0.0.1/rr", stripeEnvironment: "live", currency: "usd" },
  { stripe, download: async (b, p) => { reads.push(`${b}/${p}`); return new Uint8Array([1]); } });
await assert.rejects(() => r.download({} as any, "driver-docs", "immutable-v1/x/y.pdf"), /Signed agreement archive required/);
await assert.rejects(() => r.download({} as any, "rental-agreements", "completed-v1/x/y.pdf"), /Signed agreement archive required/);
assert.deepEqual(await r.download({} as any, "rental-agreements", "immutable-v1/x/y.pdf"), new Uint8Array([1]));
assert.deepEqual(reads, ["rental-agreements/immutable-v1/x/y.pdf"]);

// Linkage refuses a driver with no portal login and never selects a customer from the request.
const ctx = (row: object) => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: row, error: null }) }) }) }) } }) as any;
const app = "10000000-0000-4000-8000-000000000001";
await assert.rejects(() => r.linkage(ctx({ id: app, user_id: null, stripe_customer_id: null, deleted_at: null }), app), /no portal login/);
const link = await r.linkage(ctx({ id: app, user_id: "10000000-0000-4000-8000-000000000002", stripe_customer_id: "not-a-customer", deleted_at: null }), app);
assert.deepEqual(link, { driverId: "10000000-0000-4000-8000-000000000002", account: "acct_x", environment: "live", currency: "usd", subscriptionId: null, customer: "" });
console.log("record-rental-resources: config, download guard and linkage checks passed");
