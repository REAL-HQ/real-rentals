// Waitlist phone-conflict resolution: exercises the real migration SQL in a
// throwaway in-memory Postgres (PGlite). Never touches the shared backend.
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const FN_SQL = readFileSync("drizzle/migrations/0022_waitlist_resolve_phone_conflict.sql", "utf8")
  .replace(/REVOKE[\s\S]*$/, ""); // roles don't exist in PGlite; grants checked statically below

const OWNER = "00000000-0000-0000-0000-0000000000a1";
const MANAGER = "00000000-0000-0000-0000-0000000000a2";
const COORD = "00000000-0000-0000-0000-0000000000a3";
const W = "11111111-1111-1111-1111-111111111111";
const A = "22222222-2222-2222-2222-222222222222";

let db: PGlite;

async function setup() {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE user_roles (user_id uuid, role text);
    CREATE TABLE applications (id uuid primary key default gen_random_uuid(), full_name text, email text, phone text,
      status text default 'partial', deleted_at timestamptz, primary_application_id uuid, created_at timestamptz default now(),
      source text, waitlist_signed_up_at timestamptz, waitlist_source text);
    CREATE TABLE waitlist (id uuid primary key, full_name text, email text, phone text, status text default 'waiting',
      created_at timestamptz default now(), source text, promoted_application_id uuid, promoted_at timestamptz,
      review_reason text, review_flagged_at timestamptz);
    CREATE TABLE audit_log (id serial, actor_user_id uuid, actor_email text, actor_role text, action text,
      entity_type text, entity_id text, summary text, metadata jsonb, created_at timestamptz default now());
    INSERT INTO user_roles VALUES ('${OWNER}','admin'),('${MANAGER}','team'),('${COORD}','coordinator');
    INSERT INTO applications (id, full_name, email, phone, source) VALUES ('${A}','Sam Test','Sam@Example.com','(555) 000-0799','city_lp');
    INSERT INTO waitlist (id, full_name, email, phone, source, review_reason) VALUES ('${W}','Sam Test','sam@example.com','555-000-4211','waitlist','email_match_phone_differs');
  `);
  await db.exec(FN_SQL);
}

async function call(o: Partial<{ actor: string; choice: "existing" | "waitlist"; reason: string; wp: string; ap: string; app: string }> = {}) {
  const r = await db.query<{ r: any }>(
    `SELECT public.resolve_waitlist_phone_conflict($1,$2,$3,$4,$5,$6,$7,'x@y.z','admin') AS r`,
    [W, o.app ?? A, o.choice === "waitlist", o.reason ?? "", o.wp ?? "555-000-4211", o.ap ?? "(555) 000-0799", o.actor ?? OWNER],
  );
  return r.rows[0].r;
}
const one = async (sql: string) => (await db.query<any>(sql)).rows[0];
const count = async (t: string) => Number((await one(`SELECT count(*) c FROM ${t}`)).c);

describe("resolve_waitlist_phone_conflict", () => {
  beforeEach(setup);

  it("Keep Existing Phone links without changing the phone and audits", async () => {
    expect(await call({ actor: MANAGER })).toMatchObject({ ok: true, already: false, application_id: A });
    expect((await one(`SELECT phone FROM applications`)).phone).toBe("(555) 000-0799");
    const w = await one(`SELECT status, promoted_application_id, review_reason FROM waitlist`);
    expect(w).toMatchObject({ status: "promoted", promoted_application_id: A, review_reason: null });
    const a = await one(`SELECT action, actor_user_id, metadata FROM audit_log`);
    expect(a.action).toBe("waitlist.conflict_resolved");
    expect(a.actor_user_id).toBe(MANAGER);
    expect(a.metadata.phone_choice).toBe("existing");
    expect(await count("applications")).toBe(1);
  });

  it("Use Waitlist Phone requires a reason, then updates phone and records it", async () => {
    expect(await call({ choice: "waitlist", reason: "" })).toMatchObject({ ok: false, error: "reason_required" });
    expect(await count("audit_log")).toBe(0);
    expect(await call({ choice: "waitlist", reason: "Confirmed by phone call" })).toMatchObject({ ok: true });
    expect((await one(`SELECT phone FROM applications`)).phone).toBe("555-000-4211");
    const m = (await one(`SELECT metadata FROM audit_log`)).metadata;
    expect(m).toMatchObject({ phone_choice: "waitlist", reason: "Confirmed by phone call", previous_phone_last4: "0799", new_phone_last4: "4211" });
  });

  it("refuses Coordinators and unknown users", async () => {
    await expect(call({ actor: COORD })).rejects.toThrow(/forbidden/);
    await expect(call({ actor: "00000000-0000-0000-0000-0000000000ff" })).rejects.toThrow(/forbidden/);
    expect((await one(`SELECT promoted_application_id FROM waitlist`)).promoted_application_id).toBeNull();
  });

  it("rejects stale records", async () => {
    expect(await call({ ap: "555-000-1111" })).toMatchObject({ ok: false, error: "stale" });
    await db.exec(`UPDATE waitlist SET phone='555-999-0000'`);
    expect(await call()).toMatchObject({ ok: false, error: "stale" });
    expect(await count("audit_log")).toBe(0);
  });

  it("rejects email mismatch, multiple matches, and a phone owned by another driver", async () => {
    await db.exec(`UPDATE applications SET email='other@example.com'`);
    expect(await call()).toMatchObject({ ok: false, error: "email_mismatch" });
    await db.exec(`UPDATE applications SET email='sam@example.com'; INSERT INTO applications (full_name,email,phone) VALUES ('Dup','sam@example.com','1')`);
    expect(await call()).toMatchObject({ ok: false, error: "multiple_email_matches" });
    await db.exec(`DELETE FROM applications WHERE full_name='Dup'; INSERT INTO applications (full_name,email,phone) VALUES ('Other','o@x.com','5550004211')`);
    expect(await call()).toMatchObject({ ok: false, error: "phone_belongs_to_other" });
  });

  it("duplicate retries are idempotent: one link, one audit row, no new driver", async () => {
    await call();
    expect(await call()).toMatchObject({ ok: true, already: true });
    expect(await call({ choice: "waitlist", reason: "retry differently" })).toMatchObject({ ok: true, already: true });
    expect(await count("audit_log")).toBe(1);
    expect(await count("applications")).toBe(1);
    expect((await one(`SELECT phone FROM applications`)).phone).toBe("(555) 000-0799");
  });

  it("concurrent attempts produce one link and one audit row", async () => {
    const rs = await Promise.all([call(), call({ choice: "waitlist", reason: "parallel attempt" })]);
    expect(rs.filter((r) => r.ok && !r.already)).toHaveLength(1);
    expect(await count("audit_log")).toBe(1);
  });

  it("refuses linking to a different application once linked", async () => {
    await call();
    const other = (await one(`INSERT INTO applications (full_name,email) VALUES ('X','sam@example.com') RETURNING id`)).id;
    expect(await call({ app: other })).toMatchObject({ ok: false, error: "already_linked_elsewhere" });
  });
});

describe("wiring", () => {
  const sql = readFileSync("drizzle/migrations/0022_waitlist_resolve_phone_conflict.sql", "utf8");
  const fns = readFileSync("src/lib/waitlist.functions.ts", "utf8");
  it("function is service-role only", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.resolve_waitlist_phone_conflict[\s\S]*FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.resolve_waitlist_phone_conflict[\s\S]*TO service_role/);
  });
  it("server functions gate on requireManager and never use bulk merge", () => {
    for (const fn of ["getWaitlistConflict", "resolveWaitlistConflict"]) {
      const body = fns.slice(fns.indexOf(`export const ${fn}`)).split("export const ")[1];
      expect(body, fn).toMatch(/await requireManager\(context\.userId\)/);
      expect(body, fn).not.toMatch(/mergeDuplicate/);
    }
    expect(fns).toMatch(/affirmed: z\.literal\(true\)/);
  });
  it("exact-match promotion path is unchanged (still uses promote_waitlist_entry)", () => {
    expect(fns).toMatch(/rpc\("promote_waitlist_entry"/);
  });
});
