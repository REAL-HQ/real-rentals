import { AppSelect } from "@/components/ui/app-select";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Car, Repeat } from "lucide-react";
import { RecordNumber } from "./RecordNumber";
import { fmtDate } from "@/lib/date-format";
import { supabase } from "@/integrations/supabase/client";
import { VEHICLE_COMBOBOX_SELECT, formatVehicleIdentityLine } from "@/lib/vehicle-label";
import { VehicleCombobox, type VehicleComboboxVehicle } from "./VehicleCombobox";
import { PAYMENT_METHODS } from "@/lib/agreement-prep";
import {
  OUTGOING_STATUSES,
  OUTGOING_STATUS_LABELS,
  SWAP_FUEL_LEVELS,
  SWAP_INSURANCE_CHECK_LABEL,
  SWAP_INSURANCE_MISSING_REMINDER,
  SWAP_INSURANCE_UPLOADED_LABEL,
  SWAP_INSURANCE_DOC_KINDS,
  SWAP_INSURANCE_DOC_LABELS,
  SWAP_INSURANCE_NOTE,
  SWAP_OFF_MESSAGE,
  SWAP_REASON_CODES,
  SWAP_REASON_LABELS,
  SWAP_STATUS_LABELS,
  swapSendBlockers,
  type OutgoingStatus,
  type SwapReasonCode,
  type SwapStatus,
} from "@/lib/vehicle-swap";
import { FileUploader } from "@/components/FileUploader";
import { SwapPickupPhotos } from "./SwapPickupPhotos";
import {
  addSwapInsuranceDocument,
  getSwapInsurance,
  cancelSwapVehicle,
  completeSwapVehicle,
  getSwapOptions,
  listVehicleSwaps,
  previewSwapVehicle,
  sendSwapVehicleAgreement,
  type SwapHistoryEntry,
} from "@/lib/vehicle-swap.functions";

// Vehicle swaps for a booking (with the Swap Vehicle action) or a vehicle.
//
// History comes only from public.rental_vehicle_swaps (listVehicleSwaps);
// before the migration is installed it is an empty list. The Swap Vehicle
// action asks the server for the gate (migration installed AND the Owner's
// app_settings.vehicle_swap switch) and stays disabled while it is off.

