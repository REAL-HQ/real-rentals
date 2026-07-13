import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Application, Vehicle } from "./types";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MoreVertical, Search, Check, ChevronDown } from "lucide-react";

const DRIVER_STATUSES = ["new","reviewing","approved","active","suspended","declined","closed"] as const;
const DEPOSIT_STATUSES = ["not_paid","partially_paid","paid","refunded"] as const;
const PAYMENT_STATUSES = ["current","late","past_due","collections"] as const;
const CHECK_STATUSES = ["pending","passed","failed"] as const;

const statusBadge: Record<string,string> = {
  new: "bg-blue-100 text-blue-800",
  reviewing: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  active: "bg-green-100 text-green-800",
  suspended: "bg-orange-100 text-orange-800",
  declined: "bg-red-100 text-red-800",
  closed: "bg-gray-200 text-gray-700",
};

function formatPhone(p?: string | null): string {
  if (!p) return "—";
  const d = p.replace(/\D/g, "");
  const n = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (n.length === 10) return `${n.slice(0,3)}-${n.slice(3,6)}-${n.slice(6)}`;
  return p;
}

export function DriversPanel() {
  const [drivers, setDrivers] = useState<Application[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [open, setOpen] = useState<Application | null>(null);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    supabase.from("applications").select("*").order("created_at", { ascending: false })
      .then(({ data }) => setDrivers(data || []));
    supabase.from("vehicles").select("*").then(({ data }) => setVehicles((data as any) || []));
  }, []);

  const vehicleMap = useMemo(() => Object.fromEntries(vehicles.map(v => [v.id, v])), [vehicles]);

  async function update(id: string, patch: Partial<Application>) {
    const { error } = await supabase.from("applications").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    setDrivers((a) => a.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    if (open?.id === id) setOpen({ ...open, ...patch } as Application);
  }
  async function remove(id: string) {
    if (!confirm("Delete this driver record? This cannot be undone.")) return;
    const { error } = await supabase.from("applications").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setDrivers((a) => a.filter((x) => x.id !== id));
    setOpen(null);
    toast.success("Deleted");
  }

  const filtered = filter === "all" ? drivers : drivers.filter((a) => a.status === filter);

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4 text-xs">
        {(["all", ...DRIVER_STATUSES] as const).map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-md capitalize ${filter === s ? "bg-black text-white" : "bg-white border border-border"}`}>
            {s} {s !== "all" && `(${drivers.filter((a) => a.status === s).length})`}
          </button>
        ))}
      </div>
      <div className="rounded-lg border border-border overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-soft text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">Name</th>
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">Email</th>
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">Phone</th>
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">Vehicle</th>
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">Weekly</th>
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">Payment</th>
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">Deposit</th>
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">Status</th>
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">Created</th>
                <th className="px-2 py-2.5 border-b border-border w-10"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => {
                const veh = a.vehicle_id ? vehicleMap[a.vehicle_id] : null;
                return (
                  <tr key={a.id} onClick={() => setOpen(a)}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-soft/60 transition-colors">
                    <td className="px-4 py-2.5 font-medium whitespace-nowrap">{a.full_name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                      {a.email ? <a href={`mailto:${a.email}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>{a.email}</a> : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                      {a.phone ? <a href={`tel:${a.phone}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>{formatPhone(a.phone)}</a> : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                      {veh ? `${veh.year} ${veh.make} ${veh.model}` : "—"}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{a.weekly_rent ? `$${a.weekly_rent}` : "—"}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap capitalize text-muted-foreground">{a.payment_status?.replace(/_/g," ")}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap capitalize text-muted-foreground">{a.deposit_status?.replace(/_/g," ")}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <Select value={a.status} onValueChange={(status) => update(a.id, { status })}>
                        <SelectTrigger className={`h-7 w-28 text-xs border-0 ${statusBadge[a.status] || "bg-gray-100"}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {DRIVER_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-muted-foreground whitespace-nowrap">
                      {new Date(a.created_at!).toLocaleDateString()}
                    </td>
                    <td className="px-2 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-soft text-muted-foreground">
                          <MoreVertical className="w-4 h-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setOpen(a)}>Open</DropdownMenuItem>
                          <DropdownMenuItem className="text-real-red focus:text-real-red" onClick={() => remove(a.id)}>Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-sm text-muted-foreground">No drivers.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {open && (
        <DriverModal driver={open} vehicles={vehicles} onClose={() => setOpen(null)} onUpdate={(p) => update(open.id, p)} onDelete={() => remove(open.id)} />
      )}
    </div>
  );
}

function DriverModal({ driver, vehicles, onClose, onUpdate, onDelete }: {
  driver: Application; vehicles: Vehicle[]; onClose: () => void;
  onUpdate: (patch: Partial<Application>) => void; onDelete: () => void;
}) {
  const veh = driver.vehicle_id ? vehicles.find(v => v.id === driver.vehicle_id) : null;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-xl font-semibold">{driver.full_name}</h2>
            <div className="text-sm text-muted-foreground">{driver.email} · {driver.phone}</div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        <Section title="Lifecycle">
          <SelField label="Driver status" value={driver.status} options={[...DRIVER_STATUSES]} onChange={(v) => onUpdate({ status: v })} />
          <SelField label="Deposit status" value={driver.deposit_status} options={[...DEPOSIT_STATUSES]} onChange={(v) => onUpdate({ deposit_status: v })} />
          <SelField label="Payment status" value={driver.payment_status} options={[...PAYMENT_STATUSES]} onChange={(v) => onUpdate({ payment_status: v })} />
          <SelField label="Background check" value={driver.background_check_status} options={[...CHECK_STATUSES]} onChange={(v) => onUpdate({ background_check_status: v })} />
          <SelField label="MVR status" value={driver.mvr_status} options={[...CHECK_STATUSES]} onChange={(v) => onUpdate({ mvr_status: v })} />
          <NumField label="Incident count" value={driver.incident_count} onSave={(v) => onUpdate({ incident_count: v ?? 0 })} />
        </Section>

        <Section title="Financials">
          <NumField label="Deposit amount ($)" value={driver.deposit_amount as any} onSave={(v) => onUpdate({ deposit_amount: v as any })} />
          <NumField label="Deposit paid ($)" value={driver.deposit_paid as any} onSave={(v) => onUpdate({ deposit_paid: v as any })} />
          <NumField label="Weekly rent ($)" value={driver.weekly_rent as any} onSave={(v) => onUpdate({ weekly_rent: v as any })} />
        </Section>

        <Section title="Vehicle">
          <div className="col-span-2 bg-soft rounded-md px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Vehicle assigned</div>
            {veh ? (
              <div className="text-sm">{veh.year} {veh.make} {veh.model}<div className="text-xs text-muted-foreground">ID {veh.id.slice(0,8)}</div></div>
            ) : <div className="text-sm text-muted-foreground">None assigned</div>}
            <div className="mt-2">
              <VehiclePicker
                vehicles={vehicles}
                value={driver.vehicle_id}
                onChange={(id) => onUpdate({ vehicle_id: id })}
              />
            </div>
          </div>
        </Section>

        <Section title="Driver info">
          <Field label="DOB" value={driver.dob} />
          <Field label="License #" value={driver.license_number} />
          <Field label="License state" value={driver.license_state} />
          <Field label="License exp." value={driver.license_expiration} />
          <Field label="Years licensed" value={driver.years_licensed} />
          <Field label="Address" value={[driver.address, driver.city, driver.state, driver.zip].filter(Boolean).join(", ") || null} />
          <Field label="Platforms" value={driver.platforms?.join(", ") || null} />
          <Field label="Weekly hours" value={driver.weekly_hours} />
          <Field label="Term" value={driver.rental_term} />
          <Field label="Payment method" value={driver.payment_method} />
        </Section>

        {driver.license_photo_url && (
          <div className="mt-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">License photo</div>
            <LicensePhoto path={driver.license_photo_url} />
          </div>
        )}

        <div className="mt-4">
          <label className="text-xs text-muted-foreground uppercase tracking-wider">Internal notes</label>
          <textarea defaultValue={driver.notes || ""} rows={3} placeholder="Internal notes…"
            onBlur={(e) => onUpdate({ notes: e.target.value })}
            className="mt-1 w-full border border-border rounded-md px-3 py-2 text-sm" />
        </div>

        <div className="mt-6 flex gap-2 justify-end">
          <button onClick={onDelete} className="rounded-md border border-real-red text-real-red px-4 py-2 text-sm hover:bg-real-red hover:text-white">Delete</button>
          <button onClick={onClose} className="rounded-md bg-black text-white px-4 py-2 text-sm">Close</button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">{title}</div>
      <div className="grid grid-cols-2 gap-3 text-sm">{children}</div>
    </div>
  );
}
function Field({ label, value }: { label: string; value: any }) {
  return (
    <div className="bg-soft rounded-md px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm">{value ?? "—"}</div>
    </div>
  );
}
function SelField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="bg-soft rounded-md px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 bg-white text-foreground"><SelectValue /></SelectTrigger>
        <SelectContent>{options.map(o => <SelectItem key={o} value={o}>{o.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}
function NumField({ label, value, onSave }: { label: string; value: number | null; onSave: (v: number | null) => void }) {
  return (
    <div className="bg-soft rounded-md px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <input type="number" defaultValue={value ?? ""} onBlur={(e) => onSave(e.target.value === "" ? null : Number(e.target.value))}
        className="w-full bg-white border border-border rounded-md px-2 py-1 text-sm" />
    </div>
  );
}
function LicensePhoto({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    supabase.storage.from("license-uploads").createSignedUrl(path, 3600).then(({ data }) => {
      if (active && data?.signedUrl) setUrl(data.signedUrl);
    });
    return () => { active = false; };
  }, [path]);
  if (!url) return <div className="aspect-video bg-soft rounded-md" />;
  return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="License" className="rounded-md max-h-64 border border-border" /></a>;
}

function VehiclePicker({ vehicles, value, onChange }: {
  vehicles: Vehicle[]; value: string | null; onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [make, setMake] = useState<string>("all");
  const [body, setBody] = useState<string>("all");
  const [fuel, setFuel] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");

  const selected = value ? vehicles.find(v => v.id === value) : null;

  const uniq = (arr: (string | null | undefined)[]) =>
    Array.from(new Set(arr.filter((x): x is string => !!x))).sort();
  const makes = useMemo(() => uniq(vehicles.map(v => v.make)), [vehicles]);
  const bodies = useMemo(() => uniq(vehicles.map(v => v.body_type)), [vehicles]);
  const fuels = useMemo(() => uniq(vehicles.map(v => v.fuel_type)), [vehicles]);
  const statuses = useMemo(() => uniq(vehicles.map(v => v.status)), [vehicles]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return vehicles.filter(v => {
      if (make !== "all" && v.make !== make) return false;
      if (body !== "all" && v.body_type !== body) return false;
      if (fuel !== "all" && v.fuel_type !== fuel) return false;
      if (status !== "all" && v.status !== status) return false;
      if (!needle) return true;
      const hay = `${v.year} ${v.make} ${v.model} ${v.trim ?? ""} ${v.color ?? ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [vehicles, q, make, body, fuel, status]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full h-8 bg-white border border-border rounded-md px-3 text-sm flex items-center justify-between text-left"
      >
        <span className={selected ? "" : "text-muted-foreground"}>
          {selected ? `${selected.year} ${selected.make} ${selected.model}${selected.trim ? " " + selected.trim : ""}` : "Assign vehicle"}
        </span>
        <ChevronDown className="w-4 h-4 text-muted-foreground" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 mt-1 w-full min-w-[320px] bg-white border border-border rounded-md shadow-lg p-2">
            <div className="relative mb-2">
              <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search year, make, model…"
                className="w-full h-8 pl-8 pr-2 text-sm border border-border rounded-md bg-white"
              />
            </div>
            <div className="grid grid-cols-2 gap-1.5 mb-2">
              <FilterSelect label="Make" value={make} onChange={setMake} options={makes} />
              <FilterSelect label="Body" value={body} onChange={setBody} options={bodies} />
              <FilterSelect label="Fuel" value={fuel} onChange={setFuel} options={fuels} />
              <FilterSelect label="Status" value={status} onChange={setStatus} options={statuses} />
            </div>
            <div className="max-h-64 overflow-y-auto -mx-1">
              <button
                type="button"
                onClick={() => { onChange(null); setOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-soft rounded flex items-center gap-2 text-muted-foreground"
              >
                {!value && <Check className="w-3.5 h-3.5" />} — None —
              </button>
              {filtered.map(v => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => { onChange(v.id); setOpen(false); }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-soft rounded flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    {value === v.id && <Check className="w-3.5 h-3.5 shrink-0" />}
                    <span className="truncate">
                      {v.year} {v.make} {v.model}{v.trim ? ` ${v.trim}` : ""}
                    </span>
                  </span>
                  <span className="text-[10px] text-muted-foreground shrink-0 capitalize">
                    {[v.body_type, v.fuel_type, v.status].filter(Boolean).join(" · ")}
                  </span>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">No matches</div>
              )}
            </div>
            <div className="mt-1 px-2 pt-1 text-[10px] text-muted-foreground border-t border-border">
              {filtered.length} of {vehicles.length}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 text-xs bg-white border border-border rounded px-1.5 capitalize"
    >
      <option value="all">{label}: all</option>
      {options.map(o => <option key={o} value={o} className="capitalize">{o}</option>)}
    </select>
  );
}