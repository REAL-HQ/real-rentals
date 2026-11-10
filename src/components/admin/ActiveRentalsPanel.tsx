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
import { ReturnFlowDialog } from "./ReturnFlowDialog";
import { RETURN_FLOW_ENABLED } from "@/lib/return-flow";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "overdue", label: "Overdue" },
  { id: "issues", label: "Issues" },
] as const;

function countLabel(value: number | null): string {
  return value == null ? "Unavailable" : String(value);
}

function documentLabel(row: ActiveRentalRow): string {
  if (row.documentsExpiring == null) return "Unavailable";
  return row.documentsExpiring ? "Expiring" : "Current";
}

function isAbortError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { name?: string; message?: string; cause?: { name?: string } };
  const msg = String(err.message ?? "");
  return (
    err.name === "AbortError" ||
    err.cause?.name === "AbortError" ||
    /aborted|ERR_CONNECTION_CLOSED|Failed to fetch|The operation was aborted/i.test(msg)
  );
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
  const [dialog, setDialog] = useState<{ kind: "pay" | "waive" | "return"; row: ActiveRentalRow } | null>(null);

  useEffect(() => {
    let alive = true;
    setFeesLoaded(false);
    fetchFees()
      .then((res) => {
        if (alive) setFees(new Map(res.rows.map((r) => [r.rentalId, r])));
      })
      .catch((e) => {
        if (!alive || isAbortError(e)) return;
        setFees(new Map());
      })
      .finally(() => {
        if (alive) setFeesLoaded(true);
      });
    return () => {
      alive = false;
    };
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
        if (!alive || isAbortError(e)) return;
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
          ]
            .filter(Boolean)
            .join(" ")}{" "}
          Unavailable means that read did not load.
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
          {/* Fits ~1000px content width at 1280 / 100% zoom: no min-width, merged cells, sticky Open. */}
          <table className="w-full table-fixed text-left text-sm" data-testid="active-rentals-table">
            <thead className="text-[11px] font-semibold text-[#55555E]">
              <tr className="border-b border-[#EDEDF0]">
                <th className="w-[16%] px-2 py-2.5 font-semibold">Driver</th>
                <th className="w-[22%] px-2 py-2.5 font-semibold">Vehicle</th>
                <th className="w-[14%] px-2 py-2.5 font-semibold">Started</th>
                <th className="w-[10%] px-2 py-2.5 font-semibold">Rate</th>
                <th className="w-[16%] px-2 py-2.5 font-semibold">Due</th>
                <th className="w-[12%] px-2 py-2.5 font-semibold">Overdue</th>
                <th className="w-[10%] px-2 py-2.5 font-semibold text-right sticky right-0 bg-white">Open</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const [vehicleName, ...vehicleDetails] = row.vehicleLabel.split(" · ");
                const fee = fees.get(row.id);
                const lateDue = (fee?.lateFee ?? 0) > 0 && !fee?.waived;
                return (
                  <tr key={row.id} className="border-b border-[#EDEDF0] last:border-0" data-testid="active-rental-row">
                    <td className="px-2 py-2 align-middle font-medium text-[#111114]">
                      <span className="block truncate">{row.driverName}</span>
                    </td>
                    <td className="px-2 py-2 align-middle text-[#111114]">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="block h-8 w-11 shrink-0 overflow-hidden rounded-md border border-border bg-soft">
                          <VehicleStaffPhoto path={row.thumbnailPath ?? null} name={vehicleName} className="h-full w-full object-cover" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium leading-tight">{vehicleName}</span>
                          {vehicleDetails.length ? (
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{vehicleDetails.join(" · ")}</span>
                          ) : null}
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-2 align-middle">
                      <span className="block whitespace-nowrap">{formatBoardDate(row.startDate)}</span>
                      <span className="block text-xs text-muted-foreground">{weeksInLabel(row.weeksIn)}</span>
                    </td>
                    <td className="px-2 py-2 align-middle whitespace-nowrap">{formatWeeklyRate(row.weeklyRate)}</td>
                    <td className="px-2 py-2 align-middle">
                      <span className="block whitespace-nowrap">{formatBoardDate(row.nextPaymentDue) || "No Due Date"}</span>
                      <span className="block text-xs text-muted-foreground">
                        {paymentStatusLabel(row.lastPaymentStatus, row.paymentsLoaded)}
                        {row.lastPaymentViaStripe ? " · Stripe" : ""}
                      </span>
                    </td>
                    <td className="px-2 py-2 align-middle">
                      {(row.overdueDays ?? 0) > 0 ? (
                        <span className="rounded-full bg-[#D03020] px-2 py-0.5 text-[11px] font-semibold text-white">
                          {overdueLabel(row.overdueDays)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{overdueLabel(row.overdueDays)}</span>
                      )}
                      {lateDue ? (
                        <span className="mt-1 block text-xs font-medium text-[#D03020]" data-testid="late-fee">
                          Late {lateFeeLabel(fee, feesLoaded)}
                        </span>
                      ) : (
                        <span className="sr-only" data-testid="late-fee">
                          {lateFeeLabel(fee, feesLoaded)}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 align-middle sticky right-0 bg-white">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          to="/admin"
                          search={{ tab: "bookings", view: "past", id: row.id }}
                          className="inline-flex h-8 items-center justify-center rounded-md border border-[#D6D6DB] bg-white px-2.5 text-xs font-medium text-[#111114] hover:bg-[#FAFAFB]"
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
                          <DropdownMenuContent align="end" className="w-48 bg-white">
                            {row.applicationId ? (
                              <DropdownMenuItem asChild>
                                <Link to="/admin" search={{ tab: "drivers", id: row.applicationId }}>
                                  Driver
                                </Link>
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuItem asChild>
                              <Link to="/admin" search={{ tab: "vehicles", id: row.vehicleId }}>
                                Vehicle
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {fees.get(row.id)?.mode === "manual" ? (
                              <DropdownMenuItem onSelect={() => setDialog({ kind: "pay", row })}>Record Payment</DropdownMenuItem>
                            ) : null}
                            {fees.get(row.id)?.owing ? (
                              <DropdownMenuItem onSelect={() => setDialog({ kind: "waive", row })}>Waive Late Fee</DropdownMenuItem>
                            ) : null}
                            {fees.get(row.id)?.mode === "manual" || fees.get(row.id)?.owing ? <DropdownMenuSeparator /> : null}
                            {RETURN_FLOW_ENABLED ? (
                              <DropdownMenuItem onSelect={() => setDialog({ kind: "return", row })}>Return</DropdownMenuItem>
                            ) : null}
                            {RETURN_FLOW_ENABLED ? <DropdownMenuSeparator /> : null}
                            <DropdownMenuItem asChild>
                              <Link to="/admin" search={{ tab: "driver_issues" }}>
                                Issues: {countLabel(row.openIssues)}
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link to="/admin" search={{ tab: "incidents" }}>
                                Incidents: {countLabel(row.openIncidents)}
                              </Link>
                            </DropdownMenuItem>
                            {row.applicationId ? (
                              <DropdownMenuItem asChild>
                                <Link to="/admin" search={{ tab: "drivers", id: row.applicationId }}>
                                  Documents: {documentLabel(row)}
                                </Link>
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
          open
          onOpenChange={(v) => {
            if (!v) setDialog(null);
          }}
          rentalId={dialog.row.id}
          driverName={dialog.row.driverName}
          weeklyRate={typeof dialog.row.weeklyRate === "number" ? dialog.row.weeklyRate : null}
          onSaved={() => setReload((n) => n + 1)}
        />
      ) : null}
      {dialog?.kind === "return" && RETURN_FLOW_ENABLED ? (
        <ReturnFlowDialog
          rentalId={dialog.row.id}
          driverName={dialog.row.driverName}
          onClose={() => setDialog(null)}
          onCompleted={() => {
            setDialog(null);
            setReload((n) => n + 1);
          }}
        />
      ) : null}
      {dialog?.kind === "waive" ? (
        <WaiveLateFeeDialog
          open
          onOpenChange={(v) => {
            if (!v) setDialog(null);
          }}
          rentalId={dialog.row.id}
          driverName={dialog.row.driverName}
          status={fees.get(dialog.row.id)}
          onSaved={() => setReload((n) => n + 1)}
        />
      ) : null}
    </div>
  );
}
