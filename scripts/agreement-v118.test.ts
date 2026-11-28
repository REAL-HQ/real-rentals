/**
 * v1.18 (v1.17 with Section 13 GPS history and photos, and Section 15
 * remote-disable wording) is the default agreement. Fake data only; no
 * database, no email, no Stripe, nothing sent.
 * Run: bunx vitest run scripts/agreement-v118.test.ts
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("@/lib/esign.server", () => ({
  getCompanySigner: async () => ({ name: "Test Signer", title: "Operations Lead" }),
  deliverSigningLink: async () => ({ email: "skipped", sms: "skipped", delivered: false }),
}));
vi.mock("@/lib/audit.server", () => ({ logAudit: async () => {} }));
vi.mock("@/lib/roles.server", () => ({ getActor: async () => null }));
vi.mock("@/lib/email.server", () => ({ sendPortalInviteEmail: async () => { throw new Error("no email in tests"); } }));
vi.mock("@/lib/reservation-confirmation.server", () => ({ maybeConfirmReservation: async () => null }));

import { prepareAgreementForTest as prepare, issueAgreement } from "../src/lib/agreements.functions";
import { fleetAgreementPrep } from "../src/lib/fleet-agreement.server";
import { libraryTemplate, acknowledgmentsOf, lineDiff, DEFAULT_LIBRARY_KEY, OWNER_APPROVED_LIBRARY } from "../src/lib/agreement-library";
import { CLAUSE_STARTER_INTERRUPT } from "../src/lib/agreement-v115";
import { V116_SOURCE } from "../src/lib/agreement-v116";
import { V117_SOURCE, V117_TERM_DEFAULTS } from "../src/lib/agreement-v117";
import {
  V118_SOURCE,
  V118_TERM_DEFAULTS,
  CLAUSE_STARTER_INTERRUPT_V118,
  V117_SECTION_13_2_INFO,
  V118_SECTION_13_2_INFO,
  V117_SECTION_13_3_INFO,
  V118_SECTION_13_3_INFO,
} from "../src/lib/agreement-v118";
import { FL_ADDENDUM_SOURCE, FL_ADDENDUM_VERSION, FL_ADDENDUM_OWNER_APPROVAL } from "../src/lib/agreement-fl-addendum";
import { parseLayout, layoutToText } from "../src/lib/agreement-layout";
import { resolveTerms, writeTerms } from "../src/lib/agreement-builder";
import { AMENDMENT_TEMPLATE_KEY } from "../src/lib/rental-amendment";
import { SWAP_TERMS_VERSION } from "../src/lib/vehicle-swap";

type Rows = Record<string, any[]>;
function fakeDb(seed: Rows) {
  const state: Rows = JSON.parse(JSON.stringify(seed));
  let n = 0;
  function q(table: string) {
    const f: ((r: any) => boolean)[] = [];
    let lim = Infinity; let op: "select" | "update" | "insert" = "select"; let patch: any = null; let inserted: any = null;
    const all = () => (state[table] ??= []);
    const run = () => {
      if (op === "insert") return { data: inserted, error: null };
      const hit = all().filter((r) => f.every((g) => g(r)));
      if (op === "update") { hit.forEach((r) => Object.assign(r, patch)); return { data: hit, error: null }; }
      return { data: hit.slice(0, lim), error: null };
    };
    const api: any = {
      select: () => api, order: () => api,
      eq: (k: string, v: any) => (f.push((r) => r[k] === v), api),
      neq: (k: string, v: any) => (f.push((r) => r[k] !== v), api),
      is: (k: string, v: any) => (f.push((r) => (r[k] ?? null) === v), api),
      in: (k: string, v: any[]) => (f.push((r) => v.includes(r[k])), api),
      not: (k: string, o: string, v: any) => (f.push((r) => (o === "is" ? (r[k] ?? null) !== v : r[k] !== v)), api),
      gte: (k: string, v: any) => (f.push((r) => r[k] >= v), api),
      lte: (k: string, v: any) => (f.push((r) => r[k] <= v), api),
      limit: (x: number) => ((lim = x), api),
      update: (p: any) => ((op = "update"), (patch = p), api),
      upsert: (p: any) => { const ex = all().find((r) => r.key === p.key); if (ex) Object.assign(ex, p); else all().push({ ...p }); return api; },
      insert: (row: any) => { op = "insert"; const rows = Array.isArray(row) ? row : [row]; const made = rows.map((r) => ({ id: r.id ?? `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, ...r })); all().push(...made); inserted = made[0]; return api; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
      maybeSingle: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null }; },
      single: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null }; },
    };
    return api;
  }
  return { from: q, state };
}

const APP: any = {
  id: "11111111-1111-4111-8111-111111111111", full_name: "Jordan Q Sample", email: "jordan.sample@example.com", phone: "+15550100199",
  address: "100 Sample St", city: "Tampa", state: "FL", zip: "33602", dob: "1990-04-02",
  license_number: "S123-456-78-900-0", license_state: "FL", license_expiration: "2030-04-02",
  vehicle_id: "22222222-2222-4222-8222-222222222222", weekly_rent: 375, deposit_amount: null,
  contract_start_date: "2026-11-20", contract_end_date: "2026-12-18", status: "approved", deleted_at: null,
};
const CAR: any = { id: APP.vehicle_id, year: 2021, make: "Toyota", model: "Camry", trim: "LE", color: "Silver", vin: "4T1C11AK5MU123456", weekly_rate: 375, deposit: 0, license_plate: "SMP123", plate_state: "FL", partner_id: null, archived_at: null };
const seed = (): Rows => ({
  applications: [APP], vehicles: [CAR], agreement_templates: [], markets: [], partners: [], agreements: [], esign_recipients: [], rentals: [],
  app_settings: [
    { key: "reservation_fee_auto", value: { enabled: true, amount: 50 } },
    { key: "company_identity", value: { legal_name: "Sample Rentals LLC" } },
  ],
});

const plain = (body: string) => layoutToText(body).replace(/\*\*/g, "");
const v118 = libraryTemplate("insurance_included_v118")!;
const resolved = resolveTerms(writeTerms(V118_SOURCE, V118_TERM_DEFAULTS));
const section13 = resolved.slice(resolved.indexOf("## 13. Tolls"), resolved.indexOf("## 14. GPS"));
const section15 = resolved.slice(resolved.indexOf("## 15. Vehicle Recovery"), resolved.indexOf("## 16. Default"));

