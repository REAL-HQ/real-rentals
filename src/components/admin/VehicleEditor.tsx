import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { generateVehicleImage } from "@/lib/admin-ai.functions";
import { getVehicleFinance, saveVehicleFinance } from "@/lib/vehicle-finance.functions";
import { OWNERSHIP_TYPES } from "@/lib/vehicles.functions";
import { resolvePhotoUrl } from "@/lib/photoUrl";
import type { Vehicle } from "./types";
import { toast } from "sonner";
import { VehicleDocuments } from "./VehicleDocuments";
import { Sparkles, Upload, X, Loader2, Lock } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STATUSES = ["available", "rented", "maintenance", "reserved"];
const BODY_TYPES = ["sedan", "suv", "xl"];
const TITLE_STATUSES = ["", "clean", "financed", "lien", "salvage", "rebuilt"];

type FormState = {
  year: number;
  make: string;
  model: string;
  trim: string;
  color: string;
  body_type: string;
  mpg: number | null;
  weekly_rate: number;
  monthly_rate: number | null;
  deposit: number | null;
  doors: number | null;
  seats: number | null;
  status: string;
  description: string;
  maintenance_status: string;
  badges: string[];
  uber_eligibility: string[];
  photos: string[];
  current_odometer: number | null;
  last_oil_change_miles: number | null;
  oil_interval_miles: number | null;
  last_tire_date: string;
  last_brake_inspection_date: string;
  vin: string;
  license_plate: string;
  plate_state: string;
  plate_expires_on: string;
  registration_state: string;
  registration_expires_on: string;
  title_status: string;
  title_number: string;
  gps_provider: string;
  gps_device_id: string;
  gps_installed_on: string;
  toll_transponder_id: string;
  toll_account: string;
  insurance_carrier: string;
  insurance_policy_number: string;
  insurance_expires_on: string;
  internal_notes: string;
  key_count: number | null;
};

/**
 * Acquisition and financing, kept apart from FormState on purpose.
 *
 * These are not columns on vehicles any more — they live in vehicle_finance,
 * which only a Manager or Owner can read or write. The browser never touches
 * that table directly; the two server functions below are the only path, and
 * they check the tier themselves.
 */
type FinanceState = {
  ownership_type: string;
  legal_owner: string;
  seller_dealer: string;
  lienholder: string;
  purchase_date: string;
  purchase_price: number | null;
  loan_reference: string;
  payoff_amount: number | null;
  monthly_payment: number | null;
  loan_maturity_date: string;
};

const EMPTY_FINANCE: FinanceState = {
  ownership_type: "",
  legal_owner: "",
  seller_dealer: "",
  lienholder: "",
  purchase_date: "",
  purchase_price: null,
  loan_reference: "",
  payoff_amount: null,
  monthly_payment: null,
  loan_maturity_date: "",
};

function init(v: Vehicle | null): FormState {
  return {
    year: v?.year ?? new Date().getFullYear(),
    make: v?.make ?? "",
    model: v?.model ?? "",
    trim: v?.trim ?? "",
    color: (v as any)?.color ?? "",
    body_type: v?.body_type ?? "sedan",
    mpg: v?.mpg ?? null,
    weekly_rate: Number(v?.weekly_rate ?? 0),
    monthly_rate: v?.monthly_rate != null ? Number(v.monthly_rate) : null,
    deposit: v?.deposit != null ? Number(v.deposit) : 249,
    doors: v?.doors ?? 4,
    seats: v?.seats ?? null,
    status: v?.status ?? "available",
    description: v?.description ?? "",
    maintenance_status: v?.maintenance_status ?? "Well Maintained",
    badges: v?.badges ?? [],
    uber_eligibility: v?.uber_eligibility ?? [],
    photos: v?.photos ?? [],
    current_odometer: (v as any)?.current_odometer ?? null,
    last_oil_change_miles: (v as any)?.last_oil_change_miles ?? null,
    oil_interval_miles: (v as any)?.oil_interval_miles ?? 5000,
    last_tire_date: (v as any)?.last_tire_date ?? "",
    last_brake_inspection_date: (v as any)?.last_brake_inspection_date ?? "",
    vin: (v as any)?.vin ?? "",
    license_plate: (v as any)?.license_plate ?? "",
    plate_state: (v as any)?.plate_state ?? "",
    plate_expires_on: (v as any)?.plate_expires_on ?? "",
    registration_state: (v as any)?.registration_state ?? "",
    registration_expires_on: (v as any)?.registration_expires_on ?? "",
    title_status: (v as any)?.title_status ?? "",
    title_number: (v as any)?.title_number ?? "",
    gps_provider: (v as any)?.gps_provider ?? "",
    gps_device_id: (v as any)?.gps_device_id ?? "",
    gps_installed_on: (v as any)?.gps_installed_on ?? "",
    toll_transponder_id: (v as any)?.toll_transponder_id ?? "",
    toll_account: (v as any)?.toll_account ?? "",
    insurance_carrier: (v as any)?.insurance_carrier ?? "",
    insurance_policy_number: (v as any)?.insurance_policy_number ?? "",
    insurance_expires_on: (v as any)?.insurance_expires_on ?? "",
    internal_notes: (v as any)?.internal_notes ?? "",
    key_count: (v as any)?.key_count ?? null,
  };
}

