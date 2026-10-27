import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';
import { getStripe, getStripeEnvironment } from '@/lib/stripe';
import { createCardOnFileSession } from '@/lib/payments.functions';
import { CARD_TOKEN_KEY, useResumeToken } from '@/lib/resume-token';
import { cardOnFileScreen, probeFromSessionResult, type CardSessionProbe } from '@/lib/card-page';
import { supabase } from '@/integrations/supabase/client';

export const Route = createFileRoute('/card/$applicationId')({
  validateSearch: (s: Record<string, unknown>): { t?: string; status?: string } => {
    const t = typeof s.t === 'string' ? s.t.trim() : '';
    const status = s.status === 'success' ? 'success' : undefined;
    return { ...(t ? { t } : {}), ...(status ? { status } : {}) };
  },
  component: CardOnFilePage,
  head: () => ({
    meta: [
      { title: 'Save Card On File — Real Rentals' },
      { name: 'description', content: 'Securely save a card on file to complete your Real Rentals reservation.' },
      { name: 'robots', content: 'noindex,nofollow' },
    ],
  }),
});

const SETUP_FALLBACK = "Could not start the card setup. Ask us for a new link and we'll send it over.";

function CardOnFilePage() {
  const { applicationId } = Route.useParams();
  const { t, status: returnStatus } = Route.useSearch();
  // Take `t` out of the address bar. The card token uses its own sessionStorage
  // key, so this tab does not present it to /thank-you as a resume credential.
  const token = useResumeToken(t, { storageKey: CARD_TOKEN_KEY });
  const [sessionState, setSessionState] = useState<'unknown' | 'yes' | 'no'>('unknown');
  const [probe, setProbe] = useState<CardSessionProbe>({ status: 'idle' });

  const isReturn = returnStatus === 'success';

  useEffect(() => {
    if (token === undefined || token) return;
    let live = true;
    supabase.auth.getSession().then(({ data }) => {
      if (live) setSessionState(data.session ? 'yes' : 'no');
    }).catch(() => {
      if (live) setSessionState('no');
    });
    return () => {
      live = false;
    };
  }, [token]);

  // Ask the server before mounting Stripe. A bad token, an expired token, and
  // a signed-in user who is not allowed all come back as the link error, and
  // that answer is the Link Expired screen. The server returns it before Stripe.
  useEffect(() => {
    if (isReturn) return;
    if (token === undefined) return;
    if (!token && sessionState !== 'yes') return;
    let live = true;
    setProbe({ status: 'pending' });
    let environment: 'sandbox' | 'live';
    try {
      environment = getStripeEnvironment();
    } catch {
      if (live) setProbe({ status: 'error', message: SETUP_FALLBACK });
      return () => {
        live = false;
      };
    }
    const returnUrl = `${window.location.origin}/card/${applicationId}?status=success`;
    createCardOnFileSession({
      data: {
        applicationId,
        returnUrl,
        environment,
        ...(token ? { token } : {}),
      },
    }).then((result) => {
      if (live) setProbe(probeFromSessionResult(result));
    }).catch(() => {
      if (live) setProbe({ status: 'error', message: SETUP_FALLBACK });
    });
    return () => {
      live = false;
    };
  }, [applicationId, isReturn, sessionState, token]);

  const screen = cardOnFileScreen({ isReturn, token, sessionState, probe });

  if (screen.kind === 'wait') return null;

  if (screen.kind === 'expired') {
    return (
      <div className="min-h-screen grid place-items-center bg-soft px-4">
        <div className="max-w-md w-full bg-white border border-border rounded-2xl p-8 text-center">
          <h1 className="text-xl font-semibold">{screen.title}</h1>
          <p className="text-sm text-muted-foreground mt-2">{screen.copy}</p>
        </div>
      </div>
    );
  }

  if (screen.kind === 'saved') {
    return (
      <div className="min-h-screen grid place-items-center bg-soft px-4">
        <div className="max-w-md w-full bg-white border border-border rounded-2xl p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center mx-auto mb-4 text-2xl">✓</div>
          <h1 className="text-xl font-semibold">Card Saved</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Your card is securely on file. Our team will be in touch to finalize your reservation. You won't be charged now.
          </p>
        </div>
      </div>
    );
  }

  if (screen.kind === 'setup-error') {
    return (
      <div className="min-h-screen grid place-items-center bg-soft px-4">
        <div className="max-w-md w-full bg-white border border-border rounded-2xl p-8 text-center">
          <p className="text-sm text-muted-foreground">{screen.message}</p>
        </div>
      </div>
    );
  }

  if (screen.kind === 'form') {
    const clientSecret = screen.clientSecret;
    return (
      <div className="min-h-screen bg-soft px-4 py-10">
        <div className="max-w-xl mx-auto">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-semibold">Save Your Card on File</h1>
            <p className="text-sm text-muted-foreground mt-2">
              Real Rentals will securely store your card via Stripe. No charge will be made now.
            </p>
          </div>
          <div className="bg-white rounded-2xl border border-border overflow-hidden">
            <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret: async () => clientSecret }}>
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
