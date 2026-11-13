// Per-renter Checkout link for the initial payment printed on a signed agreement.
// Charges are written before the session exists. The existing webhook marks them
// paid from payment_intent.metadata.paymentIds. Never throws out to signing.
import { initialPaymentFromMerge, type InitialPaymentOffer } from "@/lib/initial-payment";
import type { Actor } from "@/lib/roles.server";

type Admin = typeof import("@/integrations/supabase/client.server").supabaseAdmin;

const SETTINGS_KEY = "initial_payment_link";
const SITE = () => (process.env.PUBLIC_SITE_URL || "https://drivereal.com").replace(/\/$/, "");

export function checkoutStripeEnv(): "sandbox" | "live" | null {
  const named = process.env.STRIPE_CHECKOUT_ENV;
  if (named === "sandbox" || named === "live") {
    const secret =
      named === "sandbox" ? process.env.STRIPE_SANDBOX_API_KEY : process.env.STRIPE_LIVE_API_KEY;
    if (secret && process.env.LOVABLE_API_KEY) return named;
    return null;
  }
  const pub = process.env.VITE_PAYMENTS_CLIENT_TOKEN || process.env.PAYMENTS_CLIENT_TOKEN || "";
  if (
    pub.startsWith("pk_test_") &&
    process.env.STRIPE_SANDBOX_API_KEY &&
    process.env.LOVABLE_API_KEY
  )
    return "sandbox";
  if (pub.startsWith("pk_live_") && process.env.STRIPE_LIVE_API_KEY && process.env.LOVABLE_API_KEY)
    return "live";
  return null;
}

type Offer = { url: string; amount: number; tiedToRenter: boolean; label: string };

async function sharedLink(
  admin: Admin,
  agreementId: string,
  offer: InitialPaymentOffer,
  actor: Actor | null,
): Promise<Offer | null> {
  const { data } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle();
  const url =
    data?.value && typeof data.value === "object"
      ? String((data.value as { url?: string }).url ?? "")
      : "";
  if (!/^https:\/\//i.test(url)) {
    const { logAudit } = await import("@/lib/audit.server");
    await logAudit(actor, {
      action: "agreement.initial_payment_link_unavailable",
      summary: "Signed agreement has no per-renter Checkout link and no settings fallback",
      entityType: "agreement",
      entityId: agreementId,
    });
    return null;
  }
  const { logAudit } = await import("@/lib/audit.server");
  await logAudit(actor, {
    action: "agreement.initial_payment_link_shared",
    summary: "Signed agreement uses the shared initial-payment link",
    entityType: "agreement",
    entityId: agreementId,
    metadata: { amount: offer.total },
  });
  return { url, amount: offer.total, tiedToRenter: false, label: offer.label };
}

async function remember(admin: Admin, agreementId: string, patch: Record<string, unknown>) {
  const { data: row } = await admin
    .from("agreements")
    .select("metadata")
    .eq("id", agreementId)
    .maybeSingle();
  const metadata = {
    ...((row?.metadata as Record<string, unknown> | null) ?? {}),
    initial_payment: patch,
  };
  await admin
    .from("agreements")
    .update({ metadata: metadata as never })
    .eq("id", agreementId);
}

