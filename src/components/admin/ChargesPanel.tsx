import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, X, Receipt, Upload, AlertTriangle, Loader2, Trash2, Send } from "lucide-react";
import { StatusPill, EmptyState, MicroLabel } from "./ui";
import {
  listTollCharges,
  createTollCharge,
  importTollStatement,
  rebillCharges,
  reattributeCharge,
  updateChargeStatus,
  deleteCharge,
  CHARGE_TYPES,
  type TollCharge,
  type ImportOutcome,
} from "@/lib/charges.functions";

type VehicleLite = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  license_plate: string | null;
};

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "new", label: "Unassigned" },
  { value: "assigned", label: "Ready to bill" },
  { value: "rebilled", label: "Billed" },
  { value: "paid", label: "Paid" },
  { value: "disputed", label: "Disputed" },
  { value: "written_off", label: "Written off" },
];

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function ChargesPanel() {
  const fetchCharges = useServerFn(listTollCharges);
  const rebill = useServerFn(rebillCharges);
  const reattribute = useServerFn(reattributeCharge);
  const setStatus = useServerFn(updateChargeStatus);
  const remove = useServerFn(deleteCharge);

  const [rows, setRows] = useState<TollCharge[]>([]);
  const [vehicles, setVehicles] = useState<VehicleLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setSelected(new Set());
    try {
      const [charges, v] = await Promise.all([
        fetchCharges({ data: { status: filter } }),
        supabase.from("vehicles").select("id,year,make,model,license_plate").order("make"),
      ]);
      setRows(charges);
      setVehicles((v.data as any) ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load charges");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const unassigned = useMemo(() => rows.filter((r) => !r.rental_id).length, [rows]);
  const billable = useMemo(
    () => rows.filter((r) => r.rental_id && (r.status === "assigned" || r.status === "new")),
    [rows],
  );
  const selectedTotal = useMemo(
    () => rows.filter((r) => selected.has(r.id)).reduce((s, r) => s + r.amount + r.admin_fee, 0),
    [rows, selected],
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function doRebill() {
    if (selected.size === 0) return;
    if (
      !confirm(
        `Bill ${selected.size} charge(s) totalling ${money(selectedTotal)} to their renters?`,
      )
    )
      return;
    setBusy(true);
    try {
      const res = await rebill({ data: { chargeIds: Array.from(selected) } });
      if (res.billed > 0) {
        toast.success(
          `Billed ${res.billed} charge(s) — ${money(res.totalAmount)}. Renters notified.`,
        );
      }
      if (res.skipped.length) {
        toast.error(`${res.skipped.length} skipped: ${res.skipped[0].reason}`);
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not rebill");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{rows.length} charge(s)</span>
          {unassigned > 0 ? <StatusPill tone="amber">{unassigned} unassigned</StatusPill> : null}
          {billable.length > 0 ? (
            <StatusPill tone="green">{billable.length} ready to bill</StatusPill>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm font-medium hover:border-[#D6D6DB]"
          >
            <Upload className="w-4 h-4" /> Import Statement
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-[#D03020] text-white px-4 py-2 text-sm font-medium hover:opacity-90"
          >
            <Plus className="w-4 h-4" /> Add Charge
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
              filter === f.value
                ? "border-[#D03020] bg-[#D03020] text-white"
                : "border-[#EDEDF0] text-[#55555E] hover:border-[#D6D6DB]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {selected.size > 0 ? (
        <div className="rounded-xl border border-[#EDEDF0] bg-[#FAFAFB] p-3 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-sm">
            {selected.size} selected · <strong>{money(selectedTotal)}</strong>
          </span>
          <div className="flex gap-2">
            <button onClick={() => setSelected(new Set())} className="text-xs text-[#55555E] px-2">
              Clear
            </button>
            <button
              onClick={doRebill}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#D03020] text-white px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
            >
              {busy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              Bill to renters
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Receipt className="w-6 h-6" strokeWidth={1.75} />}
          title="No Charges"
          hint="Import a toll statement or add a citation to start tracking what needs rebilling."
        />
      ) : (
        <div className="rounded-2xl border border-[#EDEDF0] bg-white shadow-sm overflow-hidden">
          <ul className="divide-y divide-[#EDEDF0]">
            {rows.map((r) => {
              const total = r.amount + r.admin_fee;
              const canBill = !!r.rental_id && (r.status === "assigned" || r.status === "new");
              return (
                <li key={r.id} className="p-3 flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    disabled={!canBill}
                    onChange={() => toggle(r.id)}
                    className="mt-1 disabled:opacity-30"
                    title={canBill ? "Select to bill" : "Not billable"}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm capitalize">
                        {r.charge_type.replace(/_/g, " ")}
                      </span>
                      <StatusPill
                        status={
                          r.status === "paid"
                            ? "active"
                            : r.status === "rebilled"
                              ? "pending"
                              : r.status === "new"
                                ? "overdue"
                                : "pending"
                        }
                      >
                        {r.status === "new" ? "unassigned" : r.status.replace(/_/g, " ")}
                      </StatusPill>
                      {r.source === "import" ? (
                        <span className="text-[10px] uppercase tracking-wide text-[#9A9AA3]">
                          imported
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {new Date(r.occurred_at).toLocaleString()} ·{" "}
                      {r.vehicle_label ?? "unknown vehicle"}
                      {r.location ? ` · ${r.location}` : ""}
                      {r.agency ? ` · ${r.agency}` : ""}
                    </p>
                    <p className="mt-0.5 text-xs">
                      {r.driver_name ? (
                        <span className="text-[#111114]">Billed to {r.driver_name}</span>
                      ) : (
                        <span className="text-[#8A5A00]">
                          Nobody had this car at that time — check the dates
                        </span>
                      )}
                      {r.reference_number ? (
                        <span className="text-[#9A9AA3]"> · ref {r.reference_number}</span>
                      ) : null}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold tabular-nums">{money(total)}</div>
                    {r.admin_fee > 0 ? (
                      <div className="text-[11px] text-[#9A9AA3]">
                        incl. {money(r.admin_fee)} fee
                      </div>
                    ) : null}
                    <div className="mt-1 flex items-center justify-end gap-1">
                      {!r.rental_id ? (
                        <button
                          onClick={async () => {
                            try {
                              const res = await reattribute({ data: { id: r.id } });
                              toast[res.attributed ? "success" : "error"](
                                res.attributed
                                  ? "Matched to a renter"
                                  : "Still no rental covers that time",
                              );
                              load();
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : "Retry failed");
                            }
                          }}
                          className="text-[11px] font-semibold text-[#D03020] px-1.5"
                        >
                          Retry match
                        </button>
                      ) : null}
                      {r.status !== "rebilled" && r.status !== "paid" ? (
                        <>
                          <button
                            onClick={async () => {
                              await setStatus({ data: { id: r.id, status: "written_off" } });
                              toast.success("Written off");
                              load();
                            }}
                            className="text-[11px] text-[#55555E] px-1.5"
                          >
                            Write off
                          </button>
                          <button
                            onClick={async () => {
                              if (!confirm("Delete this charge?")) return;
                              try {
                                await remove({ data: { id: r.id } });
                                load();
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : "Could not delete");
                              }
                            }}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[#55555E] hover:text-[#D03020]"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {showAdd ? (
        <AddChargeForm
          vehicles={vehicles}
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            load();
          }}
        />
      ) : null}
      {showImport ? (
        <ImportForm
          onClose={() => setShowImport(false)}
          onDone={() => {
            setShowImport(false);
            load();
          }}
        />
      ) : null}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className={`bg-white rounded-2xl w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[92vh] overflow-y-auto shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-[#EDEDF0]">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="text-[#55555E] hover:text-[#111114]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-4">{children}</div>
      </div>
    </div>
  );
}

function AddChargeForm({
  vehicles,
  onClose,
  onSaved,
}: {
  vehicles: VehicleLite[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const create = useServerFn(createTollCharge);
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "");
  const [chargeType, setChargeType] = useState("toll");
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 16));
  const [amount, setAmount] = useState("");
  const [adminFee, setAdminFee] = useState("");
  const [agency, setAgency] = useState("");
  const [location, setLocation] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const amt = Number(amount.replace(/[^\d.]/g, ""));
    if (!vehicleId) return toast.error("Pick a vehicle.");
    if (!Number.isFinite(amt) || amt <= 0) return toast.error("Enter an amount.");
    setBusy(true);
    try {
      const res = await create({
        data: {
          vehicleId,
          chargeType,
          occurredAt: new Date(occurredAt).toISOString(),
          amount: amt,
          adminFee: Number(adminFee.replace(/[^\d.]/g, "")) || 0,
          agency: agency.trim() || null,
          location: location.trim() || null,
          referenceNumber: reference.trim() || null,
        },
      });
      toast[res.attributed ? "success" : "warning"](
        res.attributed
          ? "Charge recorded and matched to the renter"
          : "Charge recorded — no rental covered that time, so it is unassigned",
      );
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add Charge" onClose={onClose}>
      <div>
        <MicroLabel>Vehicle</MicroLabel>
        <select
          value={vehicleId}
          onChange={(e) => setVehicleId(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm bg-white"
        >
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {[v.year, v.make, v.model].filter(Boolean).join(" ")}
              {v.license_plate ? ` · ${v.license_plate}` : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <MicroLabel>Type</MicroLabel>
          <select
            value={chargeType}
            onChange={(e) => setChargeType(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm bg-white"
          >
            {CHARGE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <MicroLabel>When it happened</MicroLabel>
          <input
            type="datetime-local"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
          />
        </div>
        <div>
          <MicroLabel>Amount $</MicroLabel>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
          />
        </div>
        <div>
          <MicroLabel>Admin fee $</MicroLabel>
          <input
            value={adminFee}
            onChange={(e) => setAdminFee(e.target.value)}
            inputMode="decimal"
            className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground -mt-1">
        The time decides who gets billed — whoever had the car then.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <MicroLabel>Agency</MicroLabel>
          <input
            value={agency}
            onChange={(e) => setAgency(e.target.value)}
            placeholder="SunPass"
            className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
          />
        </div>
        <div>
          <MicroLabel>Reference #</MicroLabel>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
          />
        </div>
      </div>
      <div>
        <MicroLabel>Location</MicroLabel>
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
        />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="rounded-lg border border-[#EDEDF0] px-4 py-2 text-sm">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-[#D03020] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

function ImportForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const doImport = useServerFn(importTollStatement);
  const [text, setText] = useState("");
  const [chargeType, setChargeType] = useState("toll");
  const [agency, setAgency] = useState("");
  const [adminFee, setAdminFee] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportOutcome | null>(null);

  async function run() {
    if (text.trim().length < 10) return toast.error("Paste the statement first.");
    setBusy(true);
    try {
      const res = await doImport({
        data: {
          text,
          chargeType,
          agency: agency.trim() || null,
          adminFeePerCharge: Number(adminFee.replace(/[^\d.]/g, "")) || 0,
        },
      });
      setResult(res);
      if (res.imported > 0) toast.success(`Imported ${res.imported} charge(s)`);
      else toast.error("Nothing imported — see the summary");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Import Toll Statement" onClose={onClose} wide>
      {result ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Imported" value={result.imported} tone="green" />
            <Stat label="Duplicates skipped" value={result.duplicates} tone="muted" />
            <Stat
              label="Could not read"
              value={result.failed.length}
              tone={result.failed.length ? "red" : "muted"}
            />
          </div>
          {result.unattributed > 0 ? (
            <div className="rounded-xl border border-[#F0DCBB] bg-[#FDF8EF] p-3 text-sm text-[#8A5A00]">
              {result.unattributed} charge(s) imported with nobody assigned — no rental covered
              those times. They are filtered under &ldquo;Unassigned&rdquo;.
            </div>
          ) : null}
          {result.unknownPlates.length ? (
            <div className="rounded-xl border border-[#F3C9C4] bg-[#FDF2F1] p-3 text-sm text-[#8A1C10]">
              <div className="font-semibold">Plates not in your fleet</div>
              <div className="mt-1">{result.unknownPlates.join(", ")}</div>
              <div className="mt-1 text-xs">
                Add the plate to the vehicle record, then re-import — duplicates are skipped
                automatically.
              </div>
            </div>
          ) : null}
          {result.unmappedHeaders.length ? (
            <div className="text-xs text-muted-foreground">
              Columns ignored: {result.unmappedHeaders.join(", ")}
            </div>
          ) : null}
          {result.failed.length ? (
            <div className="rounded-xl border border-[#EDEDF0] p-3 max-h-40 overflow-y-auto">
              <div className="text-xs font-semibold uppercase tracking-wide text-[#55555E]">
                Rows not imported
              </div>
              <ul className="mt-1.5 space-y-0.5 text-xs text-[#55555E]">
                {result.failed.slice(0, 40).map((f) => (
                  <li key={f.row}>
                    Line {f.row}: {f.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setResult(null);
                setText("");
              }}
              className="rounded-lg border border-[#EDEDF0] px-4 py-2 text-sm"
            >
              Import another
            </button>
            <button
              onClick={onDone}
              className="rounded-lg bg-[#D03020] text-white px-4 py-2 text-sm font-medium"
            >
              Done
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Paste the CSV straight from your toll or citation portal. Columns are matched by name,
            vehicles by license plate, and each charge is billed to whoever had the car at that
            moment. Re-importing an overlapping statement is safe — anything already on file is
            skipped.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <MicroLabel>Charge type</MicroLabel>
              <select
                value={chargeType}
                onChange={(e) => setChargeType(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm bg-white"
              >
                {CHARGE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <MicroLabel>Agency (fallback)</MicroLabel>
              <input
                value={agency}
                onChange={(e) => setAgency(e.target.value)}
                placeholder="SunPass"
                className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <MicroLabel>Admin fee each $</MicroLabel>
              <input
                value={adminFee}
                onChange={(e) => setAdminFee(e.target.value)}
                inputMode="decimal"
                placeholder="0"
                className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
              />
            </div>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            placeholder={
              "License Plate,Transaction Date,Amount,Plaza,Transaction ID\nABC1234,01/05/2026 8:15 AM,$1.75,Veterans Expy,SP-100"
            }
            className="w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-xs font-mono"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-[#EDEDF0] px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={run}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#D03020] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {busy ? "Importing…" : "Import"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "green" | "red" | "muted";
}) {
  const cls =
    tone === "green"
      ? "border-[#CDE7D6] bg-[#F2FAF5] text-[#1F8A4C]"
      : tone === "red"
        ? "border-[#F3C9C4] bg-[#FDF2F1] text-[#8A1C10]"
        : "border-[#EDEDF0] bg-[#FAFAFB] text-[#55555E]";
  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[11px]">{label}</div>
    </div>
  );
}
