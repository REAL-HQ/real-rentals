// Historical-agreements SQL against the local harness (installed by up.sh): the rollback
// restores the two replaced functions to their exact prior text and removes everything
// else; a reinstall works; and the rollback refuses once any registration exists.
// Run on a fresh harness, before the acceptance test: it leaves 01 installed and empty.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { DB } from "./record-rental-harness/clients";

const db = postgres(DB, { max: 1, onnotice: () => {} });
const install = readFileSync("proposed/record-rental-historical/01-historical-agreements-v1.sql", "utf8");
const rollback = readFileSync("proposed/record-rental-historical/02-rollback.sql", "utf8");
const def = async (fn: string) => (await db`select pg_get_functiondef(${fn}::regprocedure) d`)[0].d as string;
const SNAP = "private.record_snapshot_v1(uuid,uuid,uuid,uuid)";
const CONSUME = "private.record_agreement_evidence_v1(uuid,uuid,timestamp with time zone,numeric)";
const objects = async () => (await db`select
  to_regclass('private.historical_agreements_v1') is not null t,
  to_regprocedure('public.register_historical_agreement_v1(uuid,uuid,uuid,uuid,date,timestamptz,numeric,numeric,text)') is not null r,
  exists(select 1 from pg_trigger where tgname = 'historical_agreement_consume_v1') g`)[0];
try {
  const prior = Object.fromEntries((await db`select fn, definition from private.historical_agreements_v1_prior`).map((r) => [r.fn, r.definition]));
  assert.match(await def(SNAP), /historical_binding_mismatch/);
  assert.doesNotMatch(prior[SNAP], /historical/);
  await db.unsafe(rollback);
  assert.equal(await def(SNAP), prior[SNAP]);
  assert.equal(await def(CONSUME), prior[CONSUME]);
  assert.deepEqual({ ...(await objects()) }, { t: false, r: false, g: false });
  console.log("PASS rollback restores both replaced functions to their exact installed text and removes the rest");
  await db.unsafe(install);
  assert.deepEqual({ ...(await objects()) }, { t: true, r: true, g: true });
  console.log("PASS reinstall after rollback succeeds");
  // A registration row (inserted with triggers and FKs suspended, harness only) blocks rollback.
  const [a] = await db`select id, user_id from public.applications where user_id is not null limit 1`;
  const [d] = await db`select id from public.documents limit 1`;
  const [v] = await db`select id from public.vehicles limit 1`;
  await db.begin(async (tx) => {
    await tx.unsafe("SET LOCAL session_replication_role = replica");
    await tx`insert into private.historical_agreements_v1 (operation_id, application_id, driver_user_id, vehicle_id, document_id, document_sha256,
      paper_operation_id, signed_on, rental_start, weekly_cents, terms_summary, registered_by, registered_role)
      values (gen_random_uuid(), ${a.id}, ${a.user_id}, ${v.id}, ${d.id}, ${"0".repeat(64)}, gen_random_uuid(), '2026-08-01', '2026-08-02T12:00:00Z',
      10000, 'synthetic row for the rollback refusal', '11111111-1111-4111-8111-111111111111', 'admin')`;
  });
  await assert.rejects(() => db.unsafe(rollback), /historical_agreements_in_use/);
  await db.unsafe("ROLLBACK"); // the file's own BEGIN is left open and aborted by the refusal
  assert.deepEqual({ ...(await objects()) }, { t: true, r: true, g: true });
  console.log("PASS rollback refuses once a registration exists, and changes nothing");
  await assert.rejects(() => db`delete from private.historical_agreements_v1`, /historical_agreement_immutable|refused|denied/i);
  await assert.rejects(() => db`truncate private.historical_agreements_v1`, /./);
  console.log("PASS registrations cannot be deleted or truncated");
  await db.begin(async (tx) => { await tx.unsafe("SET LOCAL session_replication_role = replica"); await tx`delete from private.historical_agreements_v1`; });
} finally {
  await db.end();
}
