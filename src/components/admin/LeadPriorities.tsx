import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Phone, MessageSquare, ArrowUpRight, CalendarDays, Flame } from "lucide-react";
import { getLeadPriorities } from "@/lib/lead-priorities.functions";
import {
  overdueAge,
  LEAD_FILTERS,
  LEAD_FILTER_LABELS,
  type LeadFilter,
  type LeadPrioritiesResult,
} from "@/lib/lead-priorities";
import { fmtDate } from "@/lib/date-format";
import { ContactStatusCell } from "./ContactStatusCell";
import { LeadFollowUpDraft } from "./LeadFollowUpDraft";
import { LeadResponseReport } from "./LeadResponseReport";
import { ReadinessStatePill, ReadinessMetrics } from "./ui";
import type { ReadinessByApplicant } from "@/lib/admin-overview";
import { displayPersonName, displayTitleCase } from "@/lib/display-normalize";

function appliedLine(iso?: string | null) {
  if (!iso) return "Date Unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Date Unknown";
  const now = new Date();
  const days = Math.floor(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86_400_000,
  );
  const rel = days <= 0 ? "Today" : days === 1 ? "Yesterday" : `${days} Days Ago`;
  return `Applied ${fmtDate(d)} · ${rel}`;
}

function lastContactLine(iso?: string | null) {
  if (!iso) return "No contact logged";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "No contact logged";
  return `Last contact ${fmtDate(d)}`;
}

