import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { rowNav } from "@/lib/row-click";
import { Phone, MessageSquare, ArrowUpRight, Flame, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getLeadPriorities } from "@/lib/lead-priorities.functions";
import {
  LEAD_FILTERS,
  LEAD_FILTER_LABELS,
  LEAD_PREVIEW_LIMIT,
  type LeadFilter,
  type LeadPrioritiesResult,
} from "@/lib/lead-priorities";
import { ContactStatusCell } from "./ContactStatusCell";
import { LeadFollowUpDraft } from "./LeadFollowUpDraft";
import { LeadResponseReport } from "./LeadResponseReport";
import { ReadinessStatePill } from "./ui";
import type { ReadinessByApplicant } from "@/lib/admin-overview";
import { displayPersonName } from "@/lib/display-normalize";
import { LeadCardBody, leadCallClass, leadStatTiles, leadTextClass } from "./LeadCardBody";
import { LeadCardMenu } from "./LeadCardMenu";
import type { StaffTier } from "@/lib/roles";

export default function LeadPriorities({
  isManager = false,
  refreshKey = 0,
  readiness = {},
  canSeeReadiness = false,
  tier = null,
}: {
  isManager?: boolean;
  refreshKey?: number;
  readiness?: ReadinessByApplicant;
  canSeeReadiness?: boolean;
  /** Signed-in staff tier; decides which ⋮ menu options show (Delete is Owner-only). */
  tier?: StaffTier | null;
}) {
  const navigate = useNavigate();
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
      className="rounded-3xl border border-border bg-white p-4 text-card-foreground shadow-sm sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="lead-priorities-title" className="flex items-center gap-2 text-lg font-semibold">
            <Flame aria-hidden="true" className="h-5 w-5 shrink-0 text-destructive" />
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
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-destructive"
            onClick={refresh}
          >
            Retry
          </Button>
        </p>
      ) : (
        result && (
          <>
            <div className="my-4 grid grid-cols-3 gap-2 sm:gap-3">
              {leadStatTiles().map(({ label, next, Icon, tile, icon }) => {
                const value = next === "new" ? result.counts.new : next === "interested" ? result.counts.hot : result.counts.overdue;
                return (
                <Button
                  key={label}
                  type="button"
                  variant="outline"
                  aria-pressed={filter === next}
                  onClick={() => setLeadFilter(next)}
                  className={`h-auto min-h-[92px] min-w-0 flex-col items-start justify-between gap-0 whitespace-normal rounded-2xl px-3 py-3 text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:text-inherit ${tile} ${
                    filter === next ? "ring-2 ring-brand" : ""
                  }`}
                >
                  <span className={`grid h-8 w-8 place-items-center rounded-xl ${icon}`}>
                    <Icon aria-hidden="true" className="h-4 w-4" />
                  </span>
                  <span className="mt-3 text-3xl font-semibold leading-none tabular-nums">{value}</span>
                  <span className="mt-1 text-xs font-medium">{label}</span>
                </Button>
              );
              })}
            </div>

            <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Lead Filters">
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
                  const displayName = lead.full_name
                    ? displayPersonName(lead.full_name)
                    : "Unnamed Applicant";
                  return (
                    <li
                      key={lead.id}
                      data-lead-priority={lead.bucket}
                      {...rowNav(navigate, { tab: "drivers", id: lead.id }, "min-w-0 rounded-2xl")}
                      aria-label={`View Applicant ${displayName}`}
                    >
                      <LeadCardBody
                        lead={lead}
                        today={result.today}
                        displayName={displayName}
                        menu={<LeadCardMenu lead={lead} today={result.today} tier={tier} onChanged={refresh} />}
                        name={displayName}
                        status={
                          <>
                            <ContactStatusCell
                              applicationId={lead.id}
                              row={lead}
                              onSaved={refresh}
                              appearance="neutral"
                            />
                            {readinessResult ? (
                              <ReadinessStatePill state={readinessResult.state} short />
                            ) : null}
                          </>
                        }
                        draft={<LeadFollowUpDraft applicationId={lead.id} bucket={lead.bucket} />}
                        actions={
                          <div className="flex items-center gap-2">
                            {lead.phone && (
                              <Button
                                asChild
                                size="sm"
                                className={leadCallClass()}
                              >
                                <a href={`tel:${lead.phone.replace(/[^+\d]/g, "")}`} aria-label="Call">
                                  <Phone aria-hidden="true" />
                                  Call
                                </a>
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              aria-label="Text"
                              title="Open Messages, then choose Text. Sending permissions and consent are checked there."
                              onClick={() =>
                                window.dispatchEvent(
                                  new CustomEvent("open-messages", {
                                    detail: { applicationId: lead.id },
                                  }),
                                )
                              }
                              className={leadTextClass()}
                            >
                              <MessageSquare aria-hidden="true" />
                              Text
                            </Button>
                            <ArrowUpRight aria-hidden="true" className="ml-auto h-4 w-4 text-muted-foreground" />
                          </div>
                        }
                      />
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
