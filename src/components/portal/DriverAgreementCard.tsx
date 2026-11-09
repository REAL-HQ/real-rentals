import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { DRIVER_AGREEMENT_VIEW_ENABLED, STAFF_PDF_LABEL } from "@/lib/driver-agreement-view";
import { getDriverAgreementPdf, getDriverAgreements } from "@/lib/driver-agreement-view.functions";

/**
 * The signed-in driver's agreements. Mounted only when the portal flag is
 * exactly true, and it does not fetch while this constant is false.
 * View PDF asks for a link on the driver's own session. When storage RLS
 * refuses that link, the card shows "Available from staff".
 */
export function DriverAgreementCard() {
  const load = useServerFn(getDriverAgreements);
  const loadPdf = useServerFn(getDriverAgreementPdf);
  const { data, isLoading, error } = useQuery({
    queryKey: ["driver-agreement-view"],
    queryFn: () => load(),
    enabled: DRIVER_AGREEMENT_VIEW_ENABLED === true,
  });
  const [unavailable, setUnavailable] = useState<Record<string, string>>({});
  const [opening, setOpening] = useState<string | null>(null);
  if (DRIVER_AGREEMENT_VIEW_ENABLED !== true) return null;

  async function openPdf(agreementId: string) {
    setOpening(agreementId);
    try {
      const result = await loadPdf({ data: { agreementId } });
      if (result.url) {
        window.open(result.url, "_blank", "noopener,noreferrer");
        return;
      }
      setUnavailable((prev) => ({ ...prev, [agreementId]: result.availability }));
    } catch {
      setUnavailable((prev) => ({ ...prev, [agreementId]: STAFF_PDF_LABEL }));
    } finally {
      setOpening(null);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-white p-5">
      <h2 className="text-base font-semibold">My Agreement</h2>
      <p className="mt-1 text-sm text-muted-foreground">Version, status, and the date you signed, Eastern Time.</p>
      {isLoading ? <p className="mt-3 text-sm text-muted-foreground">Loading…</p> : null}
      {error ? (
        <p className="mt-3 text-sm text-real-red">{error instanceof Error ? error.message : "Could not load agreements."}</p>
      ) : null}
      {data && data.agreements.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No Agreement On File</p> : null}
      {data?.agreements.map((item) => (
        <article key={item.id} className="mt-4 border-t border-border pt-4">
          <h3 className="text-sm font-medium">{item.title}</h3>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex min-h-11 items-center justify-between gap-3">
              <dt className="text-muted-foreground">Version</dt>
              <dd>{item.versionLabel}</dd>
            </div>
            <div className="flex min-h-11 items-center justify-between gap-3">
              <dt className="text-muted-foreground">Status</dt>
              <dd>{item.statusLabel}</dd>
            </div>
            <div className="flex min-h-11 items-center justify-between gap-3">
              <dt className="text-muted-foreground">Signed</dt>
              <dd>{item.signedLabel}</dd>
            </div>
          </dl>
          {unavailable[item.id] ? (
            <p className="mt-3 text-sm text-muted-foreground">{unavailable[item.id]}</p>
          ) : item.canRequestPdf ? (
            <button
              type="button"
              onClick={() => void openPdf(item.id)}
              disabled={opening === item.id}
              className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-real-red px-4 text-sm font-medium text-white disabled:opacity-60"
            >
              View PDF
            </button>
          ) : null}
        </article>
      ))}
    </section>
  );
}
