import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Application, Vehicle } from "./types";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-router";
import { mergeDuplicateApplications } from "@/lib/applications.functions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  MoreVertical, Search, Check, ChevronDown, ArrowLeft,
  Mail, Phone, MapPin, Car, CreditCard, ShieldCheck, Activity,
  User as UserIcon, FileText, Star, Trash2, Copy, GitMerge,
} from "lucide-react";

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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const runMerge = useServerFn(mergeDuplicateApplications);

  useEffect(() => {
    supabase.from("applications").select("*").order("created_at", { ascending: false })
      .then(({ data }) => setDrivers(data || []));
    supabase.from("vehicles").select("*").then(({ data }) => setVehicles((data as any) || []));
  }, []);

  const vehicleMap = useMemo(() => Object.fromEntries(vehicles.map(v => [v.id, v])), [vehicles]);

  // Group by primary_application_id (falls back to id). Primary row = the one
  // whose id === groupKey; others render as collapsed history.
  const grouped = useMemo(() => {
    const filteredRows = filter === "all" ? drivers : drivers.filter((a) => a.status === filter);
    const byKey = new Map<string, { primary: Application; history: Application[] }>();
    for (const row of filteredRows) {
      const key = row.primary_application_id ?? row.id;
      const entry = byKey.get(key) ?? { primary: row, history: [] };
      if (row.id === key) entry.primary = row;
      else entry.history.push(row);
      byKey.set(key, entry);
    }
    // Sort history within each group newest-first
    for (const g of byKey.values()) {
      g.history.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    }
    return Array.from(byKey.values()).sort(
      (a, b) => (b.primary.created_at ?? "").localeCompare(a.primary.created_at ?? ""),
    );
  }, [drivers, filter]);

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

  async function handleMerge() {
    if (!confirm("Merge existing duplicate leads by phone/email? This links older rows to the newest and cannot be undone.")) return;
    setMerging(true);
    try {
      const res = await runMerge();
      toast.success(`Linked ${res.merged} duplicate rows.`);
      const { data } = await supabase.from("applications").select("*").order("created_at", { ascending: false });
      setDrivers(data || []);
    } catch (e: any) {
      toast.error(e?.message || "Merge failed");
    } finally {
      setMerging(false);
    }
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (open) {
    return (
      <DriverDetail
        driver={open}
        vehicles={vehicles}
        onBack={() => setOpen(null)}
        onUpdate={(p) => update(open.id, p)}
        onDelete={() => remove(open.id)}
      />
    );
  }

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
                      <div>{new Date(a.created_at!).toLocaleDateString()}</div>
                      <div className="text-[10px] opacity-70">{new Date(a.created_at!).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>
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

    </div>
  );
}

