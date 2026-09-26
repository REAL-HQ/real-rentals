import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  X, Keyboard, ScanLine, FileText, Upload, Loader2, Check, AlertTriangle, ArrowLeft, Sparkles,
} from "lucide-react";
import {
  suggestUnitNumber, decodeVin, createVehicle,
  OWNERSHIP_TYPES, BODY_TYPES, VEHICLE_STATUSES,
} from "@/lib/vehicles.functions";
import { checkVin } from "@/lib/vin";

// Adding a vehicle.
//
// The old path opened the full editor and refused to save without a weekly
// rate, so recording a car you had just bought meant inventing a price. A
// vehicle should exist the moment it physically exists; pricing, insurance and
// paperwork follow.
//
// Four ways in. Two are built; the other two are Phase 2/3 and say so rather
// than presenting a button that does nothing.

type Mode = "choose" | "manual" | "vin";

const DECODED_LABELS: Record<string, string> = {
  year: "Year", make: "Make", model: "Model", trim: "Trim",
  body_class: "Body style", body_type: "Body type", drivetrain: "Drivetrain",
  engine_cylinders: "Cylinders", engine_displacement: "Displacement (L)",
  fuel_type: "Fuel", doors: "Doors", manufacturer: "Manufacturer",
  plant_country: "Built in", series: "Series",
};

