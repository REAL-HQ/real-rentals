// Runs supabase/migrations/20261117070000_partner_portal_v2.sql against a
// minimal stand-in of the production schema (PGlite) and exercises
// approve_partner_submission. No network, no production database.
import { describe, expect, test, beforeAll } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const SUB = "c9bc2e5f-fe8f-409a-a10d-bff8bad6809e";
const SUB2 = "d9bc2e5f-fe8f-409a-a10d-bff8bad6809e";
const SUB3 = "e9bc2e5f-fe8f-409a-a10d-bff8bad6809e";
const ACTOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const STUB = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA private; CREATE SCHEMA extensions;
CREATE FUNCTION extensions.gen_random_uuid() RETURNS uuid LANGUAGE sql AS 'select gen_random_uuid()';
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'select null::uuid';
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid DEFAULT gen_random_uuid(), bucket_id text, name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION private.is_manager() RETURNS boolean LANGUAGE sql AS 'select true';
CREATE FUNCTION private.is_staff() RETURNS boolean LANGUAGE sql AS 'select true';
CREATE FUNCTION private.is_partner_owner(uuid) RETURNS boolean LANGUAGE sql AS 'select false';
CREATE FUNCTION private.partner_owns_vehicle(uuid) RETURNS boolean LANGUAGE sql AS 'select false';
CREATE TABLE public.partners (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, email text, phone text,
  partner_type text NOT NULL DEFAULT 'other' CHECK (partner_type IN ('vehicle_owner','capital_partner','private_lender','jv_partner','other')),
  status text NOT NULL DEFAULT 'prospect' CHECK (status IN ('prospect','active','paused','closed')),
  capital_committed numeric, vehicles_contributed integer, monthly_payment numeric, notes text, documents jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), user_id uuid, revenue_split_pct numeric NOT NULL DEFAULT 50);
CREATE TABLE public.vehicles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), year int NOT NULL, make text NOT NULL, model text NOT NULL, trim text, vin text, color text,
  license_plate text, registration_state text, title_status text, current_odometer int, weekly_rate numeric, status text NOT NULL DEFAULT 'onboarding',
  partner_id uuid REFERENCES public.partners(id));
CREATE UNIQUE INDEX vehicles_vin_unique_idx ON public.vehicles (upper(vin)) WHERE vin IS NOT NULL AND vin <> '';
CREATE FUNCTION public.guard_ready() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.status IN ('available','reserved') AND (NEW.weekly_rate IS NULL OR NEW.weekly_rate <= 0) THEN RAISE EXCEPTION 'vehicle needs a positive weekly rate'; END IF; RETURN NEW; END $$;
CREATE TRIGGER vehicles_guard_ready_status BEFORE INSERT OR UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.guard_ready();
CREATE TABLE public.fleet_owner_submissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), full_name text NOT NULL, email text NOT NULL, phone text NOT NULL,
  vin text NOT NULL, year int NOT NULL, make text NOT NULL, model text NOT NULL, trim text, mileage int, title_status text, lien_status text,
  registration_state text, currently_insured boolean, condition text, photo_urls text[] NOT NULL DEFAULT '{}', message text, status text NOT NULL DEFAULT 'new',
  notes text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), partner_id uuid NOT NULL REFERENCES public.partners(id), period_start date NOT NULL, period_end date NOT NULL,
  gross_rent numeric NOT NULL DEFAULT 0, partner_share numeric NOT NULL DEFAULT 0, maintenance_share numeric NOT NULL DEFAULT 0, net_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending', paid_at timestamptz, notes text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.rentals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid);
