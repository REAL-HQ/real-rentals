import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, StatusPill } from "./ui";
import {
  formatIssueTimeEt,
  issueKindLabel,
  issueStatusLabel,
  ISSUE_STATUSES,
  type IssueStatus,
} from "@/lib/driver-issues";
import { listDriverIssues, updateDriverIssueStatus, type DriverIssueRow } from "@/lib/driver-issues.functions";

const FILTERS = [
  { id: "open", label: "Open" },
  { id: "closed", label: "Closed" },
  { id: "all", label: "All" },
] as const;

export function DriverIssuesPanel() {
  const fetchList = useServerFn(listDriverIssues);
  const saveStatus = useServerFn(updateDriverIssueStatus);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("open");
  const [rows, setRows] = useState<DriverIssueRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load(next = filter) {
    setLoading(true);
    try {
      const res = await fetchList({ data: { filter: next } });
      setRows(res.rows);
      setTruncated(res.truncated);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load driver issues");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function changeStatus(row: DriverIssueRow, status: IssueStatus) {
    if (status === row.status) return;
    setBusyId(row.id);
    try {
      const res = await saveStatus({ data: { id: row.id, status } });
      if (!res.ok) throw new Error(res.error);
      toast.success(`Marked ${issueStatusLabel(status)}`);
      await load(filter);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update status");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4" data-testid="driver-issues">
      <div className="admin-sticky-bar flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                filter === f.id
                  ? "border-[#D03020] bg-[#D03020] text-white"
                  : "border-[#EDEDF0] text-[#55555E] hover:border-[#D6D6DB]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="text-sm text-muted-foreground">
          {rows.length} issue{rows.length === 1 ? "" : "s"}
          {truncated ? " · newest 200" : ""}
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<AlertTriangle className="w-6 h-6" strokeWidth={1.75} />}
          title={filter === "open" ? "No Open Issues" : "No Issues"}
          hint="Reports a renter files in the driver portal show up here."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <article key={row.id} className="rounded-2xl border border-[#EDEDF0] bg-white shadow-sm p-4" data-testid="driver-issue-row">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="font-semibold text-[#111114]">{row.title}</h2>
                    <StatusPill status={row.closed ? "completed" : "pending"}>{issueStatusLabel(row.status)}</StatusPill>
                    <span className="text-[11px] font-medium text-[#55555E]">{issueKindLabel(row.kind)}</span>
                  </div>
                  <p className="mt-1 text-[13px] text-[#55555E]">
                    {row.driverName}
                    {row.vehicleLabel ? ` · ${row.vehicleLabel}` : " · No Vehicle Linked"}
                  </p>
                </div>
                <time className="text-[12px] text-[#9A9AA3] whitespace-nowrap" dateTime={row.createdAt}>
                  {formatIssueTimeEt(row.createdAt)}
                </time>
              </div>

              {row.body ? <p className="mt-3 text-sm text-[#111114] whitespace-pre-wrap">{row.body}</p> : null}

              <div className="mt-3 rounded-lg bg-[#FAFAFB] border border-[#EDEDF0] px-3 py-2">
                <div className="text-[10px] font-semibold tracking-[0.12em] text-[#9A9AA3]">Staff Note</div>
                <p className="mt-1 text-[13px] text-[#55555E]">Not stored yet. Status can still be updated.</p>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="text-[12px] text-[#55555E]" htmlFor={`issue-status-${row.id}`}>
                  Status
                </label>
                <select
                  id={`issue-status-${row.id}`}
                  value={ISSUE_STATUSES.includes(row.status as IssueStatus) ? row.status : "open"}
                  disabled={busyId === row.id}
                  onChange={(e) => changeStatus(row, e.target.value as IssueStatus)}
                  className="rounded-lg border border-[#EDEDF0] bg-white px-2 py-1.5 text-sm"
                >
                  {ISSUE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {issueStatusLabel(s)}
                    </option>
                  ))}
                </select>
                {row.applicationId ? (
                  <Link
                    to="/admin"
                    search={{ tab: "drivers", id: row.applicationId }}
                    className="rounded-lg border border-[#EDEDF0] px-3 py-1.5 text-sm text-[#111114] hover:bg-[#FAFAFB]"
                  >
                    Open Driver
                  </Link>
                ) : null}
                {row.rentalId ? (
                  <Link
                    to="/admin"
                    search={{ tab: "bookings", id: row.rentalId }}
                    className="rounded-lg border border-[#EDEDF0] px-3 py-1.5 text-sm text-[#111114] hover:bg-[#FAFAFB]"
                  >
                    Open Booking
                  </Link>
                ) : null}
                <Link
                  to="/admin"
                  search={{ tab: "incidents", issue: row.id }}
                  className="rounded-lg border border-[#EDEDF0] px-3 py-1.5 text-sm text-[#111114] hover:bg-[#FAFAFB]"
                  data-testid="create-incident-from-issue"
                >
                  Create Incident From Issue
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
