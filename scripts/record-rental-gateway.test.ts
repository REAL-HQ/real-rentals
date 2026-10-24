// The signed evidence gateway (proposed/record-rental-gateway) against the local harness,
// through the real PostgREST: a correctly signed call works; everything a browser or a
// replaying attacker could send is refused before any work. Run after up.sh and seed.sh.
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { DB, GATEWAY_KEY, OWNER, OWNER_SESSION, context, staff } from "./record-rental-harness/clients";
import { authenticatedPrincipal, trustedIssuer } from "../src/lib/record-rental-transport.server";

const db = postgres(DB, { max: 1, onnotice: () => {} });
const APP = "44444444-4444-4444-8444-444444444444";
const MANAGER = "e0000000-0000-4000-8000-0000000000e1", MANAGER_SESSION = "e0000000-0000-4000-8000-0000000000e2";
const COORD = "c0000000-0000-4000-8000-00000000c001", COORD_SESSION = "c0000000-0000-4000-8000-00000000c002";
let checks = 0;
const pass = (name: string) => { checks++; console.log(`PASS ${name}`); };

type Who = ReturnType<typeof context>;
function signed(op: string, args: Record<string, unknown>, actor: string, session: string,
  over: { key?: string; issued?: number; nonce?: string } = {}) {
  // The scope the app sets for each call (the application, as the TCP transport does).
  const text = JSON.stringify({ ...args, scopeApplication: (args.application as string) ?? "", scopeVehicle: "" });
  const issued = over.issued ?? Date.now(), nonce = over.nonce ?? randomUUID();
  const mac = createHmac("sha256", Buffer.from(over.key ?? GATEWAY_KEY, "hex"))
    .update(["record-evidence-gateway-v1", op, actor, session, String(issued), nonce, text].join("\n")).digest("hex");
  return { _op: op, _args: text, _issued_ms: issued, _nonce: nonce, _mac: mac };
}
async function call(who: Who, fn: string, body: Record<string, unknown>) {
  const { data, error } = await who.ctx.supabase.rpc(fn, body);
  return { data, message: (error as any)?.message as string | undefined };
}
async function refused(name: string, run: () => Promise<{ message?: string }>, pattern: RegExp) {
  const r = await run();
  assert.ok(r.message, `${name}: was accepted`);
  assert.match(r.message!, pattern);
  pass(`${name} (${r.message})`);
}

