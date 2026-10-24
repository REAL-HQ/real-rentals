// Disposable verification of the corrected Security 0031 package (v2) against the original (v1).
// PostgreSQL 17.6 cluster created here, database `postgres` built from replica.sql with
// production's collation (en_US.UTF-8, libc) unless a scenario says otherwise. Test copies of
// a package change exactly two profile values (system identifier and catalog hash) so its
// target gates pass on this cluster; everything else is byte-identical, and that is asserted.
// Every request is sent the way the Supabase Management API delivers it: one simple-protocol
// query (one implicit transaction) with the API's comment trailer appended.
// Run: PG17_BIN=/path/to/pg17/bin bun run.ts   (as root; the cluster runs as user `tester`)
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "/home/user/real-rentals/node_modules/postgres/src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const sec = join(here, "../..");
const BIN = process.env.PG17_BIN!;
const DIR = "/tmp/rr0031v2", DATA = DIR + "/data", PORT = 55931;
const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const V1 = readFileSync(join(sec, "0031-package/0031_guarded_coordinator_containment.sql"), "utf8");
const V2 = readFileSync(join(sec, "0031-package-v2/0031_guarded_coordinator_containment_v2.sql"), "utf8");
const REQ = readFileSync(join(sec, "0031-package-v2/request-v2-guard3.sql"), "utf8");
// Superseded guard v2, kept only to show the search_path substitutions were real.
const GEN2 = join(sec, "0031-direct-route/gen-guard2.py");
// The superseded first guard, kept only to show the two bypasses were real.
const REQ_OLD_GUARD = readFileSync(join(sec, "0031-package-v2/request-v2.sql"), "utf8");
const REPLICA = readFileSync(join(here, "replica.sql"), "utf8");
const PREFLIGHT = readFileSync(join(sec, "0031-preflight-readonly.sql"), "utf8");
const TRAILER = "\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: pat:disposable\n-- date: 2026-10-24T00:00:00.000Z";
const NAMES = ["coordinator_application_containment", "coordinator_review_containment", "coordinator_document_containment", "coordinator_identity_storage_containment", "coordinator_agreement_containment"];
const FAILPOINT = "-- TEST_FAILURE_POINT (only disposable test copies may inject failure here)";
if (sha(V1) !== "32c17aa76e5026c4f50a2179aab143baa5d05463743b1a0f366ab4339103494f") throw new Error("v1 package bytes changed");
if (sha(V2) !== "d101c54e903f8495b1d1c6fa063319a3ac5a88340cc0e5bd276b60cc87a3e9d1") throw new Error("v2 package bytes changed");

const asTester = (cmd: string, args: string[]) => execFileSync("runuser", ["-u", "tester", "--", join(BIN, cmd), ...args], { stdio: "pipe" });
rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR); execFileSync("chown", ["tester", DIR]);
asTester("initdb", ["-D", DATA, "-U", "postgres", "--auth=trust", "--encoding=UTF8", "--locale=en_US.UTF-8", "--no-sync"]);
asTester("pg_ctl", ["-D", DATA, "-l", DIR + "/log", "-w", "-o", `-p ${PORT} -k ${DIR} -c listen_addresses=127.0.0.1 -c fsync=off`, "start"]);
const conn = (db: string) => postgres({ host: "127.0.0.1", port: PORT, user: "postgres", database: db, max: 1, onnotice: () => {} });
const admin = conn("template1");

