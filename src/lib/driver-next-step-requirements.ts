import { NEXT_STEP_REQUIREMENT_KEYS, type ActivationRequirement } from "./activation-readiness";
import { reservationFeeRefundedDetail } from "@/lib/reservation-fee-refund";
import { unpaidReservationFeeDetail } from "@/lib/reservations";

function reservationPaymentDetail(
  status: string | null | undefined,
  fee?: { amount?: number | null; dueDate?: string | null } | null,
): string {
  const raw = String(status ?? "");
  if (raw === "paid") return "Paid";
  // Paid and credited to the first week's rent (rentals.reservation_deposit_status).
  if (raw === "applied") return "Paid · Applied To First Week";
  if (raw === "pending") return unpaidReservationFeeDetail(fee?.amount, fee?.dueDate);
  if (raw === "not_required") return "Not Required";
  if (raw === "waived") return "Waived";
  if (raw === "refunded" || raw.startsWith("refunded:")) {
    return reservationFeeRefundedDetail(raw.includes(":") ? raw.slice(raw.indexOf(":") + 1) : null);
  }
  return "Not Recorded";
}

/** Profile presentation only; never substitutes for server activation readiness. */
export function driverNextStepRequirements(
  requirements: readonly ActivationRequirement[],
  reservationPaymentStatus: string | null | undefined,
  /** The Terms Confirmed row (staff-terms.ts termsConfirmedRequirement). Omitted = not shown. */
  termsConfirmed?: ActivationRequirement | null,
  /** Amount and due date from the same unpaid Reservation Fee row the Reserved tab lists. */
  reservationFee?: { amount?: number | null; dueDate?: string | null } | null,
): ActivationRequirement[] {
  const reservationPayment: ActivationRequirement = {
    key: "reservation_paid",
    label: "Reservation Paid",
    met: reservationPaymentStatus === "paid" || reservationPaymentStatus === "applied" ? true : reservationPaymentStatus === "pending" ? false : null,
    enforcement: "advisory",
    detail: reservationPaymentDetail(reservationPaymentStatus, reservationFee),
  };
  return NEXT_STEP_REQUIREMENT_KEYS.flatMap((key) => {
    if (key === "reservation_paid") return [reservationPayment];
    if (key === "terms_confirmed") return termsConfirmed ? [termsConfirmed] : [];
    const requirement = requirements.find((item) => item.key === key);
    if (!requirement) return [];
    return [{
      ...requirement,
      label: key === "insurance_verified" ? "Insurance Setup"
        : key === "inspection" ? "Pickup Inspection" : requirement.label,
    }];
  });
}
