import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  BLACKLIST_REASONS,
  appendNote,
  applicationIdentifiers,
  blacklistBlockers,
  blacklistNotesLine,
  matchingKinds,
  normalizeAddress,
  normalizeEmail,
  normalizeLicense,
  normalizePhone,
  secondStrikeReached,
  strikeBlockers,
} from "../src/lib/blacklist";
import {
  addToBlacklist,
  blacklistRefusalFromDbError,
  checkBlacklist,
  clearBlacklistMatch,
  flagBlacklistIds,
  logStrike,
  removeFromBlacklist,
  voidStrike,
} from "../src/lib/blacklist.server";
import { driverStatusDisplay } from "../src/lib/driver-status-display";
import { DANGER_BADGE } from "../src/lib/badge-tone";
import { BLACKLISTED_BADGE } from "../src/lib/blacklist";

/** In-memory Supabase-style fake: select / insert / update / upsert with eq, is filters, and rpc. */
function fakeAdmin(seed: Record<string, any[]>, rpcResult?: { data?: any; error?: any }) {
  const db: Record<string, any[]> = JSON.parse(JSON.stringify(seed));
  let n = 0;
  const from = (table: string) => {
    db[table] ??= [];
    const f: Array<(r: any) => boolean> = [];
    let mode: "select" | "update" | "insert" | "upsert" = "select";
    let patch: any = null;
    let ins: any = null;
    const q: any = {
      select: () => q,
      eq: (c: string, v: any) => (f.push((r) => r[c] === v), q),
      is: (c: string, v: any) => (f.push((r) => (r[c] ?? null) === v), q),
      limit: () => q,
      update: (p: any) => ((mode = "update"), (patch = p), q),
      insert: (r: any) => ((mode = "insert"), (ins = r), q),
      upsert: (r: any) => ((mode = "upsert"), (ins = r), q),
      single: () => run(true),
      maybeSingle: () => run(true),
      then: (res: any, rej: any) => run(false).then(res, rej),
    };
    const run = async (one: boolean) => {
      if (mode === "insert" || mode === "upsert") {
        const rows = (Array.isArray(ins) ? ins : [ins]).map((r: any) => ({ id: `new-${++n}`, created_at: new Date(Date.UTC(2026, 10, 19, 0, n)).toISOString(), ...r }));
        db[table].push(...rows);
        return { data: one ? rows[0] : rows, error: null };
      }
      const hit = db[table].filter((r) => f.every((x) => x(r)));
      if (mode === "update") hit.forEach((r) => Object.assign(r, patch));
      return { data: one ? (hit[0] ?? null) : hit, error: null };
    };
    return q;
  };
  const rpc = async () => rpcResult ?? { data: { blacklisted: false, block: null, matches: [] }, error: null };
  return { admin: { from, rpc }, db };
}

const APP = "36973513-0000-4000-8000-000000000001";
const owner = { userId: "u-owner", email: "owner@example.com", role: "admin", tier: "owner" as const };
const manager = { userId: "u-mgr", email: "mgr@example.com", role: "team", tier: "manager" as const };
const coordinator = { userId: "u-co", email: "co@example.com", role: "coordinator", tier: "coordinator" as const };
const audits: any[] = [];
const audit = async (_a: any, e: any) => void audits.push(e);
const seed = () => ({
  applications: [{ id: APP, full_name: "Test Renter", notes: "Prior note.", deleted_at: null }],
  renter_blacklist: [] as any[],
  renter_strikes: [] as any[],
  renter_blacklist_clearances: [] as any[],
});
const HEATHER_NOTE =
  "Blacklisted Nov 19, 2026: rent unpaid 2+ days ($350), ignored multiple contacts, kill switch bypassed/drove while disabled, vehicle CZ07DA repossessed Nov 19 with spare key; main key not returned ($150 replacement). Never signed a rental agreement.";

