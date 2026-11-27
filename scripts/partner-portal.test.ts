import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  PARTNER_EXPENSE_COLUMNS,
  PARTNER_PAYMENT_COLUMNS,
  PARTNER_RENTAL_COLUMNS,
  PARTNER_STRIPE_CONNECT_ENABLED,
  PARTNER_VEHICLE_COLUMNS,
  intakeFileProblem,
  intakePath,
  isIntakePathFor,
  isPayoutReceiptPathFor,
  partnerMonths,
  partnerRentalNotice,
  partnerSections,
  payoutReceiptPath,
  submissionStatusView,
  toPartnerExpense,
  toPartnerVehicle,
  withinPartnerTextingHours,
} from "../src/lib/partner-portal";
import { sendPartnerRentalNotice } from "../src/lib/partner-notices.server";
import { columnMissing, finishIntake, startIntake, sendPartnerSubmissionAlert } from "../src/lib/partner-intake.server";
import { claimPartnerAccess, likeExact } from "../src/lib/partner-portal.server";
import { approvalErrorMessage } from "../src/lib/partner-admin.server";
import { isDefaultOff, AUTOMATIONS } from "../src/lib/automation-catalog";

const SUB = "c9bc2e5f-fe8f-409a-a10d-bff8bad6809e";
const F1 = "f75c0088-211c-45db-a031-16bf9752c795";
const PARTNER = "11111111-2222-4333-8444-555555555555";
const RENTER_FIELDS = ["driver_id", "application_id", "full_name", "renter", "phone", "email", "insurance", "agreement", "license", "background", "mvr", "stripe_customer"];

// ------------------------------------------------------------ fake Supabase
type Tables = Record<string, any[]>;
function fakeAdmin(tables: Tables, opts: { missingColumns?: boolean; noClaimTable?: boolean; users?: Record<string, any>; storage?: Set<string> } = {}) {
  const log = { selects: [] as Array<{ table: string; cols: string }>, inserts: [] as Array<{ table: string; row: any }>, updates: [] as Array<{ table: string; patch: any }>, tablesTouched: new Set<string>() };
  const V2 = ["idempotency_key", "business_name", "registration_path", "sms_consent_at", "partner_id", "notify_rentals"];
  const db: any = { log };
  db.from = (name: string) => {
    log.tablesTouched.add(name);
    const filters: Array<(r: any) => boolean> = [];
    let cols = "*";
    let mode: "select" | "update" | "insert" = "select";
    let patch: any = null;
    const colErr = (c: string) => opts.missingColumns && V2.some((k) => c.includes(k)) ? { code: "42703", message: `column "${V2.find((k) => c.includes(k))}" does not exist` } : null;
    const q: any = {
      select: (c = "*") => { cols = c; log.selects.push({ table: name, cols: c }); return q; },
      eq: (k: string, v: any) => (filters.push((r) => r[k] === v), q),
      is: (k: string, v: any) => (filters.push((r) => (r[k] ?? null) === v), q),
      in: (k: string, v: any[]) => (filters.push((r) => v.includes(r[k])), q),
      gte: (k: string, v: any) => (filters.push((r) => String(r[k]) >= String(v)), q),
      ilike: (k: string, v: string) => (filters.push((r) => String(r[k] ?? "").toLowerCase() === v.replace(/\\([\\%_])/g, "$1").toLowerCase()), q),
      or: () => q,
      order: () => q,
      limit: () => q,
      rows: () => (tables[name] ?? []).filter((r) => filters.every((f) => f(r))),
      exec: async () => {
        const e = colErr(cols) ?? (mode === "update" ? colErr(Object.keys(patch).join(",")) : null);
        if (e) return { data: null, error: e };
        if (mode === "update") { for (const r of q.rows()) Object.assign(r, patch); log.updates.push({ table: name, patch }); return { data: null, error: null }; }
        return { data: q.rows(), error: null };
      },
      maybeSingle: async () => { const r = await q.exec(); return r.error ? r : { data: r.data?.[0] ?? null, error: null }; },
      single: async () => { const r = await q.exec(); return r.error ? r : { data: r.data?.[0] ?? null, error: r.data?.[0] ? null : { message: "no row" } }; },
      then: (res: any, rej: any) => q.exec().then(res, rej),
      update: (p: any) => { mode = "update"; patch = p; return q; },
      insert: (row: any) => {
        const run = async () => {
          if (name === "partner_notice_sends" && opts.noClaimTable) return { data: null, error: { code: "42P01", message: 'relation "partner_notice_sends" does not exist' } };
          const e = colErr(Object.keys(row).join(","));
          if (e) return { data: null, error: e };
          tables[name] = tables[name] ?? [];
          if (row.key && tables[name].some((r) => r.key === row.key)) return { data: null, error: { code: "23505", message: "duplicate key" } };
          if (row.idempotency_key && tables[name].some((r) => r.idempotency_key === row.idempotency_key)) return { data: null, error: { code: "23505", message: "duplicate key" } };
          const stored = { id: row.id ?? crypto.randomUUID(), created_at: new Date().toISOString(), ...row };
          tables[name].push(stored);
          log.inserts.push({ table: name, row });
          return { data: stored, error: null };
        };
        const p: any = run();
        p.select = () => ({ single: async () => { const r = await p; return r.error ? r : { data: { id: r.data.id }, error: null }; } });
        return p;
      },
      upsert: async (row: any) => { tables[name] = tables[name] ?? []; tables[name].push(row); return { error: null }; },
    };
    return q;
  };
  db.storage = {
    from: (bucket: string) => ({
      createSignedUploadUrl: async (path: string) => ({ data: { token: `tok:${bucket}:${path}`, path }, error: null }),
      list: async (folder: string, o: { search: string }) => ({ data: [...(opts.storage ?? new Set())].filter((k) => k === `${bucket}:${folder}/${o.search}`).map(() => ({ name: o.search })), error: null }),
    }),
  };
  db.auth = { admin: { getUserById: async (id: string) => ({ data: { user: opts.users?.[id] ?? null } }) } };
  return db;
}

