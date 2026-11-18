/**
 * Driver Portal access opens at pickup (Dolmar, t463u / t466u).
 *  - No login email before the pickup payment, on any path.
 *  - Exactly one welcome after the pickup payment, never for the Reservation Fee.
 *  - Before pickup the secure link uploads or replaces documents.
 *  - Payment history shows the Reservation Fee and Stripe receipts.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { pickedUpFrom, rentalMeansPickedUp, PORTAL_OPENS_AT_PICKUP_MESSAGE } from "../src/lib/portal-pickup-gate";
import { isPickupPayment, isReservationFeePayment, PORTAL_WELCOME_AUDIT_ACTION, PORTAL_WELCOME_PENDING_ACTION } from "../src/lib/portal-welcome";
import { maybeSendPortalWelcome, maybeWelcomeAfterPayment, welcomeOrDeferAtActivation } from "../src/lib/portal-welcome.server";
import { isIssuedUploadPath, replaceApplicantDocumentCore, DOC_REPLACE_LOCKED_MESSAGE, DOC_REPLACE_CLOSED_MESSAGE } from "../src/lib/applicant-document-replace.server";
import { canUploadBeforePickupStatus, isDocumentsOnlyStatus } from "../src/lib/application-edit-status";
import { isPortalHandoffStatus, portalOpenRefused } from "../src/lib/application-resume-flag";
import { buildPortalPaymentHistory, historyReceiptUrl, type HistoryRow } from "../src/lib/portal-payment-history";

const read = (p: string) => readFileSync(p, "utf8");

/** Minimal Supabase-style fake: from(t).select().eq().order().limit().maybeSingle(), insert, update. */
function fakeAdmin(tables: Record<string, any[]>) {
  const writes: { table: string; op: string; row: any }[] = [];
  function from(table: string) {
    const filters: [string, unknown][] = [];
    let op: "select" | "update" | "insert" = "select";
    let payload: any = null;
    const rows = () => (tables[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
    const q: any = {
      select: () => q,
      eq: (k: string, v: unknown) => (filters.push([k, v]), q),
      is: () => q,
      in: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      update: (p: any) => ((op = "update"), (payload = p), q),
      insert: (p: any) => {
        writes.push({ table, op: "insert", row: p });
        return Promise.resolve({ error: null });
      },
      then: (res: any, rej: any) => {
        if (op === "update") {
          for (const r of rows()) Object.assign(r, payload);
          writes.push({ table, op: "update", row: payload });
          return Promise.resolve({ error: null }).then(res, rej);
        }
        return Promise.resolve({ data: rows(), error: null }).then(res, rej);
      },
    };
    return q;
  }
  return { admin: { from }, writes };
}

function world(over: { appStatus?: string; rentalStatus?: string; payments?: any[]; audits?: any[] } = {}) {
  return fakeAdmin({
    applications: [{ id: "app1", email: "renter@example.com", full_name: "Test Renter", status: over.appStatus ?? "active" }],
    rentals: [{ id: "r1", application_id: "app1", status: over.rentalStatus ?? "active", vehicle_id: null, created_at: "2026-11-01" }],
    payments: over.payments ?? [],
    audit_log: over.audits ?? [],
    vehicles: [],
  });
}

function deps(log: string[], extra: Record<string, any> = {}) {
  return {
    gate: async () => "send" as const,
    provision: async () => (log.push("provision"), { userId: "u1", conflict: false }),
    setPasswordLink: async () => "https://example.com/set-password#token",
    send: async (a: any) => (log.push(`send:${a.setPasswordUrl ? "link" : "nolink"}`), { ok: true }),
    audit: async (e: any) => void log.push(`audit:${e.action}`),
    ...extra,
  };
}

const rentPaid = { id: "p1", type: "rent", status: "paid", rental_id: "r1", driver_id: "app1", reason: null };
const feePaid = { id: "p0", type: "rent", status: "paid", rental_id: "r1", driver_id: "app1", reason: "reservation_fee" };

describe("picked-up rule", () => {
  it("only an active application or a started rental counts", () => {
    expect(rentalMeansPickedUp("reserved")).toBe(false);
    expect(rentalMeansPickedUp("cancelled")).toBe(false);
    expect(rentalMeansPickedUp("active")).toBe(true);
    expect(rentalMeansPickedUp("closed")).toBe(true);
    expect(pickedUpFrom("approved", ["reserved"])).toBe(false);
    expect(pickedUpFrom("active", [])).toBe(true);
    expect(PORTAL_OPENS_AT_PICKUP_MESSAGE).toMatch(/secure link/);
  });
  it("approved is no longer a portal handoff status", () => {
    expect(isPortalHandoffStatus("approved")).toBe(false);
    expect(isPortalHandoffStatus("active")).toBe(true);
    expect(portalOpenRefused("approved")).toBe(false);
    expect(isDocumentsOnlyStatus("approved")).toBe(true);
    expect(canUploadBeforePickupStatus("approved")).toBe(true);
    expect(canUploadBeforePickupStatus("declined")).toBe(false);
  });
});

describe("pickup payment", () => {
  it("never counts the Reservation Fee", () => {
    expect(isReservationFeePayment(feePaid)).toBe(true);
    expect(isPickupPayment(feePaid, { rentalId: "r1", applicationId: "app1" })).toBe(false);
    expect(isPickupPayment(rentPaid, { rentalId: "r1", applicationId: "app1" })).toBe(true);
    expect(isPickupPayment({ ...rentPaid, status: "pending" }, { rentalId: "r1", applicationId: "app1" })).toBe(false);
  });
});

describe("one welcome, after the pickup payment", () => {
  it("does not send before pickup", async () => {
    const log: string[] = [];
    const { admin } = world({ appStatus: "approved", rentalStatus: "reserved", payments: [rentPaid] });
    expect(await maybeSendPortalWelcome(admin, { applicationId: "app1", source: "activation" }, deps(log))).toBe("not_picked_up");
    expect(log).toEqual([]);
  });

  it("activation without the pickup payment defers, with no login", async () => {
    const log: string[] = [];
    const { admin } = world({ payments: [feePaid] });
    expect(await welcomeOrDeferAtActivation(admin, { applicationId: "app1", rentalId: "r1" }, deps(log))).toBe("not_paid");
    expect(log).toEqual([`audit:${PORTAL_WELCOME_PENDING_ACTION}`]);
  });

  it("activation with the pickup rent paid sends once, with the set-password link", async () => {
    const log: string[] = [];
    const { admin } = world({ payments: [rentPaid] });
    expect(await welcomeOrDeferAtActivation(admin, { applicationId: "app1", rentalId: "r1" }, deps(log))).toBe("sent");
    expect(log).toEqual(["provision", "send:link", `audit:${PORTAL_WELCOME_AUDIT_ACTION}`]);
  });

  it("is never sent twice", async () => {
    const log: string[] = [];
    const { admin } = world({ payments: [rentPaid], audits: [{ id: "a", action: PORTAL_WELCOME_AUDIT_ACTION, entity_id: "app1" }] });
    expect(await maybeSendPortalWelcome(admin, { applicationId: "app1", rentalId: "r1", source: "activation" }, deps(log))).toBe("already");
    expect(log).toEqual([]);
  });

  it("the payment webhook finishes a deferred welcome", async () => {
    const log: string[] = [];
    const { admin } = world({ payments: [rentPaid], audits: [{ id: "a", action: PORTAL_WELCOME_PENDING_ACTION, entity_id: "app1" }] });
    expect(await maybeWelcomeAfterPayment(admin, { rentalId: "r1", reason: null }, deps(log))).toBe("sent");
    expect(log).toContain("send:link");
  });

  it("weekly rent never emails a renter activated before this change", async () => {
    const log: string[] = [];
    const { admin } = world({ payments: [rentPaid] });
    expect(await maybeWelcomeAfterPayment(admin, { rentalId: "r1", reason: null }, deps(log))).toBe("already");
    expect(log).toEqual([]);
  });

  it("a Reservation Fee payment is ignored", async () => {
    const log: string[] = [];
    const { admin } = world({ payments: [feePaid], audits: [{ id: "a", action: PORTAL_WELCOME_PENDING_ACTION, entity_id: "app1" }] });
    expect(await maybeWelcomeAfterPayment(admin, { rentalId: "r1", reason: "reservation_fee" }, deps(log))).toBe("ignored");
    expect(await maybeWelcomeAfterPayment(admin, { rentalId: "r1", reason: null }, deps(log))).toBe("not_paid");
    expect(log).toEqual([]);
  });

  it("respects the automation switch", async () => {
    const log: string[] = [];
    const { admin } = world({ payments: [rentPaid] });
    expect(await maybeSendPortalWelcome(admin, { applicationId: "app1", rentalId: "r1", source: "activation" }, deps(log, { gate: async () => "off" }))).toBe("off");
    expect(log).toEqual([]);
  });
});

describe("no login email before pickup, on any path (source)", () => {
  const reservations = read("src/lib/reservations.functions.ts");
  const email = read("src/lib/email.server.ts");
  const rentals = read("src/lib/rentals.functions.ts");
  const signin = read("src/lib/portal-signin.server.ts");
  const reset = read("src/lib/password-reset.server.ts");

  it("Reserved sends a Pickup Booked email with no login", () => {
    expect(reservations).not.toMatch(/sendPortalInviteEmail|maybeSendBookingLoginEmail/);
    const body = email.slice(email.indexOf("export async function sendPickupBookedEmail"), email.indexOf("\"Welcome To Your Driver Portal.\""));
    expect(body.length).toBeGreaterThan(100);
    expect(body).not.toMatch(/set-password|\/login|action_link|Set Your Password/);
    expect(body).toMatch(/Once your rental is paid at pickup, we'll email your driver portal login\./);
  });

  it("activation no longer sends its own welcome", () => {
    const core = rentals.slice(rentals.indexOf("export async function activateRentalCore"));
    expect(core).not.toMatch(/inviteUrl|sendPortalInviteEmail/);
    expect(core).toMatch(/welcomeOrDeferAtActivation/);
  });

  it("self sign-in and password reset are gated before pickup", () => {
    expect(signin).toMatch(/portalGateForEmail/);
    expect(signin).toMatch(/PORTAL_OPENS_AT_PICKUP_MESSAGE/);
    expect(reset).toMatch(/prePickupRenter/);
  });

  it("the approval email promises the login at pickup", () => {
    expect(email).toMatch(/Once your rental is paid at pickup, we'll email your driver portal login\./);
  });
});

const APP = "59b62ce6-654e-4298-a6c3-ff5bb79f9d35";
describe("secure link documents before pickup", () => {
  function docWorld(status: string, licence: string | null = `${APP}/1795038600000-old111.jpg`) {
    return fakeAdmin({
      applications: [{ id: APP, status, full_name: "Test Renter", license_photo_url: licence, trip_screenshots: [] }],
      notifications: [],
    });
  }
  const noop = { pickedUp: async () => false, sync: async () => null, audit: async () => {} };

  it("an approved renter replaces a blurry license; staff are alerted", async () => {
    const { admin, writes } = docWorld("approved");
    const r = await replaceApplicantDocumentCore(admin, APP, { kind: "license", path: `${APP}/1795038676606-ab12cd.jpg` }, noop);
    expect(r.replaced).toBe(true);
    expect(writes.find((w) => w.table === "applications")?.row).toEqual({ license_photo_url: `${APP}/1795038676606-ab12cd.jpg` });
    expect(writes.find((w) => w.table === "notifications")?.row.title).toBe("Document Replaced");
  });

  it("only takes back a path in the exact issued shape", () => {
    expect(isIssuedUploadPath(APP, `${APP}/1795038676606-ab12cd.jpg`)).toBe(true);
    for (const bad of [`${APP}/1795038676606-ab12cd.jpg"`, `${APP}/a,b.jpg`, `${APP}/../x/1795038676606-ab12cd.jpg`, `${APP}/1795038676606-ab 12.jpg`, "x.jpg"]) {
      expect(isIssuedUploadPath(APP, bad)).toBe(false);
    }
  });

  it("refuses another application's file, a closed application, and a picked-up renter", async () => {
    await expect(replaceApplicantDocumentCore(docWorld("approved").admin, APP, { kind: "license", path: "11111111-1111-4111-8111-111111111111/1795038676607-zz12cd.jpg" }, noop)).rejects.toThrow();
    await expect(replaceApplicantDocumentCore(docWorld("declined").admin, APP, { kind: "license", path: `${APP}/1795038676607-zz12cd.jpg` }, noop)).rejects.toThrow(DOC_REPLACE_CLOSED_MESSAGE);
    await expect(
      replaceApplicantDocumentCore(docWorld("approved").admin, APP, { kind: "license", path: `${APP}/1795038676607-zz12cd.jpg` }, { ...noop, pickedUp: async () => true }),
    ).rejects.toThrow(DOC_REPLACE_LOCKED_MESSAGE);
  });
});

describe("payment history", () => {
  const base: HistoryRow = {
    id: "fee",
    type: "rent",
    status: "paid",
    amount: 50,
    balance_due: 0,
    net_collected: 50,
    refunded_amount: 0,
    due_date: "2026-11-01",
    paid_date: "2026-11-01",
    created_at: "2026-11-01T12:00:00.000Z",
    payment_method: "card",
    stripe_payment_intent_id: "pi_1",
    stripe_invoice_id: null,
    stripe_receipt_url: "https://pay.stripe.com/receipts/abc",
    reason: "reservation_fee",
  } as HistoryRow;

  it("shows an unlinked Reservation Fee with its receipt", () => {
    const h = buildPortalPaymentHistory({ rows: [base] });
    expect(h.payments.length).toBe(1);
    expect(h.payments[0].typeLabel).toBe("Reservation Fee");
    expect(h.payments[0].receiptUrl).toBe("https://pay.stripe.com/receipts/abc");
  });

  it("only links https Stripe receipts", () => {
    expect(historyReceiptUrl("http://pay.stripe.com/x")).toBeNull();
    expect(historyReceiptUrl("https://evil.example.com/stripe.com")).toBeNull();
    expect(historyReceiptUrl("javascript:alert(1)")).toBeNull();
    expect(historyReceiptUrl("https://pay.stripe.com/receipts/x")).toBe("https://pay.stripe.com/receipts/x");
  });

  it("the card renders a Receipt link that opens safely", () => {
    const card = read("src/components/portal/PaymentHistoryCard.tsx");
    expect(card).toMatch(/receiptUrl/);
    expect(card).toMatch(/noopener noreferrer/);
  });
});
