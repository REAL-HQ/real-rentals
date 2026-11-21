/**
 * 20261120040000_renter_blacklist.sql against a throwaway Postgres, plus the
 * proposed Heather Bell data fix. Never reads production env.
 * Run: bun test scripts/renter-blacklist-postgres.test.ts
 * Uses PG_BIN, else pg_config --bindir, else /usr/lib/postgresql/<v>/bin. Skips when no initdb.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addressSimilar, normalizeAddress, normalizeAddressBase, normalizeCard, normalizeDobLast, normalizeEmail, normalizeIp, normalizeLicense, normalizePhone } from "../src/lib/blacklist";

function candidates(): string[] {
  const out: string[] = [];
  if (process.env.PG_BIN) out.push(process.env.PG_BIN);
  const r = spawnSync("pg_config", ["--bindir"], { encoding: "utf8" });
  if (r.status === 0 && r.stdout.trim()) out.push(r.stdout.trim());
  if (existsSync("/usr/lib/postgresql")) for (const v of readdirSync("/usr/lib/postgresql")) out.push(`/usr/lib/postgresql/${v}/bin`);
  out.push("/workspace/pg17/node_modules/@embedded-postgres/linux-x64/native/bin");
  return out;
}
const BIN = candidates().find((d) => existsSync(join(d, "initdb")) && existsSync(join(d, "pg_ctl")));
const DIR = mkdtempSync(join(tmpdir(), "rr-blacklist-pg-"));
const PORT = String(56000 + Math.floor(Math.random() * 4000));
const PSQL = BIN && existsSync(join(BIN, "psql")) ? join(BIN, "psql") : "psql";

function run(bin: string, args: string[]) {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${bin} ${args.join(" ")} failed\n${r.stdout}\n${r.stderr}`);
}
function psql(sql: string) {
  const r = spawnSync(PSQL, ["-h", DIR, "-p", PORT, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-q"], { input: sql, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: r.stderr ?? "" };
}
function must(sql: string) {
  const r = psql(sql);
  if (!r.ok) throw new Error(r.err);
  return r.out;
}
const lit = (v: string | null) => (v == null ? "NULL" : `'${v.replace(/'/g, "''")}'`);

const STUBS = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE SCHEMA private;
CREATE FUNCTION private.is_staff() RETURNS boolean LANGUAGE sql AS 'select true';
CREATE FUNCTION private.is_owner() RETURNS boolean LANGUAGE sql AS 'select true';
CREATE FUNCTION private.is_manager() RETURNS boolean LANGUAGE sql AS 'select true';
CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS 'begin new.updated_at = now(); return new; end';
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, role text, created_at timestamptz DEFAULT now());
CREATE TABLE public.audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_user_id uuid, actor_email text, actor_role text,
  action text, entity_type text, entity_id text, summary text, metadata jsonb DEFAULT '{}', created_at timestamptz DEFAULT now());
CREATE TABLE public.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), full_name text, email text, phone text, address text, city text, state text, zip text,
  license_number text, status text NOT NULL DEFAULT 'new', user_id uuid, notes text, deleted_at timestamptz,
  dob date, card_brand text, card_last4 text, card_exp_month int, card_exp_year int);
CREATE TABLE public.agreements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid REFERENCES public.applications(id) ON DELETE CASCADE, signer_ip text);
CREATE TABLE public.waitlist (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), full_name text NOT NULL, email text NOT NULL, phone text,
  status text NOT NULL DEFAULT 'waiting', review_flagged_at timestamptz, review_reason text);
CREATE TABLE public.contact_leads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, email text NOT NULL, phone text);
CREATE TABLE public.driver_contacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid REFERENCES public.applications(id) ON DELETE CASCADE, kind text, value text);
CREATE TABLE public.driver_addresses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid REFERENCES public.applications(id) ON DELETE CASCADE, line1 text NOT NULL DEFAULT '', zip text);
CREATE TABLE public.rentals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid, driver_id uuid NOT NULL, vehicle_id uuid, status text NOT NULL DEFAULT 'reserved');
`;

const HEATHER = "f8593900-aaaa-4bbb-8ccc-000000000006";
const HEATHER_RENTAL = "36973513-480e-4423-8129-000000000006";
const OWNER = "0f0f0f0f-0000-4000-8000-000000000001";
const HEATHER_USER = "0f0f0f0f-0000-4000-8000-000000000002";

const skip = !BIN;
beforeAll(() => {
  if (skip) return;
  run(join(BIN!, "initdb"), ["-D", join(DIR, "data"), "-U", "postgres", "-A", "trust"]);
  run(join(BIN!, "pg_ctl"), ["-D", join(DIR, "data"), "-l", join(DIR, "pg.log"), "-o", `-k ${DIR} -p ${PORT} -c listen_addresses=''`, "-w", "start"]);
  must(STUBS);
  // fleet_review_decisions exactly as production created it.
  const fleet = readFileSync(new URL("../proposed/fleet-applicant-review-v1.sql", import.meta.url), "utf8")
    .replace(/ALTER TABLE public\.fleet_webhook_deliveries[\s\S]*?;\n/g, "");
  must(fleet);
  must(readFileSync(new URL("../supabase/migrations/20261120040000_renter_blacklist.sql", import.meta.url), "utf8"));
  must(readFileSync(new URL("../supabase/migrations/20261120070000_blacklist_manager_can_add.sql", import.meta.url), "utf8"));
  must(readFileSync(new URL("../supabase/migrations/20261121130000_blacklist_note_editable.sql", import.meta.url), "utf8"));
  must(`INSERT INTO auth.users VALUES ('${OWNER}', 'owner@example.com'), ('${HEATHER_USER}', 'renter6@example.com');
        INSERT INTO public.user_roles (user_id, role) VALUES ('${OWNER}', 'admin');
        INSERT INTO public.applications (id, full_name, email, phone, address, zip, license_number, status, user_id, notes)
        VALUES ('${HEATHER}', 'Heather Bell', 'Renter6@Example.com', '(555) 010-0106', '12 Pine Street Apt 3', '33610', 'b100-200-30-400-0', 'active', '${HEATHER_USER}', 'Existing note.');
        INSERT INTO public.rentals (id, application_id, driver_id, status) VALUES ('${HEATHER_RENTAL}', '${HEATHER}', '${HEATHER_USER}', 'active');`);
});
afterAll(() => {
  if (skip) return;
  spawnSync(join(BIN!, "pg_ctl"), ["-D", join(DIR, "data"), "-m", "immediate", "stop"]);
  rmSync(DIR, { recursive: true, force: true });
});

describe.skipIf(skip)("renter blacklist in Postgres", () => {
  test("SQL normalizers match src/lib/blacklist.ts", () => {
    const phones = ["(555) 010-0106", "+1 555 010 0106", "15550100106", "555-0106", "", null];
    const emails = ["  A.B@Example.COM ", "n/a", "x@y", null];
    const lic = ["b100-200-30-400-0", "B 100 200", "x1", null];
    const addrs: [string | null, string | null][] = [
      ["12 Pine Street Apt 3", "33610"], ["12 pine st #3, Tampa, FL 33610-1234", null], ["12 Pine St Unit 3", ""],
      ["N/A", "33610"], ["PO Box", null], ["4500 North West Boulevard, Tampa FL", "33614"], [null, null], ["12 Pine St, Tampa 33610, FL 33611", null],
    ];
    for (const p of phones) expect(must(`SELECT coalesce(private.rr_norm_phone(${lit(p)}), '<null>')`)).toBe(normalizePhone(p) ?? "<null>");
    for (const e of emails) expect(must(`SELECT coalesce(private.rr_norm_email(${lit(e)}), '<null>')`)).toBe(normalizeEmail(e) ?? "<null>");
    for (const l of lic) expect(must(`SELECT coalesce(private.rr_norm_license(${lit(l)}), '<null>')`)).toBe(normalizeLicense(l) ?? "<null>");
    for (const [a, z] of addrs) expect(must(`SELECT coalesce(private.rr_norm_address(${lit(a)}, ${lit(z)}), '<null>')`)).toBe(normalizeAddress(a, z) ?? "<null>");
    const more: [string | null, string | null][] = [...addrs, ["40 Magnolia Street Apt 2B", "33610"], ["40 Magnolia St Bldg C Unit 4", "33610"], ["Apt 4", "33610"], ["7 Elm Rd Floor 2 Room 9", "33612"]];
    for (const [a, z] of more) expect(must(`SELECT coalesce(private.rr_norm_address_base(${lit(a)}, ${lit(z)}), '<null>')`)).toBe(normalizeAddressBase(a, z) ?? "<null>");
    const people: [string | null, string | null][] = [["1990-04-02", "Pat Q Sample Jr"], ["1990-04-02", "Sample"], ["bad", "A B"], [null, "A B"], ["1990-04-02T00:00:00Z", "A. B. Sample III"]];
    for (const [d, n] of people) expect(must(`SELECT coalesce(private.rr_norm_dob_last(${lit(d)}, ${lit(n)}), '<null>')`)).toBe(normalizeDobLast(d, n) ?? "<null>");
    const cards: [string | null, string | null, number | null, number | null][] = [["Visa", "4242", 7, 2029], ["visa", "42", 7, 2029], [null, "4242", 7, 2029], ["amex", "0005", 13, 2029]];
    for (const [b, l, m, y] of cards) expect(must(`SELECT coalesce(private.rr_norm_card(${lit(b)}, ${lit(l)}, ${m ?? "NULL"}, ${y ?? "NULL"}), '<null>')`)).toBe(normalizeCard(b, l, m, y) ?? "<null>");
    for (const ip of ["203.0.113.7", " 203.0.113.7, 10.0.0.1", "10.1.2.3", "172.20.1.1", "172.32.1.1", "::1", "2001:db8::1", "unknown", null])
      expect(must(`SELECT coalesce(private.rr_norm_ip(${lit(ip)}), '<null>')`)).toBe(normalizeIp(ip) ?? "<null>");
    const pairs: [string, string][] = [["40 magnolia st|33610", "40 magnolai st|33610"], ["40 magnolia st|33610", "40 n magnolia st|33610"], ["40 magnolia st|33610", "41 magnolia st|33610"], ["40 magnolia st|33610", "40 oak st|33610"], ["40 magnolia st|33610", "40 magnolia st|"]];
    for (const [a, b] of pairs) expect(must(`SELECT private.rr_address_similar(${lit(a)}, ${lit(b)})`)).toBe(addressSimilar(a, b) ? "t" : "f");
  });

  test("proposed Heather SQL: blacklists once, snapshots identifiers, appends note once", () => {
    const sql = readFileSync(new URL("../proposed/blacklist/01-blacklist-heather-bell.sql", import.meta.url), "utf8");
    must(sql);
    must(sql); // re-run is a no-op
    expect(must(`SELECT count(*) FROM public.renter_blacklist WHERE application_id = '${HEATHER}'`)).toBe("1");
    expect(must(`SELECT reason_code || '|' || blacklisted_on || '|' || added_by || '|' || full_name FROM public.renter_blacklist`)).toBe(`vehicle_repossessed|2026-11-19|${OWNER}|Heather Bell`);
    expect(must(`SELECT string_agg(kind, ',' ORDER BY kind) FROM public.renter_blacklist_identifiers`)).toBe("address,address_base,email,license,phone");
    const notes = must(`SELECT notes FROM public.applications WHERE id = '${HEATHER}'`);
    expect(notes.startsWith("Existing note.\n\nBlacklisted Nov 19, 2026: rent unpaid 2+ days ($350)")).toBe(true);
    expect(notes.split("Blacklisted Nov 19, 2026").length).toBe(2);
    expect(must(`SELECT count(*) FROM public.audit_log WHERE action = 'renter.blacklisted'`)).toBe("1");
    expect(must(`SELECT note FROM public.renter_blacklist WHERE application_id = '${HEATHER}'`)).toMatch(/Never signed a rental agreement\. \$600 unpaid incl\. \$150 key\.$/);
    expect(notes).not.toContain("$600 unpaid");
  });

  test("proposed SQL skips the note when the identical note already exists", () => {
    // Simulate the separate data fix having added it first on a fresh entry.
    must(`UPDATE public.renter_blacklist SET removed_at = now(), removed_by_label = 'Owner', removal_reason = 'test reset'`);
    must(`UPDATE public.applications SET notes = 'Only the note: ' || (SELECT note FROM public.renter_blacklist LIMIT 1) WHERE id = '${HEATHER}'`);
    const before = must(`SELECT notes FROM public.applications WHERE id = '${HEATHER}'`);
    must(readFileSync(new URL("../proposed/blacklist/01-blacklist-heather-bell.sql", import.meta.url), "utf8"));
    expect(must(`SELECT notes FROM public.applications WHERE id = '${HEATHER}'`)).toBe(before);
    expect(must(`SELECT count(*) FROM public.renter_blacklist WHERE application_id = '${HEATHER}'`)).toBe("2");
    expect(must(`SELECT count(*) FROM public.renter_blacklist WHERE application_id = '${HEATHER}' AND removed_at IS NULL`)).toBe("1");
  });

  test("history: entries cannot be deleted or rewritten", () => {
    expect(psql(`DELETE FROM public.renter_blacklist`).err).toContain("never deleted");
    expect(psql(`UPDATE public.renter_blacklist SET reason_code = 'other' WHERE removed_at IS NULL`).err).toContain("only the note and the removal");
    expect(psql(`UPDATE public.renter_blacklist SET blacklisted_on = '2020-01-01' WHERE removed_at IS NULL`).err).toContain("only the note and the removal");
    expect(psql(`UPDATE public.renter_blacklist SET note = 'x' WHERE removed_at IS NULL`).err).toContain("a blacklist note is required");
    const keep = must(`SELECT note FROM public.renter_blacklist WHERE removed_at IS NULL`);
    expect(psql(`UPDATE public.renter_blacklist SET note = 'Edited note text' WHERE removed_at IS NULL`).ok).toBe(true);
    expect(must(`SELECT note FROM public.renter_blacklist WHERE removed_at IS NULL`)).toBe("Edited note text");
    must(`UPDATE public.renter_blacklist SET note = '${keep.replace(/'/g, "''")}' WHERE removed_at IS NULL`);
    expect(psql(`UPDATE public.renter_blacklist SET removed_at = now() WHERE removed_at IS NULL`).err).toContain("renter_blacklist_removal_complete");
    expect(psql(`UPDATE public.renter_blacklist SET removal_reason = 'again!' WHERE removed_at IS NOT NULL`).err).toContain("already removed");
  });

  test("blocking: blacklisted renter cannot be approved, reserved, resumed or activated; ending still works", () => {
    expect(psql(`UPDATE public.applications SET status = 'reviewing' WHERE id = '${HEATHER}'`).ok).toBe(true);
    expect(psql(`UPDATE public.applications SET status = 'approved' WHERE id = '${HEATHER}'`).err).toContain("renter_blacklisted");
    expect(psql(`INSERT INTO public.rentals (application_id, driver_id, status) VALUES ('${HEATHER}', '${HEATHER_USER}', 'reserved')`).err).toContain("renter_blacklisted");
    // A rental under no application but her login: refused by driver id.
    expect(psql(`INSERT INTO public.rentals (driver_id, status) VALUES ('${HEATHER_USER}', 'active')`).err).toContain("renter_blacklisted");
    // Her existing rental can be ended / repossessed.
    expect(psql(`UPDATE public.rentals SET status = 'completed' WHERE application_id = '${HEATHER}'`).ok).toBe(true);
    expect(psql(`UPDATE public.rentals SET status = 'active' WHERE application_id = '${HEATHER}'`).err).toContain("renter_blacklisted");
    expect(psql(`INSERT INTO public.rentals (application_id, driver_id, status) VALUES ('${HEATHER}', '${HEATHER_USER}', 'on_hold')`).ok).toBe(true);
    expect(psql(`UPDATE public.rentals SET status = 'reserved' WHERE status = 'on_hold'`).err).toContain("renter_blacklisted");
  });

  test("matching: a reformatted re-application is flagged needs_staff and cannot be approved or rented", () => {
    const id = must(`INSERT INTO public.applications (full_name, email, phone) VALUES ('H. Bell', 'renter6@example.com ', '+1 555 010 0106') RETURNING id`);
    expect(must(`SELECT decision || '|' || reason || '|' || array_to_string(escalation_codes, ',') || '|' || decided_by FROM public.fleet_review_decisions WHERE application_id = '${id}'`))
      .toBe("needs_staff|blacklist match: Email, Phone (matches Heather Bell)|blacklist_match|Blacklist Check (automated)");
    expect(must(`SELECT matched_name || '|' || array_to_string(matched_kinds, ',') FROM public.renter_blacklist_matches WHERE source_id = '${id}'`)).toBe("Heather Bell|email,phone");
    expect(must(`SELECT assessment->'blacklist_match'->'matched' FROM public.fleet_review_decisions WHERE application_id = '${id}'`)).toBe('["email", "phone"]');
    expect(psql(`UPDATE public.applications SET status = 'approved' WHERE id = '${id}'`).err).toContain("renter_blacklist_match_uncleared");
    expect(psql(`INSERT INTO public.rentals (application_id, driver_id, status) VALUES ('${id}', gen_random_uuid(), 'reserved')`).err).toContain("renter_blacklist_match_uncleared");
    // An Owner clears it (not the same person): approval goes through.
    must(`INSERT INTO public.renter_blacklist_clearances (application_id, blacklist_id, cleared_by_label)
          SELECT '${id}', id, 'Owner' FROM public.renter_blacklist WHERE removed_at IS NULL`);
    must(`UPDATE public.fleet_review_decisions SET resolved_at = now() WHERE application_id = '${id}'`);
    expect(psql(`UPDATE public.applications SET status = 'approved' WHERE id = '${id}'`).ok).toBe(true);
  });

  test("matching by licence (later wizard step) and by address, merged into an existing FLEET flag", () => {
    const id = must(`INSERT INTO public.applications (full_name, email, phone) VALUES ('Someone', 'other@example.com', '5550109999') RETURNING id`);
    expect(must(`SELECT count(*) FROM public.fleet_review_decisions WHERE application_id = '${id}'`)).toBe("0");
    must(`INSERT INTO public.fleet_review_decisions (application_id, decision, reason) VALUES ('${id}', 'needs_staff', 'FLEET: screenshot unclear')`);
    must(`UPDATE public.applications SET license_number = 'B100 200 30 400 0' WHERE id = '${id}'`);
    expect(must(`SELECT reason || '|' || array_to_string(escalation_codes, ',') FROM public.fleet_review_decisions WHERE application_id = '${id}' AND resolved_at IS NULL`))
      .toBe("blacklist match: License Number (matches Heather Bell); FLEET: screenshot unclear|blacklist_match");
    const id2 = must(`INSERT INTO public.applications (full_name, email, phone, address, zip) VALUES ('Neighbour', 'n@example.com', '5550108888', '12 pine st. #3', '33610') RETURNING id`);
    expect(must(`SELECT assessment->'blacklist_match'->'matched' FROM public.fleet_review_decisions WHERE application_id = '${id2}'`)).toBe('["address", "address_base"]');
    const id3 = must(`INSERT INTO public.applications (full_name, email, phone) VALUES ('Clean', 'clean@example.com', '5550107777') RETURNING id`);
    must(`INSERT INTO public.driver_contacts (application_id, kind, value) VALUES ('${id3}', 'phone', '555.010.0106')`);
    expect(must(`SELECT count(*) FROM public.fleet_review_decisions WHERE application_id = '${id3}'`)).toBe("1");
  });

  test("blacklisting scans existing live applications; removal stops new blocks", () => {
    const pre = must(`INSERT INTO public.applications (full_name, email, phone, status) VALUES ('Pre', 'pre@example.com', '5550105555', 'reviewing') RETURNING id`);
    const closed = must(`INSERT INTO public.applications (full_name, email, phone, status) VALUES ('Old', 'pre@example.com', '5550105556', 'closed') RETURNING id`);
    const target = must(`INSERT INTO public.applications (full_name, email, phone, status) VALUES ('Target', 'pre@example.com', '5550105557', 'active') RETURNING id`);
    // Not yet: two-strike reason needs strikes.
    expect(psql(`INSERT INTO public.renter_blacklist (application_id, reason_code, note, blacklisted_on, added_by_label) VALUES ('${target}', 'smoking_second_strike', 'Smoked in car', '2026-11-19', 'Owner')`).err).toContain("blacklist_needs_second_strike");
    must(`INSERT INTO public.renter_strikes (application_id, kind, occurred_on, note, added_by_label) VALUES ('${target}', 'smoking', '2026-10-01', 'Smell of smoke', 'Coordinator'), ('${target}', 'smoking', '2026-11-18', 'Ash in cupholder', 'Coordinator')`);
    must(`INSERT INTO public.renter_blacklist (application_id, reason_code, note, blacklisted_on, added_by_label) VALUES ('${target}', 'smoking_second_strike', 'Smoked in car twice', '2026-11-19', 'Owner')`);
    expect(must(`SELECT count(*) FROM public.fleet_review_decisions WHERE application_id = '${pre}' AND 'blacklist_match' = ANY(escalation_codes)`)).toBe("1");
    expect(must(`SELECT count(*) FROM public.fleet_review_decisions WHERE application_id = '${closed}'`)).toBe("0");
    expect(psql(`DELETE FROM public.renter_strikes`).err).toContain("never deleted");
    must(`UPDATE public.renter_blacklist SET removed_at = now(), removed_by_label = 'Owner', removal_reason = 'Owner forgave' WHERE application_id = '${target}' AND removed_at IS NULL`);
    expect(psql(`INSERT INTO public.rentals (application_id, driver_id, status) VALUES ('${target}', gen_random_uuid(), 'reserved')`).ok).toBe(true);
    expect(JSON.parse(must(`SELECT public.renter_blacklist_check('${pre}')::text`))).toMatchObject({ blacklisted: false, block: null });
    expect(JSON.parse(must(`SELECT public.renter_blacklist_check('${HEATHER}')::text`))).toMatchObject({ blacklisted: true, block: "renter_blacklisted" });
  });

  test("linked people: same building, similar address, DOB + last name, card, signer IP", () => {
    // Give Heather's (blacklisted) record more details: the snapshot picks them up.
    must(`UPDATE public.applications SET dob = '1991-03-04', card_brand = 'visa', card_last4 = '4242', card_exp_month = 7, card_exp_year = 2029 WHERE id = '${HEATHER}'`);
    must(`INSERT INTO public.agreements (application_id, signer_ip) VALUES ('${HEATHER}', '198.51.100.23')`);
    const kinds = must(`SELECT string_agg(kind, ',' ORDER BY kind) FROM public.renter_blacklist_identifiers i JOIN public.renter_blacklist b ON b.id = i.blacklist_id WHERE b.application_id = '${HEATHER}' AND b.removed_at IS NULL`);
    expect(kinds).toBe("address,address_base,card,dob_last,email,ip,license,phone");
    const flagged = (sql: string) => {
      const id = must(sql);
      return {
        id,
        matched: must(`SELECT coalesce(string_agg(k, ',' ORDER BY k), '') FROM public.renter_blacklist_matches m, unnest(m.matched_kinds) k WHERE m.source_table = 'applications' AND m.source_id = '${id}'`),
        reason: must(`SELECT coalesce(max(reason), '') FROM public.fleet_review_decisions WHERE application_id = '${id}' AND resolved_at IS NULL`),
      };
    };
    const unit = flagged(`INSERT INTO public.applications (full_name, email, phone, address, zip) VALUES ('Roommate One', 'r1@example.com', '5550102001', '12 Pine St Unit 9', '33610') RETURNING id`);
    expect(unit.matched).toBe("address_base");
    expect(unit.reason).toBe("blacklist match: Same Building (matches Heather Bell)");
    const typo = flagged(`INSERT INTO public.applications (full_name, email, phone, address, zip) VALUES ('Roommate Two', 'r2@example.com', '5550102002', '12 Pnie Street', '33610') RETURNING id`);
    expect(typo.matched).toBe("address_similar");
    const otherZip = flagged(`INSERT INTO public.applications (full_name, email, phone, address, zip) VALUES ('Far Away', 'r3@example.com', '5550102003', '12 Pine Street', '32801') RETURNING id`);
    expect(otherZip.matched).toBe("");
    const dob = flagged(`INSERT INTO public.applications (full_name, email, phone, dob) VALUES ('Heather Ann Bell', 'new@example.com', '5550102004', '1991-03-04') RETURNING id`);
    expect(dob.matched).toBe("dob_last");
    expect(dob.reason).toBe("blacklist match: DOB + Last Name (matches Heather Bell)");
    const card = flagged(`INSERT INTO public.applications (full_name, email, phone) VALUES ('Card Sharer', 'c@example.com', '5550102005') RETURNING id`);
    must(`UPDATE public.applications SET card_brand = 'Visa', card_last4 = '4242', card_exp_month = 7, card_exp_year = 2029 WHERE id = '${card.id}'`);
    expect(must(`SELECT array_to_string(matched_kinds, ',') FROM public.renter_blacklist_matches WHERE source_id = '${card.id}'`)).toBe("card");
    const ip = flagged(`INSERT INTO public.applications (full_name, email, phone) VALUES ('Same Device', 'd@example.com', '5550102006') RETURNING id`);
    must(`INSERT INTO public.agreements (application_id, signer_ip) VALUES ('${ip.id}', '198.51.100.23')`);
    expect(must(`SELECT array_to_string(matched_kinds, ',') FROM public.renter_blacklist_matches WHERE source_id = '${ip.id}'`)).toBe("ip");
    expect(must(`SELECT reason FROM public.fleet_review_decisions WHERE application_id = '${ip.id}'`)).toBe("blacklist match: Signer IP (matches Heather Bell)");
    // A private office IP is never used.
    const office = flagged(`INSERT INTO public.applications (full_name, email, phone) VALUES ('Office Wifi', 'o@example.com', '5550102007') RETURNING id`);
    must(`INSERT INTO public.agreements (application_id, signer_ip) VALUES ('${office.id}', '10.0.0.5')`);
    expect(must(`SELECT count(*) FROM public.renter_blacklist_matches WHERE source_id = '${office.id}'`)).toBe("0");
    // Each match blocks approval until an Owner clears it; never declined.
    expect(psql(`UPDATE public.applications SET status = 'approved' WHERE id = '${unit.id}'`).err).toContain("renter_blacklist_match_uncleared");
    expect(must(`SELECT status FROM public.applications WHERE id = '${unit.id}'`)).toBe("new");
    expect(JSON.parse(must(`SELECT public.renter_blacklist_check('${dob.id}')::text`)).matches[0]).toMatchObject({ full_name: "Heather Bell", kinds: ["dob_last"], cleared: false });
  });

  test("blacklisting Heather's new phone flags someone who already had it (snapshot grows, scan runs)", () => {
    const friend = must(`INSERT INTO public.applications (full_name, email, phone, status) VALUES ('Friend', 'f@example.com', '5550103030', 'reviewing') RETURNING id`);
    expect(must(`SELECT count(*) FROM public.renter_blacklist_matches WHERE source_id = '${friend}'`)).toBe("0");
    must(`INSERT INTO public.driver_contacts (application_id, kind, value) VALUES ('${HEATHER}', 'phone', '555-010-3030')`);
    expect(must(`SELECT array_to_string(matched_kinds, ',') FROM public.renter_blacklist_matches WHERE source_id = '${friend}'`)).toBe("phone");
  });

  test("re-entry through the waitlist and the website contact form is recorded and flagged", () => {
    const w = must(`INSERT INTO public.waitlist (full_name, email, phone) VALUES ('HB', 'RENTER6@example.com', '555 010 0106') RETURNING id`);
    expect(must(`SELECT (review_flagged_at IS NOT NULL) || '|' || review_reason FROM public.waitlist WHERE id = '${w}'`)).toBe("true|blacklist match: Email, Phone (matches Heather Bell)");
    expect(must(`SELECT matched_name || '|' || array_to_string(matched_kinds, ',') FROM public.renter_blacklist_matches WHERE source_table = 'waitlist' AND source_id = '${w}'`)).toBe("Heather Bell|email,phone");
    const c = must(`INSERT INTO public.contact_leads (name, email, phone) VALUES ('Someone', 'nobody@example.com', '+15550100106') RETURNING id`);
    expect(must(`SELECT array_to_string(matched_kinds, ',') FROM public.renter_blacklist_matches WHERE source_table = 'contact_leads' AND source_id = '${c}'`)).toBe("phone");
    const clean = must(`INSERT INTO public.waitlist (full_name, email, phone) VALUES ('Clean', 'clean2@example.com', '5550104444') RETURNING id`);
    expect(must(`SELECT (review_flagged_at IS NULL)::text FROM public.waitlist WHERE id = '${clean}'`)).toBe("true");
  });

  test("automated message suppression: blacklisted application, her phone or email; not linked people or others", () => {
    const sup = (app: string | null, phone: string | null, email: string | null) =>
      must(`SELECT public.renter_blacklist_suppressed(${app ? `'${app}'` : "NULL"}, ${lit(phone)}, ${lit(email)})`);
    expect(sup(HEATHER, null, null)).toBe("t");
    expect(sup(null, "+15550100106", null)).toBe("t");
    expect(sup(null, null, " renter6@EXAMPLE.com")).toBe("t");
    expect(sup(null, "+15550109999", "someone@example.com")).toBe("f");
    expect(sup(null, null, null)).toBe("f");
    // A linked (matched) person is flagged, not silenced: staff still talk to them.
    const linked = must(`SELECT source_id FROM public.renter_blacklist_matches WHERE source_table = 'applications' AND matched_kinds = ARRAY['address_base'] LIMIT 1`);
    expect(sup(linked, null, null)).toBe("f");
    // Suppression is its own rule: nothing is written to the STOP list.
    expect(must(`SELECT to_regclass('public.sms_opt_outs') IS NULL`)).toBe("t");
    expect(must(`SELECT has_function_privilege('authenticated', 'public.renter_blacklist_suppressed(uuid, text, text)', 'EXECUTE')`)).toBe("f");
    expect(must(`SELECT has_function_privilege('service_role', 'public.renter_blacklist_suppressed(uuid, text, text)', 'EXECUTE')`)).toBe("t");
    expect(must(`SELECT has_table_privilege('authenticated', 'public.renter_blacklist_matches', 'INSERT')`)).toBe("f");
  });

  test("permissions: browser roles cannot reach the identifiers or the check function", () => {
    expect(must(`SELECT has_table_privilege('authenticated', 'public.renter_blacklist_identifiers', 'SELECT')`)).toBe("f");
    expect(must(`SELECT has_table_privilege('anon', 'public.renter_blacklist', 'SELECT')`)).toBe("f");
    expect(must(`SELECT has_table_privilege('authenticated', 'public.renter_blacklist', 'DELETE')`)).toBe("f");
    expect(must(`SELECT has_function_privilege('authenticated', 'public.renter_blacklist_check(uuid)', 'EXECUTE')`)).toBe("f");
    expect(must(`SELECT has_function_privilege('service_role', 'public.renter_blacklist_check(uuid)', 'EXECUTE')`)).toBe("t");
    expect(must(`SELECT string_agg(policyname || ':' || cmd, ',' ORDER BY policyname) FROM pg_policies WHERE tablename = 'renter_blacklist'`))
      .toBe("Manager adds to blacklist:INSERT,Owner removes from blacklist:UPDATE,Staff read blacklist:SELECT");
    expect(must(`SELECT pg_get_expr(polwithcheck, polrelid) FROM pg_policy WHERE polname = 'Manager adds to blacklist'`)).toContain("is_manager");
    expect(must(`SELECT pg_get_expr(polwithcheck, polrelid) FROM pg_policy WHERE polname = 'Owner removes from blacklist'`)).toContain("is_owner");
  });
});
