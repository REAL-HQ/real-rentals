// Rehearsal of proposed/m2-window1/request-mark-missing-licence-docs.sql on the local harness only,
// synthetic data only. The request is sent exactly as the Management API delivers it (bytes plus the
// API's comment trailer). Seeds production's investigated profile (2026-10-24): 20 good licence
// documents with objects, and 2 closed applications whose 4 staff-created PDF licence rows name no
// object. Proves:
//   - a tampered request is refused by guard v3 and changes nothing;
//   - any drift from the investigated state is refused and changes nothing;
//   - the exact request marks exactly those 4 rows not current, writes 4 audit rows, and changes
//     no other document, application, agreement, Storage object or Security 0031 policy;
//   - a second submission is refused;
//   - after steps 1-2 and a backfill of the 20 real objects, the gate report reads missing=0
//     mismatched=0.
// Run: RR_HARNESS_LAST_ORD=143 bash scripts/record-rental-harness/up.sh && bun scripts/m2-window1-missing-licence-fix.test.ts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const REF = process.env.M2_PACKET_REF ?? "origin/review/m2-packet-29d47ee3";
const URL = "postgresql://postgres@127.0.0.1:55462/rr?sslmode=disable";
const db = postgres(URL, { max: 1, onnotice: () => {} });
const TRAILER = "\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: harness\n-- date: 2026-10-24T00:00:00.000Z";
const REQUEST = readFileSync("proposed/m2-window1/request-mark-missing-licence-docs.sql", "utf8");
const show = (p: string) => execFileSync("git", ["show", `${REF}:${p}`], { encoding: "utf8" });
const psql = (sql: string) => execFileSync("psql", [URL, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: sql, encoding: "utf8" });
let checks = 0;
const pass = (s: string) => { checks++; console.log(`PASS ${s}`); };
const send = async (text: string) => { try { await db.unsafe(text + TRAILER); return "ok"; } catch (e: any) { return String(e.message); } };
const state = () => db`select
  (select md5(string_agg(to_jsonb(d)::text, E'\n' order by d.id)) from public.documents d) docs,
  (select md5(string_agg(to_jsonb(a)::text, E'\n' order by a.id)) from public.applications a) apps,
  (select md5(string_agg(to_jsonb(g)::text, E'\n' order by g.id)) from public.agreements g) agreements,
  (select md5(string_agg(to_jsonb(o)::text, E'\n' order by o.id)) from storage.objects o) objects,
  (select count(*)::int from public.audit_log) audit,
  (select md5(string_agg(concat_ws('|',tablename,policyname,permissive,roles::text,cmd,qual), E'\n' order by policyname)) from pg_policies where policyname like 'coordinator\\_%\\_containment') p0031`.then((r) => r[0]);
const missingInScope = () => db`select count(*)::int n from public.documents d
  where d.is_current and d.category in ('license_front','license_back')
    and not exists (select 1 from public.applications a where a.id = d.driver_id and a.deleted_at is not null)
    and not exists (select 1 from storage.objects o where o.bucket_id = d.storage_bucket and o.name = d.storage_path)`.then((r) => r[0].n);

