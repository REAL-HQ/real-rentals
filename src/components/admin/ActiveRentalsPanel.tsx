import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CalendarCheck, MoreVertical } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "./ui";
import { AdminTableScroll } from "./AdminTableScroll";
import { VehicleStaffPhoto } from "./VehicleStaffPhoto";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  formatBoardDate,
  formatWeeklyRate,
  overdueLabel,
  paymentStatusLabel,
  weeksInLabel,
  type ActiveRentalRow,
} from "@/lib/active-rentals";
import { listActiveRentals } from "@/lib/active-rentals.functions";
import { getRentalLateFees, type RentalLateFeeStatus } from "@/lib/rent-reminders.functions";
import { RecordPaymentDialog, WaiveLateFeeDialog, lateFeeLabel } from "./RentPaymentActions";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "overdue", label: "Overdue" },
  { id: "issues", label: "Issues" },
] as const;

const HEADERS = ["Driver", "Vehicle", "Started", "Weeks", "Rate", "Due", "Paid", "Overdue", "Late Fee", "Actions"];

function countLabel(value: number | null): string {
  return value == null ? "Unavailable" : String(value);
}

function documentLabel(row: ActiveRentalRow): string {
  if (row.documentsExpiring == null) return "Unavailable";
  return row.documentsExpiring ? "Expiring" : "Current";
}