function DriverDetail({ driver, vehicles, onBack, onUpdate, onDelete }: {
  driver: Application; vehicles: Vehicle[]; onBack: () => void;
  onUpdate: (patch: Partial<Application>) => void; onDelete: () => void;
}) {
  const veh = driver.vehicle_id ? vehicles.find(v => v.id === driver.vehicle_id) : null;
  const initials = (driver.full_name || "?")
    .split(/\s+/).map(s => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  const trips = Number(driver.trips_completed);
  const tripsOk = !Number.isNaN(trips) && trips >= 200;

  return (
    <div className="-mx-8 -my-8 min-h-full bg-gradient-to-b from-soft/60 to-white">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b border-border">
        <div className="px-8 py-3 flex items-center justify-between">
          <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Back to drivers
          </button>
          <div className="flex items-center gap-2">
            {driver.email && (
              <a href={`mailto:${driver.email}`} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-white px-3 py-1.5 text-xs font-medium hover:bg-soft">
                <Mail className="w-3.5 h-3.5" /> Email
              </a>
            )}
            {driver.phone && (
              <a href={`tel:${driver.phone}`} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-white px-3 py-1.5 text-xs font-medium hover:bg-soft">
                <Phone className="w-3.5 h-3.5" /> Call
              </a>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-border bg-white hover:bg-soft">
                <MoreVertical className="w-4 h-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="text-real-red focus:text-real-red" onClick={onDelete}>
                  <Trash2 className="w-4 h-4 mr-2" /> Delete driver
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <div className="px-8 py-6 space-y-6">
        {/* Identity header */}
        <div className="flex items-start gap-4">
          <div className="h-16 w-16 shrink-0 rounded-full bg-black text-white grid place-items-center text-xl font-semibold">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-semibold truncate">{driver.full_name}</h2>
              <span className={`text-[11px] px-2 py-0.5 rounded-full capitalize ${statusBadge[driver.status] || "bg-gray-100 text-gray-700"}`}>
                {driver.status}
              </span>
              {tripsOk && (
                <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                  <ShieldCheck className="w-3 h-3 mr-1" /> Verified 200+ trips
                </Badge>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {driver.email && (
                <a href={`mailto:${driver.email}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
                  <Mail className="w-3.5 h-3.5" /> {driver.email}
                </a>
              )}
              {driver.phone && (
                <a href={`tel:${driver.phone}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
                  <Phone className="w-3.5 h-3.5" /> {formatPhone(driver.phone)}
                </a>
              )}
              {(driver.city || driver.state) && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" /> {[driver.city, driver.state].filter(Boolean).join(", ")}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            icon={<Car className="w-4 h-4" />}
            label="Vehicle"
            value={veh ? `${veh.year} ${veh.make} ${veh.model}` : "Unassigned"}
            muted={!veh}
          />
          <StatCard
            icon={<CreditCard className="w-4 h-4" />}
            label="Weekly rent"
            value={driver.weekly_rent ? `$${Number(driver.weekly_rent).toLocaleString()}` : "—"}
          />
          <StatCard
            icon={<Activity className="w-4 h-4" />}
            label="Trips completed"
            value={Number.isNaN(trips) || !driver.trips_completed ? "—" : trips.toLocaleString()}
            hint={!Number.isNaN(trips) && driver.trips_completed ? (tripsOk ? "Meets 200+" : "Below 200") : undefined}
            hintTone={tripsOk ? "good" : "warn"}
          />
          <StatCard
            icon={<Star className="w-4 h-4" />}
            label="Rating"
            value={driver.rating ? `${driver.rating}/5` : "—"}
          />
        </div>

        {/* Tabs */}
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="bg-white border border-border">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="lifecycle">Lifecycle</TabsTrigger>
            <TabsTrigger value="financials">Financials</TabsTrigger>
            <TabsTrigger value="vehicle">Vehicle</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4 space-y-4">
            <Card title="Driver info" icon={<UserIcon className="w-4 h-4" />}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
              </div>
            </Card>
            <Card title="Gig experience" icon={<Activity className="w-4 h-4" />}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field
                  label="Total trips / deliveries"
                  value={(() => {
                    const n = Number(driver.trips_completed);
                    if (!driver.trips_completed) return null;
                    if (Number.isNaN(n)) return driver.trips_completed;
                    return `${n.toLocaleString()}${n >= 200 ? " ✓" : " (below 200)"}`;
                  })()}
                />
                <Field label="Driver rating" value={driver.rating ? `${driver.rating} / 5` : null} />
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="lifecycle" className="mt-4">
            <Card title="Status & compliance" icon={<ShieldCheck className="w-4 h-4" />}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <SelField label="Driver status" value={driver.status} options={[...DRIVER_STATUSES]} onChange={(v) => onUpdate({ status: v })} />
                <SelField label="Deposit status" value={driver.deposit_status} options={[...DEPOSIT_STATUSES]} onChange={(v) => onUpdate({ deposit_status: v })} />
                <SelField label="Payment status" value={driver.payment_status} options={[...PAYMENT_STATUSES]} onChange={(v) => onUpdate({ payment_status: v })} />
                <SelField label="Background check" value={driver.background_check_status} options={[...CHECK_STATUSES]} onChange={(v) => onUpdate({ background_check_status: v })} />
                <SelField label="MVR status" value={driver.mvr_status} options={[...CHECK_STATUSES]} onChange={(v) => onUpdate({ mvr_status: v })} />
                <NumField label="Incident count" value={driver.incident_count} onSave={(v) => onUpdate({ incident_count: v ?? 0 })} />
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="financials" className="mt-4">
            <Card title="Payment terms" icon={<CreditCard className="w-4 h-4" />}>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <NumField label="Deposit amount ($)" value={driver.deposit_amount as any} onSave={(v) => onUpdate({ deposit_amount: v as any })} />
                <NumField label="Deposit paid ($)" value={driver.deposit_paid as any} onSave={(v) => onUpdate({ deposit_paid: v as any })} />
                <NumField label="Weekly rent ($)" value={driver.weekly_rent as any} onSave={(v) => onUpdate({ weekly_rent: v as any })} />
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="vehicle" className="mt-4">
            <Card title="Assigned vehicle" icon={<Car className="w-4 h-4" />}>
              <div className="rounded-lg border border-border bg-soft/50 p-4 mb-3">
                {veh ? (
                  <div>
                    <div className="text-lg font-semibold">{veh.year} {veh.make} {veh.model}{veh.trim ? ` ${veh.trim}` : ""}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {[veh.body_type, veh.fuel_type, veh.status].filter(Boolean).join(" · ")} · ID {veh.id.slice(0, 8)}
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">No vehicle assigned</div>
                )}
              </div>
              <VehiclePicker
                vehicles={vehicles}
                value={driver.vehicle_id}
                onChange={(id) => onUpdate({ vehicle_id: id })}
              />
            </Card>
          </TabsContent>

          <TabsContent value="documents" className="mt-4 space-y-4">
            {((driver as any).trip_screenshots?.length || driver.profile_screenshot_url) ? (
              <Card title="Trip / delivery screenshots" icon={<FileText className="w-4 h-4" />}>
                <TripScreenshots
                  paths={Array.from(new Set([
                    ...(((driver as any).trip_screenshots as string[] | null) ?? []),
                    ...(driver.profile_screenshot_url ? [driver.profile_screenshot_url] : []),
                  ].filter(Boolean)))}
                />
              </Card>
            ) : (
              <Card title="Trip / delivery screenshots" icon={<FileText className="w-4 h-4" />}>
                <div className="text-sm text-muted-foreground">No screenshots uploaded.</div>
              </Card>
            )}
            {driver.license_photo_url ? (
              <Card title="License photo" icon={<FileText className="w-4 h-4" />}>
                <LicensePhoto path={driver.license_photo_url} />
              </Card>
            ) : (
              <Card title="License photo" icon={<FileText className="w-4 h-4" />}>
                <div className="text-sm text-muted-foreground">No license photo uploaded.</div>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="notes" className="mt-4">
            <Card title="Internal notes" icon={<FileText className="w-4 h-4" />}>
              <textarea
                defaultValue={driver.notes || ""} rows={6} placeholder="Add internal notes about this driver…"
                onBlur={(e) => onUpdate({ notes: e.target.value })}
                className="w-full border border-border rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black/5"
              />
              <p className="text-[11px] text-muted-foreground mt-2">Saved automatically when you click away.</p>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function Card({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-white shadow-[0_1px_0_rgba(0,0,0,0.02)]">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        <div className="text-sm font-semibold">{title}</div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function StatCard({ icon, label, value, hint, hintTone, muted }: {
  icon: React.ReactNode; label: string; value: React.ReactNode;
  hint?: string; hintTone?: "good" | "warn"; muted?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-white p-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
        {icon}<span>{label}</span>
      </div>
      <div className={`mt-2 text-lg font-semibold truncate ${muted ? "text-muted-foreground" : ""}`}>{value}</div>
      {hint && (
        <div className={`mt-1 text-[11px] ${hintTone === "good" ? "text-emerald-700" : "text-amber-700"}`}>{hint}</div>
      )}
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

function TripScreenshots({ paths }: { paths: string[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    (async () => {
      const map: Record<string, string> = {};
      for (const p of paths) {
        const { data } = await supabase.storage.from("profile-screenshots").createSignedUrl(p, 3600);
        if (data?.signedUrl) map[p] = data.signedUrl;
      }
      if (active) setUrls(map);
    })();
    return () => { active = false; };
  }, [paths.join("|")]);
  if (!paths.length) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {paths.map((p) => {
        const url = urls[p];
        const isPdf = p.toLowerCase().endsWith(".pdf");
        return (
          <a key={p} href={url ?? "#"} target="_blank" rel="noreferrer"
             className="block rounded-md border border-border overflow-hidden bg-soft hover:border-foreground/40">
            {url && !isPdf ? (
              <img src={url} alt="Trip screenshot" className="w-full h-32 object-cover" />
            ) : (
              <div className="w-full h-32 flex items-center justify-center text-xs text-muted-foreground">
                {url ? "Open PDF" : "Loading…"}
              </div>
            )}
          </a>
        );
      })}
    </div>
  );
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