// ------------------------------------------------------------ privacy whitelists
describe("partner whitelists never carry renter, agreement or insurance data", () => {
  test("column lists", () => {
    for (const cols of [PARTNER_VEHICLE_COLUMNS, PARTNER_RENTAL_COLUMNS, PARTNER_EXPENSE_COLUMNS, PARTNER_PAYMENT_COLUMNS]) {
      for (const bad of ["driver_id", "application_id", "insurance", "agreement", "gps", "key_location", "toll", "description", "vendor", "notes", "reference", "receipt"]) {
        expect(cols.split(",")).not.toContain(bad);
        expect(cols.includes(bad)).toBe(false);
      }
    }
  });

  test("toPartnerVehicle returns only whitelisted keys, even if a row has renter fields", () => {
    const v = toPartnerVehicle(
      { id: "v1", year: 2016, make: "Ford", model: "Fusion", trim: "SE", vin: "3FA6P0H73GR318847", status: "available", weekly_rate: 375, photos: ["v1/a.jpg"], insurance_policy_number: "X", gps_device_id: "Y" },
      [{ id: "r1", vehicle_id: "v1", start_date: "2026-11-17", end_date: null, status: "active", driver_id: "d", full_name: "Renter Person", phone: "x" }],
    );
    expect(Object.keys(v).sort()).toEqual(["color", "id", "label", "make", "model", "photoPath", "plate", "rentals", "status", "statusLabel", "trim", "vin", "weeklyRate", "year"].sort());
    expect(Object.keys(v.rentals[0]).sort()).toEqual(["active", "end", "start"]);
    expect(v.status).toBe("rented");
    expect(JSON.stringify(v)).not.toMatch(/Renter Person|insurance|gps|driver/i);
  });

  test("statuses", () => {
    expect(toPartnerVehicle({ id: "a", status: "available" }, []).status).toBe("listed");
    expect(toPartnerVehicle({ id: "a", status: "onboarding" }, []).status).toBe("preparing");
    expect(toPartnerVehicle({ id: "a", status: "maintenance" }, []).status).toBe("in_service");
    expect(toPartnerVehicle({ id: "a", status: "rented" }, []).status).toBe("rented");
  });

  test("expenses drop free text and hide insurance details", () => {
    const e = toPartnerExpense({ id: "e1", vehicle_id: "v1", category: "insurance", amount: "212.50", incurred_on: "2026-11-01", description: "Carrier XYZ premium via Broker ABC", vendor_id: "vend", notes: "policy 123", reference: "INV-1", receipt_path: "r.pdf" })!;
    expect(e).toEqual({ id: "e1", vehicleId: "v1", date: "2026-11-01", category: "insurance", label: "Program Coverage", amount: 212.5 });
    expect(toPartnerExpense({ id: "e2", vehicle_id: "v1", category: "finance", amount: 300, incurred_on: "2026-11-01" })).toBeNull();
    expect(toPartnerExpense({ id: "e3", vehicle_id: "v1", category: "purchase", amount: 9000, incurred_on: "2026-11-01" })).toBeNull();
  });

  test("monthly earnings use the split on rent and expenses", () => {
    const now = new Date("2026-11-17T15:00:00Z");
    const months = partnerMonths(
      [
        { type: "rent", status: "paid", net_collected: 350, paid_date: "2026-11-03" },
        { type: "rent", status: "paid", net_collected: 350, paid_date: "2026-11-10" },
        { type: "deposit", status: "paid", net_collected: 500, paid_date: "2026-11-03" },
        { type: "rent", status: "pending", net_collected: 350, paid_date: "2026-11-17" },
        { type: "rent", status: "paid", net_collected: 300, paid_date: "2026-10-20" },
      ],
      [{ id: "x", vehicleId: "v", date: "2026-11-05", category: "maintenance", label: "Maintenance", amount: 80 }],
      50, 3, now,
    );
    expect(months.map((m) => m.month)).toEqual(["2026-11", "2026-10", "2026-09"]);
    expect(months[0]).toEqual({ month: "2026-11", grossRent: 700, partnerShare: 350, expenses: 80, partnerExpenseShare: 40, net: 310 });
    expect(months[1].net).toBe(150);
  });

  test("sections unlock only when active", () => {
    expect(partnerSections("prospect")).toMatchObject({ earnings: false, payouts: false, bank: false, vehicles: true, addVehicle: true });
    expect(partnerSections("active")).toMatchObject({ earnings: true, payouts: true, bank: true });
    expect(submissionStatusView("new")).toBe("under_review");
    expect(submissionStatusView("approved")).toBe("approved");
  });
});