CREATE TABLE public.audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_user_id uuid, actor_email text, actor_role text, action text, entity_type text, entity_id text, summary text, metadata jsonb, created_at timestamptz DEFAULT now());
`;
const POLICY_TABLES = ["applications", "payments", "vehicle_expenses", "issues", "maintenance_records", "documents"];

beforeAll(async () => {
  await db.exec(STUB);
  for (const t of POLICY_TABLES) await db.exec(`CREATE TABLE public.${t} (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, partner_id uuid, visibility text[], storage_bucket text, storage_path text); ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
  await db.exec(`
    CREATE POLICY "Partners can view their assigned drivers" ON public.applications FOR SELECT TO authenticated USING (private.partner_owns_vehicle(vehicle_id));
    CREATE POLICY "Partners read rentals on own vehicles" ON public.rentals FOR SELECT TO authenticated USING (private.partner_owns_vehicle(vehicle_id));
    CREATE POLICY "Partners can view their payments" ON public.payments FOR SELECT TO authenticated USING (private.partner_owns_vehicle(vehicle_id));
    CREATE POLICY "Partners view their visible documents" ON public.documents FOR SELECT TO authenticated USING (private.is_partner_owner(partner_id));
    CREATE POLICY "Partners read their driver documents" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'rental-agreements');
  `);
  // The migration ends with NOTIFY pgrst, harmless here.
  await db.exec(readFileSync(new URL("../supabase/migrations/20261117070000_partner_portal_v2.sql", import.meta.url), "utf8"));
  await db.exec(`
    INSERT INTO auth.users (id) VALUES ('${ACTOR}');
    INSERT INTO public.fleet_owner_submissions (id, full_name, email, phone, vin, year, make, model, mileage, title_status, registration_state, photo_urls)
    VALUES ('${SUB}', 'Test Owner', 'Owner@Example.com', '0000000000', '3fa6p0h73gr318847', 2016, 'Ford', 'Fusion SE', 139815, 'Clean', 'FL', '{a.jpg}'),
           ('${SUB2}', 'Test Owner', 'owner@example.com', '0000000000', '1HGCM82633A004352', 2019, 'Honda', 'Accord', 50000, 'Clean', 'FL', '{}'),
           ('${SUB3}', 'Other Owner', 'other@example.com', '0000000000', '1HGCM82633A004352', 2019, 'Honda', 'Accord', 50000, 'Clean', 'FL', '{}');
  `);
});

async function approve(id: string, rate: number | null, split = 50, list = true) {
  return db.query<{ r: any }>(`select public.approve_partner_submission($1, $2, $3, $4, $5) as r`, [id, ACTOR, rate, split, list]);
}

