// Record Rental end to end against the local harness (scripts/record-rental-harness):
// production-order baseline + M2 packet with hosted amendments, real PostgREST,
// a real rr_evidence_transport login, simulated Stripe. Never a hosted backend.
// Run: bash scripts/record-rental-harness/up.sh && bash scripts/record-rental-harness/seed.sh
//      bun scripts/record-rental-e2e.test.ts
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import { buildRecordResources, existingSubscriptionId, type RecordStripeReader } from "../src/lib/record-rental-resources.server";
import { createRecordRentalTransportV2, finalizeRecordArchiveV2, type RentalContext } from "../src/lib/record-rental-runtime.server";
import { executeRecordRental } from "../src/lib/record-rental-operation.server";
import { parseIssuerUrl } from "../src/lib/record-rental-issuer-sql.server";

const DB = "postgresql://postgres@127.0.0.1:55462/rr?sslmode=disable";
const GATEWAY = "http://127.0.0.1:55464";
const SECRET = "record-rental-harness-jwt-secret-not-a-real-key-0000";
const ISSUER = "postgres://rr_evidence_transport:harness-transport-only@127.0.0.1:55462/rr?sslmode=disable";
const OWNER = "11111111-1111-4111-8111-111111111111", OWNER_SESSION = "33333333-3333-4333-8333-333333333333";
const COORD = "c0000000-0000-4000-8000-00000000c001", COORD_SESSION = "c0000000-0000-4000-8000-00000000c002";
const APP = "44444444-4444-4444-8444-444444444444", VEHICLE = "77777777-7777-4777-8777-777777777777";
const VEHICLE2 = "78888888-7777-4777-8777-777777777777", AGREEMENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STARTED = "2026-10-01T15:00:00+00:00";

const db = postgres(DB, { max: 1, onnotice: () => {} });
const results: string[] = [];
const pass = (name: string) => { results.push(name); console.log(`PASS ${name}`); };

