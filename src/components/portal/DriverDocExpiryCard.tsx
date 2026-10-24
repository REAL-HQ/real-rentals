import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { DRIVER_DOC_EXPIRY_CARD_ENABLED } from "@/lib/driver-doc-expiry";
import { getDriverDocExpiry } from "@/lib/driver-doc-expiry.functions";

/**
 * License and insurance expiry for the signed-in driver. Mounted only when
 * the portal flag is exactly true, and it does not fetch while this constant
 * is false. Upload Or Replace opens the documents tab, which already holds
 * the vault's replace flow.
 */
export function DriverDocExpiryCard({ onOpenDocuments }: { onOpenDocuments: () => void }) {
  const load = useServerFn(getDriverDocExpiry);
  const { data, isLoading, error } = useQuery({
    queryKey: ["driver-doc-expiry"],
    queryFn: () => load(),
    enabled: DRIVER_DOC_EXPIRY_CARD_ENABLED === true,
  });
  if (DRIVER_DOC_EXPIRY_CARD_ENABLED !== true) return null;

  return (
    <section className="rounded-2xl border border-border bg-white p-5">
      <h2 className="text-base font-semibold">My Documents</h2>
      <p className="mt-1 text-sm text-muted-foreground">License and insurance expiry, Eastern Time.</p>
      {isLoading ? <p className="mt-3 text-sm text-muted-foreground">Loading…</p> : null}
      {error ? (
        <p className="mt-3 text-sm text-real-red">{error instanceof Error ? error.message : "Could not load documents."}</p>
      ) : null}
      {data ? (
        <ul className="mt-3 divide-y divide-border">
          {data.items.map((item) => (
            <li key={item.key} className="flex min-h-11 items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium">{item.label}</div>
                <div className="text-sm text-muted-foreground">{item.displayDate ?? item.stateLabel}</div>
              </div>
              {item.displayDate ? <div className="text-sm font-medium">{item.stateLabel}</div> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        onClick={onOpenDocuments}
        className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-real-red px-4 text-sm font-medium text-white"
      >
        Upload Or Replace
      </button>
    </section>
  );
}
