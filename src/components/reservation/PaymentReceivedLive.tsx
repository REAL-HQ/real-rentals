/**
 * Loads the Payment Received data for a Checkout Session id and renders the
 * rich page. Any refusal (old link, bad or unpaid session, Stripe down) shows
 * `fallback`: the static thank-you in src/routes/reservation-fee.tsx.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { bookPaymentReceivedPickup, getPaymentReceived } from "@/lib/payment-received.functions";
import type { PaymentReceivedView } from "@/lib/payment-received";
import { PaymentReceivedDetails } from "@/components/reservation/PaymentReceivedDetails";

export function PaymentReceivedLive({ sessionId, fallback }: { sessionId: string; fallback: ReactNode }) {
  const load = useServerFn(getPaymentReceived);
  const book = useServerFn(bookPaymentReceivedPickup);
  const [view, setView] = useState<PaymentReceivedView | null>(null);

  useEffect(() => {
    let live = true;
    load({ data: { sessionId } })
      .then((v) => { if (live) setView(v); })
      .catch(() => { if (live) setView({ ok: false, reason: "unavailable" }); });
    return () => { live = false; };
  }, [sessionId]);

  if (!view) {
    return (
      <div data-testid="payment-received-loading" className="rounded-xl border border-[#EDEDF0] bg-white p-8 text-center">
        <p className="text-sm text-[#55555E]">Loading Your Receipt…</p>
      </div>
    );
  }
  if (!view.ok) return <>{fallback}</>;
  return <PaymentReceivedDetails view={view} onBook={(startAt) => book({ data: { sessionId, startAt } })} />;
}
