/**
 * Loads Payment Not Completed data for a Checkout Session id and renders the
 * conversion page. Missing, invalid or unusable sessions still show the page,
 * with live counts and photos hidden. A paid fee redirects to Payment Received.
 */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getPaymentNotCompleted, restartPaymentNotCompletedCheckout } from "@/lib/payment-not-completed.functions";
import { EMPTY_PNC_VIEW, paidReturnPath, type PaymentNotCompletedView } from "@/lib/payment-not-completed";
import { PaymentNotCompletedPage } from "@/components/reservation/PaymentNotCompletedPage";

export function PaymentNotCompletedLive({ sessionId }: { sessionId?: string }) {
  const load = useServerFn(getPaymentNotCompleted);
  const restart = useServerFn(restartPaymentNotCompletedCheckout);
  const [view, setView] = useState<PaymentNotCompletedView | null>(sessionId ? null : EMPTY_PNC_VIEW);
  const [reserving, setReserving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let live = true;
    load({ data: { sessionId } })
      .then((v) => { if (live) setView(v); })
      .catch(() => { if (live) setView({ ok: false, reason: "unavailable" }); });
    return () => { live = false; };
  }, [sessionId]);

  useEffect(() => {
    if (view && view.ok && view.alreadyPaid) {
      window.location.replace(paidReturnPath(view.sessionId));
    }
  }, [view]);

  async function onReserve() {
    if (!sessionId || reserving) return;
    setReserving(true);
    setError(null);
    try {
      const r = await restart({ data: { sessionId } });
      if (r.ok && r.alreadyPaid) {
        window.location.replace(paidReturnPath(r.sessionId));
        return;
      }
      if (r.ok && !r.alreadyPaid && r.url) {
        window.location.assign(r.url);
        return;
      }
      setError(!r.ok ? r.message : "We couldn't open checkout. Please use the Pay Reservation Fee button in your Agreement Signed email, or call us.");
    } catch {
      setError("We couldn't open checkout. Please use the Pay Reservation Fee button in your Agreement Signed email, or call us.");
    } finally {
      setReserving(false);
    }
  }

  if (view && view.ok && view.alreadyPaid) {
    return (
      <div data-testid="payment-not-completed-redirecting" className="min-h-screen bg-[#FAFAFB] flex items-center justify-center px-5">
        <p className="text-sm text-[#55555E]">Your Reservation Fee Is Paid. Taking You To Your Receipt…</p>
      </div>
    );
  }

  const canRestart = Boolean(sessionId);
  return (
    <PaymentNotCompletedPage
      view={view}
      onReserve={canRestart ? onReserve : undefined}
      reserving={reserving}
      error={error}
    />
  );
}
