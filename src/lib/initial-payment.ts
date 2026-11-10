// What the signed agreement already states is due up front. Client-safe.
// The reservation fee is applied to the first week in the wording; it is not
// added again here. Deposit is included only when the printed deposit is > 0.

export type InitialPaymentOffer = {
  rent: number;
  deposit: number;
  total: number;
  label: string;
};

function dollars(printed: unknown): number | null {
  const n = Number(String(printed ?? "").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

export function initialPaymentFromMerge(merge: {
  weekly_rate?: string;
  deposit_amount?: string;
}): InitialPaymentOffer | null {
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