try {
  // The harness has no Supabase migration ledger; production does. A stub lets the same read-only files run.
  psql(`CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text PRIMARY KEY);
INSERT INTO supabase_migrations.schema_migrations VALUES ('1'),('2') ON CONFLICT DO NOTHING;`);
  psql(`SET session_replication_role = replica;
INSERT INTO public.applications(id, full_name, email, phone, status, contact_status, created_at, reviewed_at, user_id)
SELECT ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'Synthetic ' || i, 'syn' || i || '@example.test', '000',
       CASE WHEN i > 10 THEN 'closed' ELSE 'reviewing' END, CASE WHEN i > 10 THEN 'unqualified' ELSE 'new' END,
       timestamptz '2026-10-05 15:00+00', now(), CASE WHEN i = 12 THEN gen_random_uuid() END
FROM generate_series(1, 12) i;
INSERT INTO public.agreements(id, application_id, status, body) VALUES (gen_random_uuid(), '00000000-0000-4000-8000-000000000011', 'signed', 'synthetic');
INSERT INTO storage.objects(id, bucket_id, name, version, user_metadata)
SELECT gen_random_uuid(), 'driver-docs', 'syn/' || i || '.jpg', gen_random_uuid()::text, '{}'::jsonb FROM generate_series(1, 20) i;
INSERT INTO public.documents(driver_id, kind, category, is_current, storage_bucket, storage_path, uploaded_by_role, size_bytes, mime_type)
SELECT ('00000000-0000-4000-8000-' || lpad(((i + 1) / 2)::text, 12, '0'))::uuid, 'license',
       CASE WHEN i % 2 = 1 THEN 'license_front' ELSE 'license_back' END, true, 'driver-docs', 'syn/' || i || '.jpg', 'driver', 1000, 'image/jpeg'
FROM generate_series(1, 20) i;
INSERT INTO public.documents(driver_id, kind, category, is_current, storage_bucket, storage_path, uploaded_by_role, mime_type, review_status, created_at)
SELECT ('00000000-0000-4000-8000-' || lpad(a::text, 12, '0'))::uuid, 'document', c, true, 'license-uploads', 'staff/' || a || '-' || c || '.pdf',
       'staff', 'application/pdf', 'verified', timestamptz '2026-10-05 15:00+00'
FROM generate_series(11, 12) a, unnest(ARRAY['license_front','license_back']) c;`);
  assert.equal(await missingInScope(), 4);
  pass("synthetic state reproduces the investigated profile: 4 missing-object licence rows on 2 closed applications");

  const s0 = await state();
  const tampered = REQUEST.replace("is_current = false WHERE", "is_current = false  WHERE");
  assert.notEqual(tampered, REQUEST);
  assert.match(await send(tampered), /RRGUARD_BYTES_MISMATCH/);
  assert.deepEqual(await state(), s0);
  pass("a one-byte change to the request is refused by guard v3; nothing changes");

  // Drift: a fifth missing-object licence row appears. The exact request must refuse it whole.
  psql(`SET session_replication_role = replica;
INSERT INTO public.documents(id, driver_id, kind, category, is_current, storage_bucket, storage_path)
VALUES ('00000000-0000-4000-9000-00000000d71f', '00000000-0000-4000-8000-000000000001', 'license', 'license_front', true, 'driver-docs', 'syn/drift.jpg');`);
  const sDrift = await state();
  assert.match(await send(REQUEST), /RRFIX_TARGET_COUNT: expected 4 missing-object licence documents, found 5/);
  assert.deepEqual(await state(), sDrift);
  psql(`SET session_replication_role = replica; DELETE FROM public.documents WHERE id = '00000000-0000-4000-9000-00000000d71f';`);
  // Drift: one of the two applications is reopened. Refused whole.
  psql(`SET session_replication_role = replica; UPDATE public.applications SET status = 'reviewing' WHERE id = '00000000-0000-4000-8000-000000000012';`);
  assert.match(await send(REQUEST), /RRFIX_APPLICATION_STATE_CHANGED/);
  psql(`SET session_replication_role = replica; UPDATE public.applications SET status = 'closed' WHERE id = '00000000-0000-4000-8000-000000000012';`);
  assert.deepEqual(await state(), s0);
  pass("drift from the investigated state (an extra missing row, a reopened application) is refused whole; nothing changes");

  // The production procedure: read-only preflight, the request once, read-only post-verification.
  const pre = JSON.parse(psql(readFileSync("proposed/m2-window1/correction-preflight-readonly.sql", "utf8")).trim());
  assert.equal(pre.targets, 4); assert.equal(pre.targets_match_investigation, true); assert.equal(pre.applications, 2);
  assert.equal(pre.applications_closed_unqualified, 2); assert.equal(pre.applications_rentals, 0); assert.equal(pre.applications_identity_reviews, 0);
  assert.equal(pre.applications_current_licence_docs, 4); assert.equal(pre.applications_licence_docs_with_object, 0); assert.equal(pre.correction_audit_rows, 0);
  assert.equal(await send(REQUEST), "ok");
  const post = JSON.parse(psql(readFileSync("proposed/m2-window1/correction-postverify-readonly.sql", "utf8")).trim());
  assert.equal(post.correction_audit_rows, 4); assert.equal(post.correction_audit_rows_well_formed, 4);
  assert.equal(post.corrected_documents, 4); assert.equal(post.corrected_not_current, 4);
  assert.equal(post.corrected_ids_md5, pre.target_ids_md5);
  assert.equal(post.corrected_rows_md5_excl_current_updated, pre.target_rows_md5_excl_current_updated);
  assert.equal(post.applications_md5, pre.applications_md5); assert.equal(post.applications_closed_unqualified, 2);
  assert.equal(post.missing_object_current_licence_in_scope, 0);
  assert.deepEqual(post.others, pre.others);
  for (const k of ["policies_0031", "policies_total", "drizzle_receipts", "supabase_receipts"]) assert.deepEqual(post[k], pre[k], k);
  pass("production procedure: preflight passes; post-verification shows exactly the preflight's 4 rows corrected, 4 well-formed audit rows, every other record unchanged, 0031 and journals unchanged");
  const s1 = await state();
  assert.equal(await missingInScope(), 0);
  const changed = await db`select d.category, d.is_current, d.storage_path, d.content_sha256 from public.documents d where d.storage_bucket = 'license-uploads' order by 1`;
  assert.equal(changed.length, 4);
  assert.ok(changed.every((r: any) => r.is_current === false && r.content_sha256 === null));
  const audits = await db`select action, entity_type, metadata->>'reason' reason from public.audit_log where action = 'document.marked_not_current'`;
  assert.equal(audits.length, 4);
  assert.ok(audits.every((r: any) => r.entity_type === "document" && r.reason === "storage_object_missing"));
  assert.equal(s1.audit, s0.audit + 4);
  assert.equal(s1.apps, s0.apps); assert.equal(s1.agreements, s0.agreements); assert.equal(s1.objects, s0.objects); assert.equal(s1.p0031, s0.p0031);
  const others = await db`select count(*)::int n from public.documents where storage_bucket = 'driver-docs' and is_current is true`;
  assert.equal(others[0].n, 20);
  pass("exact request: those 4 rows become not current (path and row kept), 4 audit rows; applications, agreements, objects, other documents and Security 0031 unchanged");

  assert.match(await send(REQUEST), /RRFIX_TARGET_COUNT: expected 4 missing-object licence documents, found 0/);
  assert.deepEqual(await state(), s1);
  pass("a second submission is refused and changes nothing");

  // Window 1 gate after the correction: steps 1-2, then the backfill of the 20 real objects.
  execFileSync("node", ["rr-apply.mjs", "148", "144"], { cwd: "/tmp/rr-harness/packet", env: { ...process.env, RR_HARNESS_DB_URL: URL }, stdio: "pipe" });
  psql(`SET ROLE service_role;
SELECT public.record_uploaded_content_sha(o.bucket_id, o.name, encode(sha256(convert_to(o.name, 'UTF8')), 'hex'), o.id, o.version, o.updated_at, d.id)
FROM public.documents d JOIN storage.objects o ON o.bucket_id = d.storage_bucket AND o.name = d.storage_path
WHERE d.is_current AND d.category IN ('license_front','license_back');`);
  const gate = psql(show("proposed/backfill-document-content-sha.sql") + "\nselect row_to_json(r) from backfill_report r;");
  assert.match(gate, /"missing":0/); assert.match(gate, /"mismatched":0/);
  pass("Window 1 gate after the correction and a 20-object backfill: missing=0 mismatched=0");
  console.log(`\nm2-window1-missing-licence-fix: ${checks} checks passed`);
} finally {
  await db.end();
}
