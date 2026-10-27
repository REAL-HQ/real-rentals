import { getStripeErrorMessage } from '@/lib/stripe.server';

const ENDED_SUBSCRIPTION_STATUSES = new Set(['canceled', 'incomplete_expired']);

/**
 * Cancels the subscription and returns null only when Stripe reports it ended. A subscription
 * that was already canceled counts as ended. Any other outcome (including "no such
 * subscription", which can mean the wrong Stripe mode) returns the problem; Stripe keeps
 * canceled subscriptions retrievable, so a missing one is never treated as ended.
 */
export async function subscriptionEnded(
  stripe: { subscriptions: { cancel(id: string): Promise<{ status: string }>; retrieve(id: string): Promise<{ status: string }> } },
  id: string,
): Promise<string | null> {
  let cancelError: unknown = null;
  try {
    const sub = await stripe.subscriptions.cancel(id);
    if (ENDED_SUBSCRIPTION_STATUSES.has(sub.status)) return null;
    return `Stripe reported the subscription as ${sub.status}, not canceled.`;
  } catch (error) {
    cancelError = error;
  }
  try {
    const sub = await stripe.subscriptions.retrieve(id);
    if (ENDED_SUBSCRIPTION_STATUSES.has(sub.status)) return null;
  } catch {
    // Report the cancel error below.
  }
  return `Could not cancel weekly autopay in Stripe: ${getStripeErrorMessage(cancelError)}`;
}
