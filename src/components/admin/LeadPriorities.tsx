import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Phone, MessageSquare, ArrowUpRight, CalendarDays, Flame, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getLeadPriorities } from "@/lib/lead-priorities.functions";
import {
  overdueAge,
  LEAD_FILTERS,
  LEAD_FILTER_LABELS,
  LEAD_PREVIEW_LIMIT,
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
    load({ data: { offset, limit: expanded ? 25 : LEAD_PREVIEW_LIMIT, filter } })
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
      className="rounded-2xl border border-border bg-card p-4 text-card-foreground sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="lead-priorities-title" className="flex items-center gap-2 text-lg font-semibold">
            <Flame aria-hidden="true" className="h-5 w-5 shrink-0 text-muted-foreground" />
            Lead Priorities
          </h2>
          <p className="text-sm text-muted-foreground">Who needs attention and what to do next</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={loading}
            className="border-border bg-card text-card-foreground shadow-none hover:bg-secondary hover:text-foreground"
          >
            <RefreshCw aria-hidden="true" />
            Refresh
          </Button>
          {updatedAt && (
            <span className="text-[11px] text-muted-foreground" role="status">
              Updated {updatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </span>
          )}
        </div>
      </div>
      <div className="text-card-foreground">
        <LeadResponseReport isManager={isManager} />
      </div>
      {loading ? (
        <p role="status" className="py-6 text-sm text-muted-foreground">
          Loading lead priorities…
        </p>
      ) : error ? (
        <p role="alert" className="py-6 text-sm text-destructive">
          Lead priorities could not be loaded.{" "}
          <Button variant="link" size="sm" className="h-auto p-0 text-destructive" onClick={refresh}>
            Retry
          </Button>
        </p>
      ) : (
        result && (
          <>
            <div className="my-4 grid grid-cols-3 gap-2 sm:gap-3">
              {(
                [
                  ["New Leads", result.counts.new, "new" as LeadFilter],
                  ["Overdue", result.counts.overdue, "follow_up_due" as LeadFilter],
                  ["Hot Leads", result.counts.hot, "interested" as LeadFilter],
                ] as const
              ).map(([label, value, next]) => (
                <Button
                  key={label}
                  type="button"
                  variant="outline"
                  aria-pressed={filter === next}
                  onClick={() => setLeadFilter(next)}
                  className={`h-16 min-w-0 flex-col items-start justify-center gap-1 whitespace-normal rounded-lg bg-card px-3 py-2 text-left text-card-foreground shadow-none hover:bg-secondary hover:text-foreground ${
                    filter === next ? "border-brand ring-1 ring-brand" : "border-border"
                  }`}
                >
                  <span className="text-xs font-normal text-muted-foreground">{label}</span>
                  <span className={`text-xl font-semibold leading-none tabular-nums ${next === "follow_up_due" && value > 0 ? "text-brand" : "text-card-foreground"}`}>{value}</span>
                </Button>
              ))}
            </div>

            <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Lead filters">
              {LEAD_FILTERS.map((key) => (
                <Button
                  key={key}
                  type="button"
                  variant="outline"
                  size="sm"
                  role="tab"
                  aria-selected={filter === key}
                  onClick={() => setLeadFilter(key)}
                  className={`h-8 rounded-lg px-3 text-xs font-medium shadow-none ${
                    filter === key
                      ? "border-brand bg-brand text-brand-foreground hover:bg-brand/90 hover:text-brand-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground"
                  }`}
                >
                  {LEAD_FILTER_LABELS[key]}
                </Button>
              ))}
            </div>

            {result.rows.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                No leads need attention in this view.
              </p>
            ) : (
              <ul className="mt-1 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {result.rows.map((lead) => {
                  const readinessResult = canSeeReadiness ? readiness[lead.id] : undefined;
                  return (
                    <li key={lead.id} data-lead-priority={lead.bucket} className="min-w-0">
                      <div className={`flex h-full flex-col gap-3 rounded-lg border bg-card p-4 text-card-foreground ${lead.priority === "Urgent" ? "border-brand/40" : "border-border"}`}>
                        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
                          <Link
                            to="/admin"
                            search={{ tab: "drivers", id: lead.id }}
                            className="min-w-0 flex-1 basis-32 break-words text-sm font-semibold leading-5 text-card-foreground hover:underline"
                          >
                            {lead.full_name
                              ? displayPersonName(lead.full_name)
                              : "Unnamed Applicant"}
                          </Link>
                          <div className="ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                            <Badge
                              variant="secondary"
                              className={`rounded-full px-2 py-0.5 text-[11px] font-medium hover:bg-secondary ${
                                lead.priority === "Urgent"
                                  ? "bg-brand/10 text-brand hover:bg-brand/10"
                                  : "bg-secondary text-muted-foreground"
                              }`}
                            >
                              {lead.priority}
                            </Badge>
                            {readinessResult ? (
                              <ReadinessStatePill state={readinessResult.state} short appearance="neutral" />
                            ) : null}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <ContactStatusCell applicationId={lead.id} row={lead} onSaved={refresh} appearance="neutral" />
                          {lead.bucket === "interested" && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                              <Flame className="h-3 w-3" /> Interested
                            </span>
                          )}
                        </div>

                        <div className="space-y-1">
                          <p className="text-sm font-medium text-card-foreground">{lead.reason}</p>
                          <p className="text-xs leading-5 text-muted-foreground">{lead.action}</p>
                        </div>
                        {readinessResult ? <div className="min-w-0"><ReadinessMetrics result={readinessResult} appearance="neutral" /></div> : null}
                        {readinessResult && readinessResult.positives.length > 0 && (
                          <span className="text-[11px] text-muted-foreground line-clamp-2">
                            {readinessResult.positives
                              .slice(0, 2)
                              .map((f) => displayTitleCase(f.detail))
                              .join(" · ")}
                          </span>
                        )}
                        <LeadFollowUpDraft applicationId={lead.id} bucket={lead.bucket} />
                        <div className="flex min-w-0 flex-col gap-1 text-[11px] leading-4 text-muted-foreground">
                          <span className="inline-flex min-w-0 items-start gap-1">
                            <CalendarDays aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0" />
                            <span>{appliedLine(lead.created_at)}</span>
                          </span>
                          <span>{lastContactLine(lead.contact_status_at)}</span>
                          {lead.contact_follow_up_on && (
                            <span>
                              Due {fmtDate(lead.contact_follow_up_on)}
                              {lead.bucket === "overdue" &&
                                ` · ${overdueAge(lead.contact_follow_up_on, result.today)}`}
                            </span>
                          )}
                        </div>
                        {lead.contact_status_note && (
                          <p className="break-words text-xs text-muted-foreground">
                            Latest contact note: “{lead.contact_status_note.slice(0, 240)}
                            {lead.contact_status_note.length > 240 ? "…" : ""}”
                          </p>
                        )}
                        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3 text-xs font-medium">
                          {lead.phone && (
                            <Button asChild variant="link" size="sm" className="h-7 gap-1 p-0 text-xs text-muted-foreground">
                              <a href={`tel:${lead.phone.replace(/[^+\d]/g, "")}`}>
                                <Phone aria-hidden="true" />
                                Call
                              </a>
                            </Button>
                          )}
                          <Button
                            variant="link"
                            size="sm"
                            title="Open Messages, then choose Text. Sending permissions and consent are checked there."
                            onClick={() =>
                              window.dispatchEvent(
                                new CustomEvent("open-messages", {
                                  detail: { applicationId: lead.id },
                                }),
                              )
                            }
                            className="h-7 gap-1 p-0 text-xs text-muted-foreground"
                          >
                            <MessageSquare aria-hidden="true" />
                            Text
                          </Button>
                          <Button asChild variant="link" size="sm" className="ml-auto h-7 gap-1 p-0 text-xs text-card-foreground">
                            <Link to="/admin" search={{ tab: "drivers", id: lead.id }}>
                              View Applicant
                              <ArrowUpRight aria-hidden="true" />
                            </Link>
                          </Button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-sm">
              <span className="text-muted-foreground">
                {result.total
                  ? `${offset + 1}–${offset + result.rows.length} of ${result.total}`
                  : "0 applicants"}
              </span>
              {!expanded && result.total > LEAD_PREVIEW_LIMIT ? (
                <Button
                  variant="link"
                  size="sm"
                  className="text-brand"
                  onClick={() => {
                    setExpanded(true);
                    setOffset(0);
                  }}
                >
                  View All
                </Button>
              ) : (
                expanded && (
                  <div className="flex gap-4">
                    <Button
                      variant="link"
                      size="sm"
                      disabled={offset === 0}
                      className="text-primary disabled:opacity-40"
                      onClick={() => setOffset(Math.max(0, offset - 25))}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="link"
                      size="sm"
                      disabled={result.nextOffset === null}
                      className="text-primary disabled:opacity-40"
                      onClick={() => {
                        if (result.nextOffset !== null) setOffset(result.nextOffset);
                      }}
                    >
                      Next
                    </Button>
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
