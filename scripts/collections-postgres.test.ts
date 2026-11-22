/**
 * 20261122143000_collections.sql against a throwaway Postgres, plus the proposed
 * Heather Bell backfill. Never reads production env.
 * Run: bun test scripts/collections-postgres.test.ts
 * Uses PG_BIN, else pg_config --bindir, else /usr/lib/postgresql/<v>/bin. Skips when no initdb.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prorateRepoWeek } from "../src/lib/collections";

function candidates(): string[] {
  const out: string[] = [];
  if (process.env.PG_BIN) out.push(process.env.PG_BIN);
  const r = spawnSync("pg_config", ["--bindir"], { encoding: "utf8" });
  if (r.status === 0 && r.stdout.trim()) out.push(r.stdout.trim());
  if (existsSync("/usr/lib/postgresql")) for (const v of readdirSync("/usr/lib/postgresql")) out.push(`/usr/lib/postgresql/${v}/bin`);
  out.push("/workspace/pg17/node_modules/@embedded-postgres/linux-x64/native/bin");
  return out;
}
const BIN = candidates().find((d) => existsSync(join(d, "initdb")) && existsSync(join(d, "pg_ctl")));
const DIR = mkdtempSync(join(tmpdir(), "rr-collections-pg-"));
const PORT = String(52000 + Math.floor(Math.random() * 4000));
const PSQL = BIN && existsSync(join(BIN, "psql")) ? join(BIN, "psql") : "psql";

function run(bin: string, args: string[]) {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${bin} ${args.join(" ")} failed\n${r.stdout}\n${r.stderr}`);
}
function psql(sql: string) {
  const r = spawnSync(PSQL, ["-h", DIR, "-p", PORT, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-q"], { input: sql, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: r.stderr ?? "" };
}
function must(sql: string) {
  const r = psql(sql);
  if (!r.ok) throw new Error(r.err);
  return r.out;
}

const STUBS = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE SCHEMA private;
CREATE FUNCTION private.is_staff() RETURNS boolean LANGUAGE sql AS 'select true';
CREATE FUNCTION private.is_manager() RETURNS boolean LANGUAGE sql AS 'select true';
CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS 'begin new.updated_at = now(); return new; end';
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, role text, created_at timestamptz DEFAULT now());
CREATE TABLE public.audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_user_id uuid, actor_email text, actor_role text,
  action text, entity_type text, entity_id text, summary text, metadata jsonb DEFAULT '{}', created_at timestamptz DEFAULT now());
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), full_name text, status text DEFAULT 'active', deleted_at timestamptz);
CREATE TABLE public.vehicles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), license_plate text, vin text, status text);
CREATE TABLE public.rentals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid, driver_id uuid NOT NULL, vehicle_id uuid,
  status text NOT NULL DEFAULT 'reserved', start_date date NOT NULL DEFAULT '2026-11-01', end_date date, weekly_rate numeric NOT NULL DEFAULT 350,
  balance_due_cents integer NOT NULL DEFAULT 0, updated_at timestamptz DEFAULT now());
CREATE TABLE public.payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rental_id uuid, driver_id uuid, vehicle_id uuid,
  type text NOT NULL DEFAULT 'rent', reason text, amount numeric(10,2) NOT NULL DEFAULT 0, balance_due numeric(10,2) NOT NULL DEFAULT 0,
  late_fees numeric(10,2) NOT NULL DEFAULT 0, late_fee_applied_through date, status text NOT NULL DEFAULT 'upcoming', due_date date, paid_date date,
  payment_method text, notes text, refunded_amount numeric(10,2) NOT NULL DEFAULT 0, stripe_invoice_id text, created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now());
`;

const OWNER = "0f0f0f0f-0000-4000-8000-000000000001";
const HEATHER = "f85939d0-9e81-4cff-9492-9f7f4358d117";
const H_RENTAL = "36973513-480e-4423-8129-2e37324ac455";
const H_VEH = "fcef9125-ddc3-45ef-9120-9a6358c4a2d9";
const H_RENT = "400fe56c-8830-4eee-b57d-c689352134d9";
const H_KEY = "c697326e-0463-4a33-8007-3b4748e7c0bf";
const MIGRATION = readFileSync(new URL("../supabase/migrations/20261122143000_collections.sql", import.meta.url), "utf8");
const BACKFILL = readFileSync(new URL("../proposed/collections/01-heather-bell-collections.sql", import.meta.url), "utf8");

const skip = !BIN;
beforeAll(() => {
  if (skip) return;
  run(join(BIN!, "initdb"), ["-D", join(DIR, "data"), "-U", "postgres", "-A", "trust"]);
  run(join(BIN!, "pg_ctl"), ["-D", join(DIR, "data"), "-l", join(DIR, "pg.log"), "-o", `-k ${DIR} -p ${PORT} -c listen_addresses=''`, "-w", "start"]);
  must(STUBS);
  must(MIGRATION);
  must(MIGRATION); // re-runnable
  must(`INSERT INTO auth.users VALUES ('${OWNER}', 'owner@example.com');
        INSERT INTO public.user_roles (user_id, role) VALUES ('${OWNER}', 'admin');
        INSERT INTO public.applications (id, full_name) VALUES ('${HEATHER}', 'Heather Bell');
        INSERT INTO public.vehicles (id, license_plate, vin) VALUES ('${H_VEH}', 'CZO7DA', '1FAHP3F2XCL118769');
        INSERT INTO public.rentals (id, application_id, driver_id, vehicle_id, status, start_date, end_date, weekly_rate, balance_due_cents)
        VALUES ('${H_RENTAL}', '${HEATHER}', gen_random_uuid(), '${H_VEH}', 'closed', '2026-11-10', '2026-11-19', 350, 60000);
        INSERT INTO public.payments (rental_id, driver_id, vehicle_id, type, reason, amount, balance_due, status, due_date, paid_date)
        VALUES ('${H_RENTAL}', '${HEATHER}', '${H_VEH}', 'rent', 'rent', 350, 0, 'paid', '2026-11-10', '2026-11-10');
        INSERT INTO public.payments (id, rental_id, driver_id, vehicle_id, type, reason, amount, balance_due, late_fees, late_fee_applied_through, status, due_date, stripe_invoice_id)
        VALUES ('${H_RENT}', '${H_RENTAL}', '${HEATHER}', '${H_VEH}', 'rent', 'rent', 350, 450, 100, '2026-11-19', 'overdue', '2026-11-17', 'in_1UcoXLGsNNO50lXbzxegwqAM');
        INSERT INTO public.payments (id, rental_id, driver_id, vehicle_id, type, reason, amount, balance_due, status, due_date, notes)
        VALUES ('${H_KEY}', '${H_RENTAL}', '${HEATHER}', '${H_VEH}', 'fee', 'Replacement key', 150, 150, 'unpaid', '2026-11-19', 'Replacement key: main key not returned');`);
});
afterAll(() => {
  if (skip) return;
  if (!process.env.KEEP_PG) spawnSync(join(BIN!, "pg_ctl"), ["-D", join(DIR, "data"), "-m", "immediate", "stop"]);
  if (!process.env.KEEP_PG) rmSync(DIR, { recursive: true, force: true });
  else console.log("PG kept at", DIR, PORT);
});

const items = (rental: string) =>
  must(`SELECT string_agg(reason || ':' || amount || ':' || amount_paid || ':' || status, ',' ORDER BY reason) FROM public.collection_items WHERE rental_id = '${rental}'`);

describe.skipIf(skip)("collections in Postgres", () => {
  test("Heather backfill: three lines, missed week prorated to day 3, off Overdue, idempotent", () => {
    must(BACKFILL);
    expect(items(H_RENTAL)).toBe("key_replacement:150.00:0.00:open,late_fees:100.00:0.00:open,unpaid_rent:150.00:0.00:open");
    const pr = JSON.parse(must(`SELECT proration FROM public.collection_items WHERE reason = 'unpaid_rent' AND rental_id = '${H_RENTAL}'`));
    expect(pr).toMatchObject({ weekly_rate: 350, daily_rate: 50, days: 3, prorated_amount: 150, original_amount: 350, week_start: "2026-11-17", repo_date: "2026-11-19" });
    // Same math as the UI's helper.
    expect(prorateRepoWeek({ weeklyRate: 350, originalAmount: 350, weekStart: "2026-11-17", repoDate: "2026-11-19" })).toMatchObject({ days: 3, amount: 150 });
    expect(must(`SELECT close_reason || '|' || repossessed_on || '|' || days_late_at_repo || '|' || balance_due_cents FROM public.rentals WHERE id = '${H_RENTAL}'`)).toBe("repossessed|2026-11-19|2|40000");
    expect(must(`SELECT string_agg(status, ',' ORDER BY due_date) FROM public.payments WHERE rental_id = '${H_RENTAL}'`)).toBe("paid,collections,collections");
    expect(must(`SELECT stripe_invoice_id FROM public.collection_items WHERE reason = 'unpaid_rent'`)).toBe("in_1UcoXLGsNNO50lXbzxegwqAM");
    must(BACKFILL);
    expect(must(`SELECT count(*) FROM public.collection_items WHERE rental_id = '${H_RENTAL}'`)).toBe("3");
    expect(items(H_RENTAL)).toBe("key_replacement:150.00:0.00:open,late_fees:100.00:0.00:open,unpaid_rent:150.00:0.00:open");
    expect(must(`SELECT actor_label FROM public.collection_item_events WHERE kind = 'prorated' LIMIT 1`)).toBe("owner@example.com");
    // A failed retry or declined charge can't put a Collections row back on Overdue.
    must(`UPDATE public.payments SET status = 'pending' WHERE id = '${H_KEY}'; UPDATE public.payments SET status = 'failed' WHERE id = '${H_KEY}'`);
    expect(must(`SELECT status FROM public.payments WHERE id = '${H_KEY}'`)).toBe("collections");
  });

  test("editing the repo date recalculates; a week after the repo owes nothing and reopens", () => {
    must(`SELECT public.record_rental_repossession('${H_RENTAL}', '2026-11-18', '${OWNER}', 'day 2')`);
    expect(items(H_RENTAL)).toContain("unpaid_rent:100.00:0.00:open");
    expect(must(`SELECT days_late_at_repo FROM public.rentals WHERE id = '${H_RENTAL}'`)).toBe("1");
    must(`SELECT public.record_rental_repossession('${H_RENTAL}', '2026-11-16', '${OWNER}', 'before the week')`);
    expect(items(H_RENTAL)).toContain("unpaid_rent:0.00:0.00:settled");
    must(`SELECT public.record_rental_repossession('${H_RENTAL}', '2026-11-19', '${OWNER}', 'back to day 3')`);
    expect(items(H_RENTAL)).toBe("key_replacement:150.00:0.00:open,late_fees:100.00:0.00:open,unpaid_rent:150.00:0.00:open");
    expect(must(`SELECT count(*) FROM public.audit_log WHERE action = 'rental.repossession_date_changed'`)).toBe("4");
    const bad = psql(`SELECT public.record_rental_repossession('${H_RENTAL}', '2026-11-01', '${OWNER}', null)`);
    expect(bad.ok).toBe(false);
    expect(bad.err).toContain("repo_date_before_start");
  });

  test("the open Stripe invoice paying later pays its own rent and late fees; a link payment pays the key", () => {
    must(`UPDATE public.payments SET status = 'paid', paid_date = '2026-11-23', balance_due = 0 WHERE id = '${H_RENT}'`);
    // $350 collected: $150 prorated rent + $100 late fees on that row. $100 stays unapplied (never
    // spills onto the key line, so an allocator marking rows paid can't double count).
    expect(items(H_RENTAL)).toBe("key_replacement:150.00:0.00:open,late_fees:100.00:100.00:paid,unpaid_rent:150.00:150.00:paid");
    // A replayed paid update never applies twice.
    must(`UPDATE public.payments SET status = 'paid' WHERE id = '${H_RENT}'`);
    must(`SELECT public.apply_payment_to_collections('${H_RENT}')`);
    expect(must(`SELECT sum(amount) FROM public.collection_payment_allocations WHERE payment_id = '${H_RENT}'`)).toBe("250.00");
    // A $150 custom payment link on the closed rental pays the key.
    must(`INSERT INTO public.payments (rental_id, driver_id, type, reason, amount, status, paid_date, payment_method)
          VALUES ('${H_RENTAL}', '${HEATHER}', 'other', 'one_off', 150, 'pending', NULL, 'card')`);
    must(`UPDATE public.payments SET status = 'paid', paid_date = '2026-11-24' WHERE reason = 'one_off'`);
    expect(items(H_RENTAL)).toBe("key_replacement:150.00:150.00:paid,late_fees:100.00:100.00:paid,unpaid_rent:150.00:150.00:paid");
  });

  test("ending a rental moves only due, uncovered rows; Reservation Fees and active rentals are untouched", () => {
    must(`INSERT INTO public.applications (id, full_name) VALUES ('11111111-0000-4000-8000-000000000001', 'Test Renter');
          INSERT INTO public.rentals (id, application_id, driver_id, status, start_date, weekly_rate)
          VALUES ('22222222-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', gen_random_uuid(), 'active', '2026-11-01', 300);
          INSERT INTO public.payments (rental_id, driver_id, type, reason, amount, balance_due, status, due_date, notes) VALUES
            ('22222222-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', 'rent', 'rent', 300, 300, 'overdue', '2026-11-08', 'old week'),
            ('22222222-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', 'rent', 'rent', 300, 300, 'failed', '2026-11-15', 'covered week'),
            ('22222222-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', 'rent', 'rent', 300, 0, 'paid', '2026-11-16', 'paid on a split row'),
            ('22222222-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', 'rent', 'rent', 300, 300, 'upcoming', '2026-11-22', 'future'),
            ('22222222-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', 'fee', 'reservation_fee', 100, 100, 'unpaid', '2026-11-01', 'reservation_fee:x');`);
    // A payment on an ACTIVE rental is ordinary rent, never Collections.
    expect(must(`SELECT count(*) FROM public.collection_payment_allocations a JOIN public.payments p ON p.id = a.payment_id WHERE p.rental_id = '22222222-0000-4000-8000-000000000001'`)).toBe("0");
    must(`UPDATE public.rentals SET status = 'closed', end_date = '2026-11-18' WHERE id = '22222222-0000-4000-8000-000000000001'`);
    expect(items("22222222-0000-4000-8000-000000000001")).toBe("unpaid_rent:300.00:0.00:open");
    expect(must(`SELECT string_agg(notes || '=' || status, ',' ORDER BY notes) FROM public.payments WHERE rental_id = '22222222-0000-4000-8000-000000000001'`))
      .toBe("covered week=failed,future=upcoming,old week=collections,paid on a split row=paid,reservation_fee:x=unpaid");
  });

  test("staff status changes and manual charges are logged with who and when", () => {
    const id = must(`SELECT public.add_collection_item('${HEATHER}', '${H_RENTAL}', 'damage', 275, 'Rear bumper', '2026-11-19', 'Body shop quote', '${OWNER}')`);
    expect(must(`SELECT vehicle_id FROM public.collection_items WHERE id = '${id}'`)).toBe(H_VEH);
    must(`SELECT public.set_collection_item_status('${id}', 'payment_plan', '${OWNER}', '$25/week agreed', 'open')`);
    const stale = psql(`SELECT public.set_collection_item_status('${id}', 'written_off', '${OWNER}', 'x', 'open')`);
    expect(stale.ok).toBe(false);
    expect(stale.err).toContain("status_changed_elsewhere");
    must(`SELECT public.set_collection_item_status('${id}', 'sent_to_collections', '${OWNER}', 'agency', 'payment_plan')`);
    expect(must(`SELECT string_agg(coalesce(from_status,'-') || '>' || coalesce(to_status,'-') || '@' || actor_label, ',' ORDER BY created_at) FROM public.collection_item_events WHERE item_id = '${id}'`))
      .toBe("->open@owner@example.com,open>payment_plan@owner@example.com,payment_plan>sent_to_collections@owner@example.com");
    must(`SELECT public.update_collection_item('${id}', 300, NULL, NULL, 'Final invoice', '${OWNER}')`);
    expect(must(`SELECT amount || '|' || notes FROM public.collection_items WHERE id = '${id}'`)).toBe("300.00|Final invoice");
    const path = psql(`SELECT public.add_collection_attachment('${id}', 'collections/other/x.pdf', 'x.pdf', 'application/pdf', '${OWNER}')`);
    expect(path.ok).toBe(false);
    must(`SELECT public.add_collection_attachment('${id}', 'collections/${id}/quote.pdf', 'quote.pdf', 'application/pdf', '${OWNER}')`);
    expect(must(`SELECT count(*) FROM public.collection_item_events WHERE item_id = '${id}' AND kind IN ('amount_changed','note','attachment_added')`)).toBe("3");
    const neg = psql(`SELECT public.add_collection_item('${HEATHER}', NULL, 'other', 0, 'x', NULL, NULL, '${OWNER}')`);
    expect(neg.ok).toBe(false);
  });

  test("browser roles cannot call the write functions", () => {
    expect(must(`SELECT has_function_privilege('authenticated', 'public.record_rental_repossession(uuid, date, uuid, text)', 'EXECUTE')`)).toBe("f");
    expect(must(`SELECT has_function_privilege('authenticated', 'public.set_collection_item_status(uuid, text, uuid, text, text)', 'EXECUTE')`)).toBe("f");
    expect(must(`SELECT has_table_privilege('authenticated', 'public.collection_items', 'INSERT')`)).toBe("f");
  });
});