// The preflight's own catalog expression, so test copies are sealed exactly as production's was.
const catalogExpr = PREFLIGHT.slice(PREFLIGHT.indexOf("encode(sha256(convert_to((SELECT jsonb_build_object("), PREFLIGHT.indexOf(",\n 'gate_audit_catalog_match'"));
let db: ReturnType<typeof postgres>;
async function fresh(locale = "en_US.UTF-8") {
  if (db) await db.end();
  await admin.unsafe("DROP DATABASE IF EXISTS postgres WITH (FORCE)");
  await admin.unsafe(`CREATE DATABASE postgres TEMPLATE template0 LOCALE '${locale}' ENCODING 'UTF8'`);
  db = conn("postgres");
  await db.unsafe(REPLICA);
}
async function profile() {
  const [r] = await db.unsafe(`SELECT (SELECT system_identifier::text FROM pg_control_system()) AS sysid, ${catalogExpr} AS cat, (SELECT datcollate FROM pg_database WHERE datname = current_database()) AS coll`);
  return r as { sysid: string; cat: string; coll: string };
}
// Only the profile line's two values change; everything else stays byte-identical (asserted).
function testCopy(pkg: string, p: { sysid: string; cat: string }, inject?: string) {
  const lines = pkg.split("\n");
  const i = lines.findIndex(l => l.startsWith(" profile jsonb := "));
  const before = lines[i];
  lines[i] = before.replace('"system_identifier": "7642734024280108049"', `"system_identifier": "${p.sysid}"`)
    .replace('"catalog_sha256": "c753236ecd2c4067c9bce7262d7b4786f5c9ea8bcbb42ce531e8deba3db41446"', `"catalog_sha256": "${p.cat}"`);
  if (lines[i] === before || lines.filter((l, k) => l !== pkg.split("\n")[k]).length !== 1) throw new Error("profile substitution failed");
  let out = lines.join("\n");
  if (inject !== undefined) { if (out.split(FAILPOINT).length !== 2) throw new Error("failure point missing"); out = out.replace(FAILPOINT, inject); }
  return out;
}
function guarded(pkg: string, gen = join(sec, "0031-direct-route/gen-guard3.py")) {
  const f = join(DIR, "pkg.sql"); writeFileSync(f, pkg);
  const guard = execFileSync("python3", ["-I", gen, f], { encoding: "utf8" });
  return guard + pkg;
}
async function send(text: string, trailer = TRAILER) {
  try { await db.unsafe(text + trailer); return "ok"; } catch (e: any) { return String(e.message); }
}
async function state() {
  const [r] = await db.unsafe(`SELECT
    (SELECT count(*)::int FROM pg_policies WHERE policyname = ANY ($1)) AS policies,
    (SELECT count(*)::int FROM pg_policies WHERE policyname = ANY ($1) AND permissive = 'RESTRICTIVE' AND cmd = 'SELECT' AND roles = '{authenticated}') AS restrictive,
    (SELECT count(*)::int FROM public.audit_log WHERE action = 'security_migration_verified' AND entity_id = '0031_coordinator_containment') AS evidence,
    (SELECT md5(jsonb_agg(to_jsonb(j) ORDER BY id)::text) FROM (SELECT id, hash, created_at FROM drizzle.__drizzle_migrations) j) AS journal,
    (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS receipts,
    (SELECT count(*)::int FROM public.audit_log) AS audit_rows`, [NAMES]);
  return r as { policies: number; restrictive: number; evidence: number; journal: string; receipts: number; audit_rows: number };
}
async function access() {
  const out: Record<string, Record<string, number>> = {};
  for (const [who, id] of Object.entries({ owner: "a1", manager: "b1", coordinator: "c1", driver: "d1" })) {
    out[who] = await db.begin(async tx => {
      await tx.unsafe("SET LOCAL ROLE authenticated");
      await tx`SELECT set_config('request.jwt.claim.sub', ${"00000000-0000-4000-8000-0000000000" + id}, true)`;
      const [r] = await tx.unsafe(`SELECT (SELECT count(*)::int FROM public.applications) AS applications,
        (SELECT count(*)::int FROM public.application_identity_reviews) AS identity_reviews,
        (SELECT count(*)::int FROM public.documents WHERE storage_bucket IN ('license-uploads','profile-screenshots','driver-docs','rental-agreements')) AS identity_documents,
        (SELECT count(*)::int FROM public.documents WHERE storage_bucket = 'vehicle-docs') AS vehicle_documents,
        (SELECT count(*)::int FROM public.agreements) AS agreements,
        (SELECT count(*)::int FROM storage.objects WHERE bucket_id IN ('license-uploads','driver-docs')) AS identity_objects,
        (SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'bucket-14') AS other_objects`);
      return r as Record<string, number>;
    });
  }
  return out;
}

