// Nov 18 2026 (Jonathon Boykins): signing skipped the $50 Reservation Fee
// Checkout because checkoutStripeEnv() read the publishable key only from
// process.env, which the production Worker never has (Vite inlines
// import.meta.env.VITE_* at build time). Also t445u: staff email deep links
// and the signed PDF attachment.
import { describe, expect, it, mock, beforeAll } from "bun:test";
import { readFileSync } from "node:fs";

const sent: any[] = [];
mock.module("@/integrations/supabase/client.server", () => {
  const b: any = { insert: () => b, select: () => b, single: async () => ({ data: { id: "dlv" }, error: null }), update: () => b, eq: () => b, maybeSingle: async () => ({ data: null, error: null }), then: (r: any) => r({ data: null, error: null }) };
  return { supabaseAdmin: { from: () => b, rpc: async () => ({ error: null }) } };
});
mock.module("@/lib/automation-controls.server", () => ({ capturePreviewEmail: () => false, emailGate: async () => "on", HELD_REASON: "held" }));
mock.module("@/lib/company.server", () => ({ getBusinessPhone: async () => ({ tel: "tel:+18888338280", display: "(888) 833-8280" }) }));

beforeAll(() => {
  process.env.RESEND_API_KEY = "test";
  (globalThis as any).fetch = async (url: string, init: any) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: "re_1" }), { status: 200 });
  };
});

