// The default entry injects https://js.stripe.com on import. This one waits for loadStripe.
import { loadStripe } from '@stripe/stripe-js/pure';

type StripeEnv = 'sandbox' | 'live';

const clientToken = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN as string | undefined;

function paymentsEnvironment(): StripeEnv {
  if (clientToken?.startsWith('pk_test_')) return 'sandbox';
  if (clientToken?.startsWith('pk_live_')) return 'live';
  throw new Error(
    'Payments are not configured for this build. Complete payment go-live to enable production checkout.',
  );
}

let stripePromise: ReturnType<typeof loadStripe> | null = null;

export function getStripe(): ReturnType<typeof loadStripe> {
  if (!stripePromise) {
    paymentsEnvironment();
    stripePromise = loadStripe(clientToken as string);
  }
  return stripePromise;
}

export function getStripeEnvironment(): StripeEnv {
  return paymentsEnvironment();
}