// ------------------------------------------------------------ uploads
describe("intake files", () => {
  test("paths are scoped to the submission and kind", () => {
    const photo = intakePath(SUB, "photo", F1, "jpg");
    expect(photo).toEqual({ bucket: "owner-vehicle-photos", path: `${SUB}/${F1}.jpg` });
    const reg = intakePath(SUB, "registration", F1, "pdf");
    expect(reg.bucket).toBe("partner-documents");
    expect(isIntakePathFor(SUB, "photo", photo.path)).toBe(true);
    expect(isIntakePathFor(SUB, "registration", reg.path)).toBe(true);
    expect(isIntakePathFor(SUB, "id_document", reg.path)).toBe(false);
    expect(isIntakePathFor(SUB, "photo", `${SUB}/../x/${F1}.jpg`)).toBe(false);
    expect(isIntakePathFor(SUB, "photo", `${F1}/${F1}.jpg`)).toBe(false);
    expect(isIntakePathFor("not-a-uuid", "photo", `not-a-uuid/${F1}.jpg`)).toBe(false);
  });
  test("payout receipt paths", () => {
    const p = payoutReceiptPath(PARTNER, SUB, F1, "pdf");
    expect(isPayoutReceiptPathFor(PARTNER, p)).toBe(true);
    expect(isPayoutReceiptPathFor(SUB, p)).toBe(false);
  });
  test("file rules", () => {
    expect(intakeFileProblem({ kind: "photo", name: "a.jpg", type: "image/jpeg", size: 6_661_723 })).toBeNull();
    expect(intakeFileProblem({ kind: "photo", name: "a.pdf", type: "application/pdf", size: 10 })).toMatch(/JPG/);
    expect(intakeFileProblem({ kind: "registration", name: "r.pdf", type: "application/pdf", size: 10 })).toBeNull();
    expect(intakeFileProblem({ kind: "photo", name: "big.jpg", type: "image/jpeg", size: 30 * 1024 * 1024 })).toMatch(/25 MB/);
  });
});

