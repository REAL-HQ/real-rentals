import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';
import { getStripe, getStripeEnvironment } from '@/lib/stripe';
import { createCardOnFileSession } from '@/lib/payments.functions';
import { useResumeToken } from '@/lib/resume-token';
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

function CardOnFilePage() {
  const { applicationId } = Route.useParams();
  const { t, status: returnStatus } = Route.useSearch();
  // Same credential as /thank-you: take `t` out of the address bar and keep it for this tab.
  const token = useResumeToken(t);
  const [status, setStatus] = useState<'idle' | 'error' | 'done'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<'unknown' | 'yes' | 'no'>('unknown');

  const isReturn = returnStatus === 'success';

  useEffect(() => {
    if (isReturn) setStatus('done');
  }, [isReturn]);

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

  const fetchClientSecret = async (): Promise<string> => {
    const returnUrl = `${window.location.origin}/card/${applicationId}?status=success`;
    const result = await createCardOnFileSession({
      data: {
        applicationId,
        returnUrl,
        environment: getStripeEnvironment(),
        ...(token ? { token } : {}),
      },
    });
    if ('error' in result) {
      setErrorMsg(result.error);
      setStatus('error');
      throw new Error(result.error);
    }
    return result.clientSecret;
  };

  const waiting = !isReturn && status !== 'error' && (token === undefined || (!token && sessionState === 'unknown'));
  const needsLink = !isReturn && status !== 'error' && token === null && sessionState === 'no';

  if (waiting) return null;

  if (needsLink) {
    return (
      <div className="min-h-screen grid place-items-center bg-soft px-4">
        <div className="max-w-md w-full bg-white border border-border rounded-2xl p-8 text-center">
          <h1 className="text-xl font-semibold">Link Expired</h1>
          <p className="text-sm text-muted-foreground mt-2">
            This link is no longer valid. Ask us for a new one and we'll send it over.
          </p>
        </div>
      </div>
    );
  }

  if (status === 'done') {
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

  return (
    <div className="min-h-screen bg-soft px-4 py-10">
      <div className="max-w-xl mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-semibold">Save Your Card on File</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Real Rentals will securely store your card via Stripe. No charge will be made now.
          </p>
        </div>
        {status === 'error' && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm p-3">
            {errorMsg ?? 'Something went wrong.'}
          </div>
        )}
        <div className="bg-white rounded-2xl border border-border overflow-hidden">
          <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret }}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>
      </div>
    </div>
  );
}