describe("status vocabulary", () => {
  test("9 one-strike reasons + 3 two-strike reasons, Title Case, no Other", () => {
    expect(BLACKLIST_REASONS.length).toBe(12);
    expect(BLACKLIST_REASONS.filter((r) => r.strike).map((r) => r.strike)).toEqual(["late_payment", "smoking", "dirty_return"]);
    expect(BLACKLIST_REASONS.some((r) => /other/i.test(r.key))).toBe(false);
    expect(BLACKLIST_REASONS[0].label).toBe("Vehicle Repossessed For Non-Payment Or Refusal To Return");
    for (const r of BLACKLIST_REASONS) {
      for (const w of r.label.replace(/[()/,]/g, " ").split(/\s+/).filter(Boolean)) {
        if (["/", "-"].includes(w)) continue;
        expect(w[0]).toBe(w[0].toUpperCase());
      }
    }
  });
  test("Blacklisted badge is the pastel Unqualified red", () => {
    expect(BLACKLISTED_BADGE).toBe(DANGER_BADGE);
  });
  test("list status shows Blacklisted over everything, even Needs Staff and Closed", () => {
    const d = driverStatusDisplay("closed", { reason: "x" }, { reasonLabel: "Chargeback On Rent Actually Owed" });
    expect(d.label).toBe("Blacklisted");
    expect(d.blacklisted).toBe(true);
    expect(d.needsStaff).toBe(false);
    expect(d.underlying).toBe("closed");
    expect(driverStatusDisplay("approved", null, null).label).toBe("Approved");
  });
  test("a blacklist match flag reads as a match, not FLEET", () => {
    const d = driverStatusDisplay("new", { reason: "matches blacklisted renter", escalationCodes: ["blacklist_match"] });
    expect(d.needsStaff).toBe(true);
    expect(d.title).toContain("Matches a blacklisted renter");
  });
});

describe("field rules", () => {
  test("reason, note and date are required; no future date", () => {
    const b = blacklistBlockers({ reason: "", note: "", date: "" });
    expect(b.map((x) => x.field).sort()).toEqual(["date", "note", "reason"]);
    expect(blacklistBlockers({ reason: "chargeback", note: "Disputed week 3", date: "2026-11-20" }, [], "2026-11-19")[0].field).toBe("date");
    expect(blacklistBlockers({ reason: "chargeback", note: "Disputed week 3", date: "2026-11-19" }, [], "2026-11-19")).toEqual([]);
  });
  test("two-strike reasons need the second strike (late payment within 60 days)", () => {
    const late = (d: string) => ({ kind: "late_payment", occurred_on: d });
    expect(secondStrikeReached([late("2026-09-01")], "late_payment")).toBe(false);
    expect(secondStrikeReached([late("2026-09-01"), late("2026-11-15")], "late_payment")).toBe(false);
    expect(secondStrikeReached([late("2026-09-01"), late("2026-10-20")], "late_payment")).toBe(true);
    expect(secondStrikeReached([late("2026-09-01"), { ...late("2026-09-02"), voided_at: "x" }], "late_payment")).toBe(false);
    expect(secondStrikeReached([{ kind: "smoking", occurred_on: "2026-01-01" }, { kind: "smoking", occurred_on: "2026-11-01" }], "smoking")).toBe(true);
    expect(blacklistBlockers({ reason: "smoking_second_strike", note: "Smoked again", date: "2026-11-19" }, [{ kind: "smoking", occurred_on: "2026-11-01" }])[0].field).toBe("strikes");
  });
  test("warnings need kind, note, date", () => {
    expect(strikeBlockers({ kind: "nope", note: "", date: "" }).length).toBe(3);
    expect(strikeBlockers({ kind: "dirty_return", note: "Trash in back seat", date: "2026-11-19" })).toEqual([]);
  });
  test("notes line keeps a note that already says Blacklisted; append skips identical text", () => {
    expect(blacklistNotesLine({ reason: "vehicle_repossessed", note: HEATHER_NOTE, date: "2026-11-19", addedBy: "Owner" })).toBe(HEATHER_NOTE);
    expect(blacklistNotesLine({ reason: "chargeback", note: "Disputed rent", date: "2026-11-19", addedBy: "Owner" })).toBe(
      "Blacklisted Nov 19, 2026 (Chargeback On Rent Actually Owed) by Owner: Disputed rent",
    );
    expect(appendNote("A", "B")).toBe("A\n\nB");
    expect(appendNote(`x\n\n${HEATHER_NOTE}`, HEATHER_NOTE)).toBe(`x\n\n${HEATHER_NOTE}`);
    expect(appendNote(null, "B")).toBe("B");
  });
});