const contact = { full_name: "Test Owner", email: "Owner@Example.com", phone: "8135550100", business_name: "Owner LLC", address_line1: "1 Main St", city: "Tampa", state: "FL", postal_code: "33602", sms_consent: true };
const vehicle = { vin: "3FA6P0H73GR318847", year: 2016, make: "Ford", model: "Fusion SE" };

describe("intake idempotency and finishing", () => {
  test("a retry with the same key lands on the same row", async () => {
    const tables: Tables = { fleet_owner_submissions: [] };
    const admin = fakeAdmin(tables);
    const key = crypto.randomUUID();
    const files = [{ kind: "photo" as const, name: "a.jpg", type: "image/jpeg", size: 100 }, { kind: "registration" as const, name: "r.pdf", type: "application/pdf", size: 100 }];
    const a = await startIntake(admin, { idempotencyKey: key, contact, vehicle, files });
    const b = await startIntake(admin, { idempotencyKey: key, contact, vehicle, files });
    expect(tables.fleet_owner_submissions.length).toBe(1);
    expect(b.submissionId).toBe(a.submissionId);
    expect(b.replay).toBe(true);
    expect(a.uploads.map((u) => u.bucket).sort()).toEqual(["owner-vehicle-photos", "partner-documents"]);
    expect(tables.fleet_owner_submissions[0].email).toBe("owner@example.com");
    expect(tables.fleet_owner_submissions[0].sms_consent_at).toBeTruthy();
  });

  test("legacy schema still saves the lead, with extras in notes and photos only", async () => {
    const tables: Tables = { fleet_owner_submissions: [] };
    const admin = fakeAdmin(tables, { missingColumns: true });
    const r = await startIntake(admin, { idempotencyKey: crypto.randomUUID(), contact, vehicle, files: [{ kind: "photo", name: "a.jpg", type: "image/jpeg", size: 1 }, { kind: "registration", name: "r.pdf", type: "application/pdf", size: 1 }] });
    expect(r.schema).toBe("legacy");
    expect(tables.fleet_owner_submissions.length).toBe(1);
    expect(tables.fleet_owner_submissions[0].notes).toMatch(/Business: Owner LLC/);
    expect(r.uploads.map((u) => u.kind)).toEqual(["photo"]);
  });

  test("finish needs the creating key and ignores paths from other submissions or missing objects", async () => {
    const key = crypto.randomUUID();
    const tables: Tables = { fleet_owner_submissions: [{ id: SUB, idempotency_key: key, photo_urls: [], status: "new", created_at: new Date().toISOString() }] };
    const good = `${SUB}/${F1}.jpg`;
    const other = `${PARTNER}/${F1}.jpg`;
    const missing = `${SUB}/${crypto.randomUUID()}.jpg`;
    const admin = fakeAdmin(tables, { storage: new Set([`owner-vehicle-photos:${SUB}/${F1}.jpg`]) });
    await expect(finishIntake(admin, { submissionId: SUB, idempotencyKey: crypto.randomUUID(), uploaded: [] }, { alert: async () => {} })).rejects.toThrow("Forbidden");
    const r = await finishIntake(admin, { submissionId: SUB, idempotencyKey: key, uploaded: [{ kind: "photo", path: good }, { kind: "photo", path: other }, { kind: "photo", path: missing }] }, { alert: async () => {} });
    expect(r.photos).toBe(1);
    expect(tables.fleet_owner_submissions[0].photo_urls).toEqual([good]);
  });

  test("staff alert is off by default and carries no phone number", async () => {
    let sent: any = null;
    const tables: Tables = { fleet_owner_submissions: [{ id: SUB, full_name: "Test Owner", email: "o@example.com", year: 2016, make: "Ford", model: "Fusion SE", photo_urls: ["a"] }] };
    expect((await sendPartnerSubmissionAlert(fakeAdmin(tables), SUB, { gate: "off", sendEmail: async (a) => (sent = a, { ok: true }) })).status).toBe("off");
    expect(sent).toBeNull();
    await sendPartnerSubmissionAlert(fakeAdmin(tables), SUB, { gate: "send", sendEmail: async (a) => (sent = a, { ok: true }) });
    expect(sent.to).toBe("team@drivereal.com");
    expect(sent.html).not.toMatch(/\d{3}[\s.-]?\d{3}[\s.-]?\d{4}/);
  });

  test("columnMissing", () => {
    expect(columnMissing({ code: "42703" })).toBe(true);
    expect(columnMissing({ code: "PGRST204", message: "Could not find the 'business_name' column" })).toBe(true);
    expect(columnMissing({ code: "23505" })).toBe(false);
  });
});

