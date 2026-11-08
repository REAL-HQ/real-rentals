// Pay Now in renter payment emails. Behavioral for the emails and the portal
// tab choice; the payment protections it relies on (payRentalBalance) are
// checked from source because they need a signed-in Stripe flow.
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => { const b: any = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: null, error: null }), insert: () => ({ select: () => ({ single: async () => ({ data: { id: "d" }, error: null }) }) }), update: () => b, then: (r: any) => r({ error: null }) }; return b; } } }));
const { PORTAL_PAY_URL, initialPortalTab } = await import("@/lib/portal-pay-link");
const { previewCapture } = await import("@/lib/automation-controls.server");
const email = await import("@/lib/email.server");

async function html(run: () => Promise<unknown>) { return (await previewCapture(run))[0]!.html; }
const hrefs = (h: string) => [...h.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

describe("Pay Now link", () => {
  test("past due, due tomorrow and payment failed all carry the same fixed portal link", async () => {
    const a = await html(() => email.sendPastDueReminderEmail({ to: "a@example.com", firstName: "A", amount: 350, dueDate: "2026-11-01", daysLate: 3 }));
    const b = await html(() => email.sendPaymentDueTomorrowEmail({ to: "b@example.com", firstName: "B", amount: 999, dueDate: "2026-11-09" }));
    const c = await html(() => email.sendPaymentFailedEmail({ to: "c@example.com", firstName: "C", amount: 12, reason: "rent" }));
    for (const h of [a, b, c]) expect(hrefs(h)).toContain(PORTAL_PAY_URL);
    expect(a).toContain(">Pay Now<");
  });
  test("the link has no amount, token, renter or payment id in it", () => {
    const u = new URL(PORTAL_PAY_URL);
    expect([...u.searchParams.keys()]).toEqual(["pay"]);
    expect(u.searchParams.get("pay")).toBe("balance");
    expect(u.host).toBe("drivereal.com");
    expect(u.pathname).toBe("/portal");
  });
  test("autopay due-tomorrow says View Payment, not Pay Now", async () => {
    const h = await html(() => email.sendPaymentDueTomorrowEmail({ to: "b@example.com", firstName: "B", amount: 1, dueDate: "2026-11-09", autopay: true }));
    expect(h).toContain(">View Payment<");
  });
  test("portal opens Payments only for ?pay=balance", () => {
    expect(initialPortalTab("?pay=balance", "dashboard")).toBe("payments");
    expect(initialPortalTab("?pay=other", "dashboard")).toBe("dashboard");
    expect(initialPortalTab("", "dashboard")).toBe("dashboard");
  });
});

describe("paying still goes through the guarded portal flow (source)", () => {
  const src = readFileSync("src/lib/rental-payments.functions.ts", "utf8");
  const body = src.slice(src.indexOf("export const payRentalBalance"), src.indexOf("export const createRentalSetupSession"));
  test("signed-in renter only, own rental, server-computed balance, in-flight and nothing-owed blocks, single collection", () => {
    expect(body).toContain("requireSupabaseAuth");
    expect(body).toContain("refuseStaffPortalWrite");
    expect(body).toContain("rental.driver_id !== context.userId");
    expect(body).toContain("rentalBalance(supabaseAdmin, data.rentalId)");
    expect(body).toContain("if (processing)");
    expect(body).toContain("if (!rows.length) return { error: 'Nothing is owed on this rental.' }");
    expect(body).toContain("cents !== Math.round(data.amountCents)");
    expect(body).toContain("collectRows(");
    expect(body).not.toMatch(/checkout\.sessions\.create|paymentLinks\.create/);
  });
  test("no new Stripe Checkout or Payment Link creation anywhere for reminders", () => {
    const e = readFileSync("src/lib/email.server.ts", "utf8");
    expect(e).not.toMatch(/paymentLinks\.create|checkout\.sessions\.create/);
  });
});
