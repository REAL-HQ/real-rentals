import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  X,
  Loader2,
  ClipboardCheck,
  LogOut,
  PiggyBank,
  MessageSquare,
  Receipt,
  AlertTriangle,
  Wrench,
  ArrowUpRight,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { endRental } from "@/lib/rentals.functions";
import { startInspection } from "@/lib/inspections.functions";
import { InspectionRunner } from "@/components/admin/InspectionsPanel";
import { DepositDialog } from "@/components/admin/DepositDialog";
import { MicroLabel } from "./ui";
import { CloseoutReadiness } from "./CloseoutReadiness";
import type { BookingDetail } from "@/lib/bookings.functions";

// The booking's actions — all of them somebody else's, on purpose.
//
// Every button here calls a server function that already existed and already
// decided who may call it: endRental (which is the only caller of
// end_rental_tx), settleDeposit through the existing DepositDialog,
// startInspection and then the existing InspectionRunner. Nothing in this file
// writes to a table, computes money, or reimplements a step. A second BUTTON on
// an existing transaction is not a second transaction; a second transaction is
// what AGENTS.md forbids, and there isn't one here.
//
// `canManage` only decides what is worth offering. Each server function
// re-authorises its own call, so hiding a button is a courtesy and never the
// boundary.

type Template = { id: string; name: string; inspection_type: string };

/** Which checklist a handoff wants: out at pickup, back at return. */
type Handoff = "checkout" | "checkin";

const HANDOFF_LABEL: Record<Handoff, string> = {
  checkout: "Check-Out",
  checkin: "Check-In",
};
/** `pre_delivery` is the going-out checklist; `return` is the coming-back one. */
const HANDOFF_TYPE: Record<Handoff, string> = {
  checkout: "pre_delivery",
  checkin: "return",
};

const today = () => new Date().toISOString().slice(0, 10);