// ------------------------------------------------------------ rental notice
describe("partner rental notice", () => {
  const base = () => ({
    rentals: [{ id: "r1", vehicle_id: "v1", start_date: "2026-11-17", status: "active", application_id: "app1", driver_id: "d1" }],
    vehicles: [{ id: "v1", year: 2016, make: "Ford", model: "Fusion", trim: "SE", partner_id: PARTNER }],
    partners: [{ id: PARTNER, name: "Grant Owner", email: "owner@example.com", phone: "8135550100", status: "active", sms_consent_at: "2026-11-16T00:00:00Z", notify_rentals: true }],
    applications: [{ id: "app1", full_name: "Renter Person", phone: "8135550199", email: "renter@example.com" }],
    partner_notice_sends: [] as any[],
  });
  const noon = new Date("2026-11-17T17:00:00Z"); // 12 PM ET
  const late = new Date("2026-11-18T02:30:00Z"); // 9:30 PM ET

  test("off by default: nothing is read or sent", async () => {
    const admin = fakeAdmin(base());
    let n = 0;
    const r = await sendPartnerRentalNotice(admin, "r1", { gate: "off", sendEmail: async () => (n++, { ok: true }), sendSms: async () => (n++, { ok: true }) });
    expect(r.status).toBe("off");
    expect(n).toBe(0);
    expect(admin.log.tablesTouched.size).toBe(0);
    expect(isDefaultOff("partner_rental_notice")).toBe(true);
    expect(isDefaultOff("partner_submission_alert")).toBe(true);
  });

  test("email + text in hours, never names the renter, never reads applications", async () => {
    const admin = fakeAdmin(base());
    const emails: any[] = [], texts: any[] = [];
    const r = await sendPartnerRentalNotice(admin, "r1", { gate: "send", now: noon, sendEmail: async (a) => (emails.push(a), { ok: true }), sendSms: async (a) => (texts.push(a), { ok: true }) });
    expect(r).toMatchObject({ status: "sent", email: "sent", sms: "sent" });
    expect(emails[0].to).toBe("owner@example.com");
    expect(texts[0].to).toBe("8135550100");
    const all = JSON.stringify([emails, texts]);
    expect(all).not.toMatch(/Renter Person|8135550199|renter@example|insurance|agreement/i);
    expect(admin.log.tablesTouched.has("applications")).toBe(false);
    const rentalSelect = admin.log.selects.find((s: any) => s.table === "rentals")!.cols;
    for (const f of ["driver_id", "application_id"]) expect(rentalSelect.includes(f)).toBe(false);
  });

  test("outside 8 AM–9 PM ET: email only", async () => {
    const texts: any[] = [];
    const r = await sendPartnerRentalNotice(fakeAdmin(base()), "r1", { gate: "send", now: late, sendEmail: async () => ({ ok: true }), sendSms: async (a) => (texts.push(a), { ok: true }) });
    expect(r.sms).toBe("outside_hours");
    expect(texts.length).toBe(0);
  });

  test("no SMS consent: email only; opted out of rental alerts: nothing", async () => {
    const t = base(); t.partners[0].sms_consent_at = null as any;
    const texts: any[] = [];
    expect((await sendPartnerRentalNotice(fakeAdmin(t), "r1", { gate: "send", now: noon, sendEmail: async () => ({ ok: true }), sendSms: async (a) => (texts.push(a), { ok: true }) })).sms).toBe("skipped");
    expect(texts.length).toBe(0);
    const t2 = base(); t2.partners[0].notify_rentals = false;
    expect((await sendPartnerRentalNotice(fakeAdmin(t2), "r1", { gate: "send", now: noon })).status).toBe("partner_opted_out");
  });

  test("once per rental", async () => {
    const t = base();
    let n = 0;
    const deps = { gate: "send" as const, now: noon, sendEmail: async () => (n++, { ok: true }), sendSms: async () => ({ ok: true }) };
    await sendPartnerRentalNotice(fakeAdmin(t), "r1", deps);
    const again = await sendPartnerRentalNotice(fakeAdmin(t), "r1", deps);
    expect(again.status).toBe("duplicate");
    expect(n).toBe(1);
  });

  test("company-owned car: no notice", async () => {
    const t = base(); t.vehicles[0].partner_id = null as any;
    expect((await sendPartnerRentalNotice(fakeAdmin(t), "r1", { gate: "send", now: noon })).status).toBe("not_partner_vehicle");
  });

  test("texting window boundaries (ET, across DST)", () => {
    expect(withinPartnerTextingHours(new Date("2026-11-17T12:59:00Z"))).toBe(false); // 7:59 AM EST
    expect(withinPartnerTextingHours(new Date("2026-11-17T13:00:00Z"))).toBe(true); // 8:00 AM EST
    expect(withinPartnerTextingHours(new Date("2026-11-18T01:59:00Z"))).toBe(true); // 8:59 PM EST
    expect(withinPartnerTextingHours(new Date("2026-11-18T02:00:00Z"))).toBe(false); // 9:00 PM EST
    expect(withinPartnerTextingHours(new Date("2026-07-01T12:00:00Z"))).toBe(true); // 8:00 AM EDT
    expect(withinPartnerTextingHours(new Date("2026-07-01T11:59:00Z"))).toBe(false);
  });

  test("copy", () => {
    const n = partnerRentalNotice({ firstName: "Grant", vehicleLabel: "2016 Ford Fusion SE", startDate: "2026-11-17", portalUrl: "https://drivereal.com/partner" });
    expect(n.subject).toBe("Your 2016 Ford Fusion SE is rented");
    expect(n.sms).toMatch(/STOP/);
    expect(n.sms).toMatch(/Nov 17, 2026/);
    expect(n.html + n.sms).not.toMatch(/insurance|renter|agreement/i);
  });
});