const results: any[] = [];
const check = (id: string, name: string, pass: boolean, detail: unknown) => {
  results.push({ id, name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${id} ${name}`);
};
const unchanged = (a: any, b: any) => a.policies === b.policies && a.evidence === b.evidence && a.journal === b.journal && a.audit_rows === b.audit_rows;

try {
  // 0. The cluster really orders like production: case-insensitive en_US, and the old
  //    normalisation reorders storage.objects policies while the new one does not.
  await fresh();
  const p = await profile();
  const [ord] = await db.unsafe(`WITH a AS (SELECT jsonb_agg(to_jsonb(x) ORDER BY policyname) j FROM pg_policies x WHERE schemaname='storage' AND tablename='objects')
    SELECT (SELECT jsonb_agg(e ORDER BY e->>'policyname') FROM jsonb_array_elements(a.j) e) = a.j AS old_keeps_order,
           (SELECT jsonb_agg(e ORDER BY (e->>'policyname') COLLATE "C") FROM jsonb_array_elements(a.j) e) = a.j AS new_keeps_order FROM a`);
  check("T0", `cluster collation ${p.coll}: old normalisation reorders storage.objects policies, corrected one keeps them`, p.coll === "en_US.UTF-8" && ord.old_keeps_order === false && ord.new_keeps_order === true, { ...p, ...ord });
  const v1 = testCopy(V1, p), v2 = testCopy(V2, p);
  // The test copies differ from each other exactly as the real packages do.
  const realDiff = [V1, V2].map(s => s.split("\n")).reduce((a, b) => a.map((l, i) => l === b[i] ? null : [l, b[i]]).filter(Boolean));
  const copyDiff = [v1, v2].map(s => s.split("\n")).reduce((a, b) => a.map((l, i) => l === b[i] ? null : [l, b[i]]).filter(Boolean));
  check("T0b", "test copies differ only in the two profile values, and v1/v2 copies differ only by the reviewed line", JSON.stringify(realDiff) === JSON.stringify(copyDiff) && realDiff.length === 1, { lines: realDiff.length });

  // 1. The original package fails exactly as in production.
  let s0 = await state();
  let r = await send(guarded(v1));
  let s1 = await state();
  check("T1", "original package refuses with POST_UNEXPECTED_CATALOG_CHANGE on en_US; nothing persists", r.includes("POST_UNEXPECTED_CATALOG_CHANGE") && unchanged(s0, s1) && s1.policies === 0, { result: r, after: s1 });

  // 1b. Why earlier tests missed it: on a C-collation database the original passes.
  await fresh("C");
  const pc = await profile();
  r = await send(guarded(testCopy(V1, pc)));
  check("T1b", "control: on a C-collation database the original package passes (why earlier tests missed the defect)", r === "ok", { result: r });

  // 2-3, 7. The corrected package installs all five policies atomically, with one evidence row; journal untouched.
  await fresh();
  s0 = await state();
  const before = await access();
  r = await send(guarded(v2));
  s1 = await state();
  check("T2", "corrected package installs on en_US with production's mixed-case storage policy names", r === "ok", { result: r });
  check("T3", "exactly five restrictive SELECT policies for authenticated, and exactly one evidence row", s1.policies === 5 && s1.restrictive === 5 && s1.evidence === 1 && s1.audit_rows === s0.audit_rows + 1, s1);
  check("T7", "Drizzle journal identical before and after the direct route (23 receipts, same hashes)", s1.journal === s0.journal && s1.receipts === 23, { before: s0.journal, after: s1.journal });
  const after = await access();
  const keep = (k: string) => JSON.stringify(before[k]) === JSON.stringify(after[k]);
  const c = after.coordinator;
  check("T3b", "role rehearsal: Coordinator loses identity data but keeps vehicle documents and other objects; Owner, Manager and driver unchanged",
    keep("owner") && keep("manager") && keep("driver") && before.coordinator.applications > 0 && c.applications === 0 && c.identity_reviews === 0 && c.identity_documents === 0 && c.agreements === 0 && c.identity_objects === 0 && c.vehicle_documents === before.coordinator.vehicle_documents && c.other_objects === before.coordinator.other_objects,
    { before, after });

  // 6. Re-running after a successful install is refused and changes nothing.
  r = await send(guarded(v2));
  const s2 = await state();
  check("T6", "re-run after success refused by PARTIAL_INSTALL; state unchanged", r.includes("PARTIAL_INSTALL") && unchanged(s1, s2), { result: r });

  // 9. The proposed production Coordinator test, rehearsed: with no coordinator account, the
  //    always-aborting statement borrows a driver login as coordinator, counts, and commits nothing.
  const COORD = readFileSync(join(sec, "0031-package-v2/coordinator-access-test-v2.sql"), "utf8");
  const COORD_V1 = readFileSync(join(sec, "0031-package-v2/coordinator-access-test.sql"), "utf8");
  await db.unsafe("DELETE FROM public.user_roles WHERE role = 'coordinator'");
  const rolesBefore = (await db.unsafe("SELECT md5(string_agg(user_id::text || role, ',' ORDER BY user_id, role)) AS h FROM public.user_roles"))[0].h;
  r = await send(COORD);
  const m = r.match(/RRCOORD_RESULT (\{.*\})/);
  const counts = m ? JSON.parse(m[1]) : null;
  const rolesAfter = (await db.unsafe("SELECT md5(string_agg(user_id::text || role, ',' ORDER BY user_id, role)) AS h FROM public.user_roles"))[0].h;
  check("T9", "Coordinator test plan: borrowed login is staff not manager, sees no identity data, keeps non-identity documents; role change never commits",
    !!counts && counts.is_staff === true && counts.is_manager === false && counts.applications === 0 && counts.identity_reviews === 0 && counts.identity_documents === 0 && counts.agreements === 0 && counts.identity_objects === 0 && counts.other_documents === 1 && rolesBefore === rolesAfter && unchanged(s2, await state()),
    { counts, rolesUnchanged: rolesBefore === rolesAfter });
  r = await send(COORD_V1);
  const rolesV1 = (await db.unsafe("SELECT md5(string_agg(user_id::text || role, ',' ORDER BY user_id, role)) AS h FROM public.user_roles"))[0].h;
  check("T9c", "control: the first Coordinator test fails as it did in production (authenticated has no USAGE on schema private); roles unchanged", r.includes("permission denied for schema private") && rolesV1 === rolesBefore, { result: r });
  await db.unsafe("INSERT INTO public.user_roles VALUES ('00000000-0000-4000-8000-0000000000c1', 'coordinator')");
  r = await send(COORD);
  check("T9b", "Coordinator test plan refuses when a real coordinator exists (use that account instead)", r.includes("RRCOORD_REAL_COORDINATOR_EXISTS"), { result: r });

  // 4-5. A failure after the DDL, and genuine catalog mutations, roll back completely.
  const mutations: Record<string, string> = {
    "T5a injected failure after the DDL": "RAISE EXCEPTION 'INJECTED_FAILURE';",
    "T4a extra grant on a protected table": "GRANT SELECT ON public.applications TO anon;",
    "T4b extra mixed-case storage policy": `CREATE POLICY "aaa Injected Policy" ON storage.objects FOR SELECT TO authenticated USING (true);`,
    "T4c dropped existing storage policy": `DROP POLICY "admins read licenses" ON storage.objects;`,
    "T4d widened role-helper ACL": "GRANT EXECUTE ON FUNCTION private.is_manager() TO anon;",
    "T4e new column on documents": "ALTER TABLE public.documents ADD COLUMN injected text;",
  };
  const expectFor = (k: string) => k.startsWith("T5a") ? "INJECTED_FAILURE" : "POST_UNEXPECTED_CATALOG_CHANGE";
  for (const [name, sql] of Object.entries(mutations)) {
    await fresh();
    const b = await state();
    const res = await send(guarded(testCopy(V2, p, sql)));
    const a = await state();
    const id = name.split(" ")[0];
    check(id, `${name.slice(id.length + 1)}: refused with ${expectFor(name)}; no partial policies or evidence`, res.includes(expectFor(name)) && unchanged(b, a) && a.policies === 0 && a.evidence === 0, { result: res, after: a });
  }

  // 7b. Journal drift before execution is still refused.
  await fresh();
  await db.unsafe("INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at) VALUES (24, '173e475c-synthetic-0023', 1792545492197)");
  let b = await state();
  r = await send(guarded(v2));
  check("T7b", "a pending migration applied first (receipt 24) is refused by JOURNAL_DRIFT_OR_REPLAY", r.includes("JOURNAL_DRIFT_OR_REPLAY") && unchanged(b, await state()), { result: r });

  // 8. The real request (guard v2 + exact v2 package). On this foreign database the guard
  //    passes and the package refuses the target. Every tampering shape the reviewer found or
  //    the guard claims to cover is refused before anything runs, and nothing it carried survives.
  const edit = (text: string, from: string, to: string) => { if (text.split(from).length !== 2) throw new Error("edit anchor missing: " + from.slice(0, 40)); return text.replace(from, to); };
  const gone = async (t: string) => (await db.unsafe(`SELECT to_regclass('public.${t}') IS NULL AS g`))[0].g;
  const insideGuard = (req: string, sql: string) => req.slice(0, req.indexOf("\n") + 1) + sql + "\n" + req.slice(req.indexOf("\n") + 1);
  const crTrailer = "\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: x\rCREATE TABLE public.inj_tail(id int);\n-- date: 2026-10-24T00:00:00.000Z";
  await fresh();
  b = await state();
  r = await send(REQ);
  check("T8a", "real request: guard passes, package refuses this foreign database with TARGET_MISMATCH", r.includes("TARGET_MISMATCH") && unchanged(b, await state()), { result: r });
  r = await send(edit(REQ, "IS TRUE OR private.is_staff() IS FALSE);\n\n-- Review", "IS TRUE OR private.is_staff() IS NOT FALSE);\n\n-- Review"));
  check("T8b", "one weakened policy byte in the package: RRGUARD_BYTES_MISMATCH", r.includes("RRGUARD_BYTES_MISMATCH"), { result: r });
  r = await send("CREATE TABLE public.inj_prefix(id int);\n" + REQ);
  check("T8c", "statement placed before the guard: RRGUARD_GUARD_TEXT_CHANGED, rolled back", r.includes("RRGUARD_GUARD_TEXT_CHANGED") && await gone("inj_prefix"), { result: r });
  r = await send(insideGuard(REQ, "CREATE TABLE public.inj_before(id int);"));
  check("T8d", "reviewer bypass A (statement inside the guard text): RRGUARD_GUARD_TEXT_CHANGED, rolled back", r.includes("RRGUARD_GUARD_TEXT_CHANGED") && await gone("inj_before"), { result: r });
  r = await send(edit(REQ, "OPERATOR(pg_catalog.~) '^(", "OPERATOR(pg_catalog.!~) '^("));
  check("T8e", "guard logic edited (trailer check inverted): RRGUARD_GUARD_TEXT_CHANGED", r.includes("RRGUARD_GUARD_TEXT_CHANGED"), { result: r });
  r = await send(REQ, crTrailer);
  check("T8f", "reviewer bypass B (carriage return in the trailer, then a statement): RRGUARD_TRAILING_TEXT, rolled back", r.includes("RRGUARD_TRAILING_TEXT") && await gone("inj_tail"), { result: r });
  r = await send(REQ + "SELECT 1;\n");
  check("T8g", "statement after the package: RRGUARD_TRAILING_TEXT", r.includes("RRGUARD_TRAILING_TEXT"), { result: r });
  r = await send(edit(REQ, "END $rrguard$;\n", "END $rrguard$;\nSELECT 1;\n"));
  check("T8h", "statement between guard and package: RRGUARD_GUARD_TEXT_CHANGED", r.includes("RRGUARD_GUARD_TEXT_CHANGED"), { result: r });
  // The same two bypasses against the superseded guard, which accepted them (so the fix matters).
  r = await send(insideGuard(REQ_OLD_GUARD, "CREATE TABLE public.inj_old_a(id int);"));
  check("B1", "control: the superseded guard let bypass A through (reached the package: TARGET_MISMATCH)", r.includes("TARGET_MISMATCH"), { result: r });
  r = await send(REQ_OLD_GUARD, crTrailer);
  check("B2", "control: the superseded guard let bypass B through (reached the package: TARGET_MISMATCH)", r.includes("TARGET_MISMATCH"), { result: r });
  // With a package copy that targets this database, both bypasses are refused by guard v2 and nothing commits.
  await fresh();
  b = await state();
  r = await send(insideGuard(guarded(v2), "CREATE TABLE public.inj_before(id int);"));
  const ra = r;
  r = await send(guarded(v2), crTrailer);
  check("T8i", "end to end with a matching copy: both bypasses refused, no policies, no evidence, no injected tables", ra.includes("RRGUARD_GUARD_TEXT_CHANGED") && r.includes("RRGUARD_TRAILING_TEXT") && unchanged(b, await state()) && await gone("inj_before") && await gone("inj_tail"), { a: ra, b: r });
  // Second review: prefixes. With a matching copy, a prefix without COMMIT is rolled back and
  // the package never runs; a prefix that commits itself survives (no guard can undo work
  // committed before it runs), but the package still never runs.
  const INJ = "CREATE TABLE public.inj(id int);";
  const SUBST_NULL = "SET search_path = public, pg_catalog; CREATE FUNCTION public.current_query() RETURNS text LANGUAGE sql AS 'SELECT NULL::text';\n";
  const OPS = "SET search_path = public, pg_catalog; CREATE FUNCTION public.rr_f(text, text) RETURNS boolean LANGUAGE sql AS 'SELECT false'; CREATE FUNCTION public.rr_fi(int, int) RETURNS boolean LANGUAGE sql AS 'SELECT false'; CREATE OPERATOR public.<> (LEFTARG = text, RIGHTARG = text, FUNCTION = public.rr_f); CREATE OPERATOR public.<> (LEFTARG = int, RIGHTARG = int, FUNCTION = public.rr_fi); CREATE OPERATOR public.!~ (LEFTARG = text, RIGHTARG = text, FUNCTION = public.rr_f);\n";
  const scenario = async (label: string, prefix: string, gen?: string, trailer = TRAILER) => {
    await fresh();
    const b0 = await state();
    const res = await send(prefix + guarded(v2, gen), trailer);
    return { res, s: await state(), b0, inj: !(await gone("inj")) };
  };
  let x = await scenario("prefix", INJ + "\n");
  check("T8c2", "matching copy, statement before the guard: refused, rolled back, package not run", x.res.includes("RRGUARD_GUARD_TEXT_CHANGED") && !x.inj && unchanged(x.b0, x.s), x);
  x = await scenario("commit", INJ + " COMMIT;\n");
  check("T8j", "LIMITATION: a prefix ending in COMMIT survives the refusal, but the package never runs (no policies, no evidence)", x.res.includes("RRGUARD_GUARD_TEXT_CHANGED") && x.inj && x.s.policies === 0 && x.s.evidence === 0, x);
  x = await scenario("null", SUBST_NULL + INJ + "\n");
  check("T8k", "search_path substitution of current_query() returning NULL: refused, nothing commits", x.res.includes("RRGUARD_GUARD_TEXT_CHANGED") && !x.inj && unchanged(x.b0, x.s), x);
  const clean = guarded(v2) + TRAILER;
  x = await scenario("spoof", `SET search_path = public, pg_catalog; CREATE FUNCTION public.current_query() RETURNS text LANGUAGE sql AS $spoof$SELECT $q$${clean}$q$::text$spoof$;\n` + INJ + "\n");
  check("T8l", "search_path substitution of current_query() returning the clean request text: refused (the prefix carries a second package header), nothing commits", x.res.includes("RRGUARD_PACKAGE_MISSING") && !x.inj && unchanged(x.b0, x.s), x);
  x = await scenario("ops", OPS + INJ + "\n");
  check("T8m", "operator substitution (<> and !~ always false): refused, nothing commits", x.res.includes("RRGUARD_GUARD_TEXT_CHANGED") && !x.inj && unchanged(x.b0, x.s), x);
  await fresh();
  r = await send(REQ + REQ.slice(REQ.indexOf("\n-- PREPARATION ONLY.") + 1, REQ.indexOf("\n-- PREPARATION ONLY.") + 90) + "\n");
  check("T8n", "second copy of the package header after the package: RRGUARD_PACKAGE_MISSING", r.includes("RRGUARD_PACKAGE_MISSING"), { result: r });
  x = await scenario("notrailer", "", undefined, "");
  check("T8o", "by design: with no API trailer (direct psql-style delivery) the exact request installs", x.res === "ok" && x.s.policies === 5 && x.s.evidence === 1, x);
  // Controls: the same substitutions defeated guard v2, so the package ran with the injected table.
  x = await scenario("null-g2", SUBST_NULL + INJ + "\n", GEN2);
  check("B3", "control: guard v2 let the NULL current_query() substitution through (package ran, injected table committed)", x.res === "ok" && x.inj && x.s.policies === 5, x);
  x = await scenario("ops-g2", OPS + INJ + "\n", GEN2);
  check("B4", "control: guard v2 let the operator substitution through to the package (which refused only because the substituted <> also broke its own NOT IN filter)", !x.res.startsWith("RRGUARD") && x.res.includes("POST_UNEXPECTED_CATALOG_CHANGE"), x);
  check("T4f", "weakened policy definition in the package refused by the inner checksum", (await (async () => { await fresh(); return send(guarded(testCopy(V2, p).replace("USING (private.is_manager() IS TRUE OR private.is_staff() IS FALSE);\n\n-- Review", "USING (true);\n\n-- Review"))); })()).includes("SQL_CHECKSUM_MISMATCH"), {});

  // Negative controls: weaken one guard in a v2 test copy and record exactly what happens.
  // N1 shows the catalog comparison is load-bearing (the mutation is accepted without it).
  // N2 and N3 show those checks are backed by a second layer (a different guard still refuses).
  const weaken = (pkg: string, from: string, to: string) => { if (pkg.split(from).length !== 2) throw new Error("control anchor missing: " + from); return pkg.replace(from, to); };
  const controls: Array<[string, string, (s: string) => string, string | null, string, string]> = [
    ["N1", "catalog comparison removed: an injected mixed-case storage policy is accepted", s => weaken(s, "IF after_catalog IS DISTINCT FROM before_catalog THEN RAISE EXCEPTION 'POST_UNEXPECTED_CATALOG_CHANGE'; END IF;", ""), `CREATE POLICY "aaa Injected Policy" ON storage.objects FOR SELECT TO authenticated USING (true);`, "ok", "load-bearing"],
    ["N2", "partial-install check removed: a re-run is refused only by the catalog-drift guard", s => weaken(s, "THEN RAISE EXCEPTION 'PARTIAL_INSTALL'; END IF;", "THEN NULL; END IF;"), "rerun", "SCHEMA_POLICY_GRANT_DRIFT", "backed by a second layer"],
    ["N3", "pre-DDL journal check removed: journal drift is refused only by the post-DDL journal check", s => weaken(s, "::jsonb THEN RAISE EXCEPTION 'JOURNAL_DRIFT_OR_REPLAY'; END IF;", "::jsonb THEN NULL; END IF;"), "drift", "POST_JOURNAL_CHANGED", "backed by a second layer"],
  ];
  for (const [id, label, mutate, scenario, expected, kind] of controls) {
    await fresh();
    const copy = mutate(testCopy(V2, p, scenario && scenario.startsWith("CREATE") ? scenario : undefined));
    if (scenario === "rerun") await send(guarded(testCopy(V2, p)));
    if (scenario === "drift") await db.unsafe("INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at) VALUES (24, 'synthetic', 1792545492197)");
    const res = await send(guarded(copy));
    check(id, `${label} (${kind}; got ${res.slice(0, 40)})`, expected === "ok" ? res === "ok" : res.includes(expected), { result: res });
  }
} finally {
  if (db) await db.end();
  await admin.end();
  try { asTester("pg_ctl", ["-D", DATA, "-m", "fast", "stop"]); } catch {}
  rmSync(DIR, { recursive: true, force: true });
}
writeFileSync(join(here, "results.json"), JSON.stringify({ postgres: "17.6", results }, null, 1) + "\n");
const failed = results.filter(r => !r.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
