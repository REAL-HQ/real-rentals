import { customerIdOf } from "@/lib/stripe-unmatched";
import {
  applicationIdOf,
  matchRenterPayment,
  subscriptionIdOf,
  type ApplicationMatchRow,
  type PaymentMatch,
  type PriorPaymentMatchRow,
  type RentalMatchRow,
} from "@/lib/renter-payments";

const RENTAL_COLS = "id, application_id, vehicle_id, status, stripe_subscription_id, stripe_customer_id, updated_at, start_date";

function mergeById<T extends { id: string }>(rows: T[]): T[] {
  const map = new Map<string, T>();
  for (const row of rows) map.set(row.id, row);
  return [...map.values()];
}

async function mustData<T>(res: { data?: T[] | T | null; error?: { message: string } | null }): Promise<T[]> {
  if (res.error) throw new Error(res.error.message);
  if (Array.isArray(res.data)) return res.data;
  return res.data ? [res.data] : [];
}

/**
 * Load the rentals, applications, and prior payments that could identify a
 * Stripe invoice, then apply the shared matcher. Query errors throw so the
 * webhook can retry.
 */
export async function resolveStripePaymentMatch(
  admin: any,
  invoice: any,
  options?: { afterSubscriptionMiss?: () => Promise<void> },
): Promise<PaymentMatch> {
  const identity = {
    invoiceId: typeof invoice?.id === "string" ? invoice.id : null,
    subscriptionId: subscriptionIdOf(invoice),
    customerId: customerIdOf(invoice),
    applicationId: applicationIdOf(invoice),
  };

  const rentals: RentalMatchRow[] = [];
  const applications: ApplicationMatchRow[] = [];
  const priorPayments: PriorPaymentMatchRow[] = [];

  const loadRentals = async (column: string, value: string) => {
    rentals.push(...await mustData<RentalMatchRow>(await admin.from("rentals").select(RENTAL_COLS).eq(column, value)));
  };

  if (identity.subscriptionId) {
    await loadRentals("stripe_subscription_id", identity.subscriptionId);
    if (!rentals.length && options?.afterSubscriptionMiss) {
      await options.afterSubscriptionMiss();
      await loadRentals("stripe_subscription_id", identity.subscriptionId);
    }
  }
  if (identity.customerId) await loadRentals("stripe_customer_id", identity.customerId);
  if (identity.applicationId) await loadRentals("application_id", identity.applicationId);

  if (identity.customerId) {
    applications.push(...await mustData<ApplicationMatchRow>(await admin.from("applications").select("id, stripe_customer_id").eq("stripe_customer_id", identity.customerId)));
    priorPayments.push(...await mustData<PriorPaymentMatchRow>(await admin.from("payments").select("rental_id, driver_id, vehicle_id, stripe_customer_id, stripe_subscription_id").eq("stripe_customer_id", identity.customerId).limit(20)));
  }
  if (identity.applicationId && !applications.some((row) => row.id === identity.applicationId)) {
    const found = await mustData<ApplicationMatchRow>(await admin.from("applications").select("id, stripe_customer_id").eq("id", identity.applicationId));
    applications.push(...found);
  }
  if (identity.subscriptionId) {
    priorPayments.push(...await mustData<PriorPaymentMatchRow>(await admin.from("payments").select("rental_id, driver_id, vehicle_id, stripe_customer_id, stripe_subscription_id").eq("stripe_subscription_id", identity.subscriptionId).limit(20)));
  }

  return matchRenterPayment(identity, {
    rentals: mergeById(rentals),
    applications: mergeById(applications),
    priorPayments,
  });
}
