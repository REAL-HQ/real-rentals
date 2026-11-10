// Per-renter initial payment, created only after the agreement is signed.
//
// A payments row is written before any Stripe call. The Checkout Session's
// PaymentIntent carries those row ids, and the existing webhook marks them
// paid. Two rows so the deposit is not counted as rent revenue.
//
// Stripe is called only when an environment can be named from configuration.
// A missing key, a failed session, or no resolvable environment never fails
// the signature. The fallback is the Owner's shared link in app_settings
// (key `initial_payment_link`, value `{ "url": "https://..." }`), and the
// email says that page is not tied to this renter. Pending rows created for
// a checkout that did not happen are voided so they are not a phantom debt.

import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";
import { initialPaymentFromMerge, type InitialPaymentAmount } from "@/lib/initial-payment";

export type InitialPaymentOffer = InitialPaymentAmount & {
  url: string;
  tiedToRenter: boolean;
};

const SITE = () => (process.env.PUBLIC_SITE_URL || "https://drivereal.com").replace(/\/$/, "");

/** Sandbox or live, only when that environment's key and the Lovable gateway key are both set. */
export function checkoutStripeEnv(): StripeEnv | null {
  if (!process.env.LOVABLE_API_KEY) return null;
  const forced = process.env.STRIPE_CHECKOUT_ENV;
  if (forced === "sandbox" || forced === "live") {
    const secret = forced === "sandbox" ? process.env.STRIPE_SANDBOX_API_KEY : process.env.STRIPE_LIVE_API_KEY;
    return secret ? forced : null;
  }
  const pk = process.env.VITE_PAYMENTS_CLIENT_TOKEN || process.env.PAYMENTS_CLIENT_TOKEN || "";
  if (pk.startsWith("pk_test_") && process.env.STRIPE_SANDBOX_API_KEY) return "sandbox";
  if (pk.startsWith("pk_live_") && process.env.STRIPE_LIVE_API_KEY) return "live";
  return null;
}

function httpsUrl(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const url = (value as { url?: unknown }).url;
  if (typeof url !== "string" || url.length > 500 || !/^https:\/\/[^\s]+$/.test(url)) return null;
  return url;
}

async function settingsLink(admin: any): Promise<string | null> {
  const { data } = await admin.from("app_settings").select("value").eq("key", "initial_payment_link").maybeSingle();
  return httpsUrl(data?.value);
}

async function voidPending(admin: any, ids: string[]) {
  if (!ids.length) return;
  await admin.from("payments").update({ status: "void", balance_due: 0 }).in("id", ids).in("status", ["pending", "failed"]);
}

async function remember(admin: any, agreementId: string, offer: InitialPaymentOffer, paymentIds: string[]) {
  const { data: row } = await admin.from("agreements").select("metadata").eq("id", agreementId).maybeSingle();
  const metadata = {
    ...((row?.metadata as Record<string, unknown> | null) ?? {}),
    initial_payment: {
      url: offer.url,
      amount: offer.total,
      tiedToRenter: offer.tiedToRenter,
      paymentIds,
      at: new Date().toISOString(),
    },
  };
  const { error } = await admin.from("agreements").update({ metadata }).eq("id", agreementId);
  if (error) console.error("[initial-payment] could not store the link on the agreement", error.message);
}

async function audit(admin: any, agreementId: string, action: string, summary: string, metadata: Record<string, unknown>) {
  const { logAudit } = await import("@/lib/audit.server");
  void admin;
  await logAudit(null, { action, summary, entityType: "agreement", entityId: agreementId, metadata });
}

