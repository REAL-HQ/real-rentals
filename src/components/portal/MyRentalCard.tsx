import { Phone } from "lucide-react";
import { useBusinessPhone } from "@/lib/company.functions";
import { fmtDate } from "@/lib/date-format";
import type { PortalMyRentalResult } from "@/lib/portal-my-rental";

function money(amount: number) {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * Read-only. The phone is the company number from useBusinessPhone().
 * There is no payment button and no write.
 */
export function MyRentalCard({ rental }: { rental: PortalMyRentalResult }) {
  const businessPhone = useBusinessPhone();
  const vehicleName = [rental.year, rental.make, rental.model].filter((part) => part != null && part !== "").join(" ");

  return (
    <section className="rounded-2xl border border-border bg-white p-5">
      <h2 className="font-semibold">My Rental</h2>
      {vehicleName ? <p className="mt-2 text-lg font-semibold">{vehicleName}</p> : null}
      <dl className="mt-3 space-y-2 text-sm">
        {rental.startDate ? (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">Started</dt>
            <dd>{fmtDate(rental.startDate)}</dd>
          </div>
        ) : null}
        {rental.weeklyAmount != null ? (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">Weekly Amount</dt>
            <dd className="font-medium">{money(rental.weeklyAmount)}</dd>
          </div>
        ) : null}
        {rental.nextPaymentDue ? (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">Next Payment Due</dt>
            <dd>{fmtDate(rental.nextPaymentDue)}</dd>
          </div>
        ) : null}
      </dl>
      <a
        href={businessPhone.tel}
        className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-real-red"
      >
        <Phone className="w-4 h-4" />
        {businessPhone.display}
      </a>
    </section>
  );
}
