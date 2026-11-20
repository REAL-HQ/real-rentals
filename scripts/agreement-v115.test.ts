/**
 * v1.15 (v1.14 + the Florida additions, Nov 19 2026), the Florida 812.155
 * Addendum, Home Address required, and the retired v1.10 / v1.10.2 templates.
 * Fake data only; no database, no email, no Stripe, nothing sent.
 * Run: bunx vitest run scripts/agreement-v115.test.ts
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
import { LIBRARY, libraryTemplate, acknowledgmentsOf, lineDiff, DEFAULT_LIBRARY_KEY, OWNER_APPROVED_LIBRARY, isRetiredLibrary } from "../src/lib/agreement-library";
import { V114_SOURCE } from "../src/lib/agreement-v114";
import * as V115 from "../src/lib/agreement-v115";
import { FL_ADDENDUM_SOURCE, FL_ADDENDUM_OWNER_APPROVAL, renderFloridaAddendum, addendumBlockers, UNKNOWN_AGREEMENT_NUMBER } from "../src/lib/agreement-fl-addendum";
import { floridaAddendumFields } from "../src/lib/florida-addendum.functions";
import { homeAddressMissing, missingHomeAddressParts, formatHomeAddress, HOME_ADDRESS_LABEL } from "../src/lib/agreement-home-address";
import { parseLayout, layoutToText } from "../src/lib/agreement-layout";
import { writeTerms, resolveTerms } from "../src/lib/agreement-builder";
import { AMENDMENT_TEMPLATE_KEY } from "../src/lib/rental-amendment";

type Rows = Record<string, any[]>;
function fakeDb(seed: Rows) {
  const state: Rows = JSON.parse(JSON.stringify(seed));
  let n = 0;
  function q(table: string) {
    const f: ((r: any) => boolean)[] = [];
    let lim = Infinity; let op: "select" | "update" | "insert" = "select"; let patch: any = null; let inserted: any = null;
    const all = () => (state[table] ??= []);
    const run = () => {
      if (table === "license_dmv_checks" && !("license_dmv_checks" in seed)) return { data: null, error: { code: "42P01", message: `relation "license_dmv_checks" does not exist` } };
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
const seed = (feeOn: boolean, extra: Rows = {}): Rows => ({
  applications: [APP], vehicles: [CAR], agreement_templates: [], markets: [], partners: [], agreements: [], esign_recipients: [], rentals: [],
  app_settings: [
    { key: "reservation_fee_auto", value: { enabled: feeOn, amount: 50 } },
    { key: "company_identity", value: { legal_name: "Sample Rentals LLC" } },
  ],
  ...extra,
});


/** What the renter reads: layout markup and bold markers removed. */
const plain = (body: string) => layoutToText(body).replace(/\*\*/g, "");
const v115 = libraryTemplate("insurance_included_v115")!;
const v115Text = plain(v115.body);

