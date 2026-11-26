import { useCallback, useEffect, useState } from "react";
import { AppSelect } from "@/components/ui/app-select";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CalendarCheck, Loader2, MoreHorizontal } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { rowOpenProps, ROW_OPEN_CLASS } from "@/lib/row-click";
import { EmptyState } from "./ui";
import { AdminTableScroll } from "./AdminTableScroll";
import { VehicleCell } from "./VehicleCell";
import { OPEN_COLUMN, ROW_MENU_COLUMN } from "./open-column";
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
import { SwitchReservationVehicleDialog } from "./SwitchReservationVehicleDialog";
import { OnHoldBadge, PutOnHoldDialog, ResumeHoldDialog } from "./OnHoldDialogs";
import { RenterCreditsCard } from "./RenterCreditsCard";
import { convertReservationFeeToCredit } from "@/lib/rental-hold.functions";
import { isOnHoldStatus } from "@/lib/rental-hold";
import { isPendingReservationStatus, PENDING_RESERVATION_LABEL, WAITING_ON_INSURANCE_CARD } from "@/lib/pending-reservation";
import { releaseReservationHold } from "@/lib/reservations.functions";

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
  const releaseHold = useServerFn(releaseReservationHold);
  const toCredit = useServerFn(convertReservationFeeToCredit);
  const [holdRow, setHoldRow] = useState<ReservationRow | null>(null);
  const [resumeRow, setResumeRow] = useState<ReservationRow | null>(null);
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
  const [switchRow, setSwitchRow] = useState<ReservationRow | null>(null);

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

  const onReleaseHold = async (row: ReservationRow) => {
    if (!window.confirm(`Release The Pending Reservation For ${row.driverName ?? "This Driver"}? The Car Returns To Available.`)) return;
    setBusyId(row.id);
    try {
      await releaseHold({ data: { rentalId: row.id } });
      toast.success("Hold Released");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could Not Release The Hold");
    } finally {
      setBusyId(null);
    }
  };

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

  const onKeepAsCredit = async (row: ReservationRow) => {
    if (!row.depositPaymentId) return;
    if (!window.confirm(`Keep ${row.driverName ?? "This Renter"}'s Reservation Fee As A Credit Toward Their Next Rental?`)) return;
    setBusyId(row.id);
    try {
      const r = await toCredit({ data: { paymentId: row.depositPaymentId } });
      toast.success(`Credit Saved: $${r.amount.toFixed(2)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could Not Save Credit");
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
            {rows.length} Reserved Vehicle{rows.length === 1 ? "" : "s"}{rows.some((r) => isOnHoldStatus(r.status)) ? ` (${rows.filter((r) => isOnHoldStatus(r.status)).length} On Hold)` : ""}{rows.some((r) => isPendingReservationStatus(r.status)) ? ` (${rows.filter((r) => isPendingReservationStatus(r.status)).length} Pending Reservation)` : ""}
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
                <th className={`${OPEN_COLUMN} py-2.5 font-semibold`}>Open</th>
                {canManage ? <th className={`${ROW_MENU_COLUMN} py-2.5`} aria-hidden="true" /> : null}
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
                      {isOnHoldStatus(row.status) ? <OnHoldBadge reason={row.holdReason} /> : null}
                      {isPendingReservationStatus(row.status) ? (
                        <span className="mt-0.5 flex flex-col items-start gap-0.5" data-reservation-status="pending_reservation">
                          <span className="inline-flex rounded-full bg-[#FFF4CC] px-2 py-0.5 text-[11px] font-medium text-[#7A5B00]">{PENDING_RESERVATION_LABEL}</span>
                          <span className="text-[11px] text-[#7A5B00]">{WAITING_ON_INSURANCE_CARD}</span>
                        </span>
                      ) : null}
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
                      <VehicleCell
                        vehicleId={row.vehicleId}
                        vehicle={{ label: row.vehicleLabel, plate: row.plate, vinLast6: row.vinLast6, unitNumber: row.unitNumber }}
                        thumbnailPath={row.thumbnailPath ?? null}
                      />
                    </td>
                    <td className="px-2 py-2 align-middle whitespace-nowrap">{fmtDate(row.createdAt)}</td>
                    <td className="px-2 py-2 align-middle">
                      {isPendingReservationStatus(row.status) && !row.pickupTime ? (
                        <span className="text-[#7A5B00]">Not Booked</span>
                      ) : (
                        <>
                          <span className="block whitespace-nowrap">{fmtDate(row.pickupDate)}</span>
                          <span className="block text-xs text-muted-foreground">
                            {row.pickupTime ? formatReservationTime(row.pickupTime) : "No Time Set"}
                          </span>
                        </>
                      )}
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
                    <td className={`${OPEN_COLUMN} py-2`}>
                        <Link
                          to="/admin"
                          search={{ tab: "bookings", view: "past", id: row.id }}
                          className="inline-flex h-8 items-center justify-center rounded-md border border-[#D6D6DB] bg-white px-2.5 text-xs font-medium text-[#111114] hover:bg-[#FAFAFB]"
                        >
                          Open
                        </Link>
                    </td>
                    {canManage ? (
                      <td className={`${ROW_MENU_COLUMN} py-2`}>
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
                              {isPendingReservationStatus(row.status) ? (
                                <DropdownMenuItem onSelect={() => void onReleaseHold(row)}>Release Hold</DropdownMenuItem>
                              ) : isOnHoldStatus(row.status) ? (
                                <DropdownMenuItem onSelect={() => setResumeRow(row)}>Resume Reservation</DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onSelect={() => setHoldRow(row)}>Put On Hold</DropdownMenuItem>
                              )}
                              {isOnHoldStatus(row.status) && row.depositPaymentId ? (
                                <DropdownMenuItem onSelect={() => void onKeepAsCredit(row)}>Keep {chargeLabel} As Credit</DropdownMenuItem>
                              ) : null}
                              {!isOnHoldStatus(row.status) && !isPendingReservationStatus(row.status) && <DropdownMenuItem onSelect={() => setSwitchRow(row)}>Switch Vehicle</DropdownMenuItem>}
                              <DropdownMenuItem onSelect={() => void onCancel(row)}>Cancel Reservation</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                      </td>
                    ) : null}
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
      {canManage && switchRow ? (
        <SwitchReservationVehicleDialog
          open={!!switchRow}
          onOpenChange={(v) => !v && setSwitchRow(null)}
          rentalId={switchRow.id}
          driverName={switchRow.driverName}
          currentVehicleLabel={[switchRow.vehicleLabel, switchRow.plate].filter(Boolean).join(" · ") || null}
          currentRate={typeof switchRow.weeklyRate === "number" ? switchRow.weeklyRate : null}
          onSwitched={refresh}
        />
      ) : null}
      <RenterCreditsCard
        canManage={canManage}
        rentals={rows.map((r) => ({ id: r.id, applicationId: r.applicationId, label: r.vehicleLabel ?? "Reservation" }))}
      />
      {holdRow ? (
        <PutOnHoldDialog open={!!holdRow} onOpenChange={(v) => !v && setHoldRow(null)} rentalId={holdRow.id} driverName={holdRow.driverName} onSaved={refresh} />
      ) : null}
      {resumeRow ? (
        <ResumeHoldDialog open={!!resumeRow} onOpenChange={(v) => !v && setResumeRow(null)} rentalId={resumeRow.id} driverName={resumeRow.driverName} onSaved={refresh} />
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
