import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { History, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { EmptyState } from "./ui";
import { listAuditLog, type AuditRow } from "@/lib/team.functions";
import { listExpiring, type ExpiringItem } from "@/lib/vehicle-docs.functions";

// Activity: who did what, plus what is about to lapse.
//
// These sit together because they answer the same kind of question — "is
// anything about to go wrong that nobody has told me about?" The expiry list
// is the one that saves money: plate, registration and insurance dates have
// been collectable since the fleet-ops migration and nothing has ever read
// them back, so a lapsed registration could only be found by looking.

const ACTION_GROUPS = [
  { value: "all", label: "Everything" },
  { value: "application", label: "Applicants" },
  { value: "rental", label: "Rentals" },
  { value: "expense", label: "Expenses" },
  { value: "role", label: "Access" },
  { value: "invite", label: "Invitations" },
  { value: "vehicle_doc", label: "Vehicle documents" },
];

function actionTone(action: string): string {
  if (action.endsWith(".deleted") || action.endsWith(".revoked")) return "text-[#D03020]";
  if (action.startsWith("role.") || action.startsWith("invite.")) return "text-[#2563EB]";
  return "text-muted-foreground";
}

export function ActivityPanel() {
  const loadLog = useServerFn(listAuditLog);
  const loadExpiring = useServerFn(listExpiring);

  const [rows, setRows] = useState<AuditRow[]>([]);
  const [expiring, setExpiring] = useState<ExpiringItem[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [log, exp] = await Promise.all([
        loadLog({ data: { action: filter } }),
        loadExpiring({ data: { withinDays: 45 } }).catch(() => [] as ExpiringItem[]),
      ]);
      setRows(log);
      setExpiring(exp);
    } catch (e: any) {
      toast.error(e?.message === "Forbidden" ? "Activity is Manager-only." : "Could not load activity.");
    } finally {
      setLoading(false);
    }
  }, [loadLog, loadExpiring, filter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const overdue = expiring.filter((e) => e.days < 0);
  const upcoming = expiring.filter((e) => e.days >= 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Activity</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Every action taken in the back office, and anything about to expire.
        </p>
      </div>

      {expiring.length > 0 && (
        <section className="rounded-xl border border-[#F59E0B] overflow-hidden">
          <div className="bg-[rgba(245,158,11,0.08)] px-4 py-2.5 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#B45309]" />
            <span className="text-sm font-medium">
              {overdue.length > 0 && (
                <span className="text-[#D03020]">{overdue.length} already expired</span>
              )}
              {overdue.length > 0 && upcoming.length > 0 && " · "}
              {upcoming.length > 0 && `${upcoming.length} expiring within 45 days`}
            </span>
          </div>
          <div className="divide-y divide-border">
            {expiring.map((e, i) => (
              <div key={`${e.vehicle_id}-${e.what}-${i}`} className="px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <span className="text-sm font-medium">{e.label}</span>
                  <span className="text-sm text-muted-foreground"> — {e.what}</span>
                </div>
                <span className={`text-sm tabular-nums ${e.days < 0 ? "text-[#D03020] font-medium" : "text-[#B45309]"}`}>
                  {e.days < 0
                    ? `expired ${Math.abs(e.days)}d ago`
                    : e.days === 0
                      ? "expires today"
                      : `${e.days}d`}
                  <span className="text-muted-foreground ml-2">
                    {new Date(e.expires_on + "T00:00:00").toLocaleDateString()}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center gap-2 mb-3">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded-lg border border-border bg-white px-3 py-2 text-sm"
          >
            {ACTION_GROUPS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
          <span className="text-sm text-muted-foreground">{rows.length} entries</span>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<History className="w-6 h-6" strokeWidth={1.75} />}
            title="Nothing recorded yet"
            hint="Approvals, rentals, expenses and access changes will appear here as they happen."
          />
        ) : (
          <div className="rounded-xl border border-border divide-y divide-border">
            {rows.map((r) => {
              const hasMeta = r.metadata && Object.keys(r.metadata as any).length > 0;
              const isOpen = open === r.id;
              return (
                <div key={r.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm">{r.summary}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        <span className={actionTone(r.action)}>{r.action}</span>
                        {" · "}
                        {r.actor_email ?? "system"}
                        {r.actor_role ? ` (${r.actor_role})` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(r.created_at).toLocaleString()}
                      </span>
                      {hasMeta && (
                        <button
                          onClick={() => setOpen(isOpen ? null : r.id)}
                          className="text-muted-foreground"
                          aria-label="Details"
                        >
                          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                      )}
                    </div>
                  </div>
                  {isOpen && hasMeta && (
                    <pre className="mt-2 rounded-lg bg-[#FAFAFB] p-3 text-xs overflow-x-auto">
                      {JSON.stringify(r.metadata, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        The log cannot be edited or deleted from the back office by anyone, including an Owner — it has
        neither a write policy nor a write grant.
      </p>
    </div>
  );
}
