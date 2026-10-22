import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getUnmatchedStripePayments } from "@/lib/stripe-unmatched.functions";
import { linkUnmatchedInvoice } from "@/lib/stripe-unmatched-link.functions";
import { STRIPE_UNMATCHED_LINK_ENABLED } from "@/lib/stripe-unmatched-link-flag";
import { formatCents } from "@/lib/stripe-unmatched";
import type { UnmatchedResponse, UnmatchedRow } from "@/lib/stripe-unmatched.functions";

export function UnmatchedStripePayments() {
  const load = useServerFn(getUnmatchedStripePayments);
  const link = useServerFn(linkUnmatchedInvoice);
  const [report, setReport] = useState<UnmatchedResponse | null>(null);
  const [linking, setLinking] = useState<UnmatchedRow | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    load({ data: {} })
      .then((result) => {
        if (live) setReport(result);
      })
      .catch(() => {
        if (live) setReport({ status: "unavailable", reason: "Unmatched Stripe Payments Could Not Be Loaded", rows: [], truncated: false });
      });
    return () => {
      live = false;
    };
  }, [load]);
  if (!report || report.status === "disabled") return null;
  return (
    <section aria-label="Unmatched Stripe Payments" className="mb-6 rounded-md border border-[#26262B] bg-[#141416] p-4 text-white">
      <h2 className="text-base font-semibold">Unmatched Stripe Payments</h2>
      <p className="mt-1 text-xs text-white/70">Live paid invoices from the last 60 days whose subscription and customer are not on a rental or an application.</p>
      {note && <p role="status" className="mt-3 text-xs text-white/70">{note}</p>}
      {report.status === "unavailable" && <p role="alert" className="mt-3 text-xs text-white/70">{report.reason}</p>}
      {report.status === "ready" && report.truncated && (
        <p role="status" className="mt-3 text-xs text-white/70">This Read Is Truncated</p>
      )}
      {report.status === "ready" && !report.truncated && report.rows.length === 0 && (
        <p className="mt-3 text-xs text-white/70">No Unmatched Invoices</p>
      )}
      {report.status === "ready" && report.rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="text-white/70">
              <tr>
                {["Invoice", "Subscription", "Customer", "Paid On", "Amount", ...(STRIPE_UNMATCHED_LINK_ENABLED ? ["Action"] : [])].map((heading) => (
                  <th key={heading} className="py-2 pr-3 font-medium whitespace-nowrap">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.invoiceId} className="border-t border-[#26262B]">
                  <td className="py-3 pr-3 whitespace-nowrap">{row.invoiceId}</td>
                  <td className="py-3 pr-3 whitespace-nowrap">{row.subscriptionId || "—"}</td>
                  <td className="py-3 pr-3 whitespace-nowrap">{row.customerSuffix || "—"}</td>
                  <td className="py-3 pr-3 whitespace-nowrap">{row.paidOn || "Unknown"}</td>
                  <td className="py-3 whitespace-nowrap tabular-nums">{formatCents(row.amountCents)}</td>
                  {STRIPE_UNMATCHED_LINK_ENABLED && (
                    <td className="py-3 whitespace-nowrap">
                      <button
                        type="button"
                        className="rounded-md border border-white/20 px-2 py-1 font-medium hover:border-white"
                        onClick={() => { setNote(null); setLinking(row); }}
                      >
                        Link to Rental
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {STRIPE_UNMATCHED_LINK_ENABLED && linking && (
        <LinkToRental
          invoiceId={linking.invoiceId}
          link={link}
          onClose={() => setLinking(null)}
          onLinked={() => {
            setReport((current) => current && current.status === "ready"
              ? { ...current, rows: current.rows.filter((row) => row.invoiceId !== linking.invoiceId) }
              : current);
            setLinking(null);
            setNote("Recorded. A recorded invoice can remain on this list until the subscription or customer is on a rental or an application.");
          }}
        />
      )}
    </section>
  );
}

function LinkToRental({
  invoiceId,
  link,
  onClose,
  onLinked,
}: {
  invoiceId: string;
  link: (opts: { data: { invoiceId: string; rentalId: string } }) => Promise<{ status: string; reason?: string }>;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [choices, setChoices] = useState<Array<{ id: string; label: string }>>([]);
  const [rentalId, setRentalId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const rentals = await supabase.from("rentals").select("id, status, start_date, application_id, vehicle_id").order("start_date", { ascending: false }).limit(200);
      if (!live || rentals.error || !rentals.data) return;
      const rows = rentals.data as Array<{ id: string; status: string | null; application_id: string | null; vehicle_id: string | null }>;
      const appIds = [...new Set(rows.map((row) => row.application_id).filter((id): id is string => !!id))];
      const vehicleIds = [...new Set(rows.map((row) => row.vehicle_id).filter((id): id is string => !!id))];
      const [apps, vehicles] = await Promise.all([
        appIds.length ? supabase.from("applications").select("id, full_name").in("id", appIds) : Promise.resolve({ data: [] }),
        vehicleIds.length ? supabase.from("vehicles").select("id, year, make, model").in("id", vehicleIds) : Promise.resolve({ data: [] }),
      ]);
      if (!live) return;
      const names = new Map((apps.data ?? []).map((row: { id: string; full_name: string | null }) => [row.id, row.full_name || "Driver"]));
      const cars = new Map((vehicles.data ?? []).map((row: { id: string; year: number | null; make: string | null; model: string | null }) => [row.id, [row.year, row.make, row.model].filter(Boolean).join(" ") || "Vehicle"]));
      setChoices(rows.map((row) => ({
        id: row.id,
        label: [names.get(row.application_id ?? "") || "Driver", cars.get(row.vehicle_id ?? "") || "Vehicle", titleWord(row.status)].filter(Boolean).join(" · "),
      })));
    })().catch(() => {
      if (live) setError("Rentals could not be loaded.");
    });
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="mt-4 rounded-md border border-[#26262B] p-3" role="dialog" aria-label="Link to Rental">
      <h3 className="text-sm font-semibold">Link to Rental</h3>
      <p className="mt-1 text-xs text-white/70">Invoice {invoiceId}. The amount and paid date come from Stripe.</p>
      {choices.length === 0 && !error && <p className="mt-3 text-xs text-white/70">No Rentals To Link</p>}
      {choices.length > 0 && (
        <label className="mt-3 block text-xs">
          <span className="text-white/70">Rental</span>
          <select
            className="mt-1 w-full rounded-md border border-white/20 bg-[#141416] px-2 py-1"
            value={rentalId}
            onChange={(event) => setRentalId(event.target.value)}
          >
            <option value="">Choose a Rental</option>
            {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
          </select>
        </label>
      )}
      {error && <p role="alert" className="mt-3 text-xs text-white/70">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={!rentalId || busy}
          className="rounded-md bg-white px-3 py-1 text-xs font-medium text-[#141416] disabled:opacity-40"
          onClick={() => {
            setBusy(true);
            setError(null);
            link({ data: { invoiceId, rentalId } })
              .then((result) => {
                if (result.status === "linked") onLinked();
                else setError(result.reason || "This invoice was not recorded.");
              })
              .catch(() => setError("This invoice was not recorded."))
              .finally(() => setBusy(false));
          }}
        >
          Link to Rental
        </button>
        <button type="button" className="rounded-md border border-white/20 px-3 py-1 text-xs" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

function titleWord(value: string | null | undefined): string {
  const text = String(value ?? "").replace(/[_-]+/g, " ").trim();
  if (!text) return "";
  return text.replace(/\b\w/g, (letter) => letter.toUpperCase());
}
