import { useMemo, useEffect, useState } from "react";
import { dailyRateLabel } from "@/lib/rent-standing";
import { Link, useNavigate } from "@tanstack/react-router";
import { rowOpenProps, ROW_OPEN_CLASS } from "@/lib/row-click";
import { useServerFn } from "@tanstack/react-start";
import { CalendarCheck, MoreVertical } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "./ui";
import { AdminTableScroll } from "./AdminTableScroll";
import { VehicleCell } from "./VehicleCell";
import { OPEN_COLUMN, ROW_MENU_COLUMN } from "./open-column";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  etDateISO,
  formatBoardDate,
  formatWeeklyRate,
  paymentStatusLabel,
  weeksInLabel,
  type ActiveRentalRow,
} from "@/lib/active-rentals";
import { activeLengthDays, orderByLength, type RentalLengthOrder } from "@/lib/rental-length-order";
import { RentalLengthSort } from "./RentalLengthSort";
import { listActiveRentals } from "@/lib/active-rentals.functions";
import { getRentalLateFees, type RentalLateFeeStatus } from "@/lib/rent-reminders.functions";
import { RecordPaymentDialog, WaiveLateFeeDialog, lateFeeLabel } from "./RentPaymentActions";
import { OverdueStatus } from "./OverdueStatus";
import { ManageLateFeesDialog } from "./ManageLateFeesDialog";
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

