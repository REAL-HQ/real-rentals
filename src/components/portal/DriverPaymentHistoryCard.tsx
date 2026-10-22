import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { DRIVER_PAYMENT_HISTORY_ENABLED } from "@/lib/driver-payment-history";
import { getDriverPaymentHistory } from "@/lib/driver-payment-history.functions";

/**
 * Past payments and the upcoming amount due for the signed-in driver.
 * Mounted only when the portal flag is exactly true.
 */
export function DriverPaymentHistoryCard() {
  const load = useServerFn(getDriverPaymentHistory);
  const { data, isLoading, error } = useQuery({
    queryKey: ["driver-payment-history"],
    queryFn: () => load(),
    enabled: DRIVER_PAYMENT_HISTORY_ENABLED === true,
  });
  if (DRIVER_PAYMENT_HISTORY_ENABLED !== true) return null;

  return (
    <section className="rounded-2xl border border-border bg-white p-5">
      <h2 className="text-base font-semibold">Payment History</h2>
      <div className="mt-4">
        <div className="text-sm font-medium">Upcoming Amount Due</div>
        {data?.upcoming ? (
          <div className="mt-2 flex min-h-11 flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-lg font-semibold">{data.upcoming.amountLabel}</div>
              <div className="text-sm text-muted-foreground">{data.upcoming.dateLabel}</div>
            </div>
            <div className="text-sm text-muted-foreground">
              {data.upcoming.methodLabel} · {data.upcoming.statusLabel}
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Nothing Due</p>
        )}
      </div>
      <div className="mt-5 text-sm font-medium">Past Payments</div>
      {isLoading ? <p className="mt-3 text-sm text-muted-foreground">Loading…</p> : null}
      {error ? <p className="mt-3 text-sm text-real-red">Could not load payments.</p> : null}
      {data && data.past.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No Payments Yet</p> : null}
      {data && data.past.length > 0 ? (
        <ul className="mt-2 divide-y divide-border">
          {data.past.map((item) => (
            <li key={item.id} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium">{item.dateLabel}</div>
                <div className="text-sm text-muted-foreground">
                  {item.methodLabel} · {item.statusLabel}
                </div>
              </div>
              <div className="text-sm font-medium">{item.amountLabel}</div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