function jwt(sub: string, session: string, role = "authenticated") {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const body = `${b({ alg: "HS256", typ: "JWT" })}.${b({ sub, session_id: session, role, aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  return `${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`;
}
function context(sub: string, session: string): { ctx: RentalContext; token: string } {
  const token = jwt(sub, session);
  const supabase = createClient(GATEWAY, jwt("00000000-0000-4000-8000-000000000000", OWNER_SESSION, "anon"), {
    auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  return { ctx: { supabase: supabase as any, userId: sub, claims: { sub, session_id: session } }, token };
}

// Simulated Stripe: exactly three reads; anything else (create, update, charge, ...) throws.
function fakeStripe(subs: Record<string, any[]>, calls: string[]): RecordStripeReader {
  const reader = {
    accounts: { retrieve: async () => { calls.push("accounts.retrieve"); return { id: "acct_harness" }; } },
    subscriptions: {
      list: async (p: any) => { calls.push("subscriptions.list"); const d = subs[p.customer] ?? []; return { data: d, has_more: false }; },
      retrieve: async (id: string) => { calls.push("subscriptions.retrieve"); const s = Object.values(subs).flat().find((x) => x.id === id); if (!s) throw new Error("no such subscription"); return s; },
    },
  };
  const guard = (o: any, name: string): any => new Proxy(o, { get(t, k) {
    if (typeof k === "symbol" || k === "then") return t[k];
    if (!(k in t)) throw new Error(`Stripe write or unexpected call attempted: ${name}.${String(k)}`);
    return typeof t[k] === "object" ? guard(t[k], `${name}.${String(k)}`) : t[k]; } });
  return guard(reader, "stripe");
}
const weeklySub = (id: string, customer: string, cents: number) => ({ id, customer, livemode: false, status: "active",
  items: { has_more: false, data: [{ quantity: 1, current_period_end: Math.floor(Date.parse("2026-10-29T15:00:00Z") / 1000), price: { currency: "usd", unit_amount: cents, recurring: { interval: "week", interval_count: 1 } } }] } });

async function agreementBytes() {
  const [r] = await db`select bytes from public.rr_harness_bytes where slot = 'agreement'`;
  return new Uint8Array(r.bytes);
}
function resources(stripe: RecordStripeReader) {
  return buildRecordResources({ issuerUrl: ISSUER, stripeEnvironment: "sandbox", currency: "usd" }, {
    stripe, download: async (_b, path) => { assert.match(path, /^immutable-v1\//); return agreementBytes(); } });
}
const request = (over: Record<string, unknown> = {}) => ({ operationId: randomUUID(), applicationId: APP, vehicleId: VEHICLE,
  startedAt: STARTED, weeklyRate: 250, deposit: 300, pickupMileage: 42100, subscriptionEvidenceId: null, reason: "Recording an existing rental from the paper ledger", ...over });
async function counts() {
  const [c] = await db`select (select count(*) from public.rentals where application_id = ${APP})::int rentals,
    (select count(*) from public.payments)::int payments`;
  return c;
}
async function refuses(name: string, run: () => Promise<unknown>, pattern: RegExp) {
  const before = await counts();
  let message = "";
  await assert.rejects(run, (e: any) => { message = String(e?.message ?? e); assert.match(message, pattern); return true; });
  assert.deepEqual(await counts(), before, `${name} changed rentals or payments`);
  pass(`${name} (${message.split("\n")[0].slice(0, 90)})`);
}

try {
  // Fixture: a Coordinator with a live session.
  await db`insert into auth.users(id, email, email_confirmed_at) values (${COORD}, 'coordinator@example.test', now()) on conflict do nothing`;
  await db`insert into auth.sessions(id, user_id, not_after) values (${COORD_SESSION}, ${COORD}, now() + interval '1 day') on conflict do nothing`;
  await db`insert into public.user_roles(user_id, role) values (${COORD}, 'coordinator') on conflict do nothing`;

  assert.throws(() => parseIssuerUrl("postgres://authenticator:x@127.0.0.1:55462/rr"), /rr_evidence_transport/);
  assert.throws(() => parseIssuerUrl("postgres://rr_evidence_transport:x@db.example.supabase.co:5432/postgres"), /TLS/);
  assert.equal(parseIssuerUrl("postgres://rr_evidence_transport.abcd:x@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require").ssl, "require");
  pass("issuer URL accepts only the dedicated login, and only over TLS off-host");

  // Agreement archive adoption through the app's finalizer and the transport's bindDocument.
  const owner = context(OWNER, OWNER_SESSION);
  const archive = new Map<string, Uint8Array>();
  const store = { upload: async (p: string, b: Uint8Array) => { if (archive.has(p)) return { error: new Error("exists") }; archive.set(p, b); return { error: null }; },
    download: async (p: string) => ({ data: archive.get(p) ?? null, error: archive.has(p) ? null : new Error("missing") }) };
  const archived = await finalizeRecordArchiveV2(owner.ctx, owner.token, resources(fakeStripe({}, [])), store, AGREEMENT, await agreementBytes());
  const [bound] = await db`select integrity_v1->>'agreement' agreement, storage_path from public.documents where id = '99999999-9999-4999-8999-999999999999'`;
  assert.equal(bound.agreement, AGREEMENT); assert.equal(bound.storage_path, archived.path);
  pass("signed agreement archived and bound through finalizeRecordArchiveV2 over the issuer transport");

  const signal = new AbortController().signal;
  const coord = context(COORD, COORD_SESSION);
  await refuses("Coordinator cannot record", () => executeRecordRental(request(), COORD,
    createRecordRentalTransportV2(coord.ctx, coord.token, resources(fakeStripe({}, []))), signal), /Owner or Manager required/);
  await refuses("rate that differs from the signed terms is refused", () => executeRecordRental(request({ weeklyRate: 260 }), OWNER,
    createRecordRentalTransportV2(owner.ctx, owner.token, resources(fakeStripe({}, []))), signal), /evidence unavailable or mismatched/);
  await refuses("start date that differs from the signed terms is refused", () => executeRecordRental(request({ startedAt: "2026-10-02T15:00:00+00:00" }), OWNER,
    createRecordRentalTransportV2(owner.ctx, owner.token, resources(fakeStripe({}, []))), signal), /evidence unavailable or mismatched/);
  await refuses("browser-supplied subscription evidence is refused", () => executeRecordRental(request({ subscriptionEvidenceId: randomUUID() }), OWNER,
    createRecordRentalTransportV2(owner.ctx, owner.token, resources(fakeStripe({}, []))), signal), /Client evidence overrides/);
  await refuses("a different staff session cannot reuse the request", () => executeRecordRental(request(), COORD,
    createRecordRentalTransportV2(owner.ctx, owner.token, resources(fakeStripe({}, []))), signal), /Session changed|mismatched/);

  // Ambiguous Stripe linkage is refused, never guessed.
  await db`update public.applications set stripe_customer_id = 'cus_harness1' where id = ${APP}`;
  const two = { cus_harness1: [weeklySub("sub_harnessA", "cus_harness1", 25000), weeklySub("sub_harnessB", "cus_harness1", 25000)] };
  await assert.rejects(() => existingSubscriptionId({ ...fakeStripe(two, []), subscriptions: { list: async () => ({ data: two.cus_harness1, has_more: false }), retrieve: async () => null } } as any, "cus_harness1"), /more than one active/);
  pass("more than one active Stripe subscription is refused");
  await refuses("subscription amount that differs from the signed terms is refused", () => executeRecordRental(request(), OWNER,
    createRecordRentalTransportV2(owner.ctx, owner.token, resources(fakeStripe({ cus_harness1: [weeklySub("sub_harnessW", "cus_harness1", 30000)] }, []))), signal), /evidence unavailable or mismatched/);

  // The recording itself.
  const calls: string[] = [];
  const stripe = fakeStripe({ cus_harness1: [weeklySub("sub_harness1", "cus_harness1", 25000)] }, calls);
  const req = request();
  const before = await counts();
  const result = await executeRecordRental(req, OWNER, createRecordRentalTransportV2(owner.ctx, owner.token, resources(stripe)), signal);
  assert.equal(result.status, "recorded"); assert.equal(result.recovered, false);
  assert.equal(result.billing, "unchanged"); assert.equal(result.paymentsImported, 0);
  const [rental] = await db`select r.status, r.start_date::text, r.weekly_rate::float8 rate, r.deposit_amount::float8 deposit, r.stripe_subscription_id, r.stripe_customer_id,
      r.next_payment_due::text due, v.status vehicle_status, a.assignment_start, a.pickup_mileage
    from public.rentals r join public.vehicles v on v.id = r.vehicle_id join public.booking_vehicle_assignments a on a.rental_id = r.id where r.id = ${result.rentalId}`;
  assert.equal(rental.status, "active"); assert.equal(rental.start_date, "2026-10-01");
  assert.equal(Date.parse(rental.assignment_start), Date.parse(STARTED));
  assert.equal(rental.rate, 250); assert.equal(rental.deposit, 300); assert.equal(rental.pickup_mileage, 42100);
  assert.equal(rental.stripe_subscription_id, "sub_harness1"); assert.equal(rental.stripe_customer_id, "cus_harness1");
  assert.equal(rental.vehicle_status, "rented");
  pass("existing rental recorded: historical start date and staff-entered terms preserved, vehicle assigned");
  const after = await counts();
  assert.equal(after.rentals, before.rentals + 1); assert.equal(after.payments, before.payments);
  assert.deepEqual([...new Set(calls)].sort(), ["accounts.retrieve", "subscriptions.list", "subscriptions.retrieve"]);
  pass("Stripe was only read: no charge, subscription or payment row created");
  const [audit] = await db`select count(*)::int n from public.audit_log where action = 'rental.recorded_existing' and entity_id = ${result.rentalId}`;
  assert.equal(audit.n, 1); pass("one audit row for the recording");

  const again = await executeRecordRental(req, OWNER, createRecordRentalTransportV2(owner.ctx, owner.token, resources(fakeStripe({ cus_harness1: [weeklySub("sub_harness1", "cus_harness1", 25000)] }, []))), signal);
  assert.equal(again.recovered, true); assert.equal(again.rentalId, result.rentalId);
  assert.equal((await counts()).rentals, after.rentals);
  pass("same operation recovers the committed rental instead of recording twice");

  await refuses("a second recording for the same driver and vehicle is refused", () => executeRecordRental(request(), OWNER,
    createRecordRentalTransportV2(owner.ctx, owner.token, resources(fakeStripe({ cus_harness1: [weeklySub("sub_harness1", "cus_harness1", 25000)] }, []))), signal), /mismatched|unavailable|conflict|duplicate/i);
  await refuses("the same driver cannot get a second active rental on another vehicle", () => executeRecordRental(request({ vehicleId: VEHICLE2 }), OWNER,
    createRecordRentalTransportV2(owner.ctx, owner.token, resources(fakeStripe({}, []))), signal), /unavailable|mismatched|conflict/i);

  // The database itself holds one active rental per driver and per vehicle, whatever the caller.
  for (const [name, column, value] of [["driver", "driver_id", "22222222-2222-4222-8222-222222222222"], ["vehicle", "vehicle_id", VEHICLE]] as const) {
    await assert.rejects(() => db.begin(async (tx) => {
      await tx.unsafe("SET LOCAL session_replication_role = replica"); // bypass app triggers; the unique index still applies
      const [r] = await tx`select * from public.rentals where id = ${result.rentalId}`;
      await tx`insert into public.rentals ${tx({ ...r, id: randomUUID(), stripe_subscription_id: null, stripe_customer_id: null, [column]: value, ...(column === "driver_id" ? { vehicle_id: VEHICLE2 } : { driver_id: COORD, application_id: APP }) })}`;
    }), (e: any) => /rentals_one_active_per_/.test(e.constraint_name ?? e.message));
    pass(`database refuses a second active rental for the same ${name}`);
  }

  const direct = await coord.ctx.supabase.rpc("record_existing_rental_evidence_v1", { token: randomUUID(), req: request() });
  assert.ok(direct.error, "coordinator reached the consumption RPC"); pass(`Coordinator calling the consumption RPC directly is refused (${(direct.error as any).code ?? ""})`);
  // Closeout of the recorded rental, exactly as rentals.functions.ts calls it.
  const closeArgs = { _operation_id: randomUUID(), _rental_id: result.rentalId, _ended_at: new Date().toISOString(),
    _vehicle_status: "available", _return_miles: 43900, _reason: "Driver returned the vehicle" };
  const coordClose = await coord.ctx.supabase.rpc("close_recorded_rental_v2", closeArgs);
  assert.ok(coordClose.error); pass(`Coordinator cannot close the recorded rental (${(coordClose.error as any).message})`);
  const paymentsBeforeClose = (await counts()).payments;
  const closed = await owner.ctx.supabase.rpc("close_recorded_rental_v2", closeArgs);
  assert.equal(closed.error, null, (closed.error as any)?.message);
  const c = closed.data as any;
  assert.equal(c.contract, "record-close-v2"); assert.equal(c.rentalId, result.rentalId); assert.equal(c.billing, "unchanged"); assert.equal(c.recovered, false);
  const [afterClose] = await db`select r.status, r.end_date::text end_date, v.status vehicle_status from public.rentals r join public.vehicles v on v.id = r.vehicle_id where r.id = ${result.rentalId}`;
  assert.notEqual(afterClose.status, "active"); assert.equal(afterClose.vehicle_status, c.vehicleStatus); assert.ok(afterClose.end_date);
  // Safe release: the car only goes back to Available when its readiness checks pass.
  if (c.vehicleStatus !== "available") assert.ok(c.releaseReasons.length > 0, "vehicle held without a stated reason");
  assert.equal((await counts()).payments, paymentsBeforeClose);
  pass(`recorded rental closed: rental ${afterClose.status} on ${afterClose.end_date}, vehicle ${c.vehicleStatus} (${c.releaseReasons.join(", ") || "released"}), billing unchanged`);
  const replay = await owner.ctx.supabase.rpc("close_recorded_rental_v2", closeArgs);
  assert.equal(replay.error, null); assert.equal((replay.data as any).recovered, true);
  pass("closeout replay with the same operation recovers instead of closing twice");

  const [{ jobs }] = await db`select count(*)::int jobs from cron.job`;
  assert.equal(jobs, 0); pass("no scheduled job committed");
  console.log(`\nrecord-rental-e2e: ${results.length} checks passed`);
} finally {
  await db.end();
}