export function VehicleEditor({
  vehicle,
  onClose,
  onSaved,
}: {
  vehicle: Vehicle | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState<FormState>(() => init(vehicle));
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const genImage = useServerFn(generateVehicleImage);
  const loadFinance = useServerFn(getVehicleFinance);
  const storeFinance = useServerFn(saveVehicleFinance);

  const [fin, setFin] = useState<FinanceState>(EMPTY_FINANCE);
  // Whether to show the financing card at all is the server's answer, not a
  // role check copied into the browser. getVehicleFinance refuses anyone below
  // Manager, so a Coordinator's request fails and the card never renders — and
  // if this flag were wrong, the save would still be refused.
  const [canFinance, setCanFinance] = useState(false);

  useEffect(() => {
    let live = true;
    if (!vehicle?.id) {
      // A new vehicle has no id to key financing to yet. Offer it anyway: the
      // record is created immediately after the insert returns an id.
      setCanFinance(true);
      setFin(EMPTY_FINANCE);
      return;
    }
    loadFinance({ data: { vehicle_id: vehicle.id } })
      .then((r) => {
        if (!live) return;
        setCanFinance(true);
        setFin(
          r
            ? {
                ownership_type: r.ownership_type ?? "",
                legal_owner: r.legal_owner ?? "",
                seller_dealer: r.seller_dealer ?? "",
                lienholder: r.lienholder ?? "",
                purchase_date: r.purchase_date ?? "",
                purchase_price: r.purchase_price != null ? Number(r.purchase_price) : null,
                loan_reference: r.loan_reference ?? "",
                payoff_amount: r.payoff_amount != null ? Number(r.payoff_amount) : null,
                monthly_payment: r.monthly_payment != null ? Number(r.monthly_payment) : null,
                loan_maturity_date: r.loan_maturity_date ?? "",
              }
            : EMPTY_FINANCE,
        );
      })
      .catch(() => {
        if (live) setCanFinance(false);
      });
    return () => {
      live = false;
    };
  }, [vehicle?.id, loadFinance]);

  function setFinField<K extends keyof FinanceState>(k: K, v: FinanceState[K]) {
    setFin((s) => ({ ...s, [k]: v }));
  }

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setF((s) => ({ ...s, [k]: v }));
  }

  async function save() {
    if (!f.make || !f.model || !f.weekly_rate)
      return toast.error("Make, model, and weekly rate are required");
    setSaving(true);
    const payload = {
      year: f.year,
      make: f.make,
      model: f.model,
      trim: f.trim || null,
      color: f.color || null,
      body_type: f.body_type || null,
      mpg: f.mpg,
      weekly_rate: f.weekly_rate,
      monthly_rate: f.monthly_rate,
      deposit: f.deposit,
      doors: f.doors,
      seats: f.seats,
      status: f.status,
      description: f.description || null,
      maintenance_status: f.maintenance_status || null,
      badges: f.badges,
      uber_eligibility: f.uber_eligibility,
      photos: f.photos,
      current_odometer: f.current_odometer,
      last_oil_change_miles: f.last_oil_change_miles,
      oil_interval_miles: f.oil_interval_miles ?? 5000,
      last_tire_date: f.last_tire_date || null,
      last_brake_inspection_date: f.last_brake_inspection_date || null,
      // Upper-cased so the case-insensitive unique index behaves predictably
      // and two entries for the same car cannot differ only by casing.
      vin: f.vin.trim().toUpperCase() || null,
      license_plate: f.license_plate.trim().toUpperCase() || null,
      plate_state: f.plate_state.trim().toUpperCase() || null,
      plate_expires_on: f.plate_expires_on || null,
      registration_state: f.registration_state.trim().toUpperCase() || null,
      registration_expires_on: f.registration_expires_on || null,
      title_status: f.title_status || null,
      title_number: f.title_number.trim() || null,
      gps_provider: f.gps_provider.trim() || null,
      gps_device_id: f.gps_device_id.trim() || null,
      gps_installed_on: f.gps_installed_on || null,
      toll_transponder_id: f.toll_transponder_id.trim() || null,
      toll_account: f.toll_account.trim() || null,
      insurance_carrier: f.insurance_carrier.trim() || null,
      insurance_policy_number: f.insurance_policy_number.trim() || null,
      insurance_expires_on: f.insurance_expires_on || null,
      key_count: f.key_count,
      internal_notes: f.internal_notes.trim() || null,
    };
    const { data: saved, error } = vehicle
      ? await supabase.from("vehicles").update(payload).eq("id", vehicle.id).select("id").single()
      : await supabase.from("vehicles").insert(payload).select("id").single();
    if (error) {
      setSaving(false);
      const msg = error.message.includes("vehicles_vin_unique_idx")
        ? "Another vehicle already has that VIN."
        : error.message.includes("vehicles_plate_unique_idx")
          ? "Another vehicle already has that license plate."
          : error.message;
      return toast.error(msg);
    }

    // Financing is a second, separately authorised write. Reported rather than
    // swallowed: silently failing to save a payoff figure is how a number goes
    // stale without anyone noticing.
    if (canFinance && saved?.id && hasFinance(fin)) {
      const res = await storeFinance({
        data: {
          vehicle_id: saved.id,
          ownership_type: (fin.ownership_type || null) as any,
          legal_owner: fin.legal_owner || null,
          seller_dealer: fin.seller_dealer || null,
          lienholder: fin.lienholder || null,
          purchase_date: fin.purchase_date || null,
          purchase_price: fin.purchase_price,
          loan_reference: fin.loan_reference || null,
          payoff_amount: fin.payoff_amount,
          monthly_payment: fin.monthly_payment,
          loan_maturity_date: fin.loan_maturity_date || null,
        },
      }).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : "Financing was not saved." }));
      if (!res.ok) {
        setSaving(false);
        return toast.error(res.error ?? "The vehicle saved, but its financing did not.");
      }
    }

    setSaving(false);
    toast.success(vehicle ? "Vehicle updated" : "Vehicle created");
    onSaved();
  }

  async function uploadFile(file: File) {
    setUploading(true);
    const ext = file.name.split(".").pop() || "jpg";
    const path = `vehicles/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage
      .from("vehicle-photos")
      .upload(path, file, { upsert: false });
    setUploading(false);
    if (error) return toast.error(error.message);
    set("photos", [...f.photos, path]);
    toast.success("Photo uploaded");
  }

  async function aiGenerate() {
    if (!f.make || !f.model || !f.year || !f.color) {
      return toast.error("Fill in year, make, model, and color first");
    }
    setGenerating(true);
    try {
      const result = await genImage({
        data: {
          year: f.year,
          make: f.make,
          model: f.model,
          color: f.color,
          body_type: f.body_type || null,
          trim: f.trim || null,
        },
      });
      const bytes = Uint8Array.from(atob(result.b64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes as unknown as BlobPart], { type: "image/png" });
      const path = `vehicles/ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
      const { error } = await supabase.storage
        .from("vehicle-photos")
        .upload(path, blob, { contentType: "image/png" });
      if (error) throw error;
      set("photos", [...f.photos, path]);
      toast.success("AI image generated");
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes("429")) toast.error("AI rate limit — try again in a moment.");
      else if (msg.includes("402"))
        toast.error("AI credits exhausted. Add credits in workspace settings.");
      else toast.error(msg.slice(0, 200));
    } finally {
      setGenerating(false);
    }
  }

  function removePhoto(idx: number) {
    set(
      "photos",
      f.photos.filter((_, i) => i !== idx),
    );
  }
  function movePhoto(idx: number, dir: -1 | 1) {
    const next = [...f.photos];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    set("photos", next);
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl max-w-3xl w-full max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-border px-6 py-4 flex justify-between items-center">
          <h2 className="text-lg font-semibold">{vehicle ? "Edit vehicle" : "Add vehicle"}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Num
              label="Year"
              v={f.year}
              onChange={(n) => set("year", n ?? new Date().getFullYear())}
            />
            <Txt label="Make" v={f.make} onChange={(s) => set("make", s)} />
            <Txt label="Model" v={f.model} onChange={(s) => set("model", s)} />
            <Txt label="Trim" v={f.trim} onChange={(s) => set("trim", s)} />
            <Txt label="Color" v={f.color} onChange={(s) => set("color", s)} />
            <Sel
              label="Body type"
              v={f.body_type}
              options={BODY_TYPES}
              onChange={(s) => set("body_type", s)}
            />
            <Num label="Doors" v={f.doors} onChange={(n) => set("doors", n)} />
            <Num label="Seats" v={f.seats} onChange={(n) => set("seats", n)} />
            <Num label="MPG" v={f.mpg} onChange={(n) => set("mpg", n)} />
            <Num label="Weekly $" v={f.weekly_rate} onChange={(n) => set("weekly_rate", n ?? 0)} />
            <Num label="Monthly $" v={f.monthly_rate} onChange={(n) => set("monthly_rate", n)} />
            <Num label="Deposit $" v={f.deposit} onChange={(n) => set("deposit", n)} />
            <Sel
              label="Status"
              v={f.status}
              options={STATUSES}
              onChange={(s) => set("status", s)}
            />
            <Txt
              label="Maintenance"
              v={f.maintenance_status}
              onChange={(s) => set("maintenance_status", s)}
            />
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">
              Description
            </label>
            <textarea
              value={f.description}
              onChange={(e) => set("description", e.target.value)}
              rows={3}
              className="mt-1 w-full border border-border rounded-md px-3 py-2 text-sm"
            />
          </div>

          <CSV label="Badges (comma separated)" v={f.badges} onChange={(a) => set("badges", a)} />
          <CSV
            label="Uber eligibility (comma separated, e.g. UberX, Comfort)"
            v={f.uber_eligibility}
            onChange={(a) => set("uber_eligibility", a)}
          />

          <div className="rounded-xl border border-[#EDEDF0] p-4 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Identity &amp; Registration
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Txt label="VIN" v={f.vin} onChange={(x) => set("vin", x)} />
              <Txt
                label="License Plate"
                v={f.license_plate}
                onChange={(x) => set("license_plate", x)}
              />
              <Txt label="Plate State" v={f.plate_state} onChange={(x) => set("plate_state", x)} />
              <DateField
                label="Plate Expires"
                v={f.plate_expires_on}
                onChange={(x) => set("plate_expires_on", x)}
              />
              <Txt
                label="Registration State"
                v={f.registration_state}
                onChange={(x) => set("registration_state", x)}
              />
              <DateField
                label="Registration Expires"
                v={f.registration_expires_on}
                onChange={(x) => set("registration_expires_on", x)}
              />
              <Sel
                label="Title Status"
                v={f.title_status}
                options={TITLE_STATUSES}
                onChange={(x) => set("title_status", x)}
              />
              <Txt
                label="Title Number"
                v={f.title_number}
                onChange={(x) => set("title_number", x)}
              />
            </div>
          </div>

          {canFinance && (
            <div className="rounded-xl border border-[#EDEDF0] p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Acquisition &amp; Financing
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Owners and managers only. Coordinators cannot read these figures — not here, and
                not from the database.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Sel
                  label="Ownership"
                  v={fin.ownership_type}
                  options={["", ...OWNERSHIP_TYPES.map((o) => o.value)]}
                  onChange={(x) => setFinField("ownership_type", x)}
                />
                <Txt
                  label="Legal Owner"
                  v={fin.legal_owner}
                  onChange={(x) => setFinField("legal_owner", x)}
                />
                <Txt
                  label="Seller / Dealer"
                  v={fin.seller_dealer}
                  onChange={(x) => setFinField("seller_dealer", x)}
                />
                <Txt
                  label="Lienholder"
                  v={fin.lienholder}
                  onChange={(x) => setFinField("lienholder", x)}
                />
                <DateField
                  label="Purchase Date"
                  v={fin.purchase_date}
                  onChange={(x) => setFinField("purchase_date", x)}
                />
                <Num
                  label="Purchase Price $"
                  v={fin.purchase_price}
                  onChange={(n) => setFinField("purchase_price", n)}
                />
                <Txt
                  label="Loan / Lease Ref"
                  v={fin.loan_reference}
                  onChange={(x) => setFinField("loan_reference", x)}
                />
                <Num
                  label="Payoff $"
                  v={fin.payoff_amount}
                  onChange={(n) => setFinField("payoff_amount", n)}
                />
                <Num
                  label="Monthly Payment $"
                  v={fin.monthly_payment}
                  onChange={(n) => setFinField("monthly_payment", n)}
                />
                <DateField
                  label="Matures"
                  v={fin.loan_maturity_date}
                  onChange={(x) => setFinField("loan_maturity_date", x)}
                />
              </div>
            </div>
          )}

          <div className="rounded-xl border border-[#EDEDF0] p-4 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Tracking, Tolls &amp; Insurance
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Txt
                label="GPS Provider"
                v={f.gps_provider}
                onChange={(x) => set("gps_provider", x)}
              />
              <Txt
                label="GPS Device / Tracker #"
                v={f.gps_device_id}
                onChange={(x) => set("gps_device_id", x)}
              />
              <DateField
                label="GPS Installed"
                v={f.gps_installed_on}
                onChange={(x) => set("gps_installed_on", x)}
              />
              <Txt
                label="Toll Transponder #"
                v={f.toll_transponder_id}
                onChange={(x) => set("toll_transponder_id", x)}
              />
              <Txt
                label="Toll Account"
                v={f.toll_account}
                onChange={(x) => set("toll_account", x)}
              />
              <Num label="Key Fobs" v={f.key_count} onChange={(n) => set("key_count", n)} />
              <Txt
                label="Insurance Carrier"
                v={f.insurance_carrier}
                onChange={(x) => set("insurance_carrier", x)}
              />
              <Txt
                label="Policy Number"
                v={f.insurance_policy_number}
                onChange={(x) => set("insurance_policy_number", x)}
              />
              <DateField
                label="Policy Expires"
                v={f.insurance_expires_on}
                onChange={(x) => set("insurance_expires_on", x)}
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground">
                Internal Notes
              </label>
              <textarea
                value={f.internal_notes}
                onChange={(e) => set("internal_notes", e.target.value)}
                rows={2}
                placeholder="Not shown to renters."
                className="mt-1 w-full border border-border rounded-md px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="rounded-xl border border-[#EDEDF0] p-4 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Service Tracking
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Num
                label="Current Odometer"
                v={f.current_odometer}
                onChange={(n) => set("current_odometer", n)}
              />
              <Num
                label="Last Oil Change (mi)"
                v={f.last_oil_change_miles}
                onChange={(n) => set("last_oil_change_miles", n)}
              />
              <Num
                label="Oil Interval (mi)"
                v={f.oil_interval_miles}
                onChange={(n) => set("oil_interval_miles", n)}
              />
              <DateField
                label="Last Tire Service"
                v={f.last_tire_date}
                onChange={(s) => set("last_tire_date", s)}
              />
              <DateField
                label="Last Brake Inspection"
                v={f.last_brake_inspection_date}
                onChange={(s) => set("last_brake_inspection_date", s)}
              />
            </div>
            {vehicle && (
              <button
                type="button"
                onClick={async () => {
                  const next = prompt(
                    "Log new odometer reading (miles):",
                    String(f.current_odometer ?? ""),
                  );
                  if (!next) return;
                  const n = Number(next);
                  if (Number.isNaN(n) || n < 0) return toast.error("Invalid mileage");
                  set("current_odometer", n);
                  const { error } = await supabase
                    .from("vehicles")
                    .update({ current_odometer: n })
                    .eq("id", vehicle.id);
                  if (error) toast.error(error.message);
                  else toast.success("Odometer logged");
                }}
                className="text-xs rounded-md border border-border px-3 py-1.5 hover:bg-soft"
              >
                Log Odometer
              </button>
            )}
          </div>

          {/* Registration, insurance card, title and finance paperwork. Only
              once the vehicle exists — the documents attach to its id. */}
          {vehicle && <VehicleDocuments vehicleId={vehicle.id} />}

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs uppercase tracking-wider text-muted-foreground">
                Photos (first is primary)
              </label>
              <div className="flex gap-2">
                <label className="inline-flex items-center gap-1.5 cursor-pointer rounded-md border border-border px-3 py-1.5 text-xs hover:bg-soft">
                  {uploading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}{" "}
                  Upload
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadFile(file);
                      e.target.value = "";
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={aiGenerate}
                  disabled={generating}
                  className="inline-flex items-center gap-1.5 rounded-md bg-black text-white px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  {generating ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  {generating ? "Generating…" : "Generate with AI"}
                </button>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mb-2">
              AI uses year, make, model, color (and trim/body type if set) to create a studio-style
              photo. Optional — upload your own if you have one.
            </p>
            {f.photos.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                No photos yet
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {f.photos.map((p, i) => (
                  <div key={i} className="relative group">
                    <div className="aspect-square rounded-md overflow-hidden bg-soft border border-border">
                      <img
                        src={resolvePhotoUrl(p) ?? ""}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    </div>
                    {i === 0 && (
                      <div className="absolute top-1 left-1 bg-black text-white text-[10px] px-1.5 py-0.5 rounded">
                        Primary
                      </div>
                    )}
                    <div className="absolute inset-x-1 bottom-1 flex justify-between opacity-0 group-hover:opacity-100 transition">
                      <button
                        onClick={() => movePhoto(i, -1)}
                        className="bg-white/90 rounded text-[10px] px-1.5"
                      >
                        ←
                      </button>
                      <button
                        onClick={() => removePhoto(i)}
                        className="bg-real-red text-white rounded text-[10px] px-1.5"
                      >
                        ✕
                      </button>
                      <button
                        onClick={() => movePhoto(i, 1)}
                        className="bg-white/90 rounded text-[10px] px-1.5"
                      >
                        →
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="sticky bottom-0 bg-white border-t border-border px-6 py-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-md bg-real-red text-white px-5 py-2 text-sm font-medium disabled:opacity-50"
          >
            {saving ? "Saving…" : vehicle ? "Save changes" : "Create vehicle"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Txt({ label, v, onChange }: { label: string; v: string; onChange: (s: string) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <input
        value={v}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full border border-border rounded-md px-2 py-1.5 text-sm"
      />
    </label>
  );
}
function Num({
  label,
  v,
  onChange,
}: {
  label: string;
  v: number | null;
  onChange: (n: number | null) => void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <input
        type="number"
        value={v ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="mt-1 w-full border border-border rounded-md px-2 py-1.5 text-sm"
      />
    </label>
  );
}
function Sel({
  label,
  v,
  options,
  onChange,
}: {
  label: string;
  v: string;
  options: string[];
  onChange: (s: string) => void;
}) {
  return (
    <div className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <Select value={v} onValueChange={onChange}>
        <SelectTrigger className="mt-1 h-8 w-full bg-white text-foreground">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
function CSV({
  label,
  v,
  onChange,
}: {
  label: string;
  v: string[];
  onChange: (a: string[]) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <input
        value={v.join(", ")}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
          )
        }
        className="mt-1 w-full border border-border rounded-md px-3 py-2 text-sm"
      />
    </label>
  );
}
function DateField({
  label,
  v,
  onChange,
}: {
  label: string;
  v: string;
  onChange: (s: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <input
        type="date"
        value={v}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full border border-border rounded-md px-2 py-1.5 text-sm"
      />
    </label>
  );
}

/** Is there anything worth writing? Avoids creating an empty financing row. */
function hasFinance(fin: FinanceState): boolean {
  return Object.values(fin).some((v) => v !== null && v !== "");
}