describe("matching normalization", () => {
  test("phone digits only, US 1 dropped", () => {
    expect(normalizePhone("+1 (555) 010-0199")).toBe("5550100199");
    expect(normalizePhone("555.010.0199")).toBe("5550100199");
    expect(normalizePhone("12345")).toBeNull();
  });
  test("email lowercase, licence uppercase alnum", () => {
    expect(normalizeEmail("  Renter.Test@Example.COM ")).toBe("renter.test@example.com");
    expect(normalizeEmail("n/a")).toBeNull();
    expect(normalizeLicense("b123-456-78-901-0")).toBe("B1234567890 10".replace(" ", ""));
    expect(normalizeLicense("x")).toBeNull();
  });
  test("address: abbreviations, unit forms, zip", () => {
    const a = normalizeAddress("123 North Main Street Apt 4", "33610");
    expect(a).toBe("123 n main st apt 4|33610");
    expect(normalizeAddress("123 N. Main St. #4, Tampa, FL 33610-1234", null)).toBe(a);
    expect(normalizeAddress("123 n main st unit 4", "33610")).toBe(a);
    expect(normalizeAddress("N/A", "33610")).toBeNull();
  });
  test("a re-application with reformatted details matches on every kind", () => {
    const bad = applicationIdentifiers({ phone: "(555) 010-0199", email: "A@B.com", license_number: "B123 456", address: "9 Oak Avenue", zip: "33610" });
    const reapply = applicationIdentifiers({ phone: "15550100199", email: "a@b.com ", license_number: "b123-456", address: "9 oak ave, Tampa FL 33610", zip: "" });
    expect(matchingKinds(reapply, bad)).toEqual(["address", "email", "license", "phone"]);
    expect(matchingKinds(applicationIdentifiers({ phone: "5550100100" }), bad)).toEqual([]);
  });
});

