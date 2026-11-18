import { useCallback, useEffect, useState } from "react";
import { AppSelect } from "@/components/ui/app-select";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CalendarCheck, Loader2, MoreHorizontal } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { rowOpenProps, ROW_OPEN_CLASS } from "@/lib/row-click";
import { EmptyState } from "./ui";
import { AdminTableScroll } from "./AdminTableScroll";
import { VehicleStaffPhoto } from "./VehicleStaffPhoto";
import {
  cancelReservation,
  listReservations,
  recordReservationFee,
} from "@/lib/reservations.functions";
import { reservationFeeLabel, type ReservationRow } from "@/lib/reservations";
import { MANUAL_METHODS, easternParts } from "@/lib/rent-reminders";
import { fmtDate, formatReservationTime } from "@/lib/date-format";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ReserveCarDialog } from "./ReserveCarDialog";

const input = "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm";
const primary = "inline-flex h-9 items-center justify-center rounded-md bg-[#D03020] px-4 text-sm font-semibold text-white hover:bg-[#B52818] disabled:opacity-50";
const secondary = "inline-flex h-9 items-center justify-center rounded-md border border-[#D6D6DB] bg-white px-4 text-sm font-medium text-[#111114] hover:bg-[#FAFAFB]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function RecordReservationFeeDialog({
  open,
  onOpenChange,
  row,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  row: ReservationRow;
  onSaved: () => void;
}) {
  const save = useServerFn(recordReservationFee);
  const chargeLabel = "Reservation Fee";
  const [amount, setAmount] = useState(row.depositAmount > 0 ? String(row.depositAmount) : "");
  const [method, setMethod] = useState<string>(MANUAL_METHODS[0].value);
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(easternParts(new Date()).date);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setAmount(row.depositAmount > 0 ? String(row.depositAmount) : "");
      setMethod(MANUAL_METHODS[0].value);
      setReference("");
      setPaidOn(easternParts(new Date()).date);
    }
  }, [open, row.depositAmount]);

  const submit = async () => {
    const n = Number(amount);
    if (!(n > 0)) {
      toast.error("Enter An Amount");
      return;
    }
    setBusy(true);
    try {
      await save({
        data: {
          rentalId: row.id,
          amount: n,
          method,
          reference: reference.trim() || null,
          paidOn,
        },
      });
      toast.success(`${chargeLabel} Recorded`);
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Could Not Record The ${chargeLabel}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white">
        <DialogHeader>
          <DialogTitle>Record {chargeLabel}: {row.driverName ?? "Driver"}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-[#55555E]">
          Paid outside the Stripe link (Cash App, Venmo, Zelle, cash). The Reservation Fee is applied to week 1; it is not a deposit. An open Stripe link for this renter is closed first.
        </p>
        <div className="grid gap-3">
          <Field label="Amount">
            <input className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" />
          </Field>
          <Field label="Method">
            <AppSelect className={input} value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Method">
              {MANUAL_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </AppSelect>
          </Field>
          <Field label="Reference">
            <input className={input} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Confirmation Or Note" aria-label="Reference" />
          </Field>
          <Field label="Date Paid">
            <input className={input} type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} aria-label="Date Paid" />
          </Field>
        </div>
        <DialogFooter>
          <button type="button" className={secondary} onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="button" className={primary} disabled={busy} onClick={() => void submit()}>
            {busy ? "Saving…" : `Record ${chargeLabel}`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReservationsPanel({ canManage = false }: { canManage?: boolean }) {
  const navigate = useNavigate();
  const load = useServerFn(listReservations);
  const cancel = useServerFn(cancelReservation);
  const [rows, setRows] = useState<ReservationRow[]>([]);
  // The $50 Reservation Fee lives in the reservation_deposit_* columns when its
  // switch is on; it is never called a deposit (Dolmar, t309u).
  const [feeOn, setFeeOn] = useState(false);
  const chargeLabel = "Reservation Fee";
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reserveOpen, setReserveOpen] = useState(false);
  const [depositRow, setDepositRow] = useState<ReservationRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setFailed(false);
    load()
      .then((r) => {
        setRows(r.rows);
        setFeeOn((r as { reservationFeeOn?: boolean }).reservationFeeOn === true);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onCancel = async (row: ReservationRow) => {
    if (!window.confirm(`Cancel The Reservation For ${row.driverName ?? "This Driver"}?`)) return;
    setBusyId(row.id);
    try {
      await cancel({ data: { rentalId: row.id } });
      toast.success("Reservation Cancelled");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could Not Cancel");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4" data-testid="reservations-panel">
      <div className="admin-sticky-bar flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[#55555E]">
          Cars held for a renter before pickup.
          {feeOn ? " Reservation Fee (applied to week 1)." : " Reservation Fee Off."}
        </p>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground" data-testid="reserved-count">
            {rows.length} Reserved Vehicle{rows.length === 1 ? "" : "s"}
          </span>
          {canManage ? (
            <button type="button" className={primary} onClick={() => setReserveOpen(true)}>
              Reserve A Car
            </button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-[#55555E]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading Reservations…
        </p>
      ) : failed ? (
        <p className="text-sm text-[#8A1C10]">Could Not Load Reservations. Apply The Rental Reservations Migration If It Is Missing.</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<CalendarCheck className="w-6 h-6" strokeWidth={1.75} />}
          title="No Reserved Vehicles"
          hint="Rentals with status Reserved show up here."
        />
      ) : (
        <AdminTableScroll className="rounded-2xl border border-[#EDEDF0] bg-white">
          <table className="w-full table-fixed text-left text-sm" data-testid="reserved-table">
            <thead className="text-[11px] font-semibold text-[#55555E]">
              <tr className="border-b border-[#EDEDF0]">
                <th className="w-[15%] px-2 py-2.5 font-semibold">Driver</th>
                <th className="w-[25%] px-2 py-2.5 font-semibold">Vehicle</th>
                <th className="w-[12%] px-2 py-2.5 font-semibold">Reserved</th>
                <th className="w-[15%] px-2 py-2.5 font-semibold">Pickup</th>
                <th className="w-[12%] px-2 py-2.5 font-semibold">{chargeLabel}</th>
                <th className="w-[8%] px-2 py-2.5 font-semibold">Rate</th>
                <th className="w-[13%] px-2 py-2.5 font-semibold text-right sticky right-0 bg-white">Open</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const fee = reservationFeeLabel(row.depositStatus, feeOn);
                return (
                  <tr
                    key={row.id}
                    className={`border-b border-[#EDEDF0] last:border-0 ${ROW_OPEN_CLASS}`}
                    data-testid="reserved-row"
                    data-reservation-id={row.id}
                    {...rowOpenProps(() => void navigate({ to: "/admin", search: { tab: "bookings", view: "past", id: row.id } as never }))}
                  >
                    <td className="px-2 py-2 align-middle font-medium text-[#111114]">
                      <span className="block truncate">{row.driverName ?? "—"}</span>
                      {row.bookedBy === "renter" ? (
                        <span
                          data-booked-by="renter"
                          title="The renter picked this pickup time on the Payment Received page"
                          className="mt-0.5 inline-flex rounded-full bg-[#EEF2FF] px-2 py-0.5 text-[11px] font-medium text-[#3D4BB8]"
                        >
                          Renter-Booked
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 align-middle text-[#111114]">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="block h-8 w-11 shrink-0 overflow-hidden rounded-md border border-border bg-soft">
                          <VehicleStaffPhoto path={row.thumbnailPath ?? null} name={row.vehicleLabel ?? "Vehicle"} className="h-full w-full object-cover" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium leading-tight">{row.vehicleLabel ?? "Unknown"}</span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {[row.plate, row.vinLast6 ? `VIN …${row.vinLast6}` : null, row.unitNumber ? `Unit ${row.unitNumber}` : null].filter(Boolean).join(" · ") || "—"}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-2 align-middle whitespace-nowrap">{fmtDate(row.createdAt)}</td>
                    <td className="px-2 py-2 align-middle">
                      <span className="block whitespace-nowrap">{fmtDate(row.pickupDate)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {row.pickupTime ? formatReservationTime(row.pickupTime) : "No Time Set"}
                      </span>
                    </td>
                    <td className="px-2 py-2 align-middle">
                      <span
                        data-deposit-status={row.depositStatus}
                        data-fee-label={fee}
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          fee === "Unpaid"
                            ? "bg-[#FFF4D6] text-[#8A6A00]"
                            : fee === "Paid"
                              ? "bg-[#E7F6EC] text-[#1B6B3A]"
                              : "bg-[#F1F1F4] text-[#55555E]"
                        }`}
                      >
                        {fee}
                      </span>
                    </td>
                    <td className="px-2 py-2 align-middle whitespace-nowrap">
                      {typeof row.weeklyRate === "number" ? `$${row.weeklyRate.toLocaleString()}/wk` : "—"}
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
                        {canManage ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                aria-label={`Actions For ${row.driverName ?? "Reservation"}`}
                                disabled={busyId === row.id}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-soft hover:text-foreground"
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-white">
                              {feeOn && (row.depositStatus === "pending" || row.depositStatus === "not_required") && (
                                <DropdownMenuItem onSelect={() => setDepositRow(row)}>Record {chargeLabel}</DropdownMenuItem>
                              )}
                              <DropdownMenuItem onSelect={() => void onCancel(row)}>Cancel Reservation</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </AdminTableScroll>
      )}

      {canManage ? (
        <ReserveCarDialog
          open={reserveOpen}
          onOpenChange={setReserveOpen}
          onSaved={refresh}
        />
      ) : null}
      {depositRow ? (
        <RecordReservationFeeDialog
          open={!!depositRow}
          onOpenChange={(v) => !v && setDepositRow(null)}
          row={depositRow}
          onSaved={refresh}
        />
      ) : null}
    </div>
  );
}
