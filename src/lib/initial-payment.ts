// The amount the signed agreement already states is due up front:
// the printed weekly rate, plus the printed security deposit when it is
// more than zero. The reservation fee is a separate line and is not added.

export type InitialPaymentAmount = {
  total: number;
  rent: number;
  deposit: number;
  /** Plain phrase for the email, e.g. "the first week's rent plus the security deposit". */
  label: string;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function money(raw: string | undefined): number | null {
  if (raw == null || !String(raw).trim()) return null;
  const n = Number(String(raw).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return round2(n);
}

/** Stripe's card minimum is $0.50. Below that, or with no weekly rate, there is no link. */
export function initialPaymentFromMerge(merge: Record<string, string | undefined | null>): InitialPaymentAmount | null {
  const rent = money(merge.weekly_rate ?? undefined);
  const deposit = money(merge.deposit_amount ?? undefined);
  if (rent == null || !(rent > 0)) return null;
  const dep = deposit != null && deposit > 0 ? deposit : 0;
  const total = round2(rent + dep);
  if (total < 0.5) return null;
  return {
    total,
    rent,
    deposit: dep,
    label: dep > 0 ? "the first week's rent plus the security deposit" : "the first week's rent",
  };
}