// ------------------------------------------------------------ portal access
describe("claiming partner access", () => {
  test("unconfirmed email is refused", async () => {
    const admin = fakeAdmin({ partners: [], fleet_owner_submissions: [{ id: SUB, email: "o@example.com", full_name: "O", phone: "1", created_at: "2026-11-16" }], user_roles: [] }, { users: { u1: { email: "o@example.com", email_confirmed_at: null } } });
    expect(await claimPartnerAccess(admin, "u1")).toEqual({ linked: false, reason: "email_unconfirmed" });
  });
  test("a confirmed submitter gets a prospect partner record and the partner role", async () => {
    const tables: Tables = { partners: [], fleet_owner_submissions: [{ id: SUB, email: "contact@example.com", full_name: "Sub Mitter", phone: "8135550100", created_at: "2026-11-16", partner_id: null }], user_roles: [] };
    const admin = fakeAdmin(tables, { users: { u1: { email: "Contact@Example.com", email_confirmed_at: "2026-11-17" } } });
    expect(await claimPartnerAccess(admin, "u1")).toEqual({ linked: true });
    expect(tables.partners[0]).toMatchObject({ status: "prospect", email: "contact@example.com", user_id: "u1" });
    expect(tables.fleet_owner_submissions[0].partner_id).toBe(tables.partners[0].id);
    expect(tables.user_roles).toContainEqual({ user_id: "u1", role: "partner" });
  });
  test("a partner row already linked to someone else is not taken over", async () => {
    const admin = fakeAdmin({ partners: [{ id: PARTNER, email: "o@example.com", user_id: "someone-else" }], user_roles: [] }, { users: { u1: { email: "o@example.com", email_confirmed_at: "x" } } });
    expect(await claimPartnerAccess(admin, "u1")).toEqual({ linked: false, reason: "linked_to_another_account" });
  });
  test("filter escaping", () => {
    expect(likeExact("A_b%c@x.com")).toBe("a\\_b\\%c@x.com");
  });
});

