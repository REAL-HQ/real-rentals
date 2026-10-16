import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isRentalReady, rentalReadyItems } from "@/lib/vehicle-readiness";
import { displayPersonName, displayVehicleWord } from "@/lib/display-normalize";
import { loadStaffPhoto } from "@/lib/photoUrl";
import type { Vehicle } from "./types";

// Driver profile → Rental → Assign Vehicle. Display/selection only: the
// caller's onChange (existing assignment path) is unchanged. Reads only
// staff-authorized vehicle rows and active rentals — no finance fields.

type ActiveRental = { vehicle_id: string; application_id: string | null; renter: string | null };

const normPlate = (s: string) => s.toLowerCase().replace(/[\s-]+/g, "");
const titleOf = (v: Vehicle) =>
  [v.year, v.make && displayVehicleWord(v.make), v.model && displayVehicleWord(v.model), v.trim]
    .filter(Boolean)
    .join(" ") || "Vehicle Details Missing";
const statusLabel = (s: string | null) =>
  (s ?? "Unknown").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function Thumb({ path }: { path: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (!path) return;
    if (/^https?:\/\//.test(path) || path.startsWith("/")) setUrl(path);
    else loadStaffPhoto(path).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [path]);
  return (
    <span className="w-10 h-8 rounded bg-soft border border-border overflow-hidden shrink-0">
      {url ? <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" /> : null}
    </span>
  );
}

export function AssignVehiclePicker({
  vehicles,
  value,
  driverId,
  onChange,
}: {
  vehicles: Vehicle[];
  value: string | null;
  driverId: string;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [make, setMake] = useState("all");
  const [body, setBody] = useState("all");
  const [fuel, setFuel] = useState("all");
  const [status, setStatus] = useState("all");
  const [rentals, setRentals] = useState<Map<string, ActiveRental>>(new Map());

  useEffect(() => {
    if (!open) return;
    let live = true;
    (async () => {
      const { data } = await supabase
        .from("rentals")
        .select("vehicle_id,application_id")
        .eq("status", "active");
      const rows = (data ?? []).filter((r: any) => r.vehicle_id) as any[];
      const ids = [...new Set(rows.map((r) => r.application_id).filter(Boolean))];
      const names = new Map<string, string>();
      if (ids.length) {
        const { data: apps } = await supabase.from("applications").select("id,full_name").in("id", ids);
        for (const a of apps ?? []) if (a.full_name) names.set(a.id, displayPersonName(a.full_name));
      }
      if (!live) return;
      setRentals(
        new Map(
          rows.map((r) => [
            r.vehicle_id,
            { vehicle_id: r.vehicle_id, application_id: r.application_id, renter: names.get(r.application_id) ?? null },
          ]),
        ),
      );
    })();
    return () => {
      live = false;
    };
  }, [open]);

  const selected = value ? vehicles.find((v) => v.id === value) : null;
  const uniq = (arr: (string | null | undefined)[]) =>
    Array.from(new Set(arr.filter((x): x is string => !!x))).sort();
  const makes = useMemo(() => uniq(vehicles.map((v) => v.make)), [vehicles]);
  const bodies = useMemo(() => uniq(vehicles.map((v) => v.body_type)), [vehicles]);
  const fuels = useMemo(() => uniq(vehicles.map((v) => v.fuel_type)), [vehicles]);
  const statuses = useMemo(() => uniq(vehicles.map((v) => v.status)), [vehicles]);

  /** Why a vehicle cannot be picked, or null. The current assignment stays pickable. */
  const blockReason = (v: Vehicle): string | null => {
    if (v.id === value) return null;
    const r = rentals.get(v.id);
    if (r && r.application_id !== driverId) return "On Active Rental";
    if (v.status !== "available") return `Status: ${statusLabel(v.status)}`;
    if (!isRentalReady(v)) {
      const gaps = rentalReadyItems(v).filter((i) => !i.done).map((i) => i.label);
      return `Missing ${gaps.join(", ")}`;
    }
    return null;
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/\s+/g, " ");
    const plateNeedle = normPlate(q);
    return vehicles
      .filter((v) => {
        if (make !== "all" && v.make !== make) return false;
        if (body !== "all" && v.body_type !== body) return false;
        if (fuel !== "all" && v.fuel_type !== fuel) return false;
        if (status !== "all" && v.status !== status) return false;
        if (!needle) return true;
        const vin6 = (v.vin ?? "").slice(-6).toLowerCase();
        const hay = `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""} ${v.trim ?? ""} ${v.color ?? ""} ${vin6} ${v.unit_number ?? ""}`
          .toLowerCase()
          .replace(/\s+/g, " ");
        if (hay.includes(needle)) return true;
        if (plateNeedle && v.license_plate && normPlate(v.license_plate).includes(plateNeedle)) return true;
        return !!plateNeedle && vin6.includes(plateNeedle);
      })
      .map((v) => ({ v, block: blockReason(v) }))
      .sort((a, b) => Number(!!a.block) - Number(!!b.block) || titleOf(a.v).localeCompare(titleOf(b.v)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicles, q, make, body, fuel, status, rentals, value, driverId]);

  const sel = (o: string[], label: string, val: string, set: (s: string) => void) => (
    <select
      value={val}
      onChange={(e) => set(e.target.value)}
      className="h-7 text-xs bg-white border border-border rounded px-1.5 min-w-0"
    >
      <option value="all">{label}: All</option>
      {o.map((x) => (
        <option key={x} value={x}>
          {statusLabel(x)}
        </option>
      ))}
    </select>
  );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full min-h-8 bg-white border border-border rounded-md px-3 py-1 text-sm flex items-center justify-between text-left gap-2"
      >
        <span className={`truncate ${selected ? "" : "text-muted-foreground"}`}>
          {selected
            ? `${titleOf(selected)}${selected.license_plate ? ` · ${selected.license_plate}` : ""}`
            : "Assign Vehicle"}
        </span>
        <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-border rounded-md shadow-lg p-2">
            <div className="relative mb-2">
              <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search Year, Make, Model, Color, Plate, VIN"
                className="w-full h-8 pl-7 pr-2 text-sm bg-white border border-border rounded"
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mb-2">
              {sel(makes, "Make", make, setMake)}
              {sel(bodies, "Body", body, setBody)}
              {sel(fuels, "Fuel", fuel, setFuel)}
              {sel(statuses, "Status", status, setStatus)}
            </div>
            <div className="max-h-[50vh] sm:max-h-80 overflow-y-auto -mx-1">
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-soft rounded flex items-center gap-2 text-muted-foreground"
              >
                {!value && <Check className="w-3.5 h-3.5" />} — None —
              </button>
              {filtered.map(({ v, block }) => {
                const r = rentals.get(v.id);
                const sub = [
                  v.color && displayVehicleWord(v.color),
                  v.license_plate ? `Plate ${v.license_plate}` : "No Plate",
                  v.vin ? `VIN …${v.vin.slice(-6)}` : "No VIN",
                  v.current_odometer != null ? `${Number(v.current_odometer).toLocaleString()} mi` : null,
                ].filter(Boolean);
                return (
                  <button
                    key={v.id}
                    type="button"
                    disabled={!!block}
                    title={block ?? undefined}
                    onClick={() => {
                      if (block) return;
                      onChange(v.id);
                      setOpen(false);
                    }}
                    className={`w-full text-left px-2 py-1.5 rounded flex items-center gap-2 ${
                      block ? "opacity-55 cursor-not-allowed" : "hover:bg-soft"
                    }`}
                  >
                    <Thumb path={Array.isArray(v.photos) && v.photos.length ? v.photos[0] : null} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        {value === v.id && <Check className="w-3.5 h-3.5 shrink-0" />}
                        <span className="truncate">{titleOf(v)}</span>
                      </span>
                      <span className="block text-[11px] text-muted-foreground truncate">{sub.join(" · ")}</span>
                      {(block || r) && (
                        <span className="block text-[11px] text-muted-foreground truncate">
                          {r ? `Rented To ${r.renter ?? "Another Driver"}` : block}
                          {r && block && block !== "On Active Rental" ? ` · ${block}` : ""}
                        </span>
                      )}
                    </span>
                    <span
                      className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${
                        r ? "bg-soft text-foreground" : block ? "bg-soft text-muted-foreground" : "bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {r ? "On Rent" : statusLabel(v.status)}
                    </span>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">No Matches</div>
              )}
            </div>
            <div className="mt-1 px-2 pt-1 text-[10px] text-muted-foreground border-t border-border">
              {filtered.filter((f) => !f.block).length} Assignable · {filtered.length} of {vehicles.length}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