export function AddVehicleDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("choose");

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-xl w-full max-w-2xl my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            {mode !== "choose" && (
              <button onClick={() => setMode("choose")} aria-label="Back" className="text-muted-foreground hover:text-foreground">
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <h3 className="font-semibold">
              {mode === "choose" ? "Add a vehicle" : mode === "vin" ? "Start from a VIN" : "Vehicle details"}
            </h3>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {mode === "choose" ? (
          <Chooser onPick={setMode} />
        ) : (
          <ManualForm startFromVin={mode === "vin"} onCreated={onCreated} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

function Chooser({ onPick }: { onPick: (m: Mode) => void }) {
  return (
    <div className="p-6 grid gap-3 sm:grid-cols-2">
      <Option
        icon={Keyboard}
        title="Enter manually"
        hint="Type what you know. Everything else can be filled in later."
        onClick={() => onPick("manual")}
      />
      <Option
        icon={ScanLine}
        title="Start from a VIN"
        hint="Paste or type the VIN and we'll look up the year, make, model and specs for you to confirm."
        onClick={() => onPick("vin")}
      />
      <Option
        icon={FileText}
        title="Scan the title"
        hint="Photograph the title and have the details read off it for review."
        soon="Next phase"
      />
      <Option
        icon={Upload}
        title="Import a spreadsheet"
        hint="Bring in a whole fleet from CSV or XLSX with column mapping and duplicate checks."
        soon="Next phase"
      />
    </div>
  );
}

function Option({
  icon: Icon, title, hint, onClick, soon,
}: {
  icon: any; title: string; hint: string; onClick?: () => void; soon?: string;
}) {
  const disabled = !!soon;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`text-left rounded-xl border p-4 transition-colors ${
        disabled
          ? "border-border opacity-55 cursor-default"
          : "border-border hover:border-[#D03020] hover:bg-[rgba(208,48,32,0.02)]"
      }`}
    >
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-[#D03020]" />
        <span className="font-medium text-sm">{title}</span>
        {soon && (
          <span className="ml-auto text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 bg-[#F4F4F6] text-muted-foreground">
            {soon}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{hint}</p>
    </button>
  );
}

type Form = {
  unit_number: string; vin: string; year: string; make: string; model: string;
  trim: string; color: string; body_type: string; current_odometer: string;
  license_plate: string; plate_state: string; status: string; ownership_type: string;
};

const EMPTY: Form = {
  unit_number: "", vin: "", year: "", make: "", model: "", trim: "", color: "",
  body_type: "", current_odometer: "", license_plate: "", plate_state: "",
  status: "available", ownership_type: "",
};

function ManualForm({
  startFromVin, onCreated, onClose,
}: {
  startFromVin: boolean; onCreated: (id: string) => void; onClose: () => void;
}) {
  const suggest = useServerFn(suggestUnitNumber);
  const decode = useServerFn(decodeVin);
  const create = useServerFn(createVehicle);

  const [f, setF] = useState<Form>(EMPTY);
  const [decoded, setDecoded] = useState<Record<string, string> | null>(null);
  const [decodeNote, setDecodeNote] = useState<string | null>(null);
  const [decoding, setDecoding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [badField, setBadField] = useState<string | null>(null);

  const set = (k: keyof Form, v: string) => {
    setF((prev) => ({ ...prev, [k]: v }));
    setBadField(null);
  };

  // Offer the next free unit number, but leave it editable — a fleet that
  // already numbers its cars should not be forced onto ours.
  useEffect(() => {
    suggest({ data: {} })
      .then((r) => r.suggestion && setF((prev) => (prev.unit_number ? prev : { ...prev, unit_number: r.suggestion })))
      .catch(() => {});
  }, [suggest]);

  const vinState = f.vin.trim() ? checkVin(f.vin) : null;

  const runDecode = useCallback(async () => {
    if (!f.vin.trim()) return toast.error("Enter a VIN first");
    setDecoding(true);
    setDecoded(null);
    setDecodeNote(null);
    try {
      const r = await decode({ data: { vin: f.vin } });
      if (!r.ok) {
        setDecodeNote(r.error ?? "Nothing came back for that VIN.");
        return;
      }
      setDecoded(r.decoded);
      if (r.warning) setDecodeNote(r.warning);
    } catch {
      setDecodeNote("Could not reach the VIN decoder. Enter the details manually.");
    } finally {
      setDecoding(false);
    }
  }, [decode, f.vin]);

  /**
   * Apply decoded values. Only fills blanks — anything already typed is left
   * alone, so a lookup can never quietly overwrite what the operator saw on
   * the car itself.
   */
  function applyDecoded() {
    if (!decoded) return;
    setF((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(decoded)) {
        if (k === "body_class") continue;
        if (k in next && !next[k as keyof Form]) (next as any)[k] = v;
      }
      return next;
    });
    toast.success("Filled in the blanks — existing entries were left as they are");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.make.trim() || !f.model.trim() || !f.year.trim()) {
      return toast.error("Year, make and model are required");
    }
    const year = Number(f.year);
    if (!Number.isFinite(year)) return toast.error("Year must be a number");

    setSaving(true);
    try {
      const res = await create({
        data: {
          unit_number: f.unit_number.trim() || null,
          vin: f.vin.trim() || null,
          year,
          make: f.make.trim(),
          model: f.model.trim(),
          trim: f.trim.trim() || null,
          color: f.color.trim() || null,
          body_type: (f.body_type || null) as any,
          current_odometer: f.current_odometer ? Number(f.current_odometer) : null,
          license_plate: f.license_plate.trim() || null,
          plate_state: f.plate_state.trim() || null,
          status: f.status || "available",
          ownership_type: (f.ownership_type || null) as any,
        },
      });
      if (!res.ok) {
        setBadField(res.field ?? null);
        return toast.error(res.error);
      }
      toast.success(`${res.unit_number ? res.unit_number + " — " : ""}${f.year} ${f.make} ${f.model} added`);
      onCreated(res.id);
    } catch (e: any) {
      toast.error(e?.message === "Forbidden" ? "Only a Manager or Owner can add vehicles." : "Could not add the vehicle.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="p-6 space-y-5">
      {/* VIN first when that is how they started */}
      <section className={startFromVin ? "" : "order-last"}>
        <Legend>Identity</Legend>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Unit number" hint="Suggested from your fleet — edit freely." bad={badField === "unit_number"}>
            <input value={f.unit_number} onChange={(e) => set("unit_number", e.target.value)} placeholder="RR-001" className={inputCls(badField === "unit_number")} />
          </Field>
          <Field label="VIN" bad={badField === "vin"}>
            <div className="flex gap-2">
              <input
                value={f.vin}
                onChange={(e) => set("vin", e.target.value.toUpperCase())}
                placeholder="17 characters"
                className={inputCls(badField === "vin")}
              />
              <button
                type="button"
                onClick={runDecode}
                disabled={decoding || !f.vin.trim()}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-border px-3 text-xs hover:bg-soft disabled:opacity-50"
              >
                {decoding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Look up
              </button>
            </div>
            {vinState && !vinState.formatValid && (
              <p className="mt-1 text-[11px] text-[#D03020]">{vinState.problem}</p>
            )}
            {vinState?.formatValid && vinState.checkDigitValid === false && (
              <p className="mt-1 text-[11px] text-[#B45309]">{vinState.problem}</p>
            )}
          </Field>
        </div>
      </section>

      {(decoded || decodeNote) && (
        <div className="rounded-lg border border-border bg-[#FAFAFB] p-3">
          {decodeNote && (
            <p className="flex items-start gap-1.5 text-xs text-[#B45309] mb-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {decodeNote}
            </p>
          )}
          {decoded && Object.keys(decoded).length > 0 && (
            <>
              <p className="text-xs font-medium mb-2">
                Found this for the VIN — nothing is saved until you apply it.
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {Object.entries(decoded).map(([k, v]) => (
                  <div key={k} className="text-xs flex justify-between gap-2">
                    <span className="text-muted-foreground">{DECODED_LABELS[k] ?? k}</span>
                    <span className="font-medium text-right">{v}</span>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={applyDecoded}
                className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-black text-white px-3 py-1.5 text-xs"
              >
                <Check className="w-3.5 h-3.5" /> Use these for anything still blank
              </button>
            </>
          )}
        </div>
      )}

      <section>
        <Legend>Vehicle</Legend>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Field label="Year *"><input value={f.year} onChange={(e) => set("year", e.target.value)} inputMode="numeric" className={inputCls()} /></Field>
          <Field label="Make *"><input value={f.make} onChange={(e) => set("make", e.target.value)} className={inputCls()} /></Field>
          <Field label="Model *"><input value={f.model} onChange={(e) => set("model", e.target.value)} className={inputCls()} /></Field>
          <Field label="Trim"><input value={f.trim} onChange={(e) => set("trim", e.target.value)} className={inputCls()} /></Field>
          <Field label="Colour"><input value={f.color} onChange={(e) => set("color", e.target.value)} className={inputCls()} /></Field>
          <Field label="Body type">
            <select value={f.body_type} onChange={(e) => set("body_type", e.target.value)} className={inputCls()}>
              <option value="">—</option>
              {BODY_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
          <Field label="Mileage"><input value={f.current_odometer} onChange={(e) => set("current_odometer", e.target.value)} inputMode="numeric" className={inputCls()} /></Field>
          <Field label="Plate" bad={badField === "license_plate"}>
            <input value={f.license_plate} onChange={(e) => set("license_plate", e.target.value.toUpperCase())} className={inputCls(badField === "license_plate")} />
          </Field>
          <Field label="Plate state"><input value={f.plate_state} onChange={(e) => set("plate_state", e.target.value.toUpperCase())} maxLength={2} className={inputCls()} /></Field>
        </div>
      </section>

      <section>
        <Legend>Status &amp; ownership</Legend>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <select value={f.status} onChange={(e) => set("status", e.target.value)} className={inputCls()}>
              {VEHICLE_STATUSES.filter((s) => !["archived", "sold", "retired"].includes(s.value)).map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Ownership">
            <select value={f.ownership_type} onChange={(e) => set("ownership_type", e.target.value)} className={inputCls()}>
              <option value="">—</option>
              {OWNERSHIP_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Only year, make and model are needed now. Rates, insurance, registration, GPS, keys,
        documents and photos are all on the vehicle's own page afterwards.
      </p>

      <div className="flex gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2.5 text-sm">
          Cancel
        </button>
        <button disabled={saving} className="flex-1 rounded-lg bg-real-red text-white py-2.5 text-sm font-medium disabled:opacity-60">
          {saving ? "Adding…" : "Add vehicle"}
        </button>
      </div>
    </form>
  );
}

function Legend({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{children}</div>;
}

function Field({
  label, children, hint, bad,
}: {
  label: string; children: React.ReactNode; hint?: string; bad?: boolean;
}) {
  return (
    <div>
      <label className={`block text-xs mb-1 ${bad ? "text-[#D03020] font-medium" : "text-muted-foreground"}`}>{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function inputCls(bad?: boolean) {
  return `w-full rounded-md border px-3 py-2 text-sm bg-white ${bad ? "border-[#D03020]" : "border-border"}`;
}