export function BookingActions({
  d,
  onRefresh,
  onOpenMessages,
  onOpenTab,
}: {
  d: BookingDetail;
  onRefresh: () => void;
  /** Opens the existing message overlay on this applicant's thread. */
  onOpenMessages: (applicationId: string) => void;
  /** Navigates to an existing admin tab, carrying the vehicle where it helps. */
  onOpenTab: (tab: "charges" | "incidents" | "maintenance", vehicleId: string | null) => void;
}) {
  const [ending, setEnding] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const active = d.booking.phase === "active";
  const applicationId = d.driver.applicationId;
  const vehicleId = d.vehicle?.id ?? null;

  return (
    <>
      <div className="flex flex-wrap gap-2" data-testid="booking-actions">
        {d.canManage && active && (
          <ActionButton
            icon={<LogOut className="w-3.5 h-3.5" strokeWidth={1.75} />}
            label="End Rental"
            testId="action-end-rental"
            onClick={() => setEnding(true)}
            primary
          />
        )}
        {d.canManage && (
          <ActionButton
            icon={<PiggyBank className="w-3.5 h-3.5" strokeWidth={1.75} />}
            label="Settle Deposit"
            testId="action-settle-deposit"
            onClick={() => setDepositOpen(true)}
          />
        )}
        {/*
          A handoff is operational work and needs no tier gate here: anybody who
          can open a booking is at least a Coordinator (getBooking requires
          staff), and canInspect() in inspections.functions.ts now admits a
          Coordinator to exactly the handoff — start, record, complete, upload
          and read photos. Destroying a condition photo still asks isStaff(),
          which is unchanged at Manager+.
        */}
        <ActionButton
          icon={<ClipboardCheck className="w-3.5 h-3.5" strokeWidth={1.75} />}
          label="Check-Out"
          testId="action-checkout"
          disabled={!vehicleId}
          title={vehicleId ? undefined : "This rental has no vehicle linked."}
          onClick={() => setHandoff("checkout")}
        />
        <ActionButton
          icon={<ClipboardCheck className="w-3.5 h-3.5" strokeWidth={1.75} />}
          label="Check-In"
          testId="action-checkin"
          disabled={!vehicleId}
          title={vehicleId ? undefined : "This rental has no vehicle linked."}
          onClick={() => setHandoff("checkin")}
        />
        <ActionButton
          icon={<MessageSquare className="w-3.5 h-3.5" strokeWidth={1.75} />}
          label="Message Driver"
          testId="action-message"
          disabled={!applicationId}
          title={applicationId ? undefined : "No driver record is linked to this rental."}
          onClick={() => applicationId && onOpenMessages(applicationId)}
        />
        {d.canManage && (
          <ActionButton
            icon={<Receipt className="w-3.5 h-3.5" strokeWidth={1.75} />}
            label="Charges"
            testId="action-charges"
            trailing
            onClick={() => onOpenTab("charges", vehicleId)}
          />
        )}
        {d.canManage && (
          <ActionButton
            icon={<AlertTriangle className="w-3.5 h-3.5" strokeWidth={1.75} />}
            label="Incidents"
            testId="action-incidents"
            trailing
            onClick={() => onOpenTab("incidents", vehicleId)}
          />
        )}
        <ActionButton
          icon={<Wrench className="w-3.5 h-3.5" strokeWidth={1.75} />}
          label="Maintenance"
          testId="action-maintenance"
          trailing
          onClick={() => onOpenTab("maintenance", vehicleId)}
        />
      </div>

      {ending && (
        <EndRentalDialog
          d={d}
          onClose={() => setEnding(false)}
          onEnded={() => {
            setEnding(false);
            onRefresh();
            // The deposit is the next thing anybody does, and forgetting it is
            // how a renter's money sits unsettled for a month.
            if (d.canManage) setDepositOpen(true);
          }}
        />
      )}
      {depositOpen && (
        <DepositDialog
          rentalId={d.booking.id}
          onClose={() => setDepositOpen(false)}
          onSettled={onRefresh}
        />
      )}
      {handoff && vehicleId && (
        <HandoffDialog
          kind={handoff}
          rentalId={d.booking.id}
          vehicleId={vehicleId}
          vehicleLabel={d.vehicle?.label ?? d.vehicle?.unitNumber ?? "this vehicle"}
          onClose={() => {
            setHandoff(null);
            onRefresh();
          }}
        />
      )}
    </>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  testId,
  disabled,
  title,
  primary,
  trailing,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  testId: string;
  disabled?: boolean;
  title?: string;
  primary?: boolean;
  trailing?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-testid={testId}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        primary
          ? "border-[#D03020] bg-[#D03020] text-white hover:bg-[#B52A1C]"
          : "border-[#EDEDF0] bg-white text-[#55555E] hover:text-[#111114] hover:border-[#D7D7DC]"
      }`}
    >
      {icon}
      {label}
      {trailing && <ArrowUpRight className="w-3 h-3 opacity-60" />}
    </button>
  );
}

/**
 * End Rental — the existing protected path, with the questions it actually asks.
 *
 * `endRental` is the only caller of `end_rental_tx`, and the transaction does
 * the rest: rental closed, vehicle released, application closed, automations
 * stopped, return mileage recorded as ONE observation. So this dialog's whole
 * job is to collect the three inputs honestly and report back exactly what the
 * server said — including the mileage refusals, which it already phrases.
 *
 * The old path in the driver record asked for mileage through window.prompt and
 * always released the car as Available. Both are the same server call; this one
 * can also send a car straight to the shop, which is what happens when the
 * check-in inspection just failed.
 */
function EndRentalDialog({
  d,
  onClose,
  onEnded,
}: {
  d: BookingDetail;
  onClose: () => void;
  onEnded: () => void;
}) {
  const close = useServerFn(endRental);
  const [busy, setBusy] = useState(false);
  const [endDate, setEndDate] = useState(today());
  const [destination, setDestination] = useState<"available" | "maintenance">("available");
  const [error, setError] = useState<string | null>(null);

  // Prefill from a completed return inspection on this rental rather than
  // asking for a number somebody has already written down. One observation,
  // not two: end_rental_tx reuses that reading instead of adding another.
  const suggested = useMemo(() => {
    const ret = d.inspections.find(
      (i) => i.type === "return" && i.completedAt && i.odometer != null,
    );
    return ret?.odometer ?? null;
  }, [d.inspections]);
  const [mileage, setMileage] = useState(suggested == null ? "" : String(suggested));

  const failedCheckIn = d.inspections.some((i) => i.type === "return" && i.status === "failed");
  const depositOutstanding = !!d.money && d.money.deposit.held === true;

  async function go() {
    setError(null);
    setBusy(true);
    try {
      const digits = mileage.replace(/[^\d]/g, "");
      const res = (await close({
        data: {
          rentalId: d.booking.id,
          endDate,
          vehicleStatus: destination,
          returnMileage: digits ? Number(digits) : null,
        },
      })) as { ok: boolean; error?: string; alreadyClosed?: boolean };
      if (res && res.ok === false) {
        setError(res.error ?? "Could not end the rental.");
        return;
      }
      toast.success(
        res?.alreadyClosed
          ? "This rental was already closed."
          : destination === "maintenance"
            ? "Rental ended — the vehicle went to maintenance."
            : "Rental ended — the vehicle is available again.",
      );
      onEnded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not end the rental.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="End Rental" onClose={onClose} testId="end-rental-dialog">
      <CloseoutReadiness rentalId={d.booking.id} />
      <div className="space-y-4">
        <p className="text-[13px] text-[#55555E]">
          Closing this rental releases{" "}
          <span className="font-medium text-[#111114]">
            {d.vehicle?.label ?? d.vehicle?.unitNumber ?? "the vehicle"}
          </span>{" "}
          and stops any running automations. The paperwork, photos and charges stay on the booking.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <MicroLabel>End Date</MicroLabel>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              aria-label="End date"
              className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm bg-white"
            />
          </div>
          <div>
            <MicroLabel>Return Mileage</MicroLabel>
            <input
              value={mileage}
              onChange={(e) => setMileage(e.target.value)}
              inputMode="numeric"
              placeholder="Odometer now"
              aria-label="Return mileage"
              data-testid="end-rental-mileage"
              className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
            />
            {suggested != null && (
              <p className="mt-1 text-[11px] text-[#9A9AA3]">
                From the completed check-in: {suggested.toLocaleString()} mi
              </p>
            )}
          </div>
        </div>

        <div>
          <MicroLabel>Where The Vehicle Goes</MicroLabel>
          <div className="mt-1.5 flex gap-2">
            {(["available", "maintenance"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setDestination(v)}
                aria-pressed={destination === v}
                data-testid={`end-rental-${v}`}
                className={`flex-1 rounded-lg border px-3 py-2 text-[13px] ${
                  destination === v
                    ? "border-[#D03020] bg-[rgba(208,48,32,0.04)] font-medium text-[#111114]"
                    : "border-[#EDEDF0] bg-white text-[#55555E]"
                }`}
              >
                {v === "available" ? "Back To Available" : "Into Maintenance"}
              </button>
            ))}
          </div>
          {failedCheckIn && destination === "available" && (
            <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-[#C68A12]">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              The check-in inspection failed. A car cannot be taken off the road while its rental is
              open, so send it to maintenance here.
            </p>
          )}
        </div>

        {!mileage.replace(/[^\d]/g, "") && (
          <p className="flex items-start gap-1.5 text-[12px] text-[#C68A12]">
            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
            No return mileage. The rental will close without one, and mileage is append-only — it
            can only be added later as a new reading.
          </p>
        )}
        {depositOutstanding && (
          <p className="flex items-start gap-1.5 text-[12px] text-[#55555E]">
            <PiggyBank className="w-3 h-3 mt-0.5 shrink-0" />A deposit is still held. Settling it
            opens next.
          </p>
        )}
        {error && (
          <p
            className="rounded-lg bg-[rgba(208,48,32,0.06)] px-3 py-2 text-[12px] text-[#D03020]"
            data-testid="end-rental-error"
          >
            {error}
          </p>
        )}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-[#EDEDF0] px-4 py-2 text-sm">
          Cancel
        </button>
        <button
          onClick={go}
          disabled={busy}
          data-testid="end-rental-confirm"
          className="inline-flex items-center gap-2 rounded-lg bg-[#D03020] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {busy ? "Ending…" : "End Rental"}
        </button>
      </div>
    </Modal>
  );
}

/**
 * A handoff, on a phone, in a car park.
 *
 * The checklist, the condition photos, the fuel level and the renter's
 * signature all already exist in the inspection flow — so this starts one with
 * the rental AND the vehicle named, then hands straight over to the existing
 * runner. Naming the rental is what keeps the photos findable from the booking
 * afterwards; `startInspection` also resolves it from the car now, so the two
 * entry points agree.
 */
function HandoffDialog({
  kind,
  rentalId,
  vehicleId,
  vehicleLabel,
  onClose,
}: {
  kind: Handoff;
  rentalId: string;
  vehicleId: string;
  vehicleLabel: string;
  onClose: () => void;
}) {
  const start = useServerFn(startInspection);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [odometer, setOdometer] = useState("");
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void supabase
      .from("inspection_templates")
      .select("id,name,inspection_type")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => {
        if (!live) return;
        const rows = ((data ?? []) as Template[]).filter(
          (t) => t.inspection_type === HANDOFF_TYPE[kind],
        );
        setTemplates(rows);
        setTemplateId(rows[0]?.id ?? "");
      });
    return () => {
      live = false;
    };
  }, [kind]);

  const go = useCallback(async () => {
    if (!templateId) return;
    setError(null);
    setBusy(true);
    try {
      const odo = Number(odometer.replace(/[^\d]/g, ""));
      const res = await start({
        data: { vehicleId, templateId, rentalId, odometer: odo > 0 ? odo : null },
      });
      setOpenId(res.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the inspection.");
    } finally {
      setBusy(false);
    }
  }, [start, templateId, odometer, vehicleId, rentalId]);

  if (openId) {
    return (
      <Modal
        title={`${HANDOFF_LABEL[kind]} — ${vehicleLabel}`}
        onClose={onClose}
        wide
        testId="handoff-runner"
      >
        <InspectionRunner id={openId} vehicleLabel={() => vehicleLabel} onBack={onClose} />
      </Modal>
    );
  }

  return (
    <Modal title={`Start ${HANDOFF_LABEL[kind]}`} onClose={onClose} testId="handoff-dialog">
      <div className="space-y-4">
        <p className="text-[13px] text-[#55555E]">
          {vehicleLabel} · recorded against this booking, so the checklist, photos and signature
          stay with it.
        </p>
        <div>
          <MicroLabel>Checklist</MicroLabel>
          {templates === null ? (
            <div className="mt-1.5 flex items-center gap-2 text-[13px] text-[#9A9AA3]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading checklists…
            </div>
          ) : templates.length === 0 ? (
            <p className="mt-1.5 text-[13px] text-[#55555E]" data-testid="handoff-no-template">
              No active {HANDOFF_LABEL[kind]} checklist is set up yet. Add one in Inspections before
              recording a handoff here.
            </p>
          ) : (
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              aria-label="Checklist"
              className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm bg-white"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div>
          <MicroLabel>Odometer (Optional)</MicroLabel>
          <input
            value={odometer}
            onChange={(e) => setOdometer(e.target.value)}
            inputMode="numeric"
            placeholder="52,140"
            aria-label="Odometer"
            className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
          />
        </div>
        {error && (
          <p
            className="rounded-lg bg-[rgba(208,48,32,0.06)] px-3 py-2 text-[12px] text-[#D03020]"
            data-testid="handoff-error"
          >
            {error}
          </p>
        )}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-[#EDEDF0] px-4 py-2 text-sm">
          Cancel
        </button>
        <button
          onClick={go}
          disabled={busy || !templateId}
          data-testid="handoff-start"
          className="inline-flex items-center gap-2 rounded-lg bg-[#D03020] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {busy ? "Starting…" : "Start"}
        </button>
      </div>
    </Modal>
  );
}

/** Full-screen on a phone, a card on a desktop. Backdrop-only close. */
function Modal({
  title,
  onClose,
  children,
  wide,
  testId,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  testId: string;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 flex items-start sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-testid={testId}
        className={`bg-white w-full ${wide ? "max-w-3xl" : "max-w-lg"} min-h-full sm:min-h-0 rounded-none sm:rounded-2xl shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#EDEDF0] px-5 py-4">
          <h3 className="text-[15px] font-semibold text-[#111114]">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-[#9A9AA3] hover:bg-[#F4F4F6] hover:text-[#111114]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