describe("permissions and writes", () => {
  test("only an Owner can blacklist, remove, void, or clear a match", async () => {
    for (const actor of [manager, coordinator]) {
      const { admin } = fakeAdmin(seed());
      await expect(addToBlacklist(admin, actor, { applicationId: APP, reason: "chargeback", note: "Disputed rent", date: "2026-11-19" }, audit, "2026-11-19")).rejects.toThrow("Only An Owner");
      await expect(removeFromBlacklist(admin, actor, { applicationId: APP, reason: "Paid in full" }, audit)).rejects.toThrow("Only An Owner");
      await expect(voidStrike(admin, actor, { strikeId: "s1", reason: "Entered in error" }, audit)).rejects.toThrow("Only An Owner");
      await expect(clearBlacklistMatch(admin, actor, { applicationId: APP, blacklistIds: ["b"] }, audit)).rejects.toThrow("Only An Owner");
    }
  });
  test("Owner blacklists: entry stores reason/note/date/who, note goes to Notes, audit written, no duplicate", async () => {
    const { admin, db } = fakeAdmin(seed());
    audits.length = 0;
    const r = await addToBlacklist(admin, owner, { applicationId: APP, reason: "vehicle_repossessed", note: HEATHER_NOTE, date: "2026-11-19" }, audit, "2026-11-19");
    expect(r.entry.reasonLabel).toBe("Vehicle Repossessed For Non-Payment Or Refusal To Return");
    expect(db.renter_blacklist[0]).toMatchObject({ application_id: APP, reason_code: "vehicle_repossessed", blacklisted_on: "2026-11-19", added_by: "u-owner", added_by_label: "owner@example.com (Owner)" });
    expect(db.applications[0].notes).toBe(`Prior note.\n\n${HEATHER_NOTE}`);
    expect(audits[0].action).toBe("renter.blacklisted");
    await expect(addToBlacklist(admin, owner, { applicationId: APP, reason: "chargeback", note: "Again", date: "2026-11-19" }, audit, "2026-11-19")).rejects.toThrow("Already Blacklisted");
  });
  test("identical note already in Notes is not added twice", async () => {
    const s = seed();
    s.applications[0].notes = `Earlier.\n\n${HEATHER_NOTE}`;
    const { admin, db } = fakeAdmin(s);
    await addToBlacklist(admin, owner, { applicationId: APP, reason: "vehicle_repossessed", note: HEATHER_NOTE, date: "2026-11-19" }, audit, "2026-11-19");
    expect(db.applications[0].notes).toBe(`Earlier.\n\n${HEATHER_NOTE}`);
  });
  test("removal keeps history with who, when and why", async () => {
    const { admin, db } = fakeAdmin(seed());
    await addToBlacklist(admin, owner, { applicationId: APP, reason: "chargeback", note: "Disputed rent", date: "2026-11-19" }, audit, "2026-11-19");
    await expect(removeFromBlacklist(admin, owner, { applicationId: APP, reason: "no" }, audit)).rejects.toThrow("Say Why");
    const r = await removeFromBlacklist(admin, owner, { applicationId: APP, reason: "Chargeback reversed by bank" }, audit, new Date("2026-11-20T15:00:00Z"));
    expect(r.entry.removedBy).toBe("owner@example.com (Owner)");
    expect(db.renter_blacklist.length).toBe(1);
    expect(db.renter_blacklist[0].removal_reason).toBe("Chargeback reversed by bank");
    expect(db.applications[0].notes).toContain("Removed From Blacklist Nov 20, 2026 by owner@example.com (Owner): Chargeback reversed by bank");
    await expect(removeFromBlacklist(admin, owner, { applicationId: APP, reason: "Second time" }, audit)).rejects.toThrow("Not Blacklisted");
  });
  test("any staff can log a warning; second strike unlocks the two-strike reason", async () => {
    const { admin, db } = fakeAdmin(seed());
    await expect(addToBlacklist(admin, owner, { applicationId: APP, reason: "late_payment_second_strike", note: "Late twice", date: "2026-11-19" }, audit, "2026-11-19")).rejects.toThrow("Two Logged Late Payment Strikes");
    const s1 = await logStrike(admin, coordinator, { applicationId: APP, kind: "late_payment", note: "Paid 3 days late", date: "2026-10-01" }, audit, "2026-11-19");
    expect(s1.secondStrike).toBe(false);
    const s2 = await logStrike(admin, manager, { applicationId: APP, kind: "late_payment", note: "Paid 2 days late", date: "2026-11-15" }, audit, "2026-11-19");
    expect(s2.secondStrike).toBe(true);
    expect(db.applications[0].notes).toContain("Warning (Late Payment) Oct 1, 2026 by co@example.com (Coordinator): Paid 3 days late");
    const r = await addToBlacklist(admin, owner, { applicationId: APP, reason: "late_payment_second_strike", note: "Late twice in 60 days", date: "2026-11-19" }, audit, "2026-11-19");
    expect(r.entry.reason).toBe("late_payment_second_strike");
  });
});