export async function createInitialPaymentLink(
  admin: any,
  args: { agreementId: string; applicationId: string; merge: Record<string, string | undefined | null> },
): Promise<InitialPaymentOffer | null> {
  try {
    const amount = initialPaymentFromMerge(args.merge);
    if (!amount) return null;
    const env = checkoutStripeEnv();
    if (!env) return await sharedOrNothing(admin, args.agreementId, amount, []);

    const rentNote = `initial:${args.agreementId}:rent`;
    const depositNote = `initial:${args.agreementId}:deposit`;
    const { data: prior } = await admin
      .from("payments")
      .select("id,type,status,amount,notes")
      .eq("driver_id", args.applicationId)
      .in("notes", [rentNote, depositNote]);
    const rows = (prior ?? []) as { id: string; type: string; status: string; amount: number; notes: string }[];
    if (rows.some((r) => r.status === "paid" || r.status === "refunded")) return null;

    const { data: rental } = await admin
      .from("rentals")
      .select("id,vehicle_id")
      .eq("application_id", args.applicationId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: agreement } = await admin.from("agreements").select("vehicle_id").eq("id", args.agreementId).maybeSingle();
    const vehicleId = (agreement?.vehicle_id as string | null) ?? (rental?.vehicle_id as string | null) ?? null;
    const due = new Date().toISOString().slice(0, 10);

    const reusable = rows.filter((r) => r.status === "pending" || r.status === "failed");
    const rentRow = reusable.find((r) => r.notes === rentNote && Number(r.amount) === amount.rent);
    const depositRow = amount.deposit > 0 ? reusable.find((r) => r.notes === depositNote && Number(r.amount) === amount.deposit) : null;
    const amountsMatch = !!rentRow && (amount.deposit === 0 || !!depositRow);
    let createdIds: string[] = [];
    let paymentIds: string[] = [];
    if (amountsMatch) {
      paymentIds = [rentRow!.id, ...(depositRow ? [depositRow.id] : [])];
    } else {
      await voidPending(admin, reusable.map((r) => r.id));
      const inserts = [
        {
          driver_id: args.applicationId,
          rental_id: (rental?.id as string | null) ?? null,
          vehicle_id: vehicleId,
          amount: amount.rent,
          balance_due: amount.rent,
          type: "rent",
          reason: "rent",
          status: "pending",
          due_date: due,
          notes: rentNote,
        },
        ...(amount.deposit > 0
          ? [{
              driver_id: args.applicationId,
              rental_id: (rental?.id as string | null) ?? null,
              vehicle_id: vehicleId,
              amount: amount.deposit,
              balance_due: amount.deposit,
              type: "deposit",
              reason: "deposit",
              status: "pending",
              due_date: due,
              notes: depositNote,
            }]
          : []),
      ];
      const { data: inserted, error } = await admin.from("payments").insert(inserts).select("id,type");
      if (error || !inserted?.length) {
        console.error("[initial-payment] charge rows were not written", error?.message);
        return await sharedOrNothing(admin, args.agreementId, amount, []);
      }
      createdIds = inserted.map((r: { id: string }) => r.id);
      const rent = inserted.find((r: { type: string }) => r.type === "rent");
      const deposit = inserted.find((r: { type: string }) => r.type === "deposit");
      paymentIds = [rent?.id, deposit?.id].filter(Boolean);
    }

    try {
      const stripe = createStripeClient(env);
      const { data: app } = await admin
        .from("applications")
        .select("id,email,full_name,phone,stripe_customer_id")
        .eq("id", args.applicationId)
        .maybeSingle();
      const customer = await ensureCustomer(admin, stripe, app ?? { id: args.applicationId });
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          customer,
          client_reference_id: args.agreementId,
          expires_at: Math.floor(Date.now() / 1000) + 23 * 3600,
          success_url: `${SITE()}/login?paid=1`,
          cancel_url: `${SITE()}/login`,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: "usd",
                unit_amount: Math.round(amount.rent * 100),
                product_data: { name: "First week of rent" },
              },
            },
            ...(amount.deposit > 0
              ? [{
                  quantity: 1,
                  price_data: {
                    currency: "usd",
                    unit_amount: Math.round(amount.deposit * 100),
                    product_data: { name: "Security deposit" },
                  },
                }]
              : []),
          ],
          metadata: {
            applicationId: args.applicationId,
            agreementId: args.agreementId,
            purpose: "initial_payment",
            paymentIds: paymentIds.join(","),
          },
          payment_intent_data: {
            metadata: {
              applicationId: args.applicationId,
              agreementId: args.agreementId,
              purpose: "initial_payment",
              paymentIds: paymentIds.join(","),
              ...(rental?.id ? { rentalId: rental.id as string } : {}),
            },
          },
        },
        { idempotencyKey: `initial-checkout:${args.agreementId}:${paymentIds.join(",")}` },
      );
      if (!session.url) throw new Error("Stripe did not return a checkout link");
      const offer: InitialPaymentOffer = { ...amount, url: session.url, tiedToRenter: true };
      await remember(admin, args.agreementId, offer, paymentIds);
      await audit(admin, args.agreementId, "agreement.initial_payment_link", "Initial payment checkout created for this renter", {
        amount: amount.total,
        paymentIds,
      });
      return offer;
    } catch (e) {
      console.error("[initial-payment] checkout was not created", e instanceof Error ? e.message : e);
      await voidPending(admin, createdIds.length ? createdIds : paymentIds);
      return await sharedOrNothing(admin, args.agreementId, amount, []);
    }
  } catch (e) {
    console.error("[initial-payment] link failed", e instanceof Error ? e.message : e);
    return null;
  }
}

async function sharedOrNothing(admin: any, agreementId: string, amount: InitialPaymentAmount, paymentIds: string[]): Promise<InitialPaymentOffer | null> {
  const url = await settingsLink(admin);
  if (!url) {
    await audit(admin, agreementId, "agreement.initial_payment_link_unavailable", "No per-renter checkout and no shared payment link is configured", {
      amount: amount.total,
    });
    return null;
  }
  const offer: InitialPaymentOffer = { ...amount, url, tiedToRenter: false };
  await remember(admin, agreementId, offer, paymentIds);
  await audit(admin, agreementId, "agreement.initial_payment_link_shared", "Signed email uses the shared payment page because a personal checkout was not available", {
    amount: amount.total,
  });
  return offer;
}

async function ensureCustomer(admin: any, stripe: ReturnType<typeof createStripeClient>, app: { id: string; email?: string | null; full_name?: string | null; phone?: string | null; stripe_customer_id?: string | null }): Promise<string> {
  if (app.stripe_customer_id) return app.stripe_customer_id;
  if (app.email) {
    const { data: sibling } = await admin
      .from("applications")
      .select("stripe_customer_id")
      .eq("email", app.email)
      .not("stripe_customer_id", "is", null)
      .neq("id", app.id)
      .limit(1)
      .maybeSingle();
    if (sibling?.stripe_customer_id) {
      await admin.from("applications").update({ stripe_customer_id: sibling.stripe_customer_id }).eq("id", app.id);
      return sibling.stripe_customer_id as string;
    }
  }
  const created = await stripe.customers.create({
    ...(app.email ? { email: app.email } : {}),
    ...(app.full_name ? { name: app.full_name } : {}),
    ...(app.phone ? { phone: app.phone } : {}),
    metadata: { applicationId: app.id },
  });
  await admin.from("applications").update({ stripe_customer_id: created.id }).eq("id", app.id);
  return created.id;
}