export default function LeadPriorities({
  isManager = false,
  refreshKey = 0,
  readiness = {},
  canSeeReadiness = false,
}: {
  isManager?: boolean;
  refreshKey?: number;
  readiness?: ReadinessByApplicant;
  canSeeReadiness?: boolean;
}) {
  const load = useServerFn(getLeadPriorities);
  const [result, setResult] = useState<LeadPrioritiesResult | null>(null);
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState<LeadFilter>("all");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(false);
    load({ data: { offset, limit: expanded ? 25 : 5, filter } })
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
        if (current) {
          setResult(r);
          setUpdatedAt(new Date());
        }
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
  }, [load, offset, expanded, revision, filter, refreshKey]);

  const refresh = () => {
    setOffset(0);
    setRevision((r) => r + 1);
  };

  const setLeadFilter = (next: LeadFilter) => {
    setFilter(next);
    setOffset(0);
    setExpanded(false);
  };

  return (
    <section
      aria-labelledby="lead-priorities-title"
      className="rounded-2xl border border-brand bg-brand p-4 text-brand-foreground sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="lead-priorities-title" className="flex items-center gap-2 text-lg font-semibold">
            <Flame aria-hidden="true" className="h-5 w-5 shrink-0" />
            Lead Priorities
          </h2>
          <p className="text-sm text-brand-foreground/80">Who needs attention and what to do next</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={refresh}
            disabled={loading}
            className="text-sm text-brand-foreground disabled:opacity-50"
          >
            Refresh
          </button>
          {updatedAt && (
            <span className="text-[11px] text-brand-foreground/80" role="status">
              Updated {updatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </span>
          )}
        </div>
      </div>
      <div className="text-card-foreground">
        <LeadResponseReport isManager={isManager} />
      </div>
      {loading ? (
        <p role="status" className="py-6 text-sm text-brand-foreground/80">
          Loading lead priorities…
        </p>
      ) : error ? (
        <p role="alert" className="py-6 text-sm text-brand-foreground">
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
                  ["New Leads", result.counts.new, "new" as LeadFilter],
                  ["Overdue", result.counts.overdue, "follow_up_due" as LeadFilter],
                  ["Hot Leads", result.counts.hot, "interested" as LeadFilter],
                ] as const
              ).map(([label, value, next]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setLeadFilter(next)}
                  className={`rounded-xl bg-secondary p-3 text-left text-secondary-foreground transition hover:bg-secondary/90 ${
                    filter === next ? "ring-1 ring-brand-foreground" : ""
                  }`}
                >
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
                </button>
              ))}
            </div>

            <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Lead filters">
              {LEAD_FILTERS.map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={filter === key}
                  onClick={() => setLeadFilter(key)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    filter === key
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-card text-muted-foreground hover:border-brand"
                  }`}
                >
                  {LEAD_FILTER_LABELS[key]}
                </button>
              ))}
            </div>

            <p className="mb-3 text-xs text-brand-foreground/80">
              Converted and closed applicants are excluded. All surfaces New and Interested before
              the overdue backlog; use Follow-up Due for urgent overdue work. Hot means marked
              Interested, not rental-ready. Dates use Eastern Time.
            </p>
            {result.rows.length === 0 ? (
              <p className="py-4 text-sm text-brand-foreground/80">
                No leads need attention in this view.
              </p>
            ) : (
              <ul className="mt-1 grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {result.rows.map((lead) => {
                  const readinessResult = canSeeReadiness ? readiness[lead.id] : undefined;
                  return (
                    <li key={lead.id} data-lead-priority={lead.bucket} className="min-w-0">
                      <div className="group flex h-full flex-col gap-2 rounded-xl border border-border bg-card p-3 text-card-foreground hover:border-brand/40 hover:shadow-sm transition">
                        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
                          <Link
                            to="/admin"
                            search={{ tab: "drivers", id: lead.id }}
                            className="min-w-0 flex-1 basis-32 truncate text-[14px] font-semibold text-card-foreground hover:text-brand"
                          >
                            {lead.full_name
                              ? displayPersonName(lead.full_name)
                              : "Unnamed Applicant"}
                          </Link>
                          <div className="ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                lead.priority === "Urgent"
                                  ? "bg-red-50 text-red-700"
                                  : lead.priority === "High"
                                    ? "bg-amber-50 text-amber-800"
                                    : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {lead.priority}
                            </span>
                            {readinessResult ? (
                              <ReadinessStatePill state={readinessResult.state} short />
                            ) : null}
                          </div>
                        </div>

                        <div className="flex min-w-0 flex-col gap-0.5 text-[11px] text-[#9A9AA3]">
                          <span className="inline-flex min-w-0 items-center gap-1">
                            <CalendarDays className="h-3 w-3 shrink-0" />
                            <span className="truncate">{appliedLine(lead.created_at)}</span>
                          </span>
                          <span className="truncate">{lastContactLine(lead.contact_status_at)}</span>
                          {lead.contact_follow_up_on && (
                            <span className="truncate">
                              Due {fmtDate(lead.contact_follow_up_on)}
                              {lead.bucket === "overdue" &&
                                ` · ${overdueAge(lead.contact_follow_up_on, result.today)}`}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <ContactStatusCell applicationId={lead.id} row={lead} onSaved={refresh} />
                          {lead.bucket === "interested" && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#D03020]">
                              <Flame className="h-3 w-3" /> Interested
                            </span>
                          )}
                        </div>

                        <p className="text-sm font-medium text-[#111114]">{lead.reason}</p>
                        <p className="text-sm text-muted-foreground">{lead.action}</p>
                        {readinessResult ? <ReadinessMetrics result={readinessResult} /> : null}
                        {readinessResult && readinessResult.positives.length > 0 && (
                          <span className="text-[11px] text-[#9A9AA3] line-clamp-2">
                            {readinessResult.positives
                              .slice(0, 2)
                              .map((f) => displayTitleCase(f.detail))
                              .join(" · ")}
                          </span>
                        )}
                        <LeadFollowUpDraft applicationId={lead.id} bucket={lead.bucket} />
                        {lead.contact_status_note && (
                          <p className="break-words text-xs text-muted-foreground">
                            Latest contact note: “{lead.contact_status_note.slice(0, 240)}
                            {lead.contact_status_note.length > 240 ? "…" : ""}”
                          </p>
                        )}
                        <div className="mt-auto flex flex-wrap gap-4 pt-1 text-xs font-medium text-primary">
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
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="mt-3 flex items-center justify-between border-t border-brand-foreground/25 pt-3 text-sm">
              <span className="text-brand-foreground/80">
                {result.total
                  ? `${offset + 1}–${offset + result.rows.length} of ${result.total}`
                  : "0 applicants"}
              </span>
              {!expanded && result.total > 5 ? (
                <button
                  className="font-medium text-brand-foreground"
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
                      className="text-brand-foreground disabled:opacity-40"
                      onClick={() => setOffset(Math.max(0, offset - 25))}
                    >
                      Previous
                    </button>
                    <button
                      disabled={result.nextOffset === null}
                      className="text-brand-foreground disabled:opacity-40"
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
