import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Phone, MessageSquare, ArrowUpRight, CalendarDays, Flame } from "lucide-react";
import { getLeadPriorities } from "@/lib/lead-priorities.functions";
import { overdueAge, type LeadPrioritiesResult, type PriorityLead } from "@/lib/lead-priorities";
import { fmtDate } from "@/lib/date-format";
import { displayPersonName, displayTitleCase } from "@/lib/display-normalize";
import type { HotProspect } from "@/lib/readiness";
import type { OverviewApplicantRow } from "@/lib/admin-overview";
import { ReadinessMetrics, ReadinessStatePill } from "./ui";
import { ContactStatusCell } from "./ContactStatusCell";
import { ModalShell, ModalHeader, ModalBody } from "./modal";

const FOLLOW_UP_LIMIT = 3;
const ALL_FOLLOW_UPS_PAGE = 25;

export type HotLeadState = {
  state: "loading" | "ready" | "withheld" | "unavailable";
  /** The same array the modal renders. The card count is its length. */
  prospects: HotProspect<OverviewApplicantRow>[];
};

function appliedAgo(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const days = Math.floor(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86_400_000,
  );
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} Days Ago`;
}

function appliedLine(iso?: string | null) {
  const rel = appliedAgo(iso);
  if (!rel) return "Date Unknown";
  return `Applied ${fmtDate(new Date(iso as string))} · ${rel}`;
}

function isLeadResult(value: unknown): value is LeadPrioritiesResult {
  if (!value || typeof value !== "object") return false;
  const result = value as LeadPrioritiesResult;
  return (
    Array.isArray(result.rows) &&
    Number.isSafeInteger(result.total) &&
    !!result.counts &&
    [result.counts.new, result.counts.overdue, result.counts.hot].every(Number.isSafeInteger)
  );
}

export default function LeadPriorities({ hot }: { hot: HotLeadState }) {
  const load = useServerFn(getLeadPriorities);
  const queryClient = useQueryClient();
  const [bucket, setBucket] = useState<"new" | "overdue" | null>(null);
  const [hotOpen, setHotOpen] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const [allOffset, setAllOffset] = useState(0);
  const priorities = useQuery({
    queryKey: ["lead-priorities", bucket ?? "priority"],
    queryFn: async () => {
      const result = await load({
        data: { offset: 0, limit: FOLLOW_UP_LIMIT, ...(bucket ? { bucket } : {}) },
      });
      if (!isLeadResult(result)) throw new Error("Lead priorities response unavailable");
      return result;
    },
    // Contact saves and window focus both refetch. There is no realtime channel.
    refetchOnWindowFocus: true,
  });
  const allLeads = useQuery({
    queryKey: ["lead-priorities", "all", allOffset],
    enabled: allOpen,
    queryFn: async () => {
      const result = await load({ data: { offset: allOffset, limit: ALL_FOLLOW_UPS_PAGE } });
      if (!isLeadResult(result)) throw new Error("Lead priorities response unavailable");
      return result;
    },
    refetchOnWindowFocus: true,
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["lead-priorities"] });
    void queryClient.invalidateQueries({ queryKey: ["overview-applicants"] });
  };
  const result = priorities.data ?? null;
  const hotCount = hot.state === "ready" ? hot.prospects.length : null;
  const hotReason =
    hot.state === "withheld"
      ? "Hot leads use qualification and coverage. That evidence is Manager only."
      : hot.state === "loading"
        ? "Hot leads are loading."
        : hot.state === "unavailable"
          ? "Hot leads could not be loaded."
          : "Opens the hot leads, with qualification and coverage.";

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
          disabled={priorities.isFetching}
          className="text-sm text-primary disabled:opacity-50"
        >
          Refresh
        </button>
      </div>
      <div className="my-4 grid grid-cols-3 gap-3">
        <SummaryCard
          label="New Leads"
          value={result ? result.counts.new : null}
          pressed={bucket === "new"}
          onClick={() => setBucket((current) => (current === "new" ? null : "new"))}
        />
        <SummaryCard
          label="Overdue"
          value={result ? result.counts.overdue : null}
          pressed={bucket === "overdue"}
          onClick={() => setBucket((current) => (current === "overdue" ? null : "overdue"))}
        />
        <SummaryCard
          label="Hot Leads"
          value={hotCount}
          pressed={hotOpen}
          disabled={hot.state !== "ready"}
          title={hotReason}
          onClick={() => setHotOpen(true)}
        />
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        New and Overdue count each applicant once, and overdue takes precedence. Hot Leads uses
        qualification and coverage, the same list the Hot Leads window shows.
      </p>
      {priorities.isLoading ? (
        <p role="status" className="py-6 text-sm text-muted-foreground">
          Loading lead priorities…
        </p>
      ) : priorities.isError ? (
        <p role="alert" className="py-6 text-sm text-red-700">
          Lead priorities could not be loaded.{" "}
          <button className="underline" onClick={refresh}>
            Retry
          </button>
        </p>
      ) : (
        result && (
          <>
            <h3 className="text-sm font-semibold">
              {bucket === "new" ? "New Leads" : bucket === "overdue" ? "Overdue" : "Priority Follow-ups"}
            </h3>
            {result.rows.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">No leads need attention in this view.</p>
            ) : (
              <ul className="divide-y divide-border">
                {result.rows.map((lead) => (
                  <FollowUpItem key={lead.id} lead={lead} today={result.today} onSaved={refresh} />
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
              <p className="text-sm text-muted-foreground">
                {result.total
                  ? `Top ${result.rows.length} of ${result.total}`
                  : "0 applicants"}
              </p>
              <button type="button" className="text-sm font-medium text-primary" onClick={() => { setAllOffset(0); setAllOpen(true); }}>
                View All Follow-ups
              </button>
            </div>
          </>
        )
      )}
      {allOpen && (
        <ModalShell onClose={() => setAllOpen(false)} size="lg" label="All Follow-ups">
          <ModalHeader
            title="All Follow-ups"
            subtitle="Every bucket, 25 at a time. Today and Information stay in this list."
            onClose={() => setAllOpen(false)}
          />
          <ModalBody>
            {allLeads.isLoading ? (
              <p role="status" className="text-sm text-muted-foreground">Loading follow-ups…</p>
            ) : allLeads.isError || !allLeads.data ? (
              <p role="alert" className="text-sm text-red-700">Follow-ups could not be loaded.</p>
            ) : allLeads.data.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No follow-ups in this list.</p>
            ) : (
              <ul className="divide-y divide-border">
                {allLeads.data.rows.map((lead) => (
                  <FollowUpItem key={lead.id} lead={lead} today={allLeads.data.today} onSaved={refresh} />
                ))}
              </ul>
            )}
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {allLeads.data
                  ? `${allLeads.data.total === 0 ? 0 : allOffset + 1}–${allOffset + allLeads.data.rows.length} of ${allLeads.data.total}`
                  : " "}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-40"
                  disabled={allOffset === 0 || allLeads.isFetching}
                  onClick={() => setAllOffset((current) => Math.max(0, current - ALL_FOLLOW_UPS_PAGE))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-40"
                  disabled={!allLeads.data?.nextOffset || allLeads.isFetching}
                  onClick={() => allLeads.data?.nextOffset != null && setAllOffset(allLeads.data.nextOffset)}
                >
                  Next
                </button>
              </div>
            </div>
          </ModalBody>
        </ModalShell>
      )}
      {hotOpen && hot.state === "ready" && (
        <ModalShell onClose={() => setHotOpen(false)} size="lg" label="Hot Prospects">
          <ModalHeader
            title="Hot Prospects"
            subtitle={`${hot.prospects.length} ${hot.prospects.length === 1 ? "person" : "people"} worth following up first. Qualification and coverage, not approval.`}
            onClose={() => setHotOpen(false)}
          />
          <ModalBody>
            {hot.prospects.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hot leads in the current applicant window.</p>
            ) : (
              <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {hot.prospects.map(({ app, readiness }) => (
                  <li key={app.id} className="min-w-0">
                    <Link
                      to="/admin"
                      search={{ tab: "drivers", id: app.id }}
                      className="group flex h-full flex-col gap-2 rounded-xl border border-[#EDEDF0] bg-white p-3 hover:border-[#D03020]/40 hover:shadow-sm transition"
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="flex items-center justify-between gap-2 min-w-0">
                          <span className="truncate text-[14px] font-semibold text-[#111114] group-hover:text-[#D03020]">
                            {app.full_name ? displayPersonName(app.full_name) : "Unnamed"}
                          </span>
                          <ReadinessStatePill state={readiness.state} short />
                        </span>
                        <span className="flex min-w-0 items-center gap-1 text-[11px] text-[#9A9AA3]">
                          <CalendarDays className="h-3 w-3 shrink-0" />
                          <span className="truncate">{appliedLine(app.created_at)}</span>
                        </span>
                      </span>
                      <ReadinessMetrics result={readiness} />
                      {readiness.positives.length > 0 && (
                        <span className="line-clamp-2 text-[11px] text-[#9A9AA3]">
                          {readiness.positives
                            .slice(0, 2)
                            .map((factor) => displayTitleCase(factor.detail))
                            .join(" · ")}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </ModalBody>
        </ModalShell>
      )}
    </section>
  );
}

function FollowUpItem({ lead, today, onSaved }: { lead: PriorityLead; today: string; onSaved: () => void }) {
  return (
    <li className="py-4" data-lead-priority={lead.bucket}>
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/admin" search={{ tab: "drivers", id: lead.id }} className="font-semibold hover:underline">
          {lead.full_name || "Unnamed Applicant"}
        </Link>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${lead.priority === "Urgent" ? "bg-red-50 text-red-700" : lead.priority === "High" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}
        >
          {lead.priority}
        </span>
        <ContactStatusCell applicationId={lead.id} row={lead} onSaved={onSaved} />
        {lead.contact_follow_up_on && (
          <span className="text-xs text-muted-foreground">
            Due {fmtDate(lead.contact_follow_up_on)}
            {lead.bucket === "overdue" && ` · ${overdueAge(lead.contact_follow_up_on, today)}`}
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
          <a href={`tel:${lead.phone.replace(/[^+\d]/g, "")}`} className="inline-flex items-center gap-1">
            <Phone className="h-3.5 w-3.5" />
            Call
          </a>
        )}
        <button
          title="Open Messages, then choose Text. Sending permissions and consent are checked there."
          onClick={() => window.dispatchEvent(new CustomEvent("open-messages", { detail: { applicationId: lead.id } }))}
          className="inline-flex items-center gap-1"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Text
        </button>
        <Link to="/admin" search={{ tab: "drivers", id: lead.id }} className="inline-flex items-center gap-1">
          View Applicant
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </li>
  );
}

function SummaryCard({
  label,
  value,
  pressed,
  disabled,
  title,
  onClick,
}: {
  label: string;
  value: number | null;
  pressed: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`rounded-xl p-3 text-left disabled:cursor-not-allowed ${pressed ? "bg-[#111114] text-white" : "bg-[#F7F7F8] disabled:opacity-60"}`}
    >
      <div className={`flex items-center gap-1 text-xs ${pressed ? "text-white/70" : "text-muted-foreground"}`}>
        {label === "Hot Leads" && <Flame className="h-3.5 w-3.5 text-[#D03020]" strokeWidth={2} />}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value === null ? "—" : value}</div>
    </button>
  );
}
