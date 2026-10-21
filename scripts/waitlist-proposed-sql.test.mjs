/**
 * Throwaway PGlite only. The proposed SQL files are not migrations and this
 * test does not connect to a hosted database.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const rateSql = readFileSync("proposed/waitlist-coming-soon-rate-v1.sql", "utf8");
const tokenSql = readFileSync("proposed/waitlist-claim-token-v1.sql", "utf8");

const WAITLIST = `
  CREATE SCHEMA IF NOT EXISTS public;
  CREATE TABLE public.waitlist (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    market_id uuid,
    full_name text NOT NULL,
    email text NOT NULL,
    phone text,
    driver_status text,
    source text NOT NULL DEFAULT 'homepage_waitlist',
    utm_source text,
    utm_medium text,
    utm_campaign text,
    utm_term text,
    utm_content text,
    gclid text,
    created_at timestamptz NOT NULL DEFAULT now(),
    city text,
    state text,
    status text NOT NULL DEFAULT 'waiting',
    pickup_date date,
    notified_at timestamptz,
    promoted_application_id uuid,
    promoted_at timestamptz,
    review_reason text,
    review_flagged_at timestamptz
  );
`;

let passed = 0;
function check(cond, label) {
  assert.equal(cond, true, label);
  passed += 1;
  console.log("PASS", label);
}

async function asRole(db, role, sql) {
  await db.exec("BEGIN");
  try {
    await db.exec(`SET LOCAL ROLE ${role}`);
    const result = await db.exec(sql);
    await db.exec("COMMIT");
    return result;
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

const rate = new PGlite();
await rate.exec(`
  ${WAITLIST}
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
  ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
  GRANT INSERT ON public.waitlist TO anon, authenticated;
  GRANT SELECT ON public.waitlist TO authenticated;
  CREATE POLICY waitlist_insert ON public.waitlist
    FOR INSERT TO anon, authenticated WITH CHECK (true);
  CREATE POLICY waitlist_select_hidden ON public.waitlist
    FOR SELECT TO authenticated USING (false);
`);
await rate.exec(rateSql);

const def = await rate.query(`
  SELECT prosecdef, proconfig
  FROM pg_proc
  WHERE proname = 'waitlist_coming_soon_email_limit'
`);
check(def.rows[0]?.prosecdef === true, "the rate function is security definer");
check(
  (def.rows[0]?.proconfig ?? []).some((item) => item.replace(/"/g, "") === "search_path="),
  "the rate function pins an empty search_path",
);
const fn = await rate.query(`SELECT pg_get_functiondef('public.waitlist_coming_soon_email_limit()'::regprocedure) AS def`);
const fnDef = String(fn.rows[0]?.def);
check(fnDef.includes("pg_catalog.pg_advisory_xact_lock") && fnDef.includes("NEW.created_at := pg_catalog.now()") && !fnDef.includes("homepage_waitlist"), "the rate function locks one email, stamps created_at, and counts every source");
const index = await rate.query(`
  SELECT indexdef FROM pg_indexes
  WHERE indexname = 'waitlist_coming_soon_email_created_idx'
`);
check(String(index.rows[0]?.indexdef).includes("lower(email)") && String(index.rows[0]?.indexdef).includes("created_at"), "the rate index is on lower(email), created_at");

let anonInserts = 0;
for (let i = 0; i < 5; i += 1) {
  await asRole(rate, "anon", `INSERT INTO public.waitlist (full_name, email, source) VALUES ('Sam', 'sam@example.com', 'homepage_waitlist')`);
  anonInserts += 1;
}
check(anonInserts === 5, "anon can insert Coming Soon rows");
let sixth = "";
try {
  await asRole(rate, "anon", `INSERT INTO public.waitlist (full_name, email, source) VALUES ('Sam', 'sam@example.com', 'homepage_waitlist')`);
} catch (error) {
  sixth = String(error?.message ?? error);
}
check(sixth.includes("waitlist coming soon rate limit") && !sixth.includes("permission denied"), "the sixth anon insert is the email limit, not a permission error");

let otherSource = 0;
for (let i = 0; i < 5; i += 1) {
  await asRole(rate, "anon", `INSERT INTO public.waitlist (full_name, email, source) VALUES ('Mix', 'mix@example.com', 'office')`);
  otherSource += 1;
}
check(otherSource === 5, "other-source rows insert until the same email limit");
let mixed = "";
try {
  await asRole(rate, "anon", `INSERT INTO public.waitlist (full_name, email, source) VALUES ('Mix', 'mix@example.com', 'homepage_waitlist')`);
} catch (error) {
  mixed = String(error?.message ?? error);
}
check(mixed.includes("waitlist coming soon rate limit"), "other-source rows count toward the email limit");

let backdated = 0;
for (let i = 0; i < 5; i += 1) {
  await asRole(rate, "anon", `INSERT INTO public.waitlist (full_name, email, source, created_at) VALUES ('Back', 'back@example.com', 'homepage_waitlist', now() - interval '2 days')`);
  backdated += 1;
}
check(backdated === 5, "a backdated insert is accepted until the email limit");
const stamped = await rate.query(`
  SELECT bool_and(created_at > now() - interval '5 minutes') AS recent
  FROM public.waitlist
  WHERE email = 'back@example.com'
`);
check(stamped.rows[0]?.recent === true, "the trigger rewrites a backdated created_at to now");
let sixthBackdated = "";
try {
  await asRole(rate, "anon", `INSERT INTO public.waitlist (full_name, email, source, created_at) VALUES ('Back', 'back@example.com', 'homepage_waitlist', now() - interval '2 days')`);
} catch (error) {
  sixthBackdated = String(error?.message ?? error);
}
check(sixthBackdated.includes("waitlist coming soon rate limit"), "a backdated sixth insert is still limited");

const visible = await asRole(rate, "authenticated", "SELECT count(*)::int AS n FROM public.waitlist");
check(Number(visible[0]?.rows?.[0]?.n ?? visible?.rows?.[0]?.n ?? 0) === 0, "RLS hides waitlist rows from authenticated");
let authed = "";
try {
  await asRole(rate, "authenticated", `INSERT INTO public.waitlist (full_name, email, source) VALUES ('Sam', 'Sam@Example.com', 'homepage_waitlist')`);
} catch (error) {
  authed = String(error?.message ?? error);
}
check(authed.includes("waitlist coming soon rate limit"), "the email limit still trips when RLS hides the rows");
await rate.close();

const grants = new PGlite();
await grants.exec(`
  ${WAITLIST}
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
  GRANT INSERT ON public.waitlist TO anon, authenticated;
  GRANT SELECT, UPDATE ON public.waitlist TO authenticated;
`);
await grants.exec(tokenSql);
await asRole(grants, "anon", `INSERT INTO public.waitlist (full_name, email) VALUES ('Ada', 'ada@example.com')`);
check(true, "anon can still insert a Coming Soon row without the hash");
let hashed = "";
try {
  await asRole(grants, "anon", `INSERT INTO public.waitlist (full_name, email, claim_token_hash) VALUES ('Ada', 'ada2@example.com', 'secret')`);
} catch (error) {
  hashed = String(error?.message ?? error);
}
check(/permission denied/i.test(hashed) && !/rate limit/i.test(hashed), "anon cannot insert claim_token_hash");
const columnGrants = await grants.query(`
  SELECT grantee, privilege_type, column_name
  FROM information_schema.column_privileges
  WHERE table_schema = 'public' AND table_name = 'waitlist'
    AND grantee IN ('anon', 'authenticated')
    AND privilege_type IN ('INSERT', 'UPDATE')
    AND column_name = 'claim_token_hash'
`);
check(columnGrants.rows.length === 0, "claim_token_hash is absent from anon and authenticated column grants");
const emailGrant = await grants.query(`
  SELECT privilege_type FROM information_schema.column_privileges
  WHERE table_name = 'waitlist' AND grantee = 'anon' AND column_name = 'email' AND privilege_type = 'INSERT'
`);
check(emailGrant.rows.length === 1, "anon keeps an explicit insert grant on email");
let updated = "";
try {
  await asRole(grants, "authenticated", `UPDATE public.waitlist SET claim_token_hash = 'secret' WHERE email = 'ada@example.com'`);
} catch (error) {
  updated = String(error?.message ?? error);
}
check(/permission denied/i.test(updated), "authenticated cannot update claim_token_hash");
await asRole(grants, "authenticated", `UPDATE public.waitlist SET phone = '5550100' WHERE email = 'ada@example.com'`);
check(true, "authenticated can still update an ordinary column");
let promoted = "";
try {
  await asRole(grants, "anon", `INSERT INTO public.waitlist (full_name, email, status) VALUES ('Ada', 'ada-promoted@example.com', 'promoted')`);
} catch (error) {
  promoted = String(error?.message ?? error);
}
check(/permission denied/i.test(promoted), "anon cannot insert status promoted");
let stampedGrant = "";
try {
  await asRole(grants, "anon", `INSERT INTO public.waitlist (full_name, email, created_at) VALUES ('Ada', 'ada-back@example.com', now())`);
} catch (error) {
  stampedGrant = String(error?.message ?? error);
}
check(/permission denied/i.test(stampedGrant), "anon cannot insert created_at");
const anonInsertCols = await grants.query(`
  SELECT column_name FROM information_schema.column_privileges
  WHERE table_schema = 'public' AND table_name = 'waitlist'
    AND grantee = 'anon' AND privilege_type = 'INSERT'
  ORDER BY column_name
`);
check(
  JSON.stringify(anonInsertCols.rows.map((row) => row.column_name)) === JSON.stringify([
    "driver_status", "email", "full_name", "gclid", "market_id", "phone", "source",
    "utm_campaign", "utm_content", "utm_medium", "utm_source", "utm_term",
  ]),
  "anon insert privileges are only the 12 coming soon columns",
);
let hashSelect = "";
try {
  await asRole(grants, "authenticated", "SELECT claim_token_hash FROM public.waitlist");
} catch (error) {
  hashSelect = String(error?.message ?? error);
}
check(/permission denied/i.test(hashSelect), "staff cannot select claim_token_hash");
await asRole(grants, "authenticated", "SELECT market_id FROM public.waitlist");
check(true, "staff can select market_id");
const selectHash = await grants.query(`
  SELECT column_name FROM information_schema.column_privileges
  WHERE table_schema = 'public' AND table_name = 'waitlist'
    AND grantee = 'authenticated' AND privilege_type = 'SELECT'
    AND column_name = 'claim_token_hash'
`);
check(selectHash.rows.length === 0, "claim_token_hash has no authenticated select grant");
await grants.close();

console.log(`${passed} proposed waitlist SQL checks passed`);
