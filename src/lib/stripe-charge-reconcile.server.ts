// Nightly Stripe charge check. Read-only against Stripe. Does not insert a
// payments row. A gap is stored on the Unmatched Payments queue (idempotent)
// and one team alert is claimed per charge id. Both the Automations switch
// and the team-alert kind default off; the caller checks them before this runs.
import { chargeGapAlert, chargeGaps, succeededChargeRef, type SucceededChargeRef } from "@/lib/stripe-charge-reconcile";
import type { TeamAlertSettings } from "@/lib/team-alerts";

type Admin = any;

export const STRIPE_CHARGE_RECONCILE_DAYS = 14;
const PAGE = 100;
const MAX_PAGES = 10;

type StripeList = {
  charges: { list: (params: Record<string, unknown>) => Promise<{ data?: any[]; has_more?: boolean }> };
};

export type ChargeReconcileResult = {
  status: "ok" | "stripe_unavailable" | "gaps";
  checked: number;
  gaps: number;
  alerts: Array<{ chargeId: string; status: string }>;
};

export async function runStripeChargeReconciliation(
  admin: Admin,
  deps: {
    stripe: StripeList;
    now?: Date;
    settings: TeamAlertSettings;
    sendAlert?: (alert: { kind: "stripe_payment_gap"; dedupeKey: string; title: string; lines: string[]; link?: string }) => Promise<{ status: string }>;
  },
): Promise<ChargeReconcileResult> {
  if (!deps.settings.stripe_payment_gap) return { status: "ok", checked: 0, gaps: 0, alerts: [] };
  const now = deps.now ?? new Date();
  const gte = Math.floor(now.getTime() / 1000) - STRIPE_CHARGE_RECONCILE_DAYS * 86400;
  const refs: SucceededChargeRef[] = [];
  let starting_after: string | undefined;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await deps.stripe.charges.list({ limit: PAGE, created: { gte }, ...(starting_after ? { starting_after } : {}) });
      const data = res?.data ?? [];
      for (const charge of data) {
        const ref = succeededChargeRef(charge);
        if (ref) refs.push(ref);
      }
      if (!res?.has_more || !data.length) break;
      starting_after = data[data.length - 1]?.id;
      if (!starting_after) break;
    }
  } catch (err) {
    console.error("[stripe-charge-reconcile] list failed", err instanceof Error ? err.message : "stripe");
    return { status: "stripe_unavailable", checked: 0, gaps: 0, alerts: [] };
  }
  if (!refs.length) return { status: "ok", checked: 0, gaps: 0, alerts: [] };
  const intentIds = refs.map((r) => r.paymentIntentId).filter((x): x is string => !!x);
  const invoiceIds = refs.map((r) => r.invoiceId).filter((x): x is string => !!x);
  const chargeIds = refs.map((r) => r.chargeId);
  const recorded: Array<{ stripe_charge_id?: string | null; stripe_payment_intent_id?: string | null; stripe_invoice_id?: string | null }> = [];
  const pull = async (column: string, ids: string[]) => {
    if (!ids.length) return;
    const res = await admin.from("payments").select("stripe_charge_id, stripe_payment_intent_id, stripe_invoice_id").in(column, ids.slice(0, 200));
    if (res?.error) throw new Error(res.error.message);
    recorded.push(...(res?.data ?? []));
  };
  await pull("stripe_charge_id", chargeIds);
  await pull("stripe_payment_intent_id", intentIds);
  await pull("stripe_invoice_id", invoiceIds);
  const gaps = chargeGaps(
    refs,
    recorded.map((p) => ({
      stripeChargeId: p.stripe_charge_id ?? null,
      stripePaymentIntentId: p.stripe_payment_intent_id ?? null,
      stripeInvoiceId: p.stripe_invoice_id ?? null,
    })),
  );
  if (!gaps.length) return { status: "ok", checked: refs.length, gaps: 0, alerts: [] };
  const send = deps.sendAlert ?? (async (alert) => {
    const { sendTeamAlert } = await import("@/lib/team-alerts.server");
    return sendTeamAlert(admin, { ...alert, link: "https://drivereal.com/admin?tab=payments" }, { settings: deps.settings });
  });
  const alerts: Array<{ chargeId: string; status: string }> = [];
  for (const gap of gaps) {
    await storeUnmatchedFromGap(admin, gap);
    const copy = chargeGapAlert(gap);
    try {
      const out = await send({ kind: "stripe_payment_gap", dedupeKey: copy.dedupeKey, title: copy.title, lines: copy.lines, link: "https://drivereal.com/admin?tab=payments" });
      alerts.push({ chargeId: gap.chargeId, status: out.status });
    } catch (err) {
      console.error("[stripe-charge-reconcile] alert failed", gap.chargeId, err instanceof Error ? err.message : "alert");
      alerts.push({ chargeId: gap.chargeId, status: "failed" });
    }
  }
  return { status: "gaps", checked: refs.length, gaps: gaps.length, alerts };
}

export async function storeUnmatchedFromGap(admin: Admin, gap: SucceededChargeRef): Promise<void> {
  const { storeUnmatchedPayment } = await import("@/lib/unmatched-payments.server");
  await storeUnmatchedPayment(admin, {
    paymentIntentId: gap.paymentIntentId ?? "",
    chargeId: gap.chargeId,
    sessionId: null,
    paymentLinkId: null,
    rentalId: null,
    applicationIds: [],
    plates: [],
    forDate: null,
    weeks: [],
    renterName: null,
    customerIds: [],
    emails: [],
    phones: [],
    billingNames: [],
    amountCents: gap.amountCents,
    currency: gap.currency,
    paidAt: null,
    purpose: null,
    reason: null,
    receiptUrl: null,
    cardPayment: true,
    invoiceId: gap.invoiceId,
  }, "no_match");
}