export async function createInitialPaymentLink(
  admin: Admin,
  agreementId: string,
  actor: Actor | null,
): Promise<Offer | null> {
  try {
    const { data: ag } = await admin
      .from("agreements")
      .select("application_id,signer_email,merge_data,metadata,vehicle_id")
      .eq("id", agreementId)
      .maybeSingle();
    if (!ag?.application_id) return null;
    const merge = (ag.merge_data ?? {}) as {
      weekly_rate?: string;
      deposit_amount?: string;
      balance_due?: string;
      _prep?: string;
    };
    const offer = initialPaymentFromMerge(merge);
    if (!offer) return null;

    const env = checkoutStripeEnv();
    if (!env) return sharedLink(admin, agreementId, offer, actor);

    const notes = {
      rent: `initial:${agreementId}:rent`,
      deposit: `initial:${agreementId}:deposit`,
    };
    const { data: existing } = await admin
      .from("payments")
      .select("id,type,amount,status,notes")
      .eq("driver_id", ag.application_id);
    const mine = (existing ?? []).filter(
      (p: { notes?: string | null }) => p.notes === notes.rent || p.notes === notes.deposit,
    );
    if (mine.some((p: { status: string }) => p.status === "paid" || p.status === "refunded"))
      return null;

    const needed = [
      { type: "rent", reason: "rent", amount: offer.rent, note: notes.rent },
      ...(offer.deposit > 0
        ? [{ type: "deposit", reason: "deposit", amount: offer.deposit, note: notes.deposit }]
        : []),
    ];
    const reusable = needed.every((n) =>
      mine.some(
        (p: { type: string; amount: number; status: string; notes?: string | null }) =>
          p.notes === n.note &&
          p.type === n.type &&
          Number(p.amount) === n.amount &&
          (p.status === "pending" || p.status === "failed"),
      ),
    );
    let ids: string[] = [];
    if (reusable) {
      ids = needed.flatMap((n) => {
        const row = mine.find((p) => p.notes === n.note);
        return row ? [row.id] : [];
      });
      if (ids.length !== needed.length) return sharedLink(admin, agreementId, offer, actor);
    } else {
      const stale = mine
        .filter((p: { status: string }) => p.status === "pending" || p.status === "failed")
        .map((p: { id: string }) => p.id);
      if (stale.length)
        await admin
          .from("payments")
          .update({ status: "void" })
          .in("id", stale)
          .in("status", ["pending", "failed"]);
      const rows = needed.map((n) => ({
        driver_id: ag.application_id,
        vehicle_id: ag.vehicle_id ?? null,
        type: n.type,
        reason: n.reason,
        amount: n.amount,
        status: "pending",
        notes: n.note,
      }));
      const { data: inserted, error } = await admin
        .from("payments")
        .insert(rows)
        .select("id,notes");
      if (error || !inserted?.length) return sharedLink(admin, agreementId, offer, actor);
      ids = needed.flatMap((n) => {
        const row = inserted.find((p) => p.notes === n.note);
        return row ? [row.id] : [];
      });
      if (ids.length !== needed.length) return sharedLink(admin, agreementId, offer, actor);
    }

    try {
      const { createStripeClient } = await import("@/lib/stripe.server");
      const stripe = createStripeClient(env);
      const { data: app } = await admin
        .from("applications")
        .select("email,full_name,stripe_customer_id")
        .eq("id", ag.application_id)
        .maybeSingle();
      let customerId = (app?.stripe_customer_id as string | null) ?? null;
      if (!customerId && app?.email) {
        const customer = await stripe.customers.create({
          email: app.email as string,
          name: (app.full_name as string | null) ?? undefined,
          metadata: { applicationId: ag.application_id as string },
        });
        customerId = customer.id;
        await admin
          .from("applications")
          .update({ stripe_customer_id: customerId })
          .eq("id", ag.application_id);
      }
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          customer: customerId ?? undefined,
          customer_email: customerId ? undefined : (ag.signer_email as string),
          line_items: needed.map((n) => ({
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: Math.round(n.amount * 100),
              product_data: {
                name:
                  n.type === "deposit"
                    ? "Security deposit"
                    : (offer.rentLineName ?? "First week's rent"),
              },
            },
          })),
          payment_intent_data: {
            metadata: {
              paymentIds: ids.join(","),
              applicationId: ag.application_id as string,
              agreementId,
            },
          },
          success_url: `${SITE()}/login?paid=1`,
          cancel_url: `${SITE()}/login`,
          expires_at: Math.floor(Date.now() / 1000) + 23 * 3600,
        },
        { idempotencyKey: `initial-checkout:${agreementId}:${ids.join(",")}` },
      );
      if (!session.url) throw new Error("Checkout session has no url");
      await remember(admin, agreementId, {
        url: session.url,
        amount: offer.total,
        tiedToRenter: true,
        paymentIds: ids,
      });
      const { logAudit } = await import("@/lib/audit.server");
      await logAudit(actor, {
        action: "agreement.initial_payment_link",
        summary: "Per-renter initial payment Checkout link created",
        entityType: "agreement",
        entityId: agreementId,
        metadata: { amount: offer.total, paymentIds: ids },
      });
      return { url: session.url, amount: offer.total, tiedToRenter: true, label: offer.label };
    } catch (e) {
      console.error("[initial-payment] checkout failed", e);
      if (!reusable)
        await admin
          .from("payments")
          .update({ status: "void" })
          .in("id", ids)
          .in("status", ["pending", "failed"]);
      return sharedLink(admin, agreementId, offer, actor);
    }
  } catch (e) {
    console.error("[initial-payment] link unavailable", e);
    return null;
  }
}
