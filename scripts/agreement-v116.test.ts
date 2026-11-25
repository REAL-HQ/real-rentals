/**
 * v1.16 (v1.15 with Section 13 toll and citation terms) is the default
 * agreement. Fake data only; no database, no email, no Stripe, nothing sent.
 * Run: bunx vitest run scripts/agreement-v116.test.ts
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
import { V114_SOURCE } from "../src/lib/agreement-v114";
import { V115_SOURCE, V115_TERM_DEFAULTS, V115_ADDITIONS } from "../src/lib/agreement-v115";
import { V116_SOURCE, V116_TERM_DEFAULTS, SECTION_13, TOLL_PAYMENT_CURE, TRANSPONDER_REPLACEMENT_CHARGE, TOLL_REVIEW_WINDOW } from "../src/lib/agreement-v116";
import { FL_ADDENDUM_OWNER_APPROVAL } from "../src/lib/agreement-fl-addendum";
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
const v116 = libraryTemplate("insurance_included_v116")!;
const resolved = resolveTerms(writeTerms(V116_SOURCE, V116_TERM_DEFAULTS));
const section = resolved.slice(resolved.indexOf("## 13. Tolls"), resolved.indexOf("## 14. GPS"));

describe("v1.16 stays the Section 13 agreement; v1.17 is the default", () => {
  it("v1.16 stays approved; new sends, amendments, and swaps use v1.17", () => {
    expect(DEFAULT_LIBRARY_KEY).toBe("insurance_included_v117");
    expect(AMENDMENT_TEMPLATE_KEY).toBe(DEFAULT_LIBRARY_KEY);
    expect(SWAP_TERMS_VERSION).toBe("v1.17");
    expect(OWNER_APPROVED_LIBRARY.insurance_included_v116).toEqual({ at: "2026-11-21", by: "Dolmar Cross (Owner), on merging the v1.16 PR" });
    expect(v116.displayVersion).toBe("1.16");
    expect(v116.insuranceIncluded).toBe(true);
    expect(v116.compareWith).toBe("insurance_included_v115");
    expect(V116_SOURCE).toContain("#- Vehicle Rental Agreement (v1.16)");
    expect(acknowledgmentsOf(v116.body)).toEqual(acknowledgmentsOf(libraryTemplate("insurance_included_v115")!.body));
    expect(parseLayout(v116.body).filter((b) => b.k === "sig")).toHaveLength(1);
  });

  it("keeps every v1.15 clause except the title and Section 13", () => {
    const diff = lineDiff(V115_SOURCE, V116_SOURCE);
    const dels = diff.filter((d) => d.t === "del").map((d) => d.line);
    expect(dels).toEqual([
      "#- Vehicle Rental Agreement (v1.15)",
      expect.stringContaining("**13.1 Tolls.**"),
      expect.stringContaining("name, address, and license information"),
    ]);
    const text = plain(resolved);
    for (const clause of V115_ADDITIONS) expect(text).toContain(clause);
    expect(V115_SOURCE).toContain("name, address, and license information");
    expect(V115_SOURCE).not.toContain("**13.3 ");
    expect(V114_SOURCE).toContain("name, address, and license information");
    expect(V114_SOURCE).toContain("#- Vehicle Rental Agreement (v1.14)");
  });

  it("prints the three filled amounts and the $25 citation fee, with no blanks", () => {
    expect(TOLL_PAYMENT_CURE).toBe("1 day");
    expect(TRANSPONDER_REPLACEMENT_CHARGE).toBe("$25");
    expect(TOLL_REVIEW_WINDOW).toBe("3 days");
    expect(V116_TERM_DEFAULTS.fee_citation_admin).toBe("$25");
    expect(V115_TERM_DEFAULTS.fee_citation_admin).toBe("$25");
    expect(section).toContain("within 1 day of our notice.");
    expect(section).not.toContain("1 days");
    expect(section).toContain("you pay a replacement charge of $25, plus any tolls and fees that result.");
    expect(section).toContain("tell us in writing within 3 days of the charge.");
    expect(section).toContain("A review does not pause any deadline we must meet with an agency, including the deadline to file a transfer affidavit.");
    expect(section).toContain("you also pay the $25 administrative fee shown in Section 4");
    expect(section).toContain("A transfer does not waive the $25 administrative fee");
    expect(section).toContain("Our fee on ordinary tolls remains $0.");
    expect(section).toContain("instead of, and not in addition to, any fee of ours on ordinary tolls.");
    expect(section).not.toMatch(/\[__\]|\[\$__\]|\{\{|\[\[|__________|\(optional\)|attorney|DRAFT|suggested 14/i);
    expect(/[\u2013\u2014]/.test(V116_SOURCE)).toBe(false);
    expect(SECTION_13).not.toMatch(/bristol|allcom|clarence|progressive|geico/i);
  });

  it("keeps the Section 4 toll and citation rows and revises Section 13 in place", () => {
    const fees = (parseLayout(resolved).find((b) => b.k === "table" && (b as any).header?.[0] === "Item") as any).rows.map((r: any) => r.cells);
    expect(fees).toContainEqual(["Tolls (SunPass / toll-by-plate)", "Actual amount owed, no added fee"]);
    expect(fees).toContainEqual(["Parking tickets, camera citations & violations", "Actual amount owed + $25 administrative fee per citation"]);
    expect(section).toContain("**13.1 Tolls.**");
    expect(section).toContain("date of birth, driver license number, the rental dates, and a copy of this Agreement");
    expect(section).toContain("§316.1001(2)(c)");
    expect(section).toContain("§316.0083");
    expect(section).toContain("§316.1896");
    expect(section).toContain("**13.6 Third-Party Toll Billing.**");
    expect(section).toContain("**13.7 Questions About a Charge.**");
    expect(resolved).toContain("Your payment, damage, indemnity, toll and citation, chargeback, and collection obligations survive");
    expect(V116_SOURCE.indexOf("## 13. Tolls")).toBeLessThan(V116_SOURCE.indexOf("## 14. GPS"));
  });

  it("does not send the Florida 812.155 Addendum with a new agreement", () => {
    expect(FL_ADDENDUM_OWNER_APPROVAL).toBeNull();
    expect(V116_SOURCE).not.toContain("Florida 812.155 Addendum");
    for (const f of ["src/lib/agreements.functions.ts", "src/lib/agreement-v116.ts", "src/lib/vehicle-swap.server.ts", "src/lib/rental-amendment.ts"]) {
      expect(readFileSync(new URL(`../${f}`, import.meta.url), "utf8")).not.toMatch(/agreement-fl-addendum|FL_ADDENDUM/);
    }
  });

  it("the default send stores v1.17 and leaves an explicit v1.16 send on v1.16", async () => {
    const db = fakeDb(seed());
    const sent = await issueAgreement(db as any, APP.id, { createdBy: null, prep: fleetAgreementPrep({ enabled: true, amount: 50 }, null) });
    const row = db.state.agreements.find((a: any) => a.id === sent.id);
    expect(row.metadata.template_key).toBe("insurance_included_v117");
    expect(row.body).toContain("(v1.17)");
    expect(row.body).toContain("at least 23 to rent a luxury or premium vehicle");
    expect(row.body).toContain("you must give us a working payment method within 1 day of our notice.");
    expect(row.body).not.toContain("1 days");
    expect(row.body).toContain("replacement charge of $25");
    expect(row.body).toContain("within 3 days of the charge.");
    expect(row.body).toContain("including the deadline to file a transfer affidavit.");
    expect(row.body).not.toMatch(/\{\{|\[\[|__________|\[__\]/);
    const older = fakeDb(seed());
    const sent116 = await issueAgreement(older as any, APP.id, { createdBy: null, prep: fleetAgreementPrep({ enabled: true, amount: 50 }, null), templateKey: "insurance_included_v116" });
    const row116 = older.state.agreements.find((a: any) => a.id === sent116.id);
    expect(row116.metadata.template_key).toBe("insurance_included_v116");
    expect(row116.body).toContain("(v1.16)");
    expect(row116.body).toContain("at least 25 to rent a luxury or premium vehicle");
  });

  it("a preview of the default has no blockers and one agreement", async () => {
    const p = await prepare(fakeDb(seed()) as any, APP.id);
    expect(p.blockers).toEqual([]);
    expect(p.tpl.meta.key).toBe("insurance_included_v117");
    expect(plain(p.body)).toContain("within 3 days of the charge.");
    expect(parseLayout(p.body).filter((b) => b.k === "sig")).toHaveLength(1);
  });
});
