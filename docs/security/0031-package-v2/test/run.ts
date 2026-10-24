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
const REQ_V2 = readFileSync(join(sec, "0031-package-v2/request-v2.sql"), "utf8");
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
function guarded(pkg: string) {
  const f = join(DIR, "pkg.sql"); writeFileSync(f, pkg);
  const guard = execFileSync("python3", ["-I", join(sec, "0031-direct-route/gen-guard.py"), f], { encoding: "utf8" });
  return guard + pkg;
}
async function send(text: string) {
  try { await db.unsafe(text + TRAILER); return "ok"; } catch (e: any) { return String(e.message); }
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
  const COORD = readFileSync(join(sec, "0031-package-v2/coordinator-access-test.sql"), "utf8");
  await db.unsafe("DELETE FROM public.user_roles WHERE role = 'coordinator'");
  const rolesBefore = (await db.unsafe("SELECT md5(string_agg(user_id::text || role, ',' ORDER BY user_id, role)) AS h FROM public.user_roles"))[0].h;
  r = await send(COORD);
  const m = r.match(/RRCOORD_RESULT (\{.*\})/);
  const counts = m ? JSON.parse(m[1]) : null;
  const rolesAfter = (await db.unsafe("SELECT md5(string_agg(user_id::text || role, ',' ORDER BY user_id, role)) AS h FROM public.user_roles"))[0].h;
  check("T9", "Coordinator test plan: borrowed login is staff not manager, sees no identity data, keeps non-identity documents; role change never commits",
    !!counts && counts.is_staff === true && counts.is_manager === false && counts.applications === 0 && counts.identity_reviews === 0 && counts.identity_documents === 0 && counts.agreements === 0 && counts.identity_objects === 0 && counts.other_documents === 1 && rolesBefore === rolesAfter && unchanged(s2, await state()),
    { counts, rolesUnchanged: rolesBefore === rolesAfter });
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

  // 8. The real v2 artifacts: the request is guard + exact package; on a foreign database the
  //    guard passes and the package refuses the target; a one-byte change is refused by the guard.
  await fresh();
  b = await state();
  r = await send(REQ_V2);
  check("T8a", "real request-v2.sql: guard passes, package refuses this foreign database with TARGET_MISMATCH", r.includes("TARGET_MISMATCH") && unchanged(b, await state()), { result: r });
  r = await send(REQ_V2.replace("IS TRUE OR private.is_staff() IS FALSE);\n\n-- Review", "IS TRUE OR private.is_staff() IS NOT FALSE);\n\n-- Review"));
  check("T8b", "real request with one weakened policy byte: refused by RRGUARD_BYTES_MISMATCH before anything runs", r.includes("RRGUARD_BYTES_MISMATCH"), { result: r });
  r = await send("CREATE TABLE public.injected_before(id int);\n" + REQ_V2);
  check("T8c", "real request with a statement placed before the guard: refused, and the prepended statement rolled back", r.includes("RRGUARD_TEXT_BEFORE") && (await db.unsafe("SELECT to_regclass('public.injected_before') IS NULL AS gone"))[0].gone, { result: r });

  // Negative controls: weaken one guard in a v2 test copy and show the matching test would fail.
  const weaken = (pkg: string, from: string, to: string) => { if (pkg.split(from).length !== 2) throw new Error("control anchor missing: " + from); return pkg.replace(from, to); };
  const controls: Array<[string, string, (s: string) => string, string | null, string]> = [
    ["N1", "catalog comparison removed", s => weaken(s, "IF after_catalog IS DISTINCT FROM before_catalog THEN RAISE EXCEPTION 'POST_UNEXPECTED_CATALOG_CHANGE'; END IF;", ""), `CREATE POLICY "aaa Injected Policy" ON storage.objects FOR SELECT TO authenticated USING (true);`, "POST_UNEXPECTED_CATALOG_CHANGE"],
    ["N2", "partial-install check removed", s => weaken(s, "THEN RAISE EXCEPTION 'PARTIAL_INSTALL'; END IF;", "THEN NULL; END IF;"), "rerun", "PARTIAL_INSTALL"],
    ["N3", "journal check removed", s => weaken(s, "::jsonb THEN RAISE EXCEPTION 'JOURNAL_DRIFT_OR_REPLAY'; END IF;", "::jsonb THEN NULL; END IF;"), "drift", "JOURNAL_DRIFT_OR_REPLAY"],
    ["N4", "policy definition weakened (inner checksum must refuse)", s => weaken(s, "USING (private.is_manager() IS TRUE OR private.is_staff() IS FALSE);\n\n-- Review", "USING (true);\n\n-- Review"), null, "SQL_CHECKSUM_MISMATCH"],
  ];
  for (const [id, label, mutate, scenario, expected] of controls) {
    await fresh();
    const copy = mutate(testCopy(V2, p, scenario && scenario.startsWith("CREATE") ? scenario : undefined));
    if (scenario === "rerun") await send(guarded(testCopy(V2, p)));
    if (scenario === "drift") await db.unsafe("INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at) VALUES (24, 'synthetic', 1792545492197)");
    const res = await send(guarded(copy));
    const detected = !res.includes(expected) ? true : false;
    // N4 is the opposite shape: the weakened copy must still be refused by the inner checksum.
    const ok = id === "N4" ? res.includes(expected) : detected;
    check(id, id === "N4" ? `${label}: refused with ${expected}` : `${label}: the guarded expectation (${expected}) no longer holds, so the test detects the weakened guard (got: ${res.slice(0, 60)})`, ok, { result: res });
  }
} finally {
  if (db) await db.end();
  await admin.end();
  try { asTester("pg_ctl", ["-D", DATA, "-m", "fast", "stop"]); } catch {}
}
writeFileSync(join(here, "results.json"), JSON.stringify({ postgres: "17.6", results }, null, 1) + "\n");
const failed = results.filter(r => !r.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
