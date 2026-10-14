import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Phone, MessageSquare, ArrowUpRight } from "lucide-react";
import { getLeadPriorities } from "@/lib/lead-priorities.functions";
import type { LeadPrioritiesResult } from "@/lib/lead-priorities";
import { fmtDate } from "@/lib/date-format";
import { ContactStatusCell } from "./ContactStatusCell";

export default function LeadPriorities() {
  const load = useServerFn(getLeadPriorities);
  const [result, setResult] = useState<LeadPrioritiesResult | null>(null);
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(false);
    load({ data: { offset, limit: expanded ? 25 : 5 } })
      .then((r) => {
        if (
          !r ||
          !Array.isArray(r.rows) ||
          !Number.isSafeInteger(r.total) ||
          !r.counts ||
          ![r.counts.new, r.counts.overdue, r.counts.hot].every(Number.isSafeInteger)
        ) {
          throw new Error("Lead priorities response unavailable");
        }
        if (current) setResult(r);
      })
      .catch(() => {
        if (current) {
          setResult(null);
          setError(true);
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [load, offset, expanded, revision]);
  const refresh = () => {
    setOffset(0);
    setRevision((r) => r + 1);
  };
  return (
    <section
      aria-labelledby="lead-priorities-title"
      className="rounded-2xl border border-border bg-white p-4 sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="lead-priorities-title" className="text-lg font-semibold">
            Lead Priorities
          </h2>
          <p className="text-sm text-muted-foreground">Who needs attention and what to do next</p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="text-sm text-primary disabled:opacity-50"
        >
          Refresh
        </button>
      </div>
      {loading ? (
        <p role="status" className="py-6 text-sm text-muted-foreground">
          Loading lead priorities…
        </p>
      ) : error ? (
        <p role="alert" className="py-6 text-sm text-red-700">
          Lead priorities could not be loaded.{" "}
          <button className="underline" onClick={refresh}>
            Retry
          </button>
        </p>
      ) : (
        result && (
          <>
            <div className="my-4 grid grid-cols-3 gap-3">
              {(
                [
                  ["New Leads", result.counts.new],
                  ["Overdue", result.counts.overdue],
                  ["Hot Leads", result.counts.hot],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded-xl bg-[#F7F7F8] p-3">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
                </div>
              ))}
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Each applicant counts once: overdue takes precedence. Hot means marked Interested, not
              rental-ready. Dates use Eastern Time.
            </p>
            {result.rows.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                No leads need attention in this view.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {result.rows.map((lead) => (
                  <li key={lead.id} className="py-4" data-lead-priority={lead.bucket}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to="/admin"
                        search={{ tab: "drivers", id: lead.id }}
                        className="font-semibold hover:underline"
                      >
                        {lead.full_name || "Unnamed Applicant"}
                      </Link>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${lead.priority === "Urgent" ? "bg-red-50 text-red-700" : lead.priority === "High" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}
                      >
                        {lead.priority}
                      </span>
                      <ContactStatusCell applicationId={lead.id} row={lead} onSaved={refresh} />
                      {lead.contact_follow_up_on && (
                        <span className="text-xs text-muted-foreground">
                          Due {fmtDate(lead.contact_follow_up_on)}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-sm font-medium">{lead.reason}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{lead.action}</p>
                    {lead.contact_status_note && (
                      <p className="mt-2 break-words text-xs text-muted-foreground">
                        Latest contact note: “{lead.contact_status_note.slice(0, 240)}
                        {lead.contact_status_note.length > 240 ? "…" : ""}”
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-4 text-xs font-medium text-primary">
                      {lead.phone && (
                        <a
                          href={`tel:${lead.phone.replace(/[^+\d]/g, "")}`}
                          className="inline-flex items-center gap-1"
                        >
                          <Phone className="h-3.5 w-3.5" />
                          Call
                        </a>
                      )}
                      <button
                        title="Open Messages, then choose Text. Sending permissions and consent are checked there."
                        onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent("open-messages", {
                              detail: { applicationId: lead.id },
                            }),
                          )
                        }
                        className="inline-flex items-center gap-1"
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        Text
                      </button>
                      <Link
                        to="/admin"
                        search={{ tab: "drivers", id: lead.id }}
                        className="inline-flex items-center gap-1"
                      >
                        View Applicant
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-sm">
              <span className="text-muted-foreground">
                {result.total
                  ? `${offset + 1}–${offset + result.rows.length} of ${result.total}`
                  : "0 applicants"}
              </span>
              {!expanded && result.total > 5 ? (
                <button
                  className="font-medium text-primary"
                  onClick={() => {
                    setExpanded(true);
                    setOffset(0);
                  }}
                >
                  View All
                </button>
              ) : (
                expanded && (
                  <div className="flex gap-4">
                    <button
                      disabled={offset === 0}
                      className="text-primary disabled:opacity-40"
                      onClick={() => setOffset(Math.max(0, offset - 25))}
                    >
                      Previous
                    </button>
                    <button
                      disabled={result.nextOffset === null}
                      className="text-primary disabled:opacity-40"
                      onClick={() => setOffset(result.nextOffset!)}
                    >
                      Next
                    </button>
                  </div>
                )
              )}
            </div>
          </>
        )
      )}
    </section>
  );
}
