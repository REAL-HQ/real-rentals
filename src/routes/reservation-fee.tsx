import { createFileRoute } from "@tanstack/react-router";
import { Logo } from "@/components/site/Logo";
import { PaymentReceivedFallback } from "@/components/reservation/PaymentReceivedDetails";
import { PaymentReceivedLive } from "@/components/reservation/PaymentReceivedLive";
import { PaymentNotCompletedLive } from "@/components/reservation/PaymentNotCompletedLive";
import { isCheckoutSessionId } from "@/lib/payment-received";

/**
 * Where Stripe Checkout returns a renter after the $50 Reservation Fee
 * (reservation-fee.server.ts success_url / cancel_url). This file reads
 * nothing itself.
 *
 *   status=paid&session_id=cs_…  PaymentReceivedLive (receipt, car, pickup
 *                                slot picker). Old links, or a missing,
 *                                invalid or unpaid session, get
 *                                PaymentReceivedFallback: the same look and
 *                                the truthful next step (we'll text them to
 *                                choose a pickup time — no email carries a
 *                                pickup scheduling link).
 *   status=canceled(&session_id) PaymentNotCompletedLive: the conversion
 *                                page. With a session id (sessions created
 *                                after this shipped) it shows the signed
 *                                car, live availability, and a button that
 *                                restarts the same $50 Checkout. Without
 *                                one, live numbers and the car block are
 *                                hidden and the renter is pointed to their
 *                                email link.
 *
 * The payment itself is recorded on the lead by the payments webhook
 * (metadata.paymentIds), which also holds the car.
 */
export const Route = createFileRoute("/reservation-fee")({
  validateSearch: (s: Record<string, unknown>): { status?: "paid" | "canceled"; session_id?: string } => ({
    status: s.status === "paid" ? "paid" : s.status === "canceled" ? "canceled" : undefined,
    session_id: isCheckoutSessionId(s.session_id) ? s.session_id : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Reservation Fee — REAL RENTALS" },
      { name: "robots", content: "noindex" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap",
      },
    ],
  }),
  component: ReservationFeeReturn,
});

function ReservationFeeReturn() {
  const { status, session_id } = Route.useSearch();
  const paid = status === "paid";
  if (!paid) return <PaymentNotCompletedLive sessionId={session_id} />;

  const staticCard = <PaymentReceivedFallback />;
  return (
    <div className="min-h-screen bg-[#FAFAFB]">
      <header className="border-b border-[#EDEDF0] bg-white">
        <div className="max-w-3xl mx-auto px-5 h-16 flex items-center">
          <Logo />
        </div>
      </header>
      <main className={`${session_id ? "max-w-[720px]" : "max-w-xl"} mx-auto px-5 py-14`}>
        {session_id ? <PaymentReceivedLive sessionId={session_id} fallback={staticCard} /> : staticCard}
      </main>
    </div>
  );
}
