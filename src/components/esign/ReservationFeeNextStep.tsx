import { useEffect, useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { RESERVATION_FEE_REDIRECT_SECONDS, type ReservationFeeSigningStep } from "@/lib/reservation-fee";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * Shown right after a successful signature. "pay": the applicant is sent to
 * the same $50 Stripe Checkout the Agreement Signed email links to, after a
 * short countdown; the button stays in case the redirect is blocked, they tap
 * "Stay On This Page", or they come back from Checkout. The email link is the
 * backup.
 */
export function ReservationFeeNextStep({
  step,
  autoRedirect = true,
  redirect = (url: string) => window.location.assign(url),
}: {
  step: ReservationFeeSigningStep;
  autoRedirect?: boolean;
  redirect?: (url: string) => void;
}) {
  const payUrl = step.state === "pay" ? step.url : null;
  const [seconds, setSeconds] = useState<number | null>(payUrl && autoRedirect ? RESERVATION_FEE_REDIRECT_SECONDS : null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (seconds === null || !payUrl) return;
    if (seconds <= 0) {
      setLeaving(true);
      redirect(payUrl);
      return;
    }
    const t = setTimeout(() => setSeconds((s) => (s === null ? null : s - 1)), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds, payUrl]);

  if (step.state === "paid") {
    return (
      <p className="mt-4 text-sm text-[#28282E]" data-testid="reservation-fee-paid">
        Your {usd(step.amount)} Reservation Fee is paid and applied in full to your first week.
      </p>
    );
  }
  if (step.state === "processing") {
    return (
      <p className="mt-4 text-sm text-[#28282E]" data-testid="reservation-fee-processing">
        Your {usd(step.amount)} Reservation Fee is processing. It is applied in full to your first week, and your car is held as soon as it goes through.
      </p>
    );
  }
  return (
    <div className="mt-5 rounded-xl border-2 border-[#D03020] bg-[#FFF6F5] p-5 text-left" data-testid="reservation-fee-pay">
      <h2 className="text-base font-semibold text-[#111114]">One Last Step: Reserve Your Car</h2>
      <p className="mt-1.5 text-sm text-[#55555E]">
        Pay your {usd(step.amount)} Reservation Fee to hold your car. It is applied in full to your first week, and the card you use is saved on file for your rental balance.
      </p>
      <a
        href={step.url}
        onClick={() => {
          setSeconds(null);
          setLeaving(true);
        }}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#D03020] px-5 py-3.5 text-[15px] font-semibold text-white active:scale-[.98]"
      >
        {leaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
        Pay {usd(step.amount)} Reservation Fee
      </a>
      {seconds !== null && seconds > 0 ? (
        <p className="mt-3 text-center text-[13px] text-[#55555E]" aria-live="polite">
          Taking you to secure checkout in {seconds}…{" "}
          <button type="button" className="font-medium text-[#D03020] underline" onClick={() => setSeconds(null)}>
            Stay On This Page
          </button>
        </p>
      ) : null}
      <p className="mt-3 text-center text-[12px] text-[#55555E]">
        We also emailed you this payment link. It works for 23 hours.
      </p>
    </div>
  );
}
