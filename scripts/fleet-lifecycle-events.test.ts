// FLEET lifecycle events sweep: off by default, once per row/attempt, the
// right payloads, no phone numbers, old rows ignored. Fake database.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;
import { fakeDb } from "./fleet-fake-db";
const ev = await import("@/lib/fleet-lifecycle-events.server");
const wh = await import("@/lib/fleet-webhook.server");

const NOW = new Date("2026-11-16T15:00:00Z");
const MIN = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const L1 = "11111111-1111-4111-8111-111111111111";
const L2 = "22222222-2222-4222-8222-222222222222";
const R2 = "44444444-4444-4444-8444-444444444444";

function seed(enabled = true) {
  return fakeDb(
    {
      app_settings: enabled ? [{ key: "fleet_lifecycle_events", value: { enabled: true } }] : [],
      applications: [
        { id: L1, full_name: "Ana Test", status: "new", phone: "8135550101", vehicle_size: "sedan", pickup_date: "2026-11-18", expected_duration: "1-3 months", gig_status: "active", drive_type: "uber" },
        { id: L2, full_name: "Ben Test", status: "active", phone: "8135550102" },
      ],
      documents: [
        { id: "doc-new", driver_id: L1, category: "license_front", is_current: true, uploaded_by_role: "applicant", created_at: MIN(5) },
        { id: "doc-old", driver_id: L1, category: "gig_profile", is_current: true, created_at: MIN(600) },
        { id: "doc-veh", driver_id: null, vehicle_id: "v1", category: "registration", created_at: MIN(5) },
      ],
      rentals: [{ id: R2, application_id: L2, vehicle_id: "v2", status: "active", autopay_active: true, start_date: "2026-11-01", end_date: "2027-02-01", weekly_rate: 300, balance_due_cents: 0 }],
      payments: [
        { id: "pay-ok", driver_id: L2, rental_id: R2, type: "rent", status: "paid", amount: 300, late_fees: 0, stripe_paid_at: MIN(10), updated_at: MIN(10) },
        { id: "pay-bad", driver_id: L2, rental_id: R2, type: "rent", status: "failed", amount: 300, late_fees: 50, attempt_count: 2, last_attempt_at: MIN(3), failure_reason: "card_declined", due_date: "2026-11-15", updated_at: MIN(3) },
        { id: "pay-ancient", driver_id: L2, rental_id: R2, type: "rent", status: "paid", amount: 300, paid_date: "2026-10-01", updated_at: MIN(2) },
      ],
      audit_log: [
        { id: "au1", action: "rental.activated", entity_type: "rental", entity_id: R2, actor_role: "owner", actor_email: "staff@example.com", summary: "Activated", metadata: {}, created_at: MIN(7) },
        { id: "au2", action: "rental.returned", entity_type: "rental", entity_id: R2, actor_role: "manager", metadata: { balance_due_cents: 4200 }, created_at: MIN(6) },
        { id: "au3", action: "document.delivery_failed", entity_type: "esign_document", entity_id: "ag1", metadata: { email: "failed", sms: "not_attempted" }, created_at: MIN(4) },
        { id: "au4", action: "application.approved", entity_type: "application", entity_id: L1, created_at: MIN(4) },
      ],
      agreements: [{ id: "ag1", application_id: L1, status: "sent", email_status: "failed", sms_status: "not_attempted" }],
      fleet_webhook_deliveries: [],
    },
    { unique: { fleet_webhook_deliveries: "dedupe_key" } },
  );
}

describe("lifecycle sweep", () => {
  test("off by default: no setting, nothing queued", async () => {
    const db = seed(false);
    const r = await ev.sweepFleetLifecycleEvents(db, { now: NOW });
    expect(r).toEqual({ enabled: false, queued: 0, planned: 0 });
    expect(db.state.fleet_webhook_deliveries.length).toBe(0);
  });
  test("queues each event once; reruns add nothing", async () => {
    const db = seed();
    const r = await ev.sweepFleetLifecycleEvents(db, { now: NOW });
    const types = db.state.fleet_webhook_deliveries.map((d) => d.event_type).sort();
    expect(types).toEqual(["agreement_delivery_failed", "documents_uploaded", "payment_failed", "payment_succeeded", "rental_activated", "rental_returned"]);
    expect(r.queued).toBe(6);
    const again = await ev.sweepFleetLifecycleEvents(db, { now: NOW });
    expect(again.queued).toBe(0);
    expect(db.state.fleet_webhook_deliveries.length).toBe(6);
  });
  test("a new failed attempt on the same row is a new event", async () => {
    const db = seed();
    await ev.sweepFleetLifecycleEvents(db, { now: NOW });
    const p = db.state.payments.find((x) => x.id === "pay-bad")!;
    p.attempt_count = 3; p.last_attempt_at = MIN(1);
    const r = await ev.sweepFleetLifecycleEvents(db, { now: NOW });
    expect(r.queued).toBe(1);
  });
  test("payloads: docs still missing, balance, return balance; no phones or staff emails", async () => {
    const db = seed();
    await ev.sweepFleetLifecycleEvents(db, { now: NOW });
    const by = (t: string) => db.state.fleet_webhook_deliveries.find((d) => d.event_type === t)!.payload;
    expect(by("documents_uploaded")).toMatchObject({ lead_id: L1, document: { id: "doc-new", category: "license_front" } });
    expect(by("documents_uploaded").still_missing).toEqual(["income"]);
    expect(by("payment_failed")).toMatchObject({ payment_id: "pay-bad", failure_reason: "card_declined", attempts: 2, autopay: true });
    expect(by("payment_failed").balance.total_owed).toBe(350);
    expect(by("rental_returned")).toMatchObject({ rental_id: R2, lead_id: L2, balance_due: 42 });
    expect(by("agreement_delivery_failed")).toMatchObject({ agreement_id: "ag1", lead_id: L1, email_status: "failed" });
    const all = JSON.stringify(db.state.fleet_webhook_deliveries);
    expect(all).not.toContain("813555");
    expect(all).not.toContain("staff@example.com");
  });
  test("old rows touched later are not news", async () => {
    const db = seed();
    await ev.sweepFleetLifecycleEvents(db, { now: NOW });
    expect(db.state.fleet_webhook_deliveries.some((d) => d.dedupe_key === "payment_succeeded:pay-ancient")).toBe(false);
  });
});

describe("wiring", () => {
  test("event names are in the queue type and the proposed CHECK keeps today's nine", () => {
    const sql = readFileSync("proposed/fleet-lifecycle-events-v1.sql", "utf8");
    for (const e of [...wh.FLEET_LIFECYCLE_EVENTS, "lead_created", "stage_changed", "quo_message_received", "quo_call", "quo_voicemail", "quo_transcript", "agreement_signed_by_renter", "application_ready_for_review", "reservation_confirmed"]) {
      expect(sql).toContain(`'${e}'`);
    }
  });
  test("cron runs the sweep inside its own try", () => {
    const src = readFileSync("src/routes/api/public/cron/fleet-webhooks.ts", "utf8");
    expect(src).toContain("sweepFleetLifecycleEvents");
    expect(src.indexOf("sweepFleetLifecycleEvents")).toBeLessThan(src.indexOf("dispatchFleetWebhooks(supabaseAdmin"));
  });
});
