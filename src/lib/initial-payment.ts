// What the signed agreement already states is due up front. Client-safe.
// The reservation fee is applied to the first week in the wording; it is not
// added again here. Deposit is included only when the printed deposit is > 0.

export type InitialPaymentOffer = {
  rent: number;
  deposit: number;
  total: number;
  label: string;
  /** Checkout line name for the rent amount; "First week's rent" when absent. */
  rentLineName?: string;
};

function dollars(printed: unknown): number | null {
  const n = Number(String(printed ?? "").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

/**
 * v1.14 (Insurance Included) agreements print a Balance Due. Under that
 * wording only the Reservation Fee is due at signing (Section 4); the balance
 * is due before pickup. No fee entered means nothing is charged at signing.
 */
function reservationFeeOffer(prepJson: unknown): InitialPaymentOffer | null {
  let fee = 0;
  try {
    const prep = JSON.parse(String(prepJson ?? "")) as {
      reservation?: { mode?: string; amount?: number | null };
    };
    if (prep.reservation?.mode === "required")
      fee = Math.round(Number(prep.reservation.amount ?? 0) * 100) / 100;
  } catch {
    return null;
  }
  if (!Number.isFinite(fee) || fee < 0.5) return null;
  return {
    rent: fee,
    deposit: 0,
    total: fee,
    label: "your Reservation Fee, applied in full to your first payment",
    rentLineName: "Reservation Fee (applied to first payment)",
  };
}

export function initialPaymentFromMerge(merge: {
  weekly_rate?: string;
  deposit_amount?: string;
  balance_due?: string;
  _prep?: string;
}): InitialPaymentOffer | null {
  if (String(merge.balance_due ?? "").trim()) return reservationFeeOffer(merge._prep);
  const rent = dollars(merge.weekly_rate);
  const deposit = dollars(merge.deposit_amount);
  if (rent == null || rent <= 0 || deposit == null) return null;
  const total = Math.round((rent + deposit) * 100) / 100;
  if (total < 0.5) return null;
  return {
    rent,
    deposit,
    total,
    label:
      deposit > 0 ? "the first week's rent plus the security deposit" : "the first week's rent",
  };
}