export function ActiveRentalsPanel() {
  const fetchBoard = useServerFn(listActiveRentals);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [rows, setRows] = useState<ActiveRentalRow[]>([]);
  const [loaded, setLoaded] = useState({ payments: true, issues: true, incidents: true, documents: true });
  const [loading, setLoading] = useState(true);
  const fetchFees = useServerFn(getRentalLateFees);
  const [fees, setFees] = useState<Map<string, RentalLateFeeStatus>>(new Map());
  const [feesLoaded, setFeesLoaded] = useState(false);
  const [reload, setReload] = useState(0);
  const [dialog, setDialog] = useState<{ kind: "pay" | "waive"; row: ActiveRentalRow } | null>(null);

  useEffect(() => {
    let alive = true;
    setFeesLoaded(false);
    fetchFees()
      .then((res) => { if (alive) setFees(new Map(res.rows.map((r) => [r.rentalId, r]))); })
      .catch(() => { if (alive) setFees(new Map()); })
      .finally(() => { if (alive) setFeesLoaded(true); });
    return () => { alive = false; };
  }, [fetchFees, reload]);

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
  }, [fetchBoard, reload]);

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
          {visible.length} Active Rental{visible.length === 1 ? "" : "s"}
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
        <AdminTableScroll className="mt-4 rounded-2xl border border-[#EDEDF0] bg-white">
          <table className="min-w-[1020px] w-full text-left text-sm">
            <thead className="text-[11px] font-semibold text-[#55555E]">
              <tr className="border-b border-[#EDEDF0]">
                {HEADERS.map((label) => (
                  <th key={label} className={`whitespace-nowrap px-3 py-2.5 font-semibold ${label === "Actions" ? "text-right" : ""}`}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const [vehicleName, ...vehicleDetails] = row.vehicleLabel.split(" · ");
                return (
                  <tr key={row.id} className="border-b border-[#EDEDF0] last:border-0" data-testid="active-rental-row">
                    <td className="min-w-[120px] px-3 py-2.5 align-middle font-medium text-[#111114]">{row.driverName}</td>
                    <td className="min-w-[220px] px-3 py-2.5 align-middle text-[#111114]">
                      <div className="flex items-center gap-2.5">
                        <span className="block h-10 w-14 shrink-0 overflow-hidden rounded-md border border-border bg-soft">
                          <VehicleStaffPhoto path={row.thumbnailPath ?? null} name={vehicleName} className="h-full w-full object-cover" />
                        </span>
                        <span className="min-w-0">
                          <span className="block font-medium leading-tight">{vehicleName}</span>
                          {vehicleDetails.length ? <span className="mt-1 block text-xs text-muted-foreground">{vehicleDetails.join(" · ")}</span> : null}
                        </span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 align-middle">{formatBoardDate(row.startDate)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 align-middle">{weeksInLabel(row.weeksIn)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 align-middle">{formatWeeklyRate(row.weeklyRate)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 align-middle">{formatBoardDate(row.nextPaymentDue) || "No Due Date"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 align-middle">
                      {paymentStatusLabel(row.lastPaymentStatus, row.paymentsLoaded)}
                      {row.lastPaymentViaStripe ? <span className="ml-1 text-[11px] text-[#55555E]">Stripe</span> : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 align-middle">
                      {(row.overdueDays ?? 0) > 0 ? (
                        <span className="rounded-full bg-[#D03020] px-2 py-0.5 text-[11px] font-semibold text-white">{overdueLabel(row.overdueDays)}</span>
                      ) : (
                        overdueLabel(row.overdueDays)
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 align-middle" data-testid="late-fee">
                      {(fees.get(row.id)?.lateFee ?? 0) > 0 && !fees.get(row.id)?.waived ? (
                        <span className="rounded-full bg-[#D03020] px-2 py-0.5 text-[11px] font-semibold text-white">{lateFeeLabel(fees.get(row.id), feesLoaded)}</span>
                      ) : (
                        lateFeeLabel(fees.get(row.id), feesLoaded)
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 align-middle">
                      <div className="flex items-center justify-end gap-1.5">
                        <Link
                          to="/admin"
                          search={{ tab: "bookings", view: "past", id: row.id }}
                          className="inline-flex h-8 items-center justify-center rounded-md border border-[#D6D6DB] bg-white px-3 text-xs font-medium text-[#111114] hover:bg-[#FAFAFB]"
                        >
                          Open
                        </Link>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              aria-label={`Actions For ${row.driverName}`}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-soft hover:text-foreground"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            {row.applicationId ? (
                              <DropdownMenuItem asChild>
                                <Link to="/admin" search={{ tab: "drivers", id: row.applicationId }}>Driver</Link>
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuItem asChild>
                              <Link to="/admin" search={{ tab: "vehicles", id: row.vehicleId }}>Vehicle</Link>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {fees.get(row.id)?.mode === "manual" ? (
                              <DropdownMenuItem onSelect={() => setDialog({ kind: "pay", row })}>Record Payment</DropdownMenuItem>
                            ) : null}
                            {fees.get(row.id)?.owing ? (
                              <DropdownMenuItem onSelect={() => setDialog({ kind: "waive", row })}>Waive Late Fee</DropdownMenuItem>
                            ) : null}
                            {fees.get(row.id)?.mode === "manual" || fees.get(row.id)?.owing ? <DropdownMenuSeparator /> : null}
                            <DropdownMenuItem asChild>
                              <Link to="/admin" search={{ tab: "driver_issues" }}>Issues: {countLabel(row.openIssues)}</Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link to="/admin" search={{ tab: "incidents" }}>Incidents: {countLabel(row.openIncidents)}</Link>
                            </DropdownMenuItem>
                            {row.applicationId ? (
                              <DropdownMenuItem asChild>
                                <Link to="/admin" search={{ tab: "drivers", id: row.applicationId }}>Documents: {documentLabel(row)}</Link>
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </AdminTableScroll>
      )}
      {dialog?.kind === "pay" ? (
        <RecordPaymentDialog
          open onOpenChange={(v) => { if (!v) setDialog(null); }}
          rentalId={dialog.row.id} driverName={dialog.row.driverName}
          weeklyRate={typeof dialog.row.weeklyRate === "number" ? dialog.row.weeklyRate : null}
          onSaved={() => setReload((n) => n + 1)}
        />
      ) : null}
      {dialog?.kind === "waive" ? (
        <WaiveLateFeeDialog
          open onOpenChange={(v) => { if (!v) setDialog(null); }}
          rentalId={dialog.row.id} driverName={dialog.row.driverName} status={fees.get(dialog.row.id)}
          onSaved={() => setReload((n) => n + 1)}
        />
      ) : null}
    </div>
  );
}