describe("blocking", () => {
  test("checkBlacklist maps the database answer to the refusal staff see", async () => {
    const bl = fakeAdmin(seed(), { data: { blacklisted: true, block: "renter_blacklisted", matches: [] }, error: null }).admin;
    expect((await checkBlacklist(bl, APP)).message).toBe("This Renter Is Blacklisted. They Cannot Be Approved, Reserved Or Rented To.");
    const m = fakeAdmin(seed(), { data: { blacklisted: false, block: "renter_blacklist_match_uncleared", matches: [{ blacklist_id: "b1", kinds: ["phone"], cleared: false }] }, error: null }).admin;
    const c = await checkBlacklist(m, APP);
    expect(c.message).toContain("Matches A Blacklisted Renter");
    expect(c.matches).toEqual([{ blacklistId: "b1", kinds: ["phone"], cleared: false }]);
    const clean = fakeAdmin(seed()).admin;
    expect((await checkBlacklist(clean, APP)).message).toBeNull();
  });
  test("not installed -> open; any other error -> closed", async () => {
    const missing = fakeAdmin(seed(), { data: null, error: { code: "PGRST202", message: "Could not find the function" } }).admin;
    expect((await checkBlacklist(missing, APP)).installed).toBe(false);
    const broken = fakeAdmin(seed(), { data: null, error: { code: "57014", message: "timeout" } }).admin;
    await expect(checkBlacklist(broken, APP)).rejects.toThrow("Could Not Check The Blacklist");
  });
  test("trigger refusals read as sentences", () => {
    expect(blacklistRefusalFromDbError("renter_blacklisted: no new rental")).toContain("Is Blacklisted");
    expect(blacklistRefusalFromDbError("renter_blacklist_match_uncleared: application x")).toContain("Matches A Blacklisted Renter");
    expect(blacklistRefusalFromDbError("something else")).toBeNull();
  });
  test("every approval / reservation / activation / agreement path runs the check", () => {
    const src = (p: string) => readFileSync(new URL(`../src/lib/${p}`, import.meta.url), "utf8");
    expect(src("applications.functions.ts")).toMatch(/checkBlacklist\(supabaseAdmin, data\.id\)/);
    expect(src("reservations.functions.ts")).toMatch(/assertNotBlacklisted\(admin, data\.applicationId\)/);
    expect(src("rentals.functions.ts")).toMatch(/checkBlacklist\(supabaseAdmin, data\.applicationId\)/);
    expect(src("agreements.functions.ts")).toMatch(/checkBlacklist\(admin, applicationId\)/);
    // FLEET's approval is the same core (approveApplicationCore) and an open needs_staff blocks it.
    expect(src("fleet-review.server.ts")).toMatch(/approveApplicationCore/);
  });
  test("a blacklist-match flag is cleared only by an Owner and records clearances", async () => {
    expect(flagBlacklistIds({ escalation_codes: ["blacklist_match"], assessment: { blacklist_match: { blacklist_ids: ["b1", "b2"] } } })).toEqual(["b1", "b2"]);
    expect(flagBlacklistIds({ escalation_codes: ["other"], assessment: { blacklist_match: { blacklist_ids: ["b1"] } } })).toEqual([]);
    const { admin, db } = fakeAdmin(seed());
    await clearBlacklistMatch(admin, owner, { applicationId: APP, blacklistIds: ["b1"], note: "Different person, same building" }, audit);
    expect(db.renter_blacklist_clearances[0]).toMatchObject({ application_id: APP, blacklist_id: "b1", cleared_by: "u-owner" });
    const fn = readFileSync(new URL("../src/lib/fleet-review.functions.ts", import.meta.url), "utf8");
    expect(fn).toMatch(/Only An Owner Can Clear A Blacklist Match/);
  });
  test("no renter phone numbers or emails in the code added for this feature", () => {
    for (const f of ["../src/lib/blacklist.ts", "../src/lib/blacklist.server.ts", "../src/components/admin/BlacklistCard.tsx", "../supabase/migrations/20261120040000_renter_blacklist.sql", "../proposed/blacklist/01-blacklist-heather-bell.sql"]) {
      const t = readFileSync(new URL(f, import.meta.url), "utf8");
      expect(t).not.toMatch(/\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/);
    }
  });
});