export function ActiveRentalsPanel({
  previewRows,
  initialLengthOrder = "default",
  initialFilter = "all",
}: {
  previewRows?: ActiveRentalRow[];
  initialLengthOrder?: RentalLengthOrder;
  initialFilter?: (typeof FILTERS)[number]["id"];
} = {}) {
  const navigate = useNavigate();
  const fetchBoard = useServerFn(listActiveRentals);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>(initialFilter);
  const [lengthOrder, setLengthOrder] = useState<RentalLengthOrder>(initialLengthOrder);
  const [rows, setRows] = useState<ActiveRentalRow[]>(previewRows ?? []);
  const [loaded, setLoaded] = useState({ payments: true, issues: true, incidents: true, documents: true });
  const [loading, setLoading] = useState(!previewRows);
  const fetchFees = useServerFn(getRentalLateFees);
  const [fees, setFees] = useState<Map<string, RentalLateFeeStatus>>(new Map());
  const [feesLoaded, setFeesLoaded] = useState(!!previewRows);
  const [reload, setReload] = useState(0);
  const [dialog, setDialog] = useState<{ kind: "pay" | "waive" | "return" | "fees"; row: ActiveRentalRow } | null>(null);

  useEffect(() => {
    if (previewRows) return;
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
  }, [fetchFees, reload, previewRows]);

  useEffect(() => {
    if (previewRows) return;
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
  }, [fetchBoard, reload, previewRows]);

  const today = etDateISO();
  const visible = useMemo(() => {
    const filtered = rows.filter((row) => {
      if (filter === "overdue") return (row.overdueDays ?? 0) > 0;
      if (filter === "issues") return (row.openIssues ?? 0) > 0;
      return true;
    });
    return orderByLength(filtered, (row) => activeLengthDays(row.startDate, today), lengthOrder);
  }, [rows, filter, lengthOrder, today]);

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
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {visible.length} Active Rental{visible.length === 1 ? "" : "s"}
          </span>
          <RentalLengthSort value={lengthOrder} onChange={setLengthOrder} />
        </div>
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
          {/* Fits ~1000px content width at 1280 / 100% zoom: no min-width, merged cells. */}
          <table className="w-full table-fixed text-left text-sm" data-testid="active-rentals-table">
            <thead className="text-[11px] font-semibold text-[#55555E]">
              <tr className="border-b border-[#EDEDF0]">
                <th className="w-[16%] px-2 py-2.5 font-semibold">Driver</th>
                <th className="w-[22%] px-2 py-2.5 font-semibold">Vehicle</th>
                <th className="w-[14%] px-2 py-2.5 font-semibold">Started</th>
                <th className="w-[10%] px-2 py-2.5 font-semibold">Rate</th>
                <th className="w-[16%] px-2 py-2.5 font-semibold">Due</th>
                <th className="w-[12%] px-2 py-2.5 font-semibold">Overdue</th>
                <th className={`${OPEN_COLUMN} py-2.5 font-semibold`}>Open</th>
                <th className={`${ROW_MENU_COLUMN} py-2.5`} aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const vehiclePlate = (row.vehicleLabel || "").split(" · ").slice(1).join(" · ") || null;
                const fee = fees.get(row.id);
                // Late only shows beside an overdue badge: a rental the shared rent standing calls
                // Current (rent paid on any row, or a daily plan) never carries a Late amount.
                const lateDue = (fee?.lateFee ?? 0) > 0 && !fee?.waived && (row.overdueDays ?? 0) > 0;
                return (
                  <tr
                    key={row.id}
                    className={`border-b border-[#EDEDF0] last:border-0 ${ROW_OPEN_CLASS}`}
                    data-testid="active-rental-row"
                    {...rowOpenProps(() => void navigate({ to: "/admin", search: { tab: "bookings", view: "past", id: row.id } as never }))}
                  >
                    <td className="px-2 py-2 align-middle font-medium text-[#111114]">
                      <span className="block truncate">{row.driverName}</span>
                    </td>
                    <td className="px-2 py-2 align-middle text-[#111114]">
                      <VehicleCell
                        vehicleId={row.vehicleId}
                        vehicle={{ label: row.vehicleLabel, plate: vehiclePlate, vinLast6: row.vehicleVinLast6, unitNumber: row.vehicleUnit }}
                        thumbnailPath={row.thumbnailPath ?? null}
                      />
                    </td>
                    <td className="px-2 py-2 align-middle">
                      <span className="block whitespace-nowrap">{formatBoardDate(row.startDate)}</span>
                      <span className="block text-xs text-muted-foreground">{weeksInLabel(row.weeksIn)}</span>
                    </td>
                    <td className="px-2 py-2 align-middle whitespace-nowrap" data-testid="rate-cell">
                      {row.cadence === "daily" && row.dailyRate ? (
                        <>
                          <span className="block">{dailyRateLabel(row.dailyRate)}</span>
                          <span className="block text-xs text-muted-foreground">Weekly {formatWeeklyRate(row.weeklyRate)}</span>
                        </>
                      ) : (
                        formatWeeklyRate(row.weeklyRate)
                      )}
                    </td>
                    <td className="px-2 py-2 align-middle">
                      <span className="block whitespace-nowrap">{formatBoardDate(row.nextPaymentDue) || "No Due Date"}</span>
                      <span className="block text-xs text-muted-foreground">
                        {paymentStatusLabel(row.lastPaymentStatus, row.paymentsLoaded)}
                        {row.lastPaymentViaStripe ? " · Stripe" : ""}
                      </span>
                      {(row.rentOwed ?? 0) > 0 ? (
                        <span className="block text-xs font-medium text-[#111114]" data-testid="rent-owed">
                          Owes {formatWeeklyRate(row.rentOwed ?? 0)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 align-middle">
                      {fee ? (
                        // Manager and above (the late fee read is manager-only): opens Manage Late Fees, never the row.
                        <button
                          type="button"
                          data-no-row-click
                          data-testid="late-fee-cell"
                          aria-label={`Manage Late Fees For ${row.driverName}`}
                          title="Manage Late Fees"
                          className="-m-1 rounded-md p-1 text-left hover:bg-[#F5F5F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D03020]/40"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDialog({ kind: "fees", row });
                          }}
                        >
                          <OverdueCellBody row={row} fee={fee} feesLoaded={feesLoaded} lateDue={lateDue} />
                        </button>
                      ) : (
                        <OverdueCellBody row={row} fee={fee} feesLoaded={feesLoaded} lateDue={lateDue} />
                      )}
                    </td>
                    <td className={`${OPEN_COLUMN} py-2`}>
                        <Link
                          to="/admin"
                          search={{ tab: "bookings", view: "past", id: row.id }}
                          className="inline-flex h-8 items-center justify-center rounded-md border border-[#D6D6DB] bg-white px-2.5 text-xs font-medium text-[#111114] hover:bg-[#FAFAFB]"
                        >
                          Open
                        </Link>
                    </td>
                    <td className={`${ROW_MENU_COLUMN} py-2`}>
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
                            {row.vehicleId ? (
                              <DropdownMenuItem asChild>
                                <Link to="/admin" search={{ tab: "vehicles", id: row.vehicleId }}>
                                  Vehicle
                                </Link>
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuSeparator />
                            {fees.get(row.id)?.mode === "manual" ? (
                              <DropdownMenuItem onSelect={() => setDialog({ kind: "pay", row })}>Record Payment</DropdownMenuItem>
                            ) : null}
                            {fees.get(row.id) ? (
                              <DropdownMenuItem onSelect={() => setDialog({ kind: "fees", row })}>Manage Late Fees</DropdownMenuItem>
                            ) : null}
                            {fees.get(row.id)?.owing ? (
                              <DropdownMenuItem onSelect={() => setDialog({ kind: "waive", row })}>Waive Late Fee</DropdownMenuItem>
                            ) : null}
                            {fees.get(row.id) ? <DropdownMenuSeparator /> : null}
                            {RETURN_FLOW_ENABLED ? (
                              <DropdownMenuItem onSelect={() => setDialog({ kind: "return", row })}>Return</DropdownMenuItem>
                            ) : null}
                            {RETURN_FLOW_ENABLED ? <DropdownMenuSeparator /> : null}
                            <DropdownMenuItem asChild>
                              <Link to="/admin" search={{ tab: "issues", filter: "driver" }}>Issues: {countLabel(row.openIssues)}</Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link to="/admin" search={{ tab: "issues", filter: "incident" }}>Incidents: {countLabel(row.openIncidents)}</Link>
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
      {dialog?.kind === "fees" ? (
        <ManageLateFeesDialog
          open
          onOpenChange={(v) => {
            if (!v) setDialog(null);
          }}
          rentalId={dialog.row.id}
          driverName={dialog.row.driverName}
          onChanged={() => setReload((n) => n + 1)}
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

function OverdueCellBody({ row, fee, feesLoaded, lateDue }: { row: ActiveRentalRow; fee: RentalLateFeeStatus | undefined; feesLoaded: boolean; lateDue: boolean }) {
  return (
    <>
      <OverdueStatus days={row.overdueDays} />
      {lateDue ? (
        <span className="mt-1 block text-xs font-medium text-[#D03020]" data-testid="late-fee">
          Late {lateFeeLabel(fee, feesLoaded)}
        </span>
      ) : fee && fee.forgiven > 0 ? (
        <span className="mt-1 block text-xs text-muted-foreground" data-testid="late-fee">
          Forgiven {lateFeeLabelMoney(fee.forgiven)}
        </span>
      ) : (
        <span className="sr-only" data-testid="late-fee">
          {lateFeeLabel(fee, feesLoaded)}
        </span>
      )}
    </>
  );
}

function lateFeeLabelMoney(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
