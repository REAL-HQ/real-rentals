// M2 Window 1 and the step-3 hand-over, on the local Record Rental harness only.
// 1. Steps 1-2 installed. Synthetic license images uploaded through the Storage API.
// 2. The real scripts/backfill-document-content-sha.ts runs (dry run, then --write,
//    then --write again) with a service_role JWT minted for the harness.
// 3. The step-3 gate SQL report must read missing=0 mismatched=0.
// 4. Step 3 (with the hosted amendments) is installed while PostgREST keeps its old
//    schema cache, and the app's approveThroughPacket gate is driven through the
//    stale window and after a schema reload.
// Run: RR_HARNESS_LAST_ORD=148 bash scripts/record-rental-harness/up.sh && bun scripts/m2-window1-drill.test.ts
import assert from "node:assert/strict";
import { createHmac, createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import { approveThroughPacket } from "../src/lib/approval-rpc.server";

const DB = "postgresql://postgres@127.0.0.1:55462/rr?sslmode=disable";
const GATEWAY = "http://127.0.0.1:55464";
const SECRET = "record-rental-harness-jwt-secret-not-a-real-key-0000";
const db = postgres(DB, { max: 1, onnotice: () => {} });
const results: string[] = [];
const pass = (s: string) => { results.push(s); console.log(`PASS ${s}`); };
const jwt = (claims: Record<string, unknown>) => {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const body = `${b({ alg: "HS256", typ: "JWT" })}.${b({ aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, ...claims })}`;
  return `${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`;
};
const SERVICE = jwt({ role: "service_role" });
const admin = createClient(GATEWAY, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const MANAGER = randomUUID(), MANAGER_SESSION = randomUUID(), DRIVER = randomUUID(), APP = randomUUID();
const manager = createClient(GATEWAY, SERVICE, { auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${jwt({ sub: MANAGER, session_id: MANAGER_SESSION, role: "authenticated" })}` } } });

async function report() {
  const [{ body }] = await db`select pg_read_file('/tmp/rr-harness/packet/proposed/backfill-document-content-sha.sql') as body`.catch(async () => [{ body: (await import("node:fs")).readFileSync("/tmp/rr-harness/packet/proposed/backfill-document-content-sha.sql", "utf8") }]);
  return db.begin(async (tx) => { await tx.unsafe(body); const [r] = await tx`select missing, mismatched, skipped, wrote from backfill_report`; return r; });
}
function backfill(...flags: string[]) {
  const r = spawnSync("bun", ["scripts/backfill-document-content-sha.ts", "--url", GATEWAY, ...flags],
    { env: { ...process.env, SUPABASE_URL: GATEWAY, SUPABASE_SERVICE_ROLE_KEY: SERVICE }, encoding: "utf8" });
  return { code: r.status, out: (r.stdout + r.stderr).trim().split("\n").filter((l) => /mode=|target host/.test(l)).join(" | ") };
}
const probe = async () => {
  const col = await manager.from("applications").select("approval_evidence_version").eq("id", APP).maybeSingle();
  const fn = await manager.rpc("approval_readiness", { _application_id: APP });
  return { column: col.error ? (col.error as any).code : "ok", rpc: fn.error ? (fn.error as any).code ?? (fn.error as any).message : "ok", rpcMessage: (fn.error as any)?.message ?? "" };
};

try {
  // Synthetic driver, staff member and two license images uploaded through Storage.
  await db`insert into auth.users(id, email, email_confirmed_at) values (${MANAGER}, ${`manager-${MANAGER.slice(0, 8)}@example.test`}, now()), (${DRIVER}, ${`driver-${DRIVER.slice(0, 8)}@example.test`}, now())`;
  await db`insert into auth.sessions(id, user_id, not_after) values (${MANAGER_SESSION}, ${MANAGER}, now() + interval '1 day')`;
  await db`insert into public.user_roles(user_id, role) values (${MANAGER}, 'team')`;
  await db`insert into public.applications(id, full_name, email, phone, status, user_id, license_number, license_state, license_expiration, dob)
    values (${APP}, 'Window One Driver', ${`driver-${DRIVER.slice(0, 8)}@example.test`}, '5550000001', 'reviewing', ${DRIVER}, 'W1000001', 'FL', '2029-06-30', '1991-02-03')`;
  const shas: Record<string, string> = {};
  for (const side of ["front", "back"]) {
    const path = `${APP}/license_${side}-${randomUUID()}.jpg`;
    const bytes = new TextEncoder().encode(`window-one synthetic license ${side} ${randomUUID()}`);
    const up = await admin.storage.from("driver-docs").upload(path, bytes, { contentType: "image/jpeg" });
    assert.equal(up.error, null);
    await db`insert into public.documents(driver_id, kind, category, storage_bucket, storage_path, visibility, file_name, mime_type, size_bytes, is_current, uploaded_by, uploaded_by_role)
      values (${APP}, ${`license_${side}`}, ${`license_${side}`}, 'driver-docs', ${path}, ${["driver", "admin"]}, ${`license-${side}.jpg`}, 'image/jpeg', ${bytes.length}, true, ${DRIVER}, 'driver')`;
    shas[path] = createHash("sha256").update(bytes).digest("hex");
  }
  const before = await report();
  assert.equal(before.missing, 2); pass(`report before backfill: missing=${before.missing} mismatched=${before.mismatched}`);

  const dry = backfill();
  assert.equal(dry.code, 0); assert.match(dry.out, /mode=dry-run .*hashed=0/); pass(`backfill dry run writes nothing (${dry.out})`);
  assert.equal((await report()).missing, 2);
  const write = backfill("--write");
  assert.equal(write.code, 0, write.out); assert.match(write.out, /hashed=2 .*missing=0 mismatched=0 pending=0 storage_errors=0/); pass(`backfill --write (${write.out})`);
  const rows = await db`select storage_path, content_sha256 from public.documents where driver_id = ${APP}`;
  for (const r of rows) assert.equal(r.content_sha256, shas[r.storage_path], "stored hash is not the digest of the uploaded bytes");
  const [binds] = await db`select count(*)::int n from private.uploaded_content_sha b join public.documents d on d.storage_bucket = b.bucket_id and d.storage_path = b.name where d.driver_id = ${APP}`;
  assert.equal(binds.n, 2); pass("hashes equal the digest of the stored bytes, each with a server binding");
  const after = await report();
  assert.equal(after.missing, 0); assert.equal(after.mismatched, 0); pass(`step-3 gate report: missing=${after.missing} mismatched=${after.mismatched}`);
  const again = backfill("--write");
  assert.equal(again.code, 0); assert.match(again.out, /hashed=0 .*missing=0 mismatched=0/); pass(`second --write is a no-op (${again.out})`);

  // Step 3 hand-over through a stale PostgREST cache.
  const pre = await probe();
  assert.equal(pre.column, "42703"); assert.equal(pre.rpc, "PGRST202"); pass(`before step 3: column ${pre.column}, RPC ${pre.rpc}`);
  let legacyCalls = 0;
  const gate = () => approveThroughPacket({ applicationId: APP,
    readVersion: async () => { const r = await manager.from("applications").select("approval_evidence_version").eq("id", APP).maybeSingle(); return { version: (r.data as any)?.approval_evidence_version ?? null, error: r.error as any }; },
    rpc: async (name, params) => (await manager.rpc(name, params)) as any,
    legacy: async () => { legacyCalls++; return { error: { message: "legacy path taken" } }; } });
  const legacy = await gate();
  assert.equal(legacyCalls, 1); assert.deepEqual(legacy, { ok: false, error: "legacy path taken" }); pass("before step 3 the gate takes the legacy path");

  const r = spawnSync("node", ["rr-apply.mjs", "152", "149"], { cwd: "/tmp/rr-harness/packet", env: { ...process.env, RR_HARNESS_DB_URL: DB }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr); pass(`installed 3-pre, step 3, 3-post with PostgREST still running (${r.stdout.trim()})`);
  const stale = await probe();
  console.log(`  stale cache: column=${stale.column} rpc=${stale.rpc}`);
  if (stale.rpc === "PGRST202") {
    const refused = await gate();
    assert.equal(legacyCalls, 1, "gate fell back to the legacy write during the stale window");
    assert.equal(refused.ok, false); assert.match((refused as any).error, /reload the PostgREST schema cache/);
    pass(`stale window reproduced (column ${stale.column}, RPC PGRST202): the gate refuses with the reload message and never writes legacy`);
  } else {
    pass(`no stale window: PostgREST already resolved the RPC (${stale.rpc})`);
  }
  await db`notify pgrst, 'reload schema'`;
  let fresh = await probe();
  for (let i = 0; i < 20 && fresh.rpc === "PGRST202"; i++) { await new Promise((s) => setTimeout(s, 250)); fresh = await probe(); }
  assert.equal(fresh.column, "ok"); assert.notEqual(fresh.rpc, "PGRST202");
  pass(`after schema reload: column readable, RPC resolves (${fresh.rpcMessage || fresh.rpc})`);
  const viaRpc = await gate();
  assert.equal(legacyCalls, 1); assert.equal(viaRpc.ok, false); assert.doesNotMatch((viaRpc as any).error, /reload/);
  pass(`after reload the gate goes through the RPC, which applies the packet's own rules (${(viaRpc as any).error})`);

  // The rest of the packet, so the harness ends fully installed.
  const rest = spawnSync("node", ["rr-apply.mjs", "206", "153"], { cwd: "/tmp/rr-harness/packet", env: { ...process.env, RR_HARNESS_DB_URL: DB }, encoding: "utf8" });
  assert.equal(rest.status, 0, rest.stderr); pass(`window 2 remainder installed (${rest.stdout.trim()})`);
  console.log(`\nm2-window1-drill: ${results.length} checks passed`);
} finally {
  await db.end();
}