describe("partner portal v2 migration", () => {
  test("drops every partner read of renter data", async () => {
    const r = await db.query<{ n: number }>(`select count(*)::int n from pg_policies where policyname in ('Partners can view their assigned drivers','Partners read rentals on own vehicles','Partners can view their payments','Partners view their visible documents','Partners read their driver documents')`);
    expect(r.rows[0].n).toBe(0);
  });

  test("bucket is private and new columns exist", async () => {
    const b = await db.query<{ public: boolean }>(`select public from storage.buckets where id='partner-documents'`);
    expect(b.rows[0].public).toBe(false);
    const c = await db.query<{ n: number }>(`select count(*)::int n from information_schema.columns where table_name='partners' and column_name in ('stripe_connect_account_id','payouts_enabled','sms_consent_at','notify_rentals','business_name')`);
    expect(c.rows[0].n).toBe(5);
  });

  test("listing needs a weekly rate", async () => {
    await expect(approve(SUB, null)).rejects.toThrow(/weekly_rate_required/);
    await expect(approve(SUB, 300, 100)).rejects.toThrow(/split_out_of_range/);
  });

  test("one button: partner active, car Available with partner_id, submission approved, audited", async () => {
    const r = (await approve(SUB, 375, 60)).rows[0].r;
    expect(r.status).toBe("available");
    const p = await db.query<any>(`select * from public.partners where id=$1`, [r.partner_id]);
    expect(p.rows[0]).toMatchObject({ status: "active", email: "owner@example.com", vehicles_contributed: 1 });
    expect(Number(p.rows[0].revenue_split_pct)).toBe(60);
    expect(p.rows[0].activated_by).toBe(ACTOR);
    const v = await db.query<any>(`select * from public.vehicles where id=$1`, [r.vehicle_id]);
    expect(v.rows[0]).toMatchObject({ vin: "3FA6P0H73GR318847", status: "available", partner_id: r.partner_id, current_odometer: 139815 });
    const s = await db.query<any>(`select status, partner_id, listed_vehicle_id from public.fleet_owner_submissions where id=$1`, [SUB]);
    expect(s.rows[0]).toMatchObject({ status: "approved", partner_id: r.partner_id, listed_vehicle_id: r.vehicle_id });
    // The owner's other submission is now attached to the same partner.
    const s2 = await db.query<any>(`select partner_id from public.fleet_owner_submissions where id=$1`, [SUB2]);
    expect(s2.rows[0].partner_id).toBe(r.partner_id);
    const a = await db.query<{ n: number }>(`select count(*)::int n from public.audit_log where action='partner.submission.approved'`);
    expect(a.rows[0].n).toBe(1);
  });

  test("cannot approve twice", async () => {
    await expect(approve(SUB, 375)).rejects.toThrow(/submission_already_approved/);
  });

  test("approve without listing goes in as onboarding; same partner reused", async () => {
    const r = (await approve(SUB2, null, 50, false)).rows[0].r;
    expect(r.status).toBe("onboarding");
    const n = await db.query<{ n: number }>(`select count(*)::int n from public.partners`);
    expect(n.rows[0].n).toBe(1);
    const p = await db.query<any>(`select vehicles_contributed from public.partners where id=$1`, [r.partner_id]);
    expect(p.rows[0].vehicles_contributed).toBe(2);
  });

  test("a VIN owned by another partner is refused, nothing changes", async () => {
    await expect(approve(SUB3, 300)).rejects.toThrow(/vin_belongs_to_another_partner/);
    const s = await db.query<any>(`select status from public.fleet_owner_submissions where id=$1`, [SUB3]);
    expect(s.rows[0].status).toBe("new");
    const n = await db.query<{ n: number }>(`select count(*)::int n from public.partners where email='other@example.com'`);
    expect(n.rows[0].n).toBe(0);
  });

  test("approval function is service-role only", async () => {
    const r = await db.query<{ ok: boolean }>(`select has_function_privilege('authenticated', 'public.approve_partner_submission(uuid, uuid, numeric, numeric, boolean)', 'EXECUTE') ok`);
    expect(r.rows[0].ok).toBe(false);
    const s = await db.query<{ ok: boolean }>(`select has_function_privilege('service_role', 'public.approve_partner_submission(uuid, uuid, numeric, numeric, boolean)', 'EXECUTE') ok`);
    expect(s.rows[0].ok).toBe(true);
  });

  test("idempotency key is unique", async () => {
    await db.exec(`INSERT INTO public.fleet_owner_submissions (full_name, email, phone, vin, year, make, model, idempotency_key) VALUES ('A','a@x.com','0','11111111111111111',2020,'A','B','k1')`);
    await expect(db.exec(`INSERT INTO public.fleet_owner_submissions (full_name, email, phone, vin, year, make, model, idempotency_key) VALUES ('A','a@x.com','0','11111111111111111',2020,'A','B','k1')`)).rejects.toThrow(/duplicate|unique/);
  });

  test("rollback restores the old policies", async () => {
    await db.exec(readFileSync(new URL("../proposed/partner-portal-v2-rollback.sql", import.meta.url), "utf8"));
    const r = await db.query<{ n: number }>(`select count(*)::int n from pg_policies where policyname like 'Partners%'`);
    expect(r.rows[0].n).toBeGreaterThanOrEqual(8);
    const f = await db.query<{ n: number }>(`select count(*)::int n from pg_proc where proname='approve_partner_submission'`);
    expect(f.rows[0].n).toBe(0);
  });
});