describe("approval errors are readable", () => {
  test("mapping", () => {
    expect(approvalErrorMessage({ message: "weekly_rate_required" })).toMatch(/weekly rate/);
    expect(approvalErrorMessage({ message: "vin_belongs_to_another_partner" })).toMatch(/another partner/);
    expect(approvalErrorMessage({ message: "Could not find the function public.approve_partner_submission" })).toMatch(/not installed/);
  });
});

// ------------------------------------------------------------ source guards
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("source guards", () => {
  const portalFiles = ["src/lib/partner-portal.server.ts", "src/lib/partner-portal.functions.ts", "src/lib/partner-portal.ts", "src/routes/partner.tsx", "src/lib/partner-notices.server.ts"];
  test("portal code never reads renter tables, documents or agreement buckets", () => {
    for (const f of portalFiles) {
      const src = read(f);
      expect(src).not.toMatch(/from\("applications"\)|from\("documents"\)|from\("agreements"\)|rental-agreements|license-uploads|driver-docs/);
      expect(src).not.toMatch(/background_check_status|mvr_status|earnings_verified_status/);
    }
  });
  test("old renter-exposing partner reads are gone", () => {
    const src = read("src/lib/partner.functions.ts");
    expect(src).not.toMatch(/export const (getMyPartner|getRenterDocumentUrl|getMyEarnings)\b|from\("applications"\)|from\("documents"\)/);
  });
  test("no phone numbers or carrier/broker names in new partner files", () => {
    const files = [...portalFiles, "src/lib/partner-intake.server.ts", "src/lib/partner-intake.functions.ts", "src/lib/partner-admin.functions.ts", "src/lib/partner-admin.server.ts", "src/components/admin/PartnerSubmissions.tsx", "src/components/partner/PartnerVehicleFields.tsx", "src/routes/partners.tsx"];
    for (const f of files) {
      const src = read(f);
      expect(src).not.toMatch(/\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/);
      expect(src).not.toMatch(/\+1\d{10}/);
    }
  });
  test("Stripe Connect is gated off, bank numbers never stored", () => {
    expect(PARTNER_STRIPE_CONNECT_ENABLED).toBe(false);
    const fns = read("src/lib/partner-portal.functions.ts") + read("src/lib/partner-connect.server.ts");
    expect(fns).not.toMatch(/routing_number|account_number|external_account/);
    expect(read("src/lib/partner-connect.server.ts")).toMatch(/if \(!PARTNER_STRIPE_CONNECT_ENABLED\) throw/);
  });
  test("migration tightens RLS and keeps the bucket private, function service-role only", () => {
    const sql = read("supabase/migrations/20261117070000_partner_portal_v2.sql");
    for (const p of ["Partners can view their assigned drivers", "Partners read rentals on own vehicles", "Partners can view their payments", "Partners read expenses on their vehicles", "Partners read issues on own vehicles", "Partners read maintenance on own vehicles", "Partners view their visible documents", "Partners read their driver documents"]) {
      expect(sql).toContain(`DROP POLICY IF EXISTS "${p}"`);
    }
    expect(sql).toMatch(/'partner-documents', 'partner-documents', false/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.approve_partner_submission\(uuid, uuid, numeric, numeric, boolean\) FROM PUBLIC, anon, authenticated/);
    expect(sql).not.toMatch(/routing_number|account_number/);
    expect(sql).toMatch(/NOT applied by this PR/);
  });
  test("rental activation calls the partner notice without blocking", () => {
    const src = read("src/lib/rentals.functions.ts");
    expect(src).toMatch(/sendPartnerRentalNotice\(supabaseAdmin, rental\.id as string\)\)\s*\n\s*\.catch/);
  });
  test("catalog entries", () => {
    const keys = AUTOMATIONS.map((a) => a.key);
    expect(keys).toContain("partner_rental_notice");
    expect(keys).toContain("partner_submission_alert");
  });
});

void RENTER_FIELDS;
