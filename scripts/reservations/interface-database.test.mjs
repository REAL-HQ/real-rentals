import postgres from "postgres";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { baseline } from "./fixture.mjs";
const config = {
  host: "/private/tmp/rr-stripe-pg/socket",
  port: 55439,
  username: "postgres",
  onnotice: () => {},
};
const admin = postgres({ ...config, database: "postgres" }),
  name = "reservation_ui_" + process.pid;
await admin.unsafe("CREATE DATABASE " + name);
const db = postgres({ ...config, database: name });
const ids = [1, 2, 3, 4].map((n) => "00000000-0000-0000-0000-00000000000" + n),
  market = "10000000-0000-0000-0000-000000000001";
let n = 0;
const test = async (label, fn) => {
  await fn();
  console.log("PASS " + label);
  n++;
};
const as = (id, fn) =>
  db.begin(async (tx) => {
    await tx`select set_config('request.jwt.claim.sub',${id ?? ""},true)`;
    await tx.unsafe("SET LOCAL ROLE authenticated");
    return fn(tx);
  });
try {
  await baseline(db, ...ids);
  await db.unsafe(`CREATE SCHEMA auth;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;GRANT USAGE ON SCHEMA public,auth TO authenticated;
CREATE TABLE markets(id uuid PRIMARY KEY);INSERT INTO markets VALUES('${market}');ALTER TABLE applications ADD COLUMN market_id uuid DEFAULT '${market}',ADD COLUMN full_name text DEFAULT 'Synthetic Applicant',ADD COLUMN ssn text DEFAULT 'SYNTHETIC';ALTER TABLE vehicles ADD COLUMN market_id uuid DEFAULT '${market}',ADD COLUMN unit_number text DEFAULT 'TEST';`);
  const readSQL = readFileSync("scripts/reservations/interface-reads.proposed.sql", "utf8");
  await test("read package refuses absent base", () =>
    assert.rejects(() => db.begin((tx) => tx.unsafe(readSQL)), /prerequisites_missing/));
  await db.begin((tx) =>
    tx.unsafe(readFileSync("scripts/reservations/migration.proposed.sql", "utf8")),
  );
  await db.begin((tx) => tx.unsafe(readSQL));
  await as(ids[0], (tx) => tx`select reservation_configure(${market},'America/New_York',60)`);
  const v = (await db`insert into vehicles(status) values('available') returning id`)[0].id,
    a = (
      await db`insert into applications(status,user_id) values('approved',gen_random_uuid()) returning id`
    )[0].id;
  const i = (
    await db`insert into inspections(vehicle_id,inspection_type,status,completed_at) values(${v},'pre_delivery','passed',now()) returning id`
  )[0].id;
  await db`insert into inspection_items(inspection_id,result,is_critical) values(${i},'pass',true)`;
  const rid = (
    await as(ids[1], (tx) => tx`select reservation_create(${a},${v},'2030-01-10T15:00Z',null) id`)
  )[0].id;
  for (const who of [ids[0], ids[1], ids[2]])
    await test("staff explicit list and history projection " + who, async () => {
      const r = (await as(who, (tx) => tx`select reservation_interface_list('drafts') r`))[0].r[0];
      assert.equal(r.applicant_name, "Synthetic Applicant");
      assert.equal("ssn" in r, false);
      assert.equal("weekly_rate" in r, false);
      assert.deepEqual(r.warnings, []);
      const h = (await as(who, (tx) => tx`select reservation_interface_history(${rid}) h`))[0].h;
      assert.deepEqual(Object.keys(h[0]).sort(), [
        "action",
        "from_state",
        "occurred_at",
        "to_state",
      ]);
    });
  for (const who of [ids[3], null])
    await test("Driver/anonymous list/history denied " + who, async () => {
      await assert.rejects(
        () => as(who, (tx) => tx`select reservation_interface_list('drafts')`),
        /Forbidden/,
      );
      await assert.rejects(
        () => as(who, (tx) => tx`select reservation_interface_history(${rid})`),
        /Forbidden/,
      );
    });
  await test("Coordinator choices denied", () =>
    assert.rejects(
      () => as(ids[2], (tx) => tx`select reservation_interface_options()`),
      /Forbidden/,
    ));
  await test("unknown schedule not represented as free", async () => {
    const o = (await as(ids[1], (tx) => tx`select reservation_interface_options() r`))[0].r;
    assert.equal(o.vehicles[0].conflict, null);
    assert.deepEqual(Object.keys(o.applicants[0]).sort(), ["id", "name", "timezone"]);
  });
  await as(ids[1], (tx) => tx`select * from reservation_change(${rid},1,'reserve')`);
  await test("overlap shown; self-exclusion only affects advisory read", async () => {
    const o = (
      await as(
        ids[1],
        (tx) => tx`select reservation_interface_options('','2030-02-01T15:00Z',null,null) r`,
      )
    )[0].r;
    assert.equal(o.vehicles[0].conflict, true);
    const self = (
      await as(
        ids[1],
        (tx) => tx`select reservation_interface_options('','2030-02-01T15:00Z',null,${rid}) r`,
      )
    )[0].r;
    assert.equal(self.vehicles[0].conflict, false);
  });
  await test("maintenance and critical evidence shown without sensitive output", async () => {
    await db`insert into incidents(vehicle_id,status) values(${v},'open')`;
    const o = (await as(ids[1], (tx) => tx`select reservation_interface_options() r`))[0].r;
    assert.ok(o.vehicles[0].reasons.some((s) => s.includes("incident")));
    const r = (await as(ids[2], (tx) => tx`select reservation_interface_list('upcoming') r`))[0].r;
    assert.ok(r[0].warnings.length);
    assert.equal((await db`select state from reservations where id=${rid}`)[0].state, "reserved");
  });
  await test("read operations do not append history", async () => {
    assert.equal((await db`select count(*)::int n from reservation_history`)[0].n, 2);
  });
  await test("replay fails atomically", () =>
    assert.rejects(() => db.begin((tx) => tx.unsafe(readSQL))));
  console.log(`${n} read projection database checks passed`);
} finally {
  await db.end();
  await admin.unsafe("DROP DATABASE " + name + " WITH (FORCE)");
  await admin.end();
}
