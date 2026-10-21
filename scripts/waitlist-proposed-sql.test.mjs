/**
 * Throwaway PGlite only. The proposed SQL files are not migrations and this
 * test does not connect to a hosted database.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const rateSql = readFileSync("proposed/waitlist-coming-soon-rate-v1.sql", "utf8");
const tokenSql = readFileSync("proposed/waitlist-claim-token-v1.sql", "utf8");
const rollbackSql = readFileSync("proposed/waitlist-claim-rollback.sql", "utf8");
const landingSql = readFileSync("proposed/application-landing-length-v1.sql", "utf8");

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
check(fnDef.includes("pg_catalog.pg_advisory_xact_lock") && fnDef.includes("pg_catalog.btrim(pg_catalog.lower") && fnDef.includes("NEW.created_at := pg_catalog.now()") && !fnDef.includes("homepage_waitlist"), "the rate function locks one trimmed email, stamps created_at, and counts every source");
const index = await rate.query(`
  SELECT indexdef FROM pg_indexes
  WHERE indexname = 'waitlist_coming_soon_email_created_idx'
`);
check(String(index.rows[0]?.indexdef).includes("btrim") && String(index.rows[0]?.indexdef).includes("lower") && String(index.rows[0]?.indexdef).includes("created_at"), "the rate index is on btrim(lower(email)), created_at");

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
let padded = "";
try {
  await asRole(rate, "anon", `INSERT INTO public.waitlist (full_name, email, source) VALUES ('Sam', '  sam@example.com  ', 'homepage_waitlist')`);
} catch (error) {
  padded = String(error?.message ?? error);
}
check(padded.includes("waitlist coming soon rate limit"), "spaces around the email stay inside the same limit");

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

function sqlStatements(section) {
  return section
    .split(";")
    .map((part) => part
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim())
    .filter((statement) => statement.length > 0);
}

async function waitlistCatalog(db) {
  const result = await db.query(`
    SELECT line FROM (
      SELECT 'column|' || a.attname || '|' || pg_catalog.format_type(a.atttypid, a.atttypmod) AS line
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'waitlist' AND a.attnum > 0 AND NOT a.attisdropped
      UNION ALL
      SELECT 'index|' || indexdef
      FROM pg_catalog.pg_indexes
      WHERE schemaname = 'public' AND tablename = 'waitlist'
      UNION ALL
      SELECT 'trigger|' || t.tgname
      FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'waitlist' AND NOT t.tgisinternal
      UNION ALL
      SELECT 'function|' || p.proname
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'waitlist_coming_soon_email_limit'
      UNION ALL
      SELECT 'table_acl|' || r.rolname || '|' || e.privilege_type || '|' || e.is_grantable::text
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) e
      JOIN pg_catalog.pg_roles r ON r.oid = e.grantee
      WHERE n.nspname = 'public' AND c.relname = 'waitlist'
        AND r.rolname IN ('anon', 'authenticated')
      UNION ALL
      SELECT 'column_acl|' || r.rolname || '|' || a.attname || '|' || e.privilege_type || '|' || e.is_grantable::text
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) e
      JOIN pg_catalog.pg_roles r ON r.oid = e.grantee
      WHERE n.nspname = 'public' AND c.relname = 'waitlist'
        AND a.attnum > 0 AND NOT a.attisdropped
        AND r.rolname IN ('anon', 'authenticated')
    ) dump
    ORDER BY line
  `);
  return result.rows.map((row) => row.line).join("\n");
}

check(
  rollbackSql.includes("DROP TRIGGER IF EXISTS waitlist_coming_soon_email_limit")
    && rollbackSql.includes("DROP FUNCTION IF EXISTS public.waitlist_coming_soon_email_limit()")
    && rollbackSql.includes("DROP INDEX IF EXISTS public.waitlist_coming_soon_email_created_idx")
    && rollbackSql.includes("GRANT SELECT, INSERT, UPDATE ON TABLE public.waitlist TO authenticated")
    && rollbackSql.includes("GRANT INSERT (")
    && rollbackSql.includes("ALTER TABLE public.waitlist DROP COLUMN IF EXISTS claim_token_hash")
    && !/GRANT\s+DELETE/i.test(rollbackSql),
  "the rollback file drops the trigger, function, index, and column and restores the grants",
);

const catalog = new PGlite();
await catalog.exec(`
  ${WAITLIST}
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
  REVOKE ALL ON public.waitlist FROM anon, authenticated;
  GRANT SELECT, INSERT, UPDATE ON TABLE public.waitlist TO authenticated;
  GRANT INSERT (
    full_name, email, phone, market_id, driver_status, source,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid
  ) ON public.waitlist TO anon;
`);
const before = await waitlistCatalog(catalog);
await catalog.exec(tokenSql);
await catalog.exec(rateSql);
const applied = await waitlistCatalog(catalog);
check(applied !== before, "applying the proposal changes the waitlist catalog");
check(applied.includes("function|waitlist_coming_soon_email_limit"), "the applied catalog has the rate function");
check(applied.includes("column|claim_token_hash|text"), "the applied catalog has claim_token_hash");
check(applied.includes("trigger|waitlist_coming_soon_email_limit"), "the applied catalog has the rate trigger");
await catalog.exec(rollbackSql);
const after = await waitlistCatalog(catalog);
check(after === before, "rollback restores a pg_dump-identical waitlist catalog");
await catalog.close();

const [landingApply, landingRollback] = landingSql.split("-- ===== ROLLBACK =====");
const landingApplySql = sqlStatements(landingApply);
const landingRollbackSql = sqlStatements(landingRollback);
const landingAlters = landingApplySql.filter((statement) => statement.startsWith("ALTER"));
const landingCounts = landingApplySql.filter((statement) => statement.startsWith("SELECT"));
check(
  landingApplySql[0] === "BEGIN"
    && landingApplySql.at(-1) === "COMMIT"
    && landingCounts.length === 2
    && landingAlters.length === 4
    && landingRollbackSql.length === 2,
  "the landing length file wraps apply in a transaction and counts over-long rows",
);
check(
  landingSql.includes("CHECK (landing_page IS NULL OR length(landing_page) <= 500) NOT VALID")
    && landingSql.includes("CHECK (referrer IS NULL OR length(referrer) <= 500) NOT VALID")
    && landingSql.includes("length(landing_page) > 500")
    && landingSql.includes("length(referrer) > 500")
    && landingSql.includes("left(landing_page, 500)")
    && landingSql.includes("blocks updates of existing")
    && landingSql.includes("VALIDATE CONSTRAINT applications_landing_page_length")
    && landingSql.includes("VALIDATE CONSTRAINT applications_referrer_length")
    && landingSql.includes("DROP CONSTRAINT IF EXISTS applications_landing_page_length")
    && landingSql.includes("DROP CONSTRAINT IF EXISTS applications_referrer_length"),
  "landing_page and referrer are checked at 500 characters, with a remediation note, then the checks can be dropped",
);

const landing = new PGlite();
await landing.exec(`
  CREATE SCHEMA IF NOT EXISTS public;
  CREATE TABLE public.applications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    landing_page text,
    referrer text
  );
`);
const longLanding = "L".repeat(501);
const longReferrer = "R".repeat(501);
await landing.exec(`INSERT INTO public.applications (landing_page, referrer) VALUES ('${longLanding}', '${longReferrer}')`);
await landing.exec(`${landingAlters[0]};`);
await landing.exec(`${landingAlters[2]};`);
const unvalidated = await landing.query(`
  SELECT conname, convalidated
  FROM pg_constraint
  WHERE conname IN ('applications_landing_page_length', 'applications_referrer_length')
  ORDER BY conname
`);
check(
  unvalidated.rows.length === 2 && unvalidated.rows.every((row) => row.convalidated === false),
  "NOT VALID adds both checks without scanning the long rows",
);
let validateLanding = "";
try {
  await landing.exec(`${landingAlters[1]};`);
} catch (error) {
  validateLanding = String(error?.message ?? error);
}
check(/applications_landing_page_length/.test(validateLanding), "VALIDATE refuses the existing long landing_page");
let validateReferrer = "";
try {
  await landing.exec(`${landingAlters[3]};`);
} catch (error) {
  validateReferrer = String(error?.message ?? error);
}
check(/applications_referrer_length/.test(validateReferrer), "VALIDATE refuses the existing long referrer");
await landing.exec(`UPDATE public.applications SET landing_page = left(landing_page, 500), referrer = left(referrer, 500)`);
await landing.exec(`${landingAlters[1]};`);
await landing.exec(`${landingAlters[3]};`);
const validated = await landing.query(`
  SELECT bool_and(convalidated) AS ok
  FROM pg_constraint
  WHERE conname IN ('applications_landing_page_length', 'applications_referrer_length')
`);
check(validated.rows[0]?.ok === true, "VALIDATE accepts the shortened rows");
let tooLong = "";
try {
  await landing.exec(`INSERT INTO public.applications (landing_page, referrer) VALUES ('${longLanding}', 'ok')`);
} catch (error) {
  tooLong = String(error?.message ?? error);
}
check(/applications_landing_page_length/.test(tooLong), "a new landing_page longer than 500 is refused");
let tooLongReferrer = "";
try {
  await landing.exec(`INSERT INTO public.applications (landing_page, referrer) VALUES ('ok', '${longReferrer}')`);
} catch (error) {
  tooLongReferrer = String(error?.message ?? error);
}
check(/applications_referrer_length/.test(tooLongReferrer), "a new referrer longer than 500 is refused");
await landing.exec(`INSERT INTO public.applications (landing_page, referrer) VALUES (NULL, NULL)`);
await landing.exec(`INSERT INTO public.applications (landing_page, referrer) VALUES ('${"L".repeat(500)}', '${"R".repeat(500)}')`);
check(true, "null and 500-character landing values are accepted");
await landing.exec(landingRollbackSql.map((statement) => `${statement};`).join("\n"));
const dropped = await landing.query(`
  SELECT count(*)::int AS n
  FROM pg_constraint
  WHERE conname IN ('applications_landing_page_length', 'applications_referrer_length')
`);
check(Number(dropped.rows[0]?.n) === 0, "the landing rollback drops both checks");
await landing.exec(`INSERT INTO public.applications (landing_page, referrer) VALUES ('${longLanding}', '${longReferrer}')`);
check(true, "a long landing_page inserts again after the rollback");
const counted = await landing.query(`
  SELECT landing_page_over_500.n AS landing_page_over_500, referrer_over_500.n AS referrer_over_500
  FROM (${landingCounts[0]}) AS landing_page_over_500(n),
       (${landingCounts[1]}) AS referrer_over_500(n)
`);
check(
  Number(counted.rows[0]?.landing_page_over_500) === 1 && Number(counted.rows[0]?.referrer_over_500) === 1,
  "the pre-flight counts the over-long landing_page and referrer rows",
);
await landing.close();

const rolled = new PGlite();
await rolled.exec(`
  CREATE SCHEMA IF NOT EXISTS public;
  CREATE TABLE public.applications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    landing_page text,
    referrer text
  );
  INSERT INTO public.applications (landing_page) VALUES ('${"L".repeat(501)}');
`);
let applyFailed = "";
try {
  await rolled.exec(landingApply);
} catch (error) {
  applyFailed = String(error?.message ?? error);
}
check(/applications_landing_page_length/.test(applyFailed), "VALIDATE inside the apply transaction refuses the long row");
try {
  await rolled.exec("ROLLBACK");
} catch {
  // The failed statement already ended the transaction.
}
const leftBehind = await rolled.query(`
  SELECT count(*)::int AS n
  FROM pg_constraint
  WHERE conname IN ('applications_landing_page_length', 'applications_referrer_length')
`);
check(Number(leftBehind.rows[0]?.n) === 0, "a failed VALIDATE does not leave a NOT VALID check behind");
await rolled.close();

console.log(`${passed} proposed waitlist SQL checks passed`);
