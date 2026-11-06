import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CalendarCheck } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "./ui";
import {
  formatBoardDate,
  formatWeeklyRate,
  overdueLabel,
  paymentStatusLabel,
  weeksInLabel,
  type ActiveRentalRow,
} from "@/lib/active-rentals";
import { listActiveRentals } from "@/lib/active-rentals.functions";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "overdue", label: "Overdue" },
  { id: "issues", label: "Issues Open" },
] as const;

function countLabel(value: number | null): string {
  return value == null ? "Unavailable" : String(value);
}

export function ActiveRentalsPanel() {
  const fetchBoard = useServerFn(listActiveRentals);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [rows, setRows] = useState<ActiveRentalRow[]>([]);
  const [loaded, setLoaded] = useState({ payments: true, issues: true, incidents: true, documents: true });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchBoard({ data: {} })
      .then((res) => {
        if (!alive) return;
        setRows(res.rows);
        setLoaded({
          payments: res.paymentsLoaded,
          issues: res.issuesLoaded,
          incidents: res.incidentsLoaded,
          documents: res.documentsLoaded,
        });
      })
      .catch((e) => {
        if (!alive) return;
        toast.error(e instanceof Error ? e.message : "Could not load active rentals");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [fetchBoard]);

  const visible = rows.filter((row) => {
    if (filter === "overdue") return (row.overdueDays ?? 0) > 0;
    if (filter === "issues") return (row.openIssues ?? 0) > 0;
    return true;
  });

  return (
    <div className="space-y-4" data-testid="active-rentals">
      <div className="admin-sticky-bar flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                filter === item.id
                  ? "border-[#D03020] bg-[#D03020] text-white"
                  : "border-[#EDEDF0] text-[#55555E] hover:border-[#D6D6DB]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span className="text-sm text-muted-foreground">
          {visible.length} active rental{visible.length === 1 ? "" : "s"}
        </span>
      </div>

      {!loaded.payments || !loaded.issues || !loaded.incidents || !loaded.documents ? (
        <p className="text-sm text-[#D03020]">
          {[
            !loaded.payments ? "Payment status is unavailable." : null,
            !loaded.issues ? "Open issue counts are unavailable." : null,
            !loaded.incidents ? "Open incident counts are unavailable." : null,
            !loaded.documents ? "Document expiry is unavailable." : null,
          ].filter(Boolean).join(" ")}
          {" "}Unavailable means that read did not load.
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<CalendarCheck className="w-6 h-6" strokeWidth={1.75} />}
          title={filter === "all" ? "No Active Rentals" : "Nothing In This Filter"}
          hint="Rentals with status Active show up here."
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#EDEDF0] bg-white">
          <table className="min-w-[1080px] w-full text-left text-sm">
            <thead className="text-[11px] font-semibold text-[#55555E]">
              <tr className="border-b border-[#EDEDF0]">
                {["Driver", "Vehicle", "Started", "Weeks In", "Weekly Rate", "Next Payment Due", "Last Payment", "Overdue", "Issues", "Incidents", "Documents", "Booking"].map((label) => (
                  <th key={label} className="px-3 py-2 font-semibold">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id} className="border-b border-[#EDEDF0] last:border-0" data-testid="active-rental-row">
                  <td className="px-3 py-3 align-top">
                    {row.applicationId ? (
                      <Link to="/admin" search={{ tab: "drivers", id: row.applicationId }} className="font-medium text-[#111114] hover:underline">
                        {row.driverName}
                      </Link>
                    ) : (
                      <span className="font-medium text-[#111114]">{row.driverName}</span>
                    )}
                  </td>
                  <td className="px-3 py-3 align-top text-[#111114]">{row.vehicleLabel}</td>
                  <td className="px-3 py-3 align-top whitespace-nowrap">{formatBoardDate(row.startDate)}</td>
                  <td className="px-3 py-3 align-top whitespace-nowrap">{weeksInLabel(row.weeksIn)}</td>
                  <td className="px-3 py-3 align-top whitespace-nowrap">{formatWeeklyRate(row.weeklyRate)}</td>
                  <td className="px-3 py-3 align-top whitespace-nowrap">{formatBoardDate(row.nextPaymentDue) || "No Due Date"}</td>
                  <td className="px-3 py-3 align-top whitespace-nowrap">
                    {paymentStatusLabel(row.lastPaymentStatus, row.paymentsLoaded)}
                    {row.lastPaymentViaStripe ? <span className="ml-1 text-[11px] text-[#55555E]">Stripe</span> : null}
                  </td>
                  <td className="px-3 py-3 align-top whitespace-nowrap">
                    {(row.overdueDays ?? 0) > 0 ? (
                      <span className="rounded-full bg-[#D03020] px-2 py-0.5 text-[11px] font-semibold text-white">{overdueLabel(row.overdueDays)}</span>
                    ) : (
                      overdueLabel(row.overdueDays)
                    )}
                  </td>
                  <td className="px-3 py-3 align-top">{countLabel(row.openIssues)}</td>
                  <td className="px-3 py-3 align-top">{countLabel(row.openIncidents)}</td>
                  <td className="px-3 py-3 align-top whitespace-nowrap">
                    {row.documentsExpiring == null ? "Unavailable" : row.documentsExpiring ? (
                      <span className="rounded-full bg-[#D03020] px-2 py-0.5 text-[11px] font-semibold text-white">Expiring</span>
                    ) : "Current"}
                  </td>
                  <td className="px-3 py-3 align-top whitespace-nowrap">
                    <Link to="/admin" search={{ tab: "bookings", id: row.id }} className="text-[#111114] hover:underline">
                      Open Booking
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
