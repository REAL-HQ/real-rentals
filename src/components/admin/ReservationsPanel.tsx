import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, MoreHorizontal } from "lucide-react";
import {
  cancelReservation,
  listReservations,
  recordReservationDeposit,
} from "@/lib/reservations.functions";
import type { ReservationRow } from "@/lib/reservations";
import {
  RESERVATION_DEPOSIT_STATUS_LABEL,
  type ReservationDepositSettings,
} from "@/lib/reservation-deposit-settings";
import { MANUAL_METHODS, easternParts, money } from "@/lib/rent-reminders";
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

function RecordDepositDialog({
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
  const save = useServerFn(recordReservationDeposit);
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
      toast.success("Deposit Recorded");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could Not Record The Deposit");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white">
        <DialogHeader>
          <DialogTitle>Record Deposit: {row.driverName ?? "Driver"}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-[#55555E]">
          Manual only (Cash App, Venmo, Zelle, cash, card). Stripe deposit links are not built yet.
        </p>
        <div className="grid gap-3">
          <Field label="Amount">
            <input className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" />
          </Field>
          <Field label="Method">
            <select className={input} value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Method">
              {MANUAL_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
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
            {busy ? "Saving…" : "Record Deposit"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReservationsPanel({ canManage = false }: { canManage?: boolean }) {
  const load = useServerFn(listReservations);
  const cancel = useServerFn(cancelReservation);
  const [rows, setRows] = useState<ReservationRow[]>([]);
  const [settings, setSettings] = useState<ReservationDepositSettings | null>(null);
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
        setSettings(r.settings);
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold text-[#111114]">Booked</h2>
          <p className="text-sm text-[#55555E]">
            Holds before Start.
            {settings?.enabled ? ` Deposit ${money(settings.defaultAmount)}` : " Deposit Off"}.
          </p>
        </div>
        {canManage ? (
          <button type="button" className={primary} onClick={() => setReserveOpen(true)}>
            Reserve Car
          </button>
        ) : null}
      </div>

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-[#55555E]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading Reservations…
        </p>
      ) : failed ? (
        <p className="text-sm text-[#8A1C10]">Could Not Load Reservations. Apply The Rental Reservations Migration If It Is Missing.</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#EDEDF0] bg-white p-8 text-center text-sm text-[#55555E]">
          No Reservations Yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#EDEDF0] bg-white">
          <table className="w-full text-sm">
            <thead className="bg-[#FAFAFB] text-left text-xs uppercase tracking-wide text-[#9A9AA3]">
              <tr>
                <th className="px-3 py-2 font-medium">Driver</th>
                <th className="px-3 py-2 font-medium">Vehicle</th>
                <th className="px-3 py-2 font-medium">Pickup</th>
                <th className="px-3 py-2 font-medium">Deposit</th>
                <th className="px-3 py-2 font-medium">Note</th>
                {canManage ? <th className="px-3 py-2 font-medium" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F1F4]">
              {rows.map((row) => (
                <tr key={row.id} data-reservation-id={row.id}>
                  <td className="px-3 py-2.5 font-medium text-[#111114]">{row.driverName ?? "—"}</td>
                  <td className="px-3 py-2.5 text-[#55555E]">
                    {row.unitNumber ? `Unit ${row.unitNumber}` : null}
                    {row.unitNumber && row.vehicleLabel ? " · " : null}
                    {row.vehicleLabel ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 text-[#55555E]">{row.pickupDate}</td>
                  <td className="px-3 py-2.5">
                    <span
                      data-deposit-status={row.depositStatus}
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        row.depositStatus === "pending"
                          ? "bg-[#FFF4D6] text-[#8A6A00]"
                          : row.depositStatus === "paid" || row.depositStatus === "applied"
                            ? "bg-[#E7F6EC] text-[#1B6B3A]"
                            : "bg-[#F1F1F4] text-[#55555E]"
                      }`}
                    >
                      {RESERVATION_DEPOSIT_STATUS_LABEL[row.depositStatus]}
                      {row.depositRequired && row.depositAmount > 0 ? ` · ${money(row.depositAmount)}` : ""}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-[#55555E] max-w-[14rem] truncate">{row.note ?? "—"}</td>
                  {canManage ? (
                    <td className="px-3 py-2.5 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#EDEDF0] bg-white text-[#55555E] hover:border-[#D6D6DB]"
                            aria-label="Reservation Actions"
                            disabled={busyId === row.id}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-white">
                          {(row.depositStatus === "pending" || row.depositStatus === "not_required") && (
                            <DropdownMenuItem onSelect={() => setDepositRow(row)}>Record Deposit</DropdownMenuItem>
                          )}
                          <DropdownMenuItem onSelect={() => void onCancel(row)}>Cancel Reservation</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage ? (
        <ReserveCarDialog
          open={reserveOpen}
          onOpenChange={setReserveOpen}
          settings={settings}
          onSaved={refresh}
        />
      ) : null}
      {depositRow ? (
        <RecordDepositDialog
          open={!!depositRow}
          onOpenChange={(v) => !v && setDepositRow(null)}
          row={depositRow}
          onSaved={refresh}
        />
      ) : null}
    </div>
  );
}