describe("checkout Stripe env (root cause)", () => {
  it("uses the build-time publishable key when process.env has none", async () => {
    const { checkoutStripeEnv } = await import("@/lib/initial-payment.server");
    const saved = { ...process.env };
    for (const k of ["STRIPE_CHECKOUT_ENV", "VITE_PAYMENTS_CLIENT_TOKEN", "PAYMENTS_CLIENT_TOKEN", "STRIPE_LIVE_API_KEY", "STRIPE_SANDBOX_API_KEY", "LOVABLE_API_KEY"]) delete process.env[k];
    try {
      expect(checkoutStripeEnv("")).toBeNull();
      process.env.STRIPE_LIVE_API_KEY = "sk_live_x";
      process.env.LOVABLE_API_KEY = "gw";
      // Production before the fix: keys set, no token in process.env -> null.
      expect(checkoutStripeEnv("")).toBeNull();
      expect(checkoutStripeEnv("pk_live_abc")).toBe("live");
      expect(checkoutStripeEnv("pk_test_abc")).toBeNull();
      process.env.STRIPE_SANDBOX_API_KEY = "sk_test_x";
      expect(checkoutStripeEnv("pk_test_abc")).toBe("sandbox");
      // An explicit runtime setting still wins.
      process.env.STRIPE_CHECKOUT_ENV = "sandbox";
      expect(checkoutStripeEnv("pk_live_abc")).toBe("sandbox");
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });
  it("reads the exact literal the Lovable Vite config inlines into the server bundle", () => {
    const src = readFileSync("src/lib/initial-payment.server.ts", "utf8");
    expect(src).toContain("import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN");
    expect(src).toMatch(/checkoutStripeEnv\(buildToken: string = buildPaymentsClientToken\(\)\)/);
  });
});

describe("Reservation Fee outcomes", () => {
  it("flags a missing link and maps staff results", async () => {
    const { reservationFeeLinkProblem, staffReservationFeeLinkResult } = await import("@/lib/reservation-fee");
    expect(reservationFeeLinkProblem({ status: "no_card", amount: 50, paymentId: "p" })).toEqual({ amount: 50, reason: "card checkout could not be created" });
    expect(reservationFeeLinkProblem({ status: "failed", amount: 0, paymentId: null, error: "Unexpected error" })?.amount).toBe(50);
    for (const o of [{ status: "off" }, { status: "no_fee_on_agreement" }, { status: "checkout", amount: 50, paymentId: "p", url: "https://checkout.stripe.com/c/x" }, { status: "already_paid", amount: 50, paymentId: "p" }] as any[]) {
      expect(reservationFeeLinkProblem(o)).toBeNull();
    }
    expect(staffReservationFeeLinkResult({ status: "checkout", amount: 50, paymentId: "p", url: "https://checkout.stripe.com/c/x" })).toEqual({ ok: true, url: "https://checkout.stripe.com/c/x", amount: 50 });
    expect(staffReservationFeeLinkResult({ status: "already_paid", amount: 50, paymentId: "p" }).ok).toBe(false);
    expect(staffReservationFeeLinkResult({ status: "no_card", amount: 50, paymentId: "p" }).ok).toBe(false);
  });
  it("signing alerts staff and never leaves the renter on You're All Set", () => {
    const src = readFileSync("src/lib/agreements.functions.ts", "utf8");
    const fn = src.slice(src.indexOf("async function sendSignedEmails"), src.indexOf("function claimError"));
    expect(fn).toContain("reservationFeeLinkProblem(fee)");
    expect(fn).toContain("reservationFeeProblem: feeProblem");
    expect(fn).toContain("reservationFeeLinkPending: feeProblem && !payment");
    expect(fn).toContain("payment.reservation_fee_link_failed");
    expect(src).toContain("export const staffReservationFeeLink");
    expect(src.slice(src.indexOf("export const staffReservationFeeLink"))).toMatch(/requireManager\(context\.userId\)/);
  });
});

describe("staff deep links (t445u)", () => {
  it("builds tab=drivers&id and reads old ?driver= links", async () => {
    const { driverRecordPath, legacyDriverRecordId } = await import("@/lib/admin-record-links");
    const id = "802fb55c-d7e8-45ae-9b40-dc5efa74753f";
    expect(driverRecordPath(id)).toBe(`/admin?tab=drivers&id=${id}`);
    expect(legacyDriverRecordId({ driver: id })).toBe(id);
    expect(legacyDriverRecordId({ driver: "x' or 1=1" })).toBeNull();
    expect(legacyDriverRecordId({})).toBeNull();
  });
  it("no staff email links /admin?driver= any more, and the route honors it", () => {
    const email = readFileSync("src/lib/email.server.ts", "utf8");
    expect(email).not.toMatch(/admin\?driver=/);
    const route = readFileSync("src/routes/admin.tsx", "utf8");
    expect(route).toContain("legacyDriverRecordId(raw)");
  });
});

describe("signed emails", () => {
  const pdf = { filename: "REAL-RENTALS-Rental-Agreement-d1266373.pdf", content: "JVBERi0=", contentType: "application/pdf" };
  it("ops email: deep link, PDF attached, ACTION NEEDED when the fee link failed", async () => {
    const { sendAgreementSignedOpsEmail } = await import("@/lib/email.server");
    sent.length = 0;
    await sendAgreementSignedOpsEmail({ driverName: "Jonathon Boykins", applicationId: "802fb55c-d7e8-45ae-9b40-dc5efa74753f", vehicle: "2013 Ford Fusion", reservationFeeProblem: { amount: 50, reason: "card checkout could not be created" }, attachment: pdf });
    const b = sent[0].body;
    expect(b.html).toContain('href="https://drivereal.com/admin?tab=drivers&id=802fb55c-d7e8-45ae-9b40-dc5efa74753f"');
    expect(b.subject).toBe("ACTION NEEDED: Signed Agreement — Jonathon Boykins");
    expect(b.html).toContain("Copy Reservation Fee Link");
    expect(b.attachments).toEqual([{ filename: pdf.filename, content: pdf.content, content_type: "application/pdf" }]);
  });
  it("ops email without a problem or PDF: normal subject, no attachments key", async () => {
    const { sendAgreementSignedOpsEmail } = await import("@/lib/email.server");
    sent.length = 0;
    await sendAgreementSignedOpsEmail({ driverName: "A B", applicationId: "802fb55c-d7e8-45ae-9b40-dc5efa74753f", vehicle: null });
    expect(sent[0].body.subject).toBe("Signed Agreement — A B");
    expect("attachments" in sent[0].body).toBe(false);
    expect(sent[0].body.html).toContain("not ready to attach");
  });
  it("renter email: pending fee says One Last Step (never You're All Set) and carries the PDF", async () => {
    const { sendAgreementSignedEmail } = await import("@/lib/email.server");
    sent.length = 0;
    await sendAgreementSignedEmail({ to: "r@example.com", firstName: "Jonathon Boykins", vehicle: "2013 Ford Fusion", portalAccess: false, payment: null, reservationFeeLine: null, reservationFeePay: null, reservationFeeLinkPending: { amount: 50 }, attachment: pdf });
    const b = sent[0].body;
    expect(b.subject).toBe("Your REAL RENTALS Agreement Is Signed: One Last Step");
    expect(b.html).toContain("One Last Step: Reserve Your Car");
    expect(b.html).toContain("If the Reservation Fee is not paid within 24 hours, the car is released.");
    expect(b.html).not.toContain("You're All Set");
    expect(b.html).toContain("100% applied to your first week&#39;s rent".replace("&#39;", b.html.includes("&#39;") ? "&#39;" : "'"));
    expect(b.html).not.toMatch(/deposit/i);
    expect(b.html).toContain("attached as a PDF");
    expect(b.attachments?.[0]?.filename).toBe(pdf.filename);
  });
  it("renter email with a working Checkout is unchanged apart from the PDF", async () => {
    const { sendAgreementSignedEmail } = await import("@/lib/email.server");
    sent.length = 0;
    await sendAgreementSignedEmail({ to: "r@example.com", firstName: "J", vehicle: null, portalAccess: false, payment: null, reservationFeeLine: "Next step: pay", reservationFeePay: { url: "https://checkout.stripe.com/c/pay/x", amount: 50 }, reservationFeeLinkPending: null, attachment: null });
    const b = sent[0].body;
    expect(b.html).toContain("Pay $50.00 Reservation Fee");
    expect("attachments" in b).toBe(false);
  });
});

describe("signed PDF loader", () => {
  const admin = (o: { archived?: boolean; size?: number; missingDoc?: boolean }) => ({
    from: (t: string) => {
      const b: any = { select: () => b, eq: () => b };
      b.maybeSingle = async () =>
        t === "agreements"
          ? { data: { id: "d1266373-b322", status: "signed", document_id: "doc1", archive_status: o.archived === false ? "pending" : "archived" } }
          : { data: o.missingDoc ? null : { storage_bucket: "rental-agreements", storage_path: "a/b.pdf" } };
      return b;
    },
    storage: { from: () => ({ download: async () => ({ data: new Blob([new Uint8Array(o.size ?? 8).fill(37)]), error: null }) }) },
  });
  it("attaches the stored PDF, skips missing / unarchived / oversized", async () => {
    const { loadSignedAgreementAttachment } = await import("@/lib/signed-agreement-pdf.server");
    const ok = await loadSignedAgreementAttachment(admin({}), "d1266373-b322");
    expect(ok?.filename).toBe("REAL-RENTALS-Rental-Agreement-d1266373.pdf");
    expect(ok?.content).toBe(btoa("%".repeat(8)));
    expect(await loadSignedAgreementAttachment(admin({ archived: false }), "x")).toBeNull();
    expect(await loadSignedAgreementAttachment(admin({ missingDoc: true }), "x")).toBeNull();
    expect(await loadSignedAgreementAttachment(admin({ size: 100 }), "x", { maxBytes: 50 })).toBeNull();
    expect(await loadSignedAgreementAttachment({ from: () => { throw new Error("db down"); } }, "x")).toBeNull();
  });
});
