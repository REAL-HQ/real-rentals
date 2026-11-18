import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { Logo } from "@/components/site/Logo";
import { PhoneLink } from "@/components/site/PhoneLink";
import { PaymentReceivedLive } from "@/components/reservation/PaymentReceivedLive";
import { isCheckoutSessionId } from "@/lib/payment-received";

/**
 * Where Stripe Checkout returns a renter after the $50 Reservation Fee
 * (reservation-fee.server.ts success_url / cancel_url). This file reads
 * nothing itself. With a Checkout Session id (sessions created after the
 * Payment Received page shipped), PaymentReceivedLive shows the receipt, the
 * car and the pickup slot picker (payment-received.server.ts). Old links, or
 * a missing, invalid or unpaid session, get the static thank-you below. The
 * payment itself is recorded on the lead by the payments webhook
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
  }),
  component: ReservationFeeReturn,
});

function ReservationFeeReturn() {
  const { status, session_id } = Route.useSearch();
  const paid = status === "paid";
  const staticCard = <StaticReturnCard paid={paid} />;
  return (
    <div className="min-h-screen bg-[#FAFAFB]">
      <header className="border-b border-[#EDEDF0] bg-white">
        <div className="max-w-3xl mx-auto px-5 h-16 flex items-center">
          <Logo />
        </div>
      </header>
      <main className={`${paid && session_id ? "max-w-[720px]" : "max-w-xl"} mx-auto px-5 py-14`}>
        {paid && session_id ? <PaymentReceivedLive sessionId={session_id} fallback={staticCard} /> : staticCard}
      </main>
    </div>
  );
}

function StaticReturnCard({ paid }: { paid: boolean }) {
  return (
    <div className="rounded-xl border border-[#EDEDF0] bg-white p-8 text-center" data-testid={paid ? "reservation-fee-return-paid" : "reservation-fee-return-canceled"}>
      {paid ? (
        <>
          <CheckCircle2 className="w-10 h-10 text-[#4CD964] mx-auto" />
          <h1 className="mt-3 text-xl font-semibold text-[#111114]">Payment Received</h1>
          <p className="mt-2 text-sm text-[#55555E]">
            Thank you. Your Reservation Fee is applied in full to your first week, and your card is saved on file for your rental balance.
          </p>
          <p className="mt-2 text-sm text-[#55555E]">
            Your car is held as soon as the payment confirms, usually within a minute. Our team will reach out to schedule your pickup.
          </p>
        </>
      ) : (
        <>
          <CircleAlert className="w-10 h-10 text-[#D03020] mx-auto" />
          <h1 className="mt-3 text-xl font-semibold text-[#111114]">Payment Not Completed</h1>
          <p className="mt-2 text-sm text-[#55555E]">
            No payment was taken. Your agreement is signed, but your car is not held until the Reservation Fee is paid.
          </p>
          <p className="mt-2 text-sm text-[#55555E]">
            To finish, use the Pay Reservation Fee button in your Agreement Signed email. The link works for 23 hours after signing.
          </p>
        </>
      )}
      <p className="mt-5 text-sm text-[#55555E]">
        Questions? Call{" "}
        <PhoneLink placement="contact" className="text-[#D03020] font-medium" />{" "}
        or email{" "}
        <a className="text-[#D03020] font-medium" href="mailto:team@drivereal.com">team@drivereal.com</a>.
      </p>
    </div>
  );
}