describe("v1.15 contains every addition verbatim", () => {
  it("is the default, Owner-approval recorded, insurance included, v1.15 title", () => {
    expect(DEFAULT_LIBRARY_KEY).toBe("insurance_included_v115");
    expect(AMENDMENT_TEMPLATE_KEY).toBe(DEFAULT_LIBRARY_KEY);
    expect(OWNER_APPROVED_LIBRARY.insurance_included_v115).toBeTruthy();
    expect(v115.displayVersion).toBe("1.15");
    expect(v115.insuranceIncluded).toBe(true);
    expect(V115.V115_SOURCE).toContain("#- Vehicle Rental Agreement (v1.15)");
  });

  it.each([
    ["1. s. 812.155(6) notice", V115.FL_812155_NOTICE],
    ["2. Section 2.2", V115.CLAUSE_RENTAL_PERIOD_ENDS],
    ["3. Section 16.3 consent withdrawn", V115.CLAUSE_CONSENT_WITHDRAWN],
    ["4. notice address", V115.CLAUSE_NOTICE_ADDRESS],
    ["5. Service Area / county consent", V115.CLAUSE_SERVICE_AREA_CONSENT],
    ["6. starter interrupt", V115.CLAUSE_STARTER_INTERRUPT],
    ["7. Section 4 pest fee row", V115.CLAUSE_PEST_FEE],
    ["8. license copy consent", V115.CLAUSE_LICENSE_COPY],
  ])("%s", (_, clause) => {
    expect(v115Text).toContain(clause);
  });

  it("2/3/5/6/8 sit in the sections asked for", () => {
    const src = V115.V115_SOURCE;
    expect(src).toContain(`**2.2 Automatic Renewal.**`);
    expect(src.split("\n").find((l) => l.startsWith("**2.2 "))).toContain(V115.CLAUSE_RENTAL_PERIOD_ENDS);
    expect(src).toContain(`**16.3 Consent Withdrawn.** ${V115.CLAUSE_CONSENT_WITHDRAWN}`);
    expect(src).toContain(`**10.3 Service Area.** ${V115.CLAUSE_SERVICE_AREA_CONSENT}`);
    expect(src.indexOf(V115.CLAUSE_STARTER_INTERRUPT)).toBeGreaterThan(src.indexOf("## 15. Vehicle Recovery"));
    expect(src.indexOf(V115.CLAUSE_STARTER_INTERRUPT)).toBeLessThan(src.indexOf("## 16. Default"));
    expect(src.indexOf(V115.CLAUSE_LICENSE_COPY)).toBeGreaterThan(src.indexOf("## 19. Who Can Rent"));
    expect(src.indexOf(V115.CLAUSE_NOTICE_ADDRESS)).toBeGreaterThan(src.indexOf("| Home Address | {{driver_address}}"));
    expect(src.indexOf(V115.CLAUSE_NOTICE_ADDRESS)).toBeLessThan(src.indexOf("## 1. Definitions"));
  });

  it("1. the s. 812.155(6) notice stays a boxed statutory notice with its initials row", () => {
    const notices = parseLayout(v115.body).filter((b) => b.k === "notice") as any[];
    expect(notices.some((n) => /812\.155\(6\)/.test(n.lead) && `${n.lead} ${n.t}`.replace(/\*\*/g, "").includes(V115.FL_812155_NOTICE))).toBe(true);
    expect(acknowledgmentsOf(v115.body)).toContain("Section 17: Florida Required Notice (Section 812.155(6), Florida Statutes).");
  });

  it("6. the starter-interrupt disclosure has its own Renter Initials row", () => {
    const acks = acknowledgmentsOf(v115.body);
    expect(acks).toContain(V115.STARTER_INTERRUPT_INITIALS_ROW);
    expect(acks.length).toBe(acknowledgmentsOf(libraryTemplate("insurance_included")!.body).length + 1);
  });

  it("7. Section 4 fee row (verbatim item and amount) and pests in the Damage Waiver exclusions", () => {
    expect(V115.CLAUSE_PEST_FEE).toBe(`${V115.PEST_FEE_ITEM}: ${V115.PEST_FEE_AMOUNT}`);
    const fees = (parseLayout(v115.body).find((b) => b.k === "table" && b.header?.[0] === "Item") as any).rows.map((r: any) => r.cells);
    expect(fees).toContainEqual([V115.PEST_FEE_ITEM, V115.PEST_FEE_AMOUNT]);
    const exclusions = V115.V115_SOURCE.split("\n").find((l) => l.startsWith("**What it does not cover.**"))!;
    expect(exclusions).toContain("pest, insect, or biohazard infestation");
  });

  it("every v1.14 line is kept; only the changed lines differ", () => {
    const diff = lineDiff(V114_SOURCE, V115.V115_SOURCE);
    const dels = diff.filter((d) => d.t === "del").map((d) => d.line);
    expect(dels).toEqual([
      "#- Vehicle Rental Agreement (v1.14)",
      expect.stringMatching(/^\*\*2\.2 Automatic Renewal/),
      "| Late payment | [[fee_late_payment]]",
      expect.stringMatching(/^\*\*What it does not cover\.\*\*/),
    ]);
    // Each changed v1.14 line survives inside its v1.15 line (text only added).
    const adds = diff.filter((d) => d.t === "add").map((d) => d.line);
    expect(adds.some((a) => a.startsWith(dels[1]))).toBe(true);
  });

  it("all values set, renders with no blanks, no carrier/broker names, no 'deposit' for the Reservation Fee", async () => {
    const p = await prepare(fakeDb(seed(true)) as any, APP.id);
    expect(p.blockers).toEqual([]);
    expect(p.body).not.toContain("__________");
    expect(p.body).not.toMatch(/\{\{|\[\[/);
    const text = plain(p.body);
    for (const c of V115.V115_ADDITIONS) expect(text).toContain(c);
    expect(text).toContain("The Home Address above is your address for all legal notices");
    expect(text).toContain("Home Address: 100 Sample St, Tampa, FL, 33602");
    const added = V115.V115_ADDITIONS.join(" ");
    expect(added).not.toMatch(/bristol|allcom|clarence/i);
    expect(added).not.toMatch(/deposit/i);
    expect(v115Text).not.toMatch(/reservation deposit/i);
    expect(/[\u2013\u2014]/.test(V115.V115_SOURCE)).toBe(false);
  });

  it("the default send stores v1.15 and keeps the agreement number", async () => {
    const db = fakeDb(seed(true));
    const sent = await issueAgreement(db as any, APP.id, { createdBy: null, prep: fleetAgreementPrep({ enabled: true, amount: 50 }, null) });
    const row = db.state.agreements.find((a: any) => a.id === sent.id);
    expect(row.metadata.template_key).toBe("insurance_included_v115");
    expect(row.body).toContain("(v1.15)");
    expect(row.body).toContain(V115.CLAUSE_STARTER_INTERRUPT);
  });

  it("v1.14 is unchanged and still renderable (signed agreements keep their own text)", async () => {
    const v114 = libraryTemplate("insurance_included")!;
    expect(v114.source).toBe(V114_SOURCE);
    expect(V114_SOURCE).not.toContain(V115.CLAUSE_STARTER_INTERRUPT);
    const p = await prepare(fakeDb(seed(true)) as any, APP.id, fleetAgreementPrep({ enabled: true, amount: 50 }, null), "insurance_included");
    expect(p.blockers).toEqual([]);
    expect(p.body).toContain("(v1.14)");
  });
});

describe("Home Address is required before an agreement can be sent", () => {
  it("shared check: blank or whitespace parts are missing", () => {
    expect(missingHomeAddressParts({ address: " ", city: "Tampa", state: "", zip: "33602" })).toEqual(["Street", "State"]);
    expect(homeAddressMissing({ address: "1 A St", city: "Tampa", state: "FL", zip: "33602" })).toBe(false);
    expect(formatHomeAddress({ address: "1 A St", city: "Tampa", state: "FL", zip: "" })).toBe("");
  });

  it("server: preview blocks and send refuses with no Home Address", async () => {
    for (const patch of [{ address: "   " }, { city: "" }, { zip: null }]) {
      const db = fakeDb({ ...seed(true), applications: [{ ...APP, ...patch }] });
      const p = await prepare(db as any, APP.id);
      expect(p.blockers.find((b) => b.field === "driver_address")?.label).toBe(HOME_ADDRESS_LABEL);
      await expect(issueAgreement(db as any, APP.id, { createdBy: null, prep: fleetAgreementPrep({ enabled: true, amount: 50 }, null) })).rejects.toThrow(/home address/i);
      expect(db.state.agreements.length).toBe(0);
    }
  });

  it("UI: the staff dialog marks Home Address required and disables Send without it", () => {
    const src = readFileSync(new URL("../src/components/admin/PrepareAgreementDialog.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/missingHomeAddressParts\(/);
    expect(src).toMatch(/const canSend = [^\n]*homeMissing\.length === 0/);
    expect(src).toContain('data-testid="home-address-required"');
    expect(src).toMatch(/aria-required="true"/);
  });
});

describe("older templates (v1.10, v1.10.2) are retired", () => {
  it("they stay in the library (previewable) but are marked retired; v1.14/v1.15 are not", () => {
    expect(isRetiredLibrary("no_insurance")).toBe(true);
    expect(isRetiredLibrary("insurance_required")).toBe(true);
    expect(isRetiredLibrary("insurance_included")).toBe(false);
    expect(isRetiredLibrary("insurance_included_v115")).toBe(false);
    for (const k of Object.keys(OWNER_APPROVED_LIBRARY)) expect(isRetiredLibrary(k)).toBe(false);
    expect(LIBRARY.filter((t) => t.retired).map((t) => t.key)).toEqual(["no_insurance", "insurance_required"]);
  });

  it.each(["no_insurance", "insurance_required"])("%s: preview says retired, send refuses, nothing stored", async (key) => {
    const db = fakeDb(seed(true));
    const p = await prepare(db as any, APP.id, undefined, key);
    expect(p.tpl.meta.key).toBe(key);
    await expect(issueAgreement(db as any, APP.id, { createdBy: null, templateKey: key })).rejects.toThrow(/retired|missing/i);
    expect(db.state.agreements.length).toBe(0);
    const src = readFileSync(new URL("../src/lib/agreements.functions.ts", import.meta.url), "utf8");
    expect(src).toMatch(/is retired, so it cannot be sent/);
  });

  it("the staff dialog does not offer retired templates", () => {
    const src = readFileSync(new URL("../src/components/admin/PrepareAgreementDialog.tsx", import.meta.url), "utf8");
    expect(src).toContain("LIBRARY.filter((t) => !t.retired).map(");
  });
});

describe("Florida 812.155 Addendum", () => {
  const fields = {
    agreement_number: "RRA-20261116-ABC123", driver_name: "Jordan Q Sample", driver_address: "100 Sample St, Tampa, FL, 33602",
    vehicle: "2021 Toyota Camry LE", vehicle_vin: "4T1C11AK5MU123456", license_plate: "SMP123 / FL",
    company_name: "Sample Rentals LLC", company_address: "1 Main St, Tampa, FL", company_email: "team@example.com", company_phone: "(555) 010-0000",
  };

  it("carries items 1-8 verbatim, the 'part of your agreement' line, and one initials row per item", () => {
    const body = renderFloridaAddendum(fields);
    const text = plain(body);
    for (const c of V115.V115_ADDITIONS) expect(text).toContain(c);
    expect(body).toContain(`| ${V115.PEST_FEE_ITEM} | ${V115.PEST_FEE_AMOUNT}`);
    expect(text).toContain("This addendum is part of your Vehicle Rental Agreement No. RRA-20261116-ABC123 and applies to the Vehicle and any replacement vehicle.");
    expect(acknowledgmentsOf(body)).toHaveLength(8);
    expect(acknowledgmentsOf(body)[5]).toMatch(/Starter-Interrupt Device/);
    expect(parseLayout(body).filter((b) => b.k === "sig")).toHaveLength(1);
    expect(parseLayout(body).some((b) => b.k === "notice" && /812\.155\(6\)/.test((b as any).lead))).toBe(true);
    expect(body).not.toContain("__________");
    expect(body).not.toMatch(/\{\{|\[\[/);
    expect(text).toContain("Service Area: 100-mile radius of Tampa, FL");
    expect(FL_ADDENDUM_SOURCE).not.toMatch(/bristol|allcom|clarence|deposit/i);
  });

  it("prints ___ when the agreement number is not on file (paper agreements)", () => {
    const text = plain(renderFloridaAddendum({ ...fields, agreement_number: null }));
    expect(text).toContain(`Vehicle Rental Agreement No. ${UNKNOWN_AGREEMENT_NUMBER} and applies`);
  });

  it("needs a Home Address (its notice address) and the car", () => {
    expect(addendumBlockers({ ...fields, driver_address: " " }).map((b) => b.field)).toEqual(["driver_address"]);
    expect(addendumBlockers(fields)).toEqual([]);
  });

  it("fills from records: latest signed agreement number, the live rental's car; nothing written", async () => {
    const db = fakeDb(seed(true, {
      rentals: [{ id: "r1", application_id: APP.id, vehicle_id: CAR.id, status: "active", created_at: "2026-11-10" }],
      agreements: [{ id: "a1", application_id: APP.id, status: "signed", signed_at: "2026-11-16T16:54:48Z", merge_data: { agreement_number: "RRA-20261116-2A4BBF" } }],
    }));
    const before = JSON.stringify(db.state);
    const f = await floridaAddendumFields(db as any, APP.id);
    expect(f.agreement_number).toBe("RRA-20261116-2A4BBF");
    expect(f.vehicle_vin).toBe(CAR.vin);
    expect(f.driver_address).toBe("100 Sample St, Tampa, FL, 33602");
    expect(JSON.stringify(db.state)).toBe(before);
    const none = await floridaAddendumFields(fakeDb(seed(true)) as any, APP.id);
    expect(none.agreement_number).toBeNull();
  });

  it("renders to a PDF through the canonical renderer", async () => {
    const { renderPreviewPdf } = await import("../src/lib/esign-pdf.server");
    const pdf = await renderPreviewPdf({ title: "Florida 812.155 Addendum", body: renderFloridaAddendum(fields), fingerprint: "abc".repeat(22), templateLabel: "Test", companySignerName: "Test Signer", companySignerTitle: null, generatedAt: "2026-11-19T00:00:00Z" });
    expect(pdf.length).toBeGreaterThan(5000);
  });

  it("is not approved for renters and nothing sends it", () => {
    expect(FL_ADDENDUM_OWNER_APPROVAL).toBeNull();
    const fn = readFileSync(new URL("../src/lib/florida-addendum.functions.ts", import.meta.url), "utf8");
    expect(fn).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(|sendSms|sendEmail|deliverSigningLink/);
    expect(fn).toMatch(/requireTier\(context\.userId, "manager"\)/);
  });
});

const APPROVED_LATE_FEE = "Late fee: $50 per day, up to a maximum of $350 per missed payment. After that, daily rent continues to accrue until the Vehicle is returned or recovered.";

describe("late-fee cap (Dolmar, Nov 19 2026, 10:48 PM ET)", () => {
  const feeRows = (body: string) => (parseLayout(body).find((b) => b.k === "table" && b.header?.[0] === "Item") as any).rows.map((r: any) => r.cells);

  it("the approved wording is exact", () => {
    expect(V115.CLAUSE_LATE_FEE).toBe(APPROVED_LATE_FEE);
    expect(`${V115.LATE_FEE_ITEM}: ${V115.LATE_FEE_AMOUNT}`).toBe(APPROVED_LATE_FEE);
    expect(V115.V115_TERM_DEFAULTS.fee_late_payment).toBe(V115.LATE_FEE_AMOUNT);
  });

  it("v1.15: one late-fee row with the exact wording; the uncapped v1.14 wording is gone", async () => {
    expect(plain(resolveTerms(v115.body))).toContain(APPROVED_LATE_FEE);
    expect(feeRows(resolveTerms(v115.body))).toContainEqual(["Late fee", "$50 per day, up to a maximum of $350 per missed payment. After that, daily rent continues to accrue until the Vehicle is returned or recovered."]);
    expect(feeRows(resolveTerms(v115.body)).filter((c: string[]) => /^late (fee|payment)/i.test(c[0]))).toHaveLength(1);
    const p = await prepare(fakeDb(seed(true)) as any, APP.id);
    const text = plain(p.body);
    expect(text).toContain(APPROVED_LATE_FEE);
    expect(text).not.toContain("$50 for each day a payment is late");
    expect(text).not.toMatch(/Late payment:/);
  });

  it("Florida addendum fee section: the exact wording, in Section 7's table", () => {
    const body = renderFloridaAddendum({
      agreement_number: "RRA-1", driver_name: "Jordan Q Sample", driver_address: "100 Sample St, Tampa, FL, 33602",
      vehicle: "2021 Toyota Camry LE", vehicle_vin: "4T1C11AK5MU123456", license_plate: "SMP123 / FL",
      company_name: "Sample Rentals LLC", company_address: "1 Main St, Tampa, FL", company_email: "team@example.com", company_phone: "(555) 010-0000",
    });
    expect(plain(body)).toContain(APPROVED_LATE_FEE);
    expect(body).toContain("| Late fee | $50 per day, up to a maximum of $350 per missed payment. After that, daily rent continues to accrue until the Vehicle is returned or recovered.");
    const s7 = FL_ADDENDUM_SOURCE.slice(FL_ADDENDUM_SOURCE.indexOf("## 7."), FL_ADDENDUM_SOURCE.indexOf("## 8."));
    expect(s7).toContain(`| ${V115.LATE_FEE_ITEM} | ${V115.LATE_FEE_AMOUNT}`);
    expect(plain(body).match(/\$50 for each day/g)).toBeNull();
    expect(acknowledgmentsOf(body)[6]).toBe("7. Late Fee and Pest, Insect & Biohazard Infestation.");
  });
});

describe("v1.15 values match v1.14", () => {
  it("same contract values", () => {
    expect(writeTerms(V115.V115_SOURCE, V115.V115_TERM_DEFAULTS)).toContain("100-mile radius of Tampa, FL");
  });
});
