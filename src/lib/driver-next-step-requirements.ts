import { NEXT_STEP_REQUIREMENT_KEYS, type ActivationRequirement } from "./activation-readiness";

/** Profile presentation only; never substitutes for server activation readiness. */
export function driverNextStepRequirements(
  requirements: readonly ActivationRequirement[],
  reservationPaymentStatus: string | null | undefined,
): ActivationRequirement[] {
  const reservationPayment: ActivationRequirement = {
    key: "reservation_paid",
    label: "Reservation Paid",
    met: reservationPaymentStatus === "paid" ? true : reservationPaymentStatus === "pending" ? false : null,
    enforcement: "advisory",
    detail: reservationPaymentStatus === "paid" ? "Paid"
      : reservationPaymentStatus === "pending" ? "Payment Pending"
      : reservationPaymentStatus === "not_required" ? "Not Required"
      : reservationPaymentStatus === "waived" ? "Waived"
      : reservationPaymentStatus === "refunded" ? "Refunded"
      : "Not Recorded",
  };
  return NEXT_STEP_REQUIREMENT_KEYS.flatMap((key) => {
    if (key === "reservation_paid") return [reservationPayment];
    const requirement = requirements.find((item) => item.key === key);
    if (!requirement) return [];
    return [{
      ...requirement,
      label: key === "insurance_verified" ? "Insurance Setup"
        : key === "inspection" ? "Inspection Setup" : requirement.label,
    }];
  });
}