describe("v1.18 is the default; older families stay unchanged", () => {
  it("v1.17 stays approved; new sends, amendments, and swaps use v1.18", () => {
    expect(DEFAULT_LIBRARY_KEY).toBe("insurance_included_v118");
    expect(AMENDMENT_TEMPLATE_KEY).toBe(DEFAULT_LIBRARY_KEY);
    expect(SWAP_TERMS_VERSION).toBe("v1.18");
    expect(OWNER_APPROVED_LIBRARY.insurance_included_v117).toEqual({ at: "2026-11-25", by: "Dolmar Cross (Owner), on merging the v1.17 PR" });
    expect(OWNER_APPROVED_LIBRARY.insurance_included_v118).toEqual({ at: "2026-11-28", by: "Dolmar Cross (Owner), on merging the v1.18 PR" });
    expect(v118.displayVersion).toBe("1.18");
    expect(v118.insuranceIncluded).toBe(true);
    expect(v118.compareWith).toBe("insurance_included_v117");
    expect(V118_SOURCE).toContain("#- Vehicle Rental Agreement (v1.18)");
    expect(acknowledgmentsOf(v118.body)).toEqual(acknowledgmentsOf(libraryTemplate("insurance_included_v117")!.body));
    expect(parseLayout(v118.body).filter((b) => b.k === "sig")).toHaveLength(1);
  });

  it("keeps every v1.17 clause except the title, Section 13.2, Section 13.3, and the starter-interrupt paragraph", () => {
    const diff = lineDiff(V117_SOURCE, V118_SOURCE);
    const dels = diff.filter((d) => d.t === "del").map((d) => d.line);
    expect(dels).toEqual([
      "#- Vehicle Rental Agreement (v1.17)",
      expect.stringContaining(V117_SECTION_13_2_INFO),
      expect.stringContaining(V117_SECTION_13_3_INFO),
      expect.stringContaining(CLAUSE_STARTER_INTERRUPT),
    ]);
    const adds = diff.filter((d) => d.t === "add").map((d) => d.line);
    expect(adds).toEqual([
      "#- Vehicle Rental Agreement (v1.18)",
      expect.stringContaining(V118_SECTION_13_2_INFO),
      expect.stringContaining(V118_SECTION_13_3_INFO),
      expect.stringContaining(CLAUSE_STARTER_INTERRUPT_V118),
    ]);
    expect(V117_SOURCE).toBe(V116_SOURCE.replace("(v1.16)", "(v1.17)"));
    expect(V117_SOURCE).toContain(CLAUSE_STARTER_INTERRUPT);
    expect(V117_SOURCE).not.toContain(CLAUSE_STARTER_INTERRUPT_V118);
    expect(V117_SOURCE).toContain("engine is turned off");
    expect(V118_TERM_DEFAULTS).toEqual(V117_TERM_DEFAULTS);
  });

  it("Section 13 still has the toll and citation terms, and now lists GPS history and photos", () => {
    expect(section13).toContain("**13.1 Tolls.**");
    expect(section13).toContain("**13.2 Tickets & Citations.**");
    expect(section13).toContain(V118_SECTION_13_2_INFO);
    expect(section13).toContain(V118_SECTION_13_3_INFO);
    expect(section13).toContain("GPS history, and photos");
    expect(section13).not.toContain("the rental dates, and a copy of this Agreement, as Florida law allows");
    expect(section13).toContain("§316.1001(2)(c)");
    expect(section13).toContain("**13.7 Questions About a Charge.**");
    expect(section13).not.toMatch(/\[__\]|\[\$__\]|\{\{|\[\[|__________|\(optional\)|attorney|DRAFT/i);
    expect(/[\u2013\u2014]/.test(V118_SOURCE)).toBe(false);
    expect(section13).not.toMatch(/bristol|allcom|clarence|progressive|geico|samsara|spireon|insurance company/i);
  });

  it("Section 15 still discloses remote disable and drops engine-off and moving-vehicle wording", () => {
    expect(section15).toContain("## 15. Vehicle Recovery");
    expect(section15).toContain("We may disable the Vehicle and take it back");
    expect(section15).toContain("You authorize REAL RENTALS and its recovery agents to locate the Vehicle");
    expect(section15).toContain("**Starter-Interrupt Device.**");
    expect(section15).toContain(CLAUSE_STARTER_INTERRUPT_V118);
    expect(section15).toContain("we may activate it to remotely disable the Vehicle");
    expect(section15).not.toContain("engine is turned off");
    expect(section15).not.toContain("restarting after the engine");
    expect(section15).not.toContain("We will not activate it to stop a moving vehicle");
    expect(section15).not.toMatch(/while the vehicle is moving/i);
    expect(section15).not.toMatch(/only (when|after|once|if) the engine/i);
    expect(section15).toContain("You agree we are not liable for lost earnings or other losses from its proper use.");
    expect(acknowledgmentsOf(v118.body)).toContain("Section 15: Starter-Interrupt Device.");
  });

  it("the default send stores v1.18 and leaves an explicit v1.17 send on v1.17", async () => {
    const db = fakeDb(seed());
    const sent = await issueAgreement(db as any, APP.id, { createdBy: null, prep: fleetAgreementPrep({ enabled: true, amount: 50 }, null) });
    const row = db.state.agreements.find((a: any) => a.id === sent.id);
    expect(row.metadata.template_key).toBe("insurance_included_v118");
    expect(row.body).toContain("(v1.18)");
    expect(row.body).toContain("GPS history, and photos");
    expect(row.body).toContain("we may activate it to remotely disable the Vehicle");
    expect(row.body).not.toContain("engine is turned off");
    expect(row.body).not.toContain("We will not activate it to stop a moving vehicle");
    expect(row.body).not.toMatch(/\{\{|\[\[|__________|\[__\]/);
    const older = fakeDb(seed());
    const sent117 = await issueAgreement(older as any, APP.id, { createdBy: null, prep: fleetAgreementPrep({ enabled: true, amount: 50 }, null), templateKey: "insurance_included_v117" });
    const row117 = older.state.agreements.find((a: any) => a.id === sent117.id);
    expect(row117.metadata.template_key).toBe("insurance_included_v117");
    expect(row117.body).toContain("(v1.17)");
    expect(row117.body).toContain(CLAUSE_STARTER_INTERRUPT);
    expect(row117.body).not.toContain("GPS history, and photos");
  });

  it("a preview of the default has no blockers and one agreement", async () => {
    const p = await prepare(fakeDb(seed()) as any, APP.id);
    expect(p.blockers).toEqual([]);
    expect(p.tpl.meta.key).toBe("insurance_included_v118");
    expect(plain(p.body)).toContain("GPS history, and photos");
    expect(plain(p.body)).toContain("we may activate it to remotely disable the Vehicle");
    expect(parseLayout(p.body).filter((b) => b.k === "sig")).toHaveLength(1);
  });

  it("the Florida addendum preview uses the v1.18 starter-interrupt wording and stays unapproved", () => {
    expect(FL_ADDENDUM_VERSION).toBe("1.1");
    expect(FL_ADDENDUM_OWNER_APPROVAL).toBeNull();
    expect(FL_ADDENDUM_SOURCE).toContain(CLAUSE_STARTER_INTERRUPT_V118);
    expect(FL_ADDENDUM_SOURCE).not.toContain("engine is turned off");
    expect(FL_ADDENDUM_SOURCE).not.toContain("We will not activate it to stop a moving vehicle");
    for (const f of ["src/lib/agreements.functions.ts", "src/lib/agreement-v118.ts", "src/lib/vehicle-swap.server.ts", "src/lib/rental-amendment.ts"]) {
      expect(readFileSync(new URL(`../${f}`, import.meta.url), "utf8")).not.toMatch(/agreement-fl-addendum|FL_ADDENDUM/);
    }
  });
});