const field = "mt-1 w-full rounded-md border border-[#EDEDF0] bg-white px-2.5 py-1.5 text-[13px]";
const label = "text-[12px] text-[#55555E]";
const vehicleName = (v: VehicleComboboxVehicle | undefined) =>
  v ? [v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle" : "Vehicle";

export function BookingVehicleHistory({
  rentalId,
  vehicleId,
  showSwap = false,
}: {
  rentalId?: string;
  vehicleId?: string;
  showSwap?: boolean;
}) {
  const load = useServerFn(listVehicleSwaps);
  const [entries, setEntries] = useState<SwapHistoryEntry[]>([]);
  const [failed, setFailed] = useState(false);
  const [names, setNames] = useState<Record<string, VehicleComboboxVehicle>>({});
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!rentalId && !vehicleId) return;
    let cancelled = false;
    void load({ data: { rentalId: rentalId ?? null, vehicleId: vehicleId ?? null } })
      .then((r) => {
        if (cancelled) return;
        setFailed(false);
        setEntries(r.entries);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [load, rentalId, vehicleId, tick]);

  useEffect(() => {
    const ids = [...new Set(entries.flatMap((e) => [e.fromVehicleId, e.toVehicleId]))].filter((id) => !names[id]);
    if (!ids.length) return;
    let live = true;
    void supabase
      .from("vehicles")
      .select(VEHICLE_COMBOBOX_SELECT)
      .in("id", ids)
      .then(({ data }) => {
        if (!live) return;
        setNames((prev) => {
          const next = { ...prev };
          for (const v of (data ?? []) as VehicleComboboxVehicle[]) next[v.id] = v;
          return next;
        });
      });
    return () => {
      live = false;
    };
  }, [entries, names]);

  return (
    <div data-testid="vehicle-timeline">
      {failed ? (
        <p className="text-[13px] text-[#55555E]">Vehicle swaps could not be loaded.</p>
      ) : entries.length === 0 ? (
        <p className="text-[13px] text-[#55555E]">No vehicle changes recorded.</p>
      ) : (
        <ol className="space-y-2">
          {entries.map((e) => (
            <li key={e.id} className="rounded-lg border border-[#EDEDF0] bg-white p-3 text-[13px]" data-testid="swap-entry">
              <div className="flex flex-wrap items-center gap-2">
                <Car className="h-3.5 w-3.5 text-[#9A9AA3]" />
                <span className="font-medium text-[#111114]">
                  {vehicleName(names[e.fromVehicleId])} → {vehicleName(names[e.toVehicleId])}
                </span>
                <RecordNumber label="Swap" value={e.swapNumber} />
                <span className="text-[#55555E]">{SWAP_STATUS_LABELS[e.status as SwapStatus] ?? e.status}</span>
              </div>
              <div className="mt-1 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px] text-[#55555E]">
                <span>Sent: {fmtDate(e.createdAt)}</span>
                <span>Completed: {e.completedAt ? fmtDate(e.completedAt) : "—"}</span>
                <span>Mileage: {e.returnMileage != null ? `${e.returnMileage.toLocaleString()} → ${e.pickupMileage?.toLocaleString() ?? "—"}` : "—"}</span>
                <span>Fuel: {e.returnFuel ? `${e.returnFuel} → ${e.pickupFuel ?? "—"}` : "—"}</span>
                <span className="col-span-2 sm:col-span-4">
                  Reason: {SWAP_REASON_LABELS[e.reasonCode as SwapReasonCode] ?? e.reasonCode}
                  {e.reason ? ` — ${e.reason}` : ""}
                </span>
              </div>
              <SwapPickupPhotos swapId={e.id} vehicleId={e.toVehicleId} vehicle={names[e.toVehicleId]} />
            </li>
          ))}
        </ol>
      )}
      {showSwap && rentalId && <SwapVehiclePanel rentalId={rentalId} onChanged={refresh} />}
    </div>
  );
}

type Options = Awaited<ReturnType<typeof getSwapOptions>>;

export function SwapVehiclePanel({
  rentalId,
  onChanged,
  autoOpen = false,
  onClosed,
}: {
  rentalId: string;
  onChanged: () => void;
  /** The driver-profile popup opens the form straight away and hides the trigger button. */
  autoOpen?: boolean;
  /** Called when the form is closed or sent, so a hosting popup can close too. */
  onClosed?: () => void;
}) {
  const options = useServerFn(getSwapOptions);
  const [opt, setOpt] = useState<Options | null>(null);
  const [open, setOpen] = useState(autoOpen);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = () => {
    setTick((t) => t + 1);
    onChanged();
  };

  useEffect(() => {
    let live = true;
    void options({ data: { rentalId } })
      .then((r) => { if (live) { setOpt(r); setError(r.ok ? null : String(r.error ?? "Swap is not available for this rental.")); } })
      .catch(() => { if (live) { setOpt(null); setError(null); } });
    return () => { live = false; };
  }, [options, rentalId, tick]);

  const enabled = opt?.ok === true && opt.enabled === true;
  const openSwap = enabled ? (opt?.openSwap as { id: string; status: SwapStatus; swap_number: number; to_vehicle_id: string } | null) : null;

  return (
    <div className="mt-3">
      {!openSwap && !autoOpen && (
        <div className="flex items-center justify-end">
          <button
            type="button"
            disabled={!enabled}
            aria-disabled={!enabled}
            onClick={() => { if (enabled) setOpen(true); }}
            title={enabled ? "Swap Vehicle" : SWAP_OFF_MESSAGE}
            data-testid="swap-button"
            className="inline-flex items-center gap-1.5 rounded-md border border-[#EDEDF0] bg-white px-2.5 py-1 text-[12px] text-[#55555E] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Repeat className="h-3 w-3" /> Swap Vehicle
          </button>
        </div>
      )}
      {!enabled && <p className="mt-1 text-[11px] text-[#9A9AA3]">{opt?.ok === false && error ? error : SWAP_OFF_MESSAGE}</p>}
      {enabled && openSwap && <OpenSwapCard swap={openSwap} onDone={reload} />}
      {enabled && !openSwap && open && opt && (
        <SwapForm rentalId={rentalId} opt={opt} onClose={() => { setOpen(false); onClosed?.(); }} onSent={() => { setOpen(false); reload(); }} />
      )}
    </div>
  );
}

function SwapForm({ rentalId, opt, onClose, onSent }: { rentalId: string; opt: Options; onClose: () => void; onSent: () => void }) {
  const preview = useServerFn(previewSwapVehicle);
  const send = useServerFn(sendSwapVehicleAgreement);
  const candidates = (opt.candidates ?? []) as VehicleComboboxVehicle[];
  const prevTerms = (opt.previousTerms ?? {}) as { damageWaiver: string | null; paymentSchedule: string | null; paymentMethod: string | null; vehicleOwner: string | null };
  const previous = opt.previous as { isPaper: boolean; label: string } | undefined;
  const from = opt.fromVehicle as VehicleComboboxVehicle | null;
  const [vehicle, setVehicle] = useState("");
  const [reasonCode, setReasonCode] = useState<SwapReasonCode>("maintenance");
  const [reason, setReason] = useState("");
  const [damageWaiver, setDamageWaiver] = useState(prevTerms.damageWaiver ?? "");
  const [schedule, setSchedule] = useState(prevTerms.paymentSchedule ?? "");
  const [method, setMethod] = useState(prevTerms.paymentMethod ?? "");
  const [owner, setOwner] = useState(prevTerms.vehicleOwner ?? "");
  const [pv, setPv] = useState<Record<string, any> | null>(null);
  const [companyAck, setCompanyAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(crypto.randomUUID());

  const terms = useMemo(() => {
    const t: Record<string, string> = {};
    if (damageWaiver) t.damageWaiver = damageWaiver;
    if (schedule) t.paymentSchedule = schedule;
    if (method) t.paymentMethod = method;
    if (owner.trim()) t.vehicleOwner = owner.trim();
    return Object.keys(t).length ? t : undefined;
  }, [damageWaiver, schedule, method, owner]);

  // Any change makes the old preview stale; Send needs a fresh one.
  // A cleared preview that had been shown says "Preview again" instead of silently disabling Send.
  const [stale, setStale] = useState(false);
  const hadPreview = useRef(false);
  useEffect(() => {
    if (hadPreview.current) setStale(true);
    hadPreview.current = false;
    setPv(null);
  }, [vehicle, damageWaiver, schedule, method, owner]);

  async function onPreview() {
    setBusy(true);
    setError(null);
    try {
      const r = await preview({ data: { rentalId, toVehicleId: vehicle, terms: terms as any } });
      if (!r.ok) throw new Error(String(r.error ?? "Preview failed"));
      hadPreview.current = true;
      setStale(false);
      setPv(r.preview as Record<string, any>);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  }

  function openPdf() {
    if (!pv?.pdfBase64) return;
    const bytes = Uint8Array.from(atob(pv.pdfBase64), (c) => c.charCodeAt(0));
    window.open(URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })), "_blank", "noopener");
  }

  async function onSend() {
    if (!pv?.fingerprint) return;
    setBusy(true);
    setError(null);
    try {
      const r = await send({
        data: {
          rentalId,
          toVehicleId: vehicle,
          terms: terms as any,
          reasonCode,
          reason: reason.trim(),
          fingerprint: pv.fingerprint,
          companyAck: companyAck || undefined,
          idempotencyKey: key.current,
        },
      });
      if (!r.ok) throw new Error(String(r.error ?? "The swap agreement was not sent"));
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The swap agreement was not sent");
    } finally {
      setBusy(false);
    }
  }

  const blockers = (pv?.blockers ?? []) as { label: string; why: string }[];
  const companyMissing = (pv?.companyMissing ?? []) as string[];
  const canSend = Boolean(pv?.canSend && pv?.fingerprint) && reason.trim().length >= 5 && (!companyMissing.length || companyAck);
  const sendWhy = swapSendBlockers({
    hasVehicle: Boolean(vehicle),
    hasPreview: Boolean(pv?.fingerprint),
    stale,
    previewBlocked: Boolean(pv && !pv.canSend),
    reasonLength: reason.trim().length,
    companyPending: companyMissing.length > 0 && !companyAck,
  });

  return (
    <div data-testid="swap-form" className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-[#EDEDF0] bg-white p-3">
      <p className="sm:col-span-2 text-[12px] text-[#55555E]">
        Current Vehicle: <span className="font-medium text-[#111114]">{vehicleName(from ?? undefined)}</span>
        {from ? ` · ${formatVehicleIdentityLine(from)}` : ""}. Follows: {previous?.label ?? "—"}.
      </p>
      <div className={`${label} sm:col-span-2`}>
        Replacement Vehicle
        <div className="mt-1">
          <VehicleCombobox vehicles={candidates} value={vehicle || null} onChange={(id) => setVehicle(id ?? "")} allowNone={false} placeholder="Choose Replacement Vehicle" aria-label="Replacement Vehicle" />
        </div>
        {!candidates.length && <p className="mt-1 text-[11px] text-[#9A9AA3]">No Available cars are free right now.</p>}
      </div>
      <label className={label}>
        Reason
        <AppSelect aria-label="Reason" className={field} value={reasonCode} onChange={(e) => setReasonCode(e.target.value as SwapReasonCode)}>
          {SWAP_REASON_CODES.map((c) => (
            <option key={c} value={c}>{SWAP_REASON_LABELS[c]}</option>
          ))}
        </AppSelect>
      </label>
      <label className={label}>
        Reason Details
        <input className={field} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What Is Wrong With The Current Car" />
      </label>
      <label className={label}>
        Damage Waiver
        <AppSelect aria-label="Damage Waiver" className={field} value={damageWaiver} onChange={(e) => setDamageWaiver(e.target.value)}>
          <option value="">From Original Agreement</option>
          <option value="accepted">Accepted</option>
          <option value="declined">Declined</option>
        </AppSelect>
      </label>
      <label className={label}>
        Payment Schedule
        <AppSelect aria-label="Payment Schedule" className={field} value={schedule} onChange={(e) => setSchedule(e.target.value)}>
          <option value="">From Original Agreement</option>
          <option value="weekly">Weekly</option>
          <option value="every_4_weeks">Every 4 Weeks</option>
        </AppSelect>
      </label>
      <label className={label}>
        Payment Method
        <AppSelect aria-label="Payment Method" className={field} value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="">From Original Agreement</option>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </AppSelect>
      </label>
      <label className={label}>
        Vehicle Owner
        <input className={field} value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Registered Owner (Optional)" />
      </label>
      {previous?.isPaper && (
        <p className="sm:col-span-2 text-[11px] text-[#9A9AA3]">The original is a paper agreement, so its choices are not on record. Pick Damage Waiver, Payment Schedule and Payment Method to match it.</p>
      )}
      <p className="sm:col-span-2 text-[11px] text-[#9A9AA3]">
        The swap agreement uses the current agreement template, names the replacement car, and keeps the weekly rate of ${Number((opt.rental as any)?.weekly_rate ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}. No Reservation Fee.
      </p>
      {pv && blockers.length > 0 && (
        <ul className="sm:col-span-2 list-disc pl-5 text-[12px] text-[#D03020]">
          {blockers.map((b) => (
            <li key={b.label}>{b.label}: {b.why}</li>
          ))}
        </ul>
      )}
      {pv && companyMissing.length > 0 && (
        <label className="sm:col-span-2 flex items-center gap-2 text-[12px] text-[#55555E]">
          <input type="checkbox" checked={companyAck} onChange={(e) => setCompanyAck(e.target.checked)} />
          Company Details Are Incomplete ({companyMissing.join(", ")}). Send With The Current Values.
        </label>
      )}
      {error && <p className="sm:col-span-2 text-[12px] text-[#D03020]">{error}</p>}
      {!canSend && sendWhy.length > 0 && (
        <p data-testid="swap-send-hint" role="status" className="sm:col-span-2 text-[12px] text-[#8A5A00]">
          Send For E-Signature Is Off: {sendWhy.join(" · ")}
        </p>
      )}
      <div className="sm:col-span-2 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-[13px]">Close</button>
        <button type="button" disabled={busy || !vehicle} onClick={() => void onPreview()} className="rounded-md border border-[#EDEDF0] px-3 py-1.5 text-[13px] disabled:opacity-50">
          Preview Agreement
        </button>
        {pv?.pdfBase64 && (
          <button type="button" onClick={openPdf} className="rounded-md border border-[#EDEDF0] px-3 py-1.5 text-[13px]">Open PDF</button>
        )}
        <button type="button" disabled={busy || !canSend} onClick={() => void onSend()} className="rounded-md bg-[#D03020] px-3 py-1.5 text-[13px] text-white disabled:opacity-50">
          Send For E-Signature
        </button>
      </div>
    </div>
  );
}

function OpenSwapCard({ swap, onDone }: { swap: { id: string; status: SwapStatus; swap_number: number; to_vehicle_id: string }; onDone: () => void }) {
  const complete = useServerFn(completeSwapVehicle);
  const cancel = useServerFn(cancelSwapVehicle);
  const [returnMiles, setReturnMiles] = useState("");
  const [pickupMiles, setPickupMiles] = useState("");
  const [returnFuel, setReturnFuel] = useState("");
  const [pickupFuel, setPickupFuel] = useState("");
  const [outgoing, setOutgoing] = useState<OutgoingStatus>("maintenance");
  const [cancelReason, setCancelReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const miles = (s: string) => (/^\d{1,7}$/.test(s.trim()) ? Number(s.trim()) : null);
  // The new car's insurance card is optional (Dolmar t549u/t550u, Nov 21 2026): it never blocks Complete Swap.
  const ready = swap.status === "signed" && miles(returnMiles) !== null && miles(pickupMiles) !== null && returnFuel && pickupFuel;

  async function run(fn: () => Promise<Record<string, any>>) {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) throw new Error(String(r.error ?? "Nothing was changed"));
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nothing was changed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="open-swap" className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-[#EDEDF0] bg-white p-3">
      <div className="sm:col-span-2 flex items-center gap-2 text-[13px]">
        <RecordNumber label="Swap" value={swap.swap_number} />
        <span className="text-[#55555E]">{SWAP_STATUS_LABELS[swap.status]}</span>
      </div>
      {swap.status === "pending_signature" && (
        <p className="sm:col-span-2 text-[12px] text-[#55555E]">The renter has the swap agreement. Hand over the new car after they sign.</p>
      )}
      <SwapInsurancePanel swap={swap} />
      {swap.status === "signed" && (
        <>
          <label className={label}>
            Return Odometer (Current Car)
            <input inputMode="numeric" className={field} value={returnMiles} onChange={(e) => setReturnMiles(e.target.value)} />
          </label>
          <label className={label}>
            Return Fuel
            <AppSelect aria-label="Return Fuel" className={field} value={returnFuel} onChange={(e) => setReturnFuel(e.target.value)}>
              <option value="">Choose</option>
              {SWAP_FUEL_LEVELS.map((f) => <option key={f} value={f}>{f}</option>)}
            </AppSelect>
          </label>
          <label className={label}>
            Pickup Odometer (New Car)
            <input inputMode="numeric" className={field} value={pickupMiles} onChange={(e) => setPickupMiles(e.target.value)} />
          </label>
          <label className={label}>
            Pickup Fuel
            <AppSelect aria-label="Pickup Fuel" className={field} value={pickupFuel} onChange={(e) => setPickupFuel(e.target.value)}>
              <option value="">Choose</option>
              {SWAP_FUEL_LEVELS.map((f) => <option key={f} value={f}>{f}</option>)}
            </AppSelect>
          </label>
          <label className={label}>
            Returned Car Goes To
            <AppSelect aria-label="Returned Car Goes To" className={field} value={outgoing} onChange={(e) => setOutgoing(e.target.value as OutgoingStatus)}>
              {OUTGOING_STATUSES.map((s) => <option key={s} value={s}>{OUTGOING_STATUS_LABELS[s]}</option>)}
            </AppSelect>
          </label>
          <p className="text-[11px] text-[#9A9AA3] self-end">Photos: run a Vehicle Inspection on each car before completing.</p>
        </>
      )}
      <label className={`${label} sm:col-span-2`}>
        Cancel Reason
        <input className={field} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Only If Cancelling This Swap" />
      </label>
      {error && <p className="sm:col-span-2 text-[12px] text-[#D03020]">{error}</p>}
      <div className="sm:col-span-2 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          disabled={busy || cancelReason.trim().length < 5}
          onClick={() => void run(() => cancel({ data: { swapId: swap.id, reason: cancelReason.trim() } }))}
          className="rounded-md border border-[#EDEDF0] px-3 py-1.5 text-[13px] disabled:opacity-50"
        >
          Cancel Swap
        </button>
        {swap.status === "signed" && (
          <button
            type="button"
            disabled={busy || !ready}
            onClick={() =>
              void run(() =>
                complete({
                  data: {
                    swapId: swap.id,
                    fromVehicleStatus: outgoing,
                    returnMiles: miles(returnMiles)!,
                    pickupMiles: miles(pickupMiles)!,
                    returnFuel: returnFuel as (typeof SWAP_FUEL_LEVELS)[number],
                    pickupFuel: pickupFuel as (typeof SWAP_FUEL_LEVELS)[number],
                  },
                }),
              )
            }
            className="rounded-md bg-[#D03020] px-3 py-1.5 text-[13px] text-white disabled:opacity-50"
          >
            Complete Swap
          </button>
        )}
      </div>
    </div>
  );
}

// "New Vehicle Insurance (Optional)": ID cards, declarations pages and endorsements
// for the NEW car, kept staff only on that vehicle's documents. Recommended, never
// required (Dolmar t549u/t550u, Nov 21 2026): a missing card only shows a neutral
// reminder. A document on file never marks the vehicle insured.
function SwapInsurancePanel({ swap }: { swap: { id: string; to_vehicle_id: string; status: SwapStatus } }) {
  const load = useServerFn(getSwapInsurance);
  const add = useServerFn(addSwapInsuranceDocument);
  const [st, setSt] = useState<Awaited<ReturnType<typeof getSwapInsurance>> | null>(null);
  const [kind, setKind] = useState<(typeof SWAP_INSURANCE_DOC_KINDS)[number]>("insurance_card");
  const [expires, setExpires] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setSt(await load({ data: { swapId: swap.id } }));
  }, [load, swap.id]);

  useEffect(() => {
    void refresh().catch(() => setError("Could not load the insurance documents."));
  }, [refresh]);

  async function uploadOne(file: File) {
    const ext = (file.name.split(".").pop() || "pdf").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${swap.to_vehicle_id}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const up = await supabase.storage.from("vehicle-docs").upload(path, file, { contentType: file.type || undefined });
    if (up.error) throw up.error;
    const r = await add({ data: { swapId: swap.id, kind, path, fileName: file.name, mimeType: file.type || null, sizeBytes: file.size, expiresAt: expires || null } });
    if (!r.ok) throw new Error(String(r.error ?? "Could not save the document."));
    await refresh();
  }

  return (
    <div data-testid="swap-insurance" className="sm:col-span-2 rounded-md border border-[#EDEDF0] bg-[#FAFAFB] p-3">
      <div className="flex items-center justify-between gap-2 text-[13px]">
        <span className="font-medium">{SWAP_INSURANCE_CHECK_LABEL}</span>
        {st && (
          <span
            data-testid="swap-insurance-status"
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${st.uploaded ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}
          >
            {st.uploaded ? SWAP_INSURANCE_UPLOADED_LABEL : SWAP_INSURANCE_MISSING_REMINDER}
          </span>
        )}
      </div>
      <p className="mt-1 text-[11px] text-[#9A9AA3]">{SWAP_INSURANCE_NOTE}</p>
      {st && st.docs.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[12px] text-[#55555E]">
          {st.docs.map((d) => <li key={d.id}>{d.kindLabel}{d.fileName ? ` — ${d.fileName}` : ""}</li>)}
        </ul>
      )}
      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className={label}>
          Document Type
          <AppSelect aria-label="Insurance Document Type" className={field} value={kind} onChange={(e) => setKind(e.target.value as (typeof SWAP_INSURANCE_DOC_KINDS)[number])}>
            {SWAP_INSURANCE_DOC_KINDS.map((k) => <option key={k} value={k}>{SWAP_INSURANCE_DOC_LABELS[k]}</option>)}
          </AppSelect>
        </label>
        <label className={label}>
          Expires (Optional)
          <input type="date" className={field} value={expires} onChange={(e) => setExpires(e.target.value)} />
        </label>
        <div className="sm:col-span-2">
          <FileUploader
            variant="inline"
            multiple
            accept="application/pdf,image/*"
            maxBytes={20 * 1024 * 1024}
            title="Upload New Vehicle Insurance"
            context={SWAP_INSURANCE_DOC_LABELS[kind]}
            upload={async (file) => { await uploadOne(file); }}
          />
        </div>
      </div>
      {error && <p className="mt-2 text-[12px] text-[#D03020]">{error}</p>}
    </div>
  );
}