try {
  const owner = context(OWNER, OWNER_SESSION);
  const manager = await staff(db, MANAGER, MANAGER_SESSION, "manager2@example.test", "team");
  const coord = await staff(db, COORD, COORD_SESSION, "coordinator@example.test", "coordinator");

  // The database's HMAC (built on sha256(), no extension) against known answers and Node.
  const long = "k".repeat(100);
  const [h] = await db`select encode(private.hmac_sha256_v1('key'::bytea, 'The quick brown fox jumps over the lazy dog'::bytea), 'hex') a,
    encode(private.hmac_sha256_v1(convert_to(${long}, 'UTF8'), 'm'::bytea), 'hex') b`;
  assert.equal(h.a, "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
  assert.equal(h.b, createHmac("sha256", long).update("m").digest("hex"));
  pass("database HMAC-SHA256 matches the published vector and Node, including a key longer than one block");

  // The app's own path: trustedIssuer over the gateway, with the staff member's client.
  const trusted = trustedIssuer({ gatewayKey: Buffer.from(GATEWAY_KEY, "hex") },
    authenticatedPrincipal(owner.ctx.supabase, OWNER, OWNER_SESSION, owner.token), owner.ctx.supabase);
  const identity = await trusted.identity(APP) as any;
  assert.equal(identity.applicationId ?? identity.application_id ?? APP, APP);
  const snapshot = await trusted.licenseSnapshot(APP) as any;
  assert.equal(snapshot.application, APP);
  pass("a correctly signed call from the server works for both gateways (identity reader; licence snapshot as the approval executor)");

  const ok = signed("identity", { application: APP }, OWNER, OWNER_SESSION);
  assert.equal((await call(owner, "record_evidence_gateway_v1", ok)).message, undefined);
  await refused("the same request replayed is refused", () => call(owner, "record_evidence_gateway_v1", ok), /gateway_replay/);
  await refused("a request signed with another key is refused", () => call(owner, "record_evidence_gateway_v1",
    signed("identity", { application: APP }, OWNER, OWNER_SESSION, { key: "cd".repeat(32) })), /gateway_signature_invalid/);
  await refused("arguments changed after signing are refused", () => call(owner, "record_evidence_gateway_v1",
    { ...signed("identity", { application: APP }, OWNER, OWNER_SESSION), _args: JSON.stringify({ application: randomUUID(), scopeApplication: APP, scopeVehicle: "" }) }), /gateway_signature_invalid/);
  await refused("a request older than 60 seconds is refused", () => call(owner, "record_evidence_gateway_v1",
    signed("identity", { application: APP }, OWNER, OWNER_SESSION, { issued: Date.now() - 120000 })), /gateway_request_stale/);
  await refused("a request signed for another staff session is refused", () => call(manager, "record_evidence_gateway_v1",
    signed("identity", { application: APP }, OWNER, OWNER_SESSION)), /gateway_signature_invalid/);
  await refused("a Coordinator is refused even with a valid signature", () => call(coord, "record_evidence_gateway_v1",
    signed("identity", { application: APP }, COORD, COORD_SESSION)), /manager_required|approval_manager_required/);
  await refused("an operation outside the fixed list is refused", () => call(owner, "record_evidence_gateway_v1",
    signed("select * from private.record_gateway_key_v1", { application: APP }, OWNER, OWNER_SESSION)), /gateway_operation_refused/);
  await refused("a licence operation is refused on the issuer gateway", () => call(owner, "record_evidence_gateway_v1",
    signed("licenseSnapshot", { application: APP }, OWNER, OWNER_SESSION)), /gateway_operation_refused/);
  await refused("an issuer operation is refused on the licence gateway", () => call(owner, "record_license_gateway_v1",
    signed("bind", { document: randomUUID() }, OWNER, OWNER_SESSION)), /gateway_operation_refused/);

  const anon = await fetch("http://127.0.0.1:55463/rpc/record_evidence_gateway_v1", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify(signed("identity", { application: APP }, OWNER, OWNER_SESSION)) });
  assert.ok(anon.status === 401 || anon.status === 403, `anon status ${anon.status}`);
  pass(`an anonymous caller cannot reach the gateway (HTTP ${anon.status})`);

  const [g] = await db`select
    has_function_privilege('anon', 'public.record_evidence_gateway_v1(text,text,bigint,uuid,text)', 'EXECUTE') anon_exec,
    has_function_privilege('service_role', 'public.record_evidence_gateway_v1(text,text,bigint,uuid,text)', 'EXECUTE') service_exec,
    has_table_privilege('authenticated', 'private.record_gateway_key_v1', 'SELECT') auth_key,
    has_table_privilege('rr_evidence_transport', 'private.record_gateway_key_v1', 'SELECT') transport_key,
    has_schema_privilege('rr_evidence_issuer', 'public', 'CREATE') issuer_create,
    pg_get_userbyid((select proowner from pg_proc where oid = 'public.record_evidence_gateway_v1(text,text,bigint,uuid,text)'::regprocedure)) owner`;
  assert.deepEqual({ ...g }, { anon_exec: false, service_exec: false, auth_key: false, transport_key: false, issuer_create: false, owner: "rr_evidence_issuer" });
  pass("grants as reviewed: authenticated only, key unreadable by API roles, owner rr_evidence_issuer without CREATE on public");
  // Rate limit: 120 signed calls per staff member per minute (filled directly, harness only).
  await db`insert into private.record_gateway_nonce_v1 (nonce, actor, op) select gen_random_uuid(), ${OWNER}, 'identity' from generate_series(1, 120)`;
  await refused("more than 120 calls a minute from one staff member are refused", () => call(owner, "record_evidence_gateway_v1",
    signed("identity", { application: APP }, OWNER, OWNER_SESSION)), /gateway_rate_limited/);
  assert.equal((await call(manager, "record_evidence_gateway_v1", signed("identity", { application: APP }, MANAGER, MANAGER_SESSION))).message, undefined);
  await db`delete from private.record_gateway_nonce_v1 where actor = ${OWNER}`;
  pass("the limit is per staff member: the Manager is unaffected");

  // Revocation and rotation are audited by key id only; a revoked key refuses everything.
  await db.unsafe(readFileSync("proposed/record-rental-gateway/04-revoke-gateway-key.sql", "utf8"));
  await refused("after revocation every call is refused", () => call(owner, "record_evidence_gateway_v1",
    signed("identity", { application: APP }, OWNER, OWNER_SESSION)), /gateway_not_provisioned/);
  const rotated = "ef".repeat(32);
  await db.unsafe(readFileSync("proposed/record-rental-gateway/02-set-gateway-key.sql", "utf8").replace(":'gateway_key_hex'", `'${rotated}'`));
  await refused("the old key is refused after rotation", () => call(owner, "record_evidence_gateway_v1",
    signed("identity", { application: APP }, OWNER, OWNER_SESSION)), /gateway_signature_invalid/);
  assert.equal((await call(owner, "record_evidence_gateway_v1", signed("identity", { application: APP }, OWNER, OWNER_SESSION, { key: rotated }))).message, undefined);
  const audit = await db`select action, metadata from public.audit_log where action like 'record_gateway.%' order by created_at`;
  assert.deepEqual(audit.map((a) => a.action).slice(-2), ["record_gateway.key_revoked", "record_gateway.key_set"]);
  for (const a of audit) {
    assert.match(a.metadata.key_id, /^[0-9a-f]{12}$/);
    assert.ok(!JSON.stringify(a.metadata).includes(GATEWAY_KEY) && !JSON.stringify(a.metadata).includes(rotated), "key material in the audit log");
  }
  pass("revocation and rotation are audited with a 12-hex key id and never the key; the new key works");

  // Rollback removes the gateway entirely; reinstall and the key restore it for the suites after this one.
  await db.unsafe(readFileSync("proposed/record-rental-gateway/03-rollback.sql", "utf8"));
  const [gone] = await db`select to_regprocedure('public.record_evidence_gateway_v1(text,text,bigint,uuid,text)') is null a,
    to_regprocedure('public.record_license_gateway_v1(text,text,bigint,uuid,text)') is null b, to_regclass('private.record_gateway_key_v1') is null c`;
  assert.deepEqual({ ...gone }, { a: true, b: true, c: true });
  await db.unsafe(readFileSync("proposed/record-rental-gateway/01-evidence-gateway-v1.sql", "utf8"));
  await db.unsafe(readFileSync("proposed/record-rental-gateway/02-set-gateway-key.sql", "utf8").replace(":'gateway_key_hex'", `'${GATEWAY_KEY}'`));
  assert.equal((await call(owner, "record_evidence_gateway_v1", signed("identity", { application: APP }, OWNER, OWNER_SESSION))).message, undefined);
  pass("rollback removes the gateway completely; reinstall with the key works again");
  console.log(`\nrecord-rental-gateway: ${checks} checks passed`);
} finally {
  await db.end();
}
