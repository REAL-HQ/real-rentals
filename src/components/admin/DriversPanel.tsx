import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Application, DriverScreening as DriverScreeningRow, LeadDocument, Vehicle } from "./types";
import { REQUIRED_DOC_TYPES, type RequiredDocType } from "./types";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { mergeDuplicateApplications } from "@/lib/applications.functions";
import { scoreApplication } from "@/lib/scoring.functions";
import {
  DocumentsCard,
  InsuranceVerificationCard,
  InterviewTab,
  ScreeningBadge,
  ScreeningPipeline,
  useDriverScreening,
} from "./DriverScreening";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  MoreVertical, Search, Check, ChevronDown, ArrowLeft,
  Mail, Phone, MapPin, Car, CreditCard, ShieldCheck, Activity,
  User as UserIcon, FileText, Star, Trash2, Copy, GitMerge,
  MessageSquare, PhoneOutgoing, BadgeDollarSign, Globe, Flame, Thermometer, Snowflake, Sparkles, AlertTriangle,
  Wallet,
} from "lucide-react";
import { removeCardOnFile } from "@/lib/payments.functions";
import { chargeCardOnRental, startRentalAutopay, stopRentalAutopay, type ChargeReason } from "@/lib/rental-payments.functions";
import { requestApplicationDocuments } from "@/lib/admin-communications.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { SourceBadge } from "./SourceBadge";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";

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

function TierBadge({ tier, score, size = "sm" }: { tier?: string | null; score?: number | null; size?: "sm" | "md" }) {
  if (!tier) return null;
  const t = String(tier).toLowerCase();
  const cls =
    t === "hot" ? "bg-red-100 text-red-800 border-red-200"
    : t === "warm" ? "bg-amber-100 text-amber-800 border-amber-200"
    : "bg-gray-100 text-gray-700 border-gray-200";
  const Icon = t === "hot" ? Flame : t === "warm" ? Thermometer : Snowflake;
  const pad = size === "md" ? "text-xs px-2 py-0.5" : "text-[10px] px-1.5 py-0.5";
  return (
    <span className={`inline-flex items-center gap-1 font-medium border rounded ${pad} ${cls}`} title={`AI tier: ${t}${score != null ? ` (${score})` : ""}`}>
      <Icon className={size === "md" ? "w-3.5 h-3.5" : "w-3 h-3"} />
      <span className="capitalize">{t}</span>
      {score != null && <span className="opacity-70">{score}</span>}
    </span>
  );
}

function AIScoreDot({ tier, score }: { tier?: string | null; score?: number | null }) {
  const t = tier ? String(tier).toLowerCase() : null;
  const label = t
    ? `AI: ${t}${score != null ? ` (${score})` : ""}`
    : "AI: not scored yet";
  const cls =
    t === "hot" ? "bg-red-500 text-white"
    : t === "warm" ? "bg-amber-400 text-white"
    : t === "cold" ? "bg-slate-400 text-white"
    : "bg-neutral-200 text-neutral-500 border border-dashed border-neutral-300";
  return (
    <TooltipProvider delayDuration={100}>
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full ${cls}`}>
          {t === "hot" ? <Flame className="w-2.5 h-2.5" /> : <Sparkles className="w-2.5 h-2.5" />}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
    </TooltipProvider>
  );
}

function formatPhone(p?: string | null): string {
  if (!p) return "—";
  const d = p.replace(/\D/g, "");
  const n = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (n.length === 10) return `${n.slice(0,3)}-${n.slice(3,6)}-${n.slice(6)}`;
  return p;
}

function smsHref(p?: string | null): string {
  if (!p) return "";
  const d = p.replace(/[^\d+]/g, "");
  return `sms:${d}`;
}

function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 24) return `${h}h ${m}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function DriversPanel() {
  const [drivers, setDrivers] = useState<Application[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [open, setOpen] = useState<Application | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [screenings, setScreenings] = useState<Record<string, DriverScreeningRow>>({});
  const [docCounts, setDocCounts] = useState<Record<string, number>>({});
  const runMerge = useServerFn(mergeDuplicateApplications);
  const now = useNow();

  useEffect(() => {
    supabase.from("applications").select("*").order("created_at", { ascending: false })
      .then(({ data }) => setDrivers(data || []));
    supabase.from("vehicles").select("*").then(({ data }) => setVehicles((data as any) || []));
    supabase.from("driver_screenings").select("*").then(({ data }) => {
      const map: Record<string, DriverScreeningRow> = {};
      (data || []).forEach((s) => { map[s.lead_id] = s as DriverScreeningRow; });
      setScreenings(map);
    });
    supabase.from("lead_documents").select("lead_id,doc_type").then(({ data }) => {
      const counts: Record<string, number> = {};
      const seen: Record<string, Set<string>> = {};
      (data || []).forEach((d: any) => {
        if (!REQUIRED_DOC_TYPES.includes(d.doc_type as RequiredDocType)) return;
        const set = seen[d.lead_id] ?? (seen[d.lead_id] = new Set());
        set.add(d.doc_type);
        counts[d.lead_id] = set.size;
      });
      setDocCounts(counts);
    });
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
    // Sort by received time, newest first. Filters narrow the set but keep
    // the same chronological order.
    return Array.from(byKey.values()).sort((a, b) => {
      return (b.primary.created_at ?? "").localeCompare(a.primary.created_at ?? "");
    });
  }, [drivers, filter]);

  async function update(id: string, patch: Partial<Application>) {
    // Stamp contacted_at the first time the admin advances status past "new"
    // or edits the record while it is still "new" without an existing stamp.
    const target = drivers.find((x) => x.id === id);
    const patchWithStamp: Partial<Application> = { ...patch };
    if (
      target &&
      !target.contacted_at &&
      patch.status &&
      patch.status !== "new"
    ) {
      patchWithStamp.contacted_at = new Date().toISOString();
    }
    const { error } = await supabase.from("applications").update(patchWithStamp).eq("id", id);
    if (error) return toast.error(error.message);
    setDrivers((a) => a.map((x) => (x.id === id ? { ...x, ...patchWithStamp } : x)));
    if (open?.id === id) setOpen({ ...open, ...patchWithStamp } as Application);
  }

  async function markContacted(id: string) {
    const target = drivers.find((x) => x.id === id);
    if (target?.contacted_at) return;
    await update(id, { contacted_at: new Date().toISOString() });
    toast.success("Marked contacted");
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
        onScreeningChange={(s) => setScreenings((prev) => ({ ...prev, [open.id]: s }))}
        onDocsChange={(docs) => {
          const count = new Set(
            docs.filter((d) => REQUIRED_DOC_TYPES.includes(d.doc_type as RequiredDocType)).map((d) => d.doc_type),
          ).size;
          setDocCounts((prev) => ({ ...prev, [open.id]: count }));
        }}
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
        <div className="ml-auto">
          <button
            onClick={handleMerge}
            disabled={merging}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white border border-border hover:bg-soft disabled:opacity-50"
          >
            <GitMerge className="w-3.5 h-3.5" /> {merging ? "Merging…" : "Merge duplicates"}
          </button>
        </div>
      </div>
      <div className="rounded-lg border border-border overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-soft text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">Name</th>
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">Phone</th>
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">Email</th>
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">Screening</th>
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">Payment</th>
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">Deposit</th>
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">Status</th>
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">Created</th>
                <th className="px-2 py-2.5 border-b border-border w-10"></th>
              </tr>
            </thead>
            <tbody>
              {grouped.flatMap(({ primary: a, history }) => {
                const veh = a.vehicle_id ? vehicleMap[a.vehicle_id] : null;
                const dupeCount = history.length + (a.resubmission_count ?? 0);
                const isExpanded = expanded.has(a.id);
                const createdMs = a.created_at ? new Date(a.created_at).getTime() : null;
                const contactedMs = a.contacted_at ? new Date(a.contacted_at).getTime() : null;
                const isWaiting = !contactedMs && (a.status ?? "new") === "new";
                const waitingMs = createdMs ? now - createdMs : 0;
                const respondedMs =
                  createdMs && contactedMs ? contactedMs - createdMs : null;
                const waitColor =
                  waitingMs < 15 * 60_000
                    ? "bg-emerald-100 text-emerald-800"
                    : waitingMs < 60 * 60_000
                    ? "bg-amber-100 text-amber-800"
                    : "bg-red-100 text-red-800";
                const rows = [
                  <tr key={a.id} onClick={() => setOpen(a)}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-soft/60 transition-colors">
                    <td className="px-4 py-2.5 font-medium whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <AIScoreDot tier={a.ai_tier} score={a.ai_score} />
                        <span>{a.full_name}</span>
                      </span>
                      <SourceBadge
                        source={a.gclid ? "google" : "organic"}
                        campaign={a.utm_campaign}
                        className="ml-2 align-middle"
                      />
                      {dupeCount > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); if (history.length) toggleExpand(a.id); }}
                          className="ml-2 inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 hover:bg-amber-200"
                          title="Duplicate submissions from same phone/email"
                        >
                          <Copy className="w-3 h-3" />×{dupeCount + 1}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {a.phone ? (
                        <a href={`tel:${a.phone}`} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline">
                          <Phone className="w-3 h-3" /> {formatPhone(a.phone)}
                        </a>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {a.email ? (
                        <a href={`mailto:${a.email}`} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline">
                          <Mail className="w-3 h-3" /> {a.email}
                        </a>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <ScreeningBadge screening={screenings[a.id] ?? null} docCount={docCounts[a.id] ?? 0} />
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap capitalize text-muted-foreground">{a.payment_status?.replace(/_/g," ")}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">${Number(a.deposit_paid ?? 0).toLocaleString()}</td>
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
                          {a.phone && (
                            <DropdownMenuItem onClick={() => window.location.href = `tel:${a.phone}`}>
                              <Phone className="w-4 h-4 mr-2" /> Call
                            </DropdownMenuItem>
                          )}
                          {a.phone && (
                            <DropdownMenuItem onClick={() => window.location.href = smsHref(a.phone)}>
                              <MessageSquare className="w-4 h-4 mr-2" /> Text
                            </DropdownMenuItem>
                          )}
                          {!contactedMs && (
                            <DropdownMenuItem onClick={() => markContacted(a.id)}>
                              <PhoneOutgoing className="w-4 h-4 mr-2" /> Mark contacted
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem className="text-real-red focus:text-real-red" onClick={() => remove(a.id)}>Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>,
                ];
                if (isExpanded) {
                  for (const h of history) {
                    rows.push(
                      <tr key={h.id} onClick={() => setOpen(h)} className="cursor-pointer bg-soft/30 border-b border-border text-xs text-muted-foreground hover:bg-soft/60">
                        <td className="pl-10 pr-4 py-2 italic">↳ earlier submission</td>
                        <td className="px-4 py-2">{h.phone ? formatPhone(h.phone) : "—"}</td>
                        <td className="px-4 py-2">{h.email || "—"}</td>
                        <td className="px-4 py-2">—</td>
                        <td className="px-4 py-2">—</td>
                        <td className="px-4 py-2 capitalize">{h.payment_status?.replace(/_/g, " ")}</td>
                        <td className="px-4 py-2 capitalize">{h.deposit_status?.replace(/_/g, " ")}</td>
                        <td className="px-4 py-2 capitalize">{h.status}</td>
                        <td className="px-4 py-2">
                          <div>{new Date(h.created_at!).toLocaleDateString()}</div>
                          <div className="opacity-70">{new Date(h.created_at!).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>
                        </td>
                        <td />
                      </tr>,
                    );
                  }
                }
                return rows;
              })}
              {grouped.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-sm text-muted-foreground">No drivers.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

function DriverDetail({ driver, vehicles, onBack, onUpdate, onDelete, onScreeningChange, onDocsChange }: {
  driver: Application; vehicles: Vehicle[]; onBack: () => void;
  onUpdate: (patch: Partial<Application>) => void; onDelete: () => void;
  onScreeningChange?: (s: DriverScreeningRow) => void;
  onDocsChange?: (docs: LeadDocument[]) => void;
}) {
  const veh = driver.vehicle_id ? vehicles.find(v => v.id === driver.vehicle_id) : null;
  const initials = (driver.full_name || "?")
    .split(/\s+/).map(s => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  const trips = Number(driver.trips_completed);
  const tripsOk = !Number.isNaN(trips) && trips >= 200;
  const { screening, setScreening, docs, setDocs } = useDriverScreening(driver.id);

  async function advanceStatus(next: import("./types").ScreeningStatus) {
    try {
      const base = screening ?? { lead_id: driver.id, status: "new_lead" as import("./types").ScreeningStatus };
      const { data, error } = await supabase
        .from("driver_screenings")
        .upsert({ ...base, lead_id: driver.id, status: next } as any, { onConflict: "lead_id" })
        .select("*")
        .single();
      if (error) throw error;
      const row = data as DriverScreeningRow;
      setScreening(row);
      onScreeningChange?.(row);
      toast.success(`Status: ${next.replace(/_/g, " ")}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to advance status");
    }
  }

  return (
    <div className="-mx-8 -my-8 min-h-full bg-[#fafafa]">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-border">
        <div className="px-8 py-3 flex items-center justify-between">
          <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Back to drivers
          </button>
          <div className="flex items-center gap-2">
            {driver.phone && (
              <a href={`tel:${driver.phone}`} className="inline-flex items-center gap-1.5 rounded-md bg-real-red text-white px-3 py-1.5 text-xs font-medium hover:bg-red-700">
                <Phone className="w-3.5 h-3.5" /> Call {formatPhone(driver.phone)}
              </a>
            )}
            {driver.phone && (
              <a href={smsHref(driver.phone)} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-white px-3 py-1.5 text-xs font-medium hover:bg-soft">
                <MessageSquare className="w-3.5 h-3.5" /> Text
              </a>
            )}
            {driver.email && (
              <a href={`mailto:${driver.email}`} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-white px-3 py-1.5 text-xs font-medium hover:bg-soft">
                <Mail className="w-3.5 h-3.5" /> Email
              </a>
            )}
            <RequestDocumentsAction driver={driver} onUpdate={onUpdate} />
            <CardOnFileActions driver={driver} onUpdate={onUpdate} />
            <AutopayActions driver={driver} />
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

      <div className="px-8 py-6 grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* Left profile sidebar */}
        <aside className="space-y-4 lg:sticky lg:top-16 lg:self-start">
          <div className="rounded-xl border border-border bg-white p-5">
            <div className="flex items-start gap-3">
              <div className="h-14 w-14 shrink-0 rounded-full bg-black text-white grid place-items-center text-lg font-semibold">
                {initials}
              </div>
              <div className="min-w-0">
                <div className="text-base font-semibold truncate">{driver.full_name || "Unnamed"}</div>
                <div className={`inline-flex mt-1 text-[10px] px-1.5 py-0.5 rounded capitalize ${statusBadge[driver.status] || "bg-gray-100 text-gray-700"}`}>
                  {driver.status}
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {tripsOk && (
                <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 text-[10px]">
                  <ShieldCheck className="w-3 h-3 mr-1" /> 200+ trips
                </Badge>
              )}
              {driver.license_valid && (
                <Badge variant="secondary" className="bg-blue-100 text-blue-800 hover:bg-blue-100 text-[10px]">Licensed</Badge>
              )}
              {driver.gclid && (
                <Badge variant="secondary" className="bg-amber-50 text-amber-800 hover:bg-amber-50 text-[10px]">
                  <BadgeDollarSign className="w-3 h-3 mr-1" /> Google Ads
                </Badge>
              )}
              {(driver as any).recovery_sent_at && (
                <Badge variant="secondary" className="bg-purple-50 text-purple-800 hover:bg-purple-50 text-[10px]" title={`Recovery email sent ${new Date((driver as any).recovery_sent_at).toLocaleString()}`}>
                  <Mail className="w-3 h-3 mr-1" /> Recovery Sent
                </Badge>
              )}
              {(driver as any).doc_request_sent_at && (
                <Badge variant="secondary" className="bg-blue-50 text-blue-800 hover:bg-blue-50 text-[10px]" title={`Docs requested ${new Date((driver as any).doc_request_sent_at).toLocaleString()}`}>
                  <FileText className="w-3 h-3 mr-1" /> Docs Requested
                </Badge>
              )}
            </div>
            <div className="mt-4 space-y-1.5 text-xs">
              {driver.phone && (
                <a href={`tel:${driver.phone}`} className="flex items-center gap-2 text-foreground hover:text-real-red">
                  <Phone className="w-3.5 h-3.5 text-muted-foreground" /> {formatPhone(driver.phone)}
                </a>
              )}
              {driver.email && (
                <a href={`mailto:${driver.email}`} className="flex items-center gap-2 text-foreground hover:text-real-red break-all">
                  <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> {driver.email}
                </a>
              )}
              {(driver.city || driver.state) && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="w-3.5 h-3.5" /> {[driver.city, driver.state].filter(Boolean).join(", ")}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-white p-5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Snapshot</div>
            <dl className="space-y-3 text-sm">
              <SidebarStat icon={<Car className="w-3.5 h-3.5" />} label="Vehicle" value={veh ? `${veh.year} ${veh.make} ${veh.model}` : "Unassigned"} muted={!veh} />
              <SidebarStat icon={<CreditCard className="w-3.5 h-3.5" />} label="Weekly rent" value={driver.weekly_rent ? `$${Number(driver.weekly_rent).toLocaleString()}` : "—"} />
              <SidebarStat icon={<Activity className="w-3.5 h-3.5" />} label="Trips" value={Number.isNaN(trips) || !driver.trips_completed ? "—" : trips.toLocaleString()} tone={tripsOk ? "good" : (driver.trips_completed ? "warn" : undefined)} />
              <SidebarStat icon={<Star className="w-3.5 h-3.5" />} label="Rating" value={driver.rating ? `${driver.rating}/5` : "—"} />
            </dl>
          </div>

          {(driver.utm_source || driver.utm_campaign || driver.gclid) && (
            <div className="rounded-xl border border-border bg-white p-5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Attribution</div>
              <div className="space-y-2 text-xs">
                <div><span className="text-muted-foreground">Source: </span>{driver.gclid ? "Google Ads" : (driver.utm_source || "Direct")}</div>
                {driver.utm_campaign && <div><span className="text-muted-foreground">Campaign: </span>{driver.utm_campaign}</div>}
                {driver.utm_medium && <div><span className="text-muted-foreground">Medium: </span>{driver.utm_medium}</div>}
                {driver.landing_page && <div className="truncate"><span className="text-muted-foreground">Landing: </span>{driver.landing_page}</div>}
              </div>
            </div>
          )}
          <CardOnFileCard driver={driver} onUpdate={onUpdate} />
        </aside>

        {/* Main column */}
        <div className="min-w-0 space-y-6">
          <ScreeningPipeline screening={screening} docs={docs} onAdvance={advanceStatus} />

          <AISnapshotCard driver={driver} onUpdate={onUpdate} />

          <Tabs defaultValue="interview" className="w-full">
          <TabsList className="bg-white border border-border">
            <TabsTrigger value="interview">Interview</TabsTrigger>
            <TabsTrigger value="screening-docs">Documents</TabsTrigger>
            <TabsTrigger value="insurance">Insurance</TabsTrigger>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="lifecycle">Lifecycle</TabsTrigger>
            <TabsTrigger value="financials">Financials</TabsTrigger>
            <TabsTrigger value="vehicle">Vehicle</TabsTrigger>
            <TabsTrigger value="documents">Legacy Docs</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
          </TabsList>

          <TabsContent value="interview" className="mt-4">
            <InterviewTab
              driver={driver}
              screening={screening}
              onSaved={(next) => {
                setScreening(next);
                onScreeningChange?.(next);
              }}
            />
          </TabsContent>

          <TabsContent value="screening-docs" className="mt-4">
            <DocumentsCard
              leadId={driver.id}
              docs={docs}
              onChange={(next) => {
                setDocs(next);
                onDocsChange?.(next);
              }}
            />
          </TabsContent>

          <TabsContent value="insurance" className="mt-4">
            <InsuranceVerificationCard
              leadId={driver.id}
              screening={screening}
              docs={docs}
              onScreening={(s) => {
                setScreening(s);
                onScreeningChange?.(s);
              }}
              onDocs={(d) => {
                setDocs(d);
                onDocsChange?.(d);
              }}
            />
          </TabsContent>

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
            <Card title="Attribution" icon={driver.gclid ? <BadgeDollarSign className="w-4 h-4" /> : <Globe className="w-4 h-4" />}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <Field label="Source" value={driver.gclid ? "Google Ads" : "Organic / Direct"} />
                <Field label="gclid" value={driver.gclid} />
                <Field label="utm_source" value={driver.utm_source} />
                <Field label="utm_medium" value={driver.utm_medium} />
                <Field label="utm_campaign" value={driver.utm_campaign} />
                <Field label="utm_term" value={driver.utm_term} />
                <Field label="utm_content" value={driver.utm_content} />
                <Field label="Landing page" value={driver.landing_page} />
                <Field label="Referrer" value={driver.referrer} />
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

function AIScoreCard({ driver, onUpdate }: { driver: Application; onUpdate: (p: Partial<Application>) => void }) {
  const [busy, setBusy] = useState(false);
  const rescore = useServerFn(scoreApplication);
  const flags = Array.isArray(driver.ai_flags) ? (driver.ai_flags as string[]) : [];
  const scoredAt = driver.scored_at ? new Date(driver.scored_at) : null;
  async function run() {
    setBusy(true);
    try {
      const res = await rescore({ data: { id: driver.id } });
      if (res && (res as any).ok !== false) {
        const r = res as any;
        onUpdate({
          ai_score: r.score,
          ai_tier: r.tier,
          ai_flags: r.flags,
          ai_summary: r.summary,
          scored_at: new Date().toISOString(),
        } as any);
        toast.success(`AI scored: ${r.tier} (${r.score})`);
      } else {
        toast.error(`Scoring failed: ${(res as any)?.error ?? "unknown"}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scoring failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rounded-xl border border-border bg-white shadow-[0_1px_0_rgba(0,0,0,0.02)]">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <span className="text-muted-foreground"><Sparkles className="w-4 h-4" /></span>
        <div className="text-sm font-semibold">AI Prospect Score</div>
        {driver.ai_tier && (
          <span className="ml-1"><TierBadge tier={driver.ai_tier} score={driver.ai_score ?? null} size="md" /></span>
        )}
        <button
          onClick={run}
          disabled={busy}
          className="ml-auto inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-border bg-white hover:bg-soft disabled:opacity-60"
        >
          <Sparkles className="w-3.5 h-3.5" /> {busy ? "Scoring…" : driver.ai_tier ? "Re-score" : "Score now"}
        </button>
      </div>
      <div className="p-4 space-y-3">
        {driver.ai_summary ? (
          <p className="text-sm text-foreground leading-relaxed">{driver.ai_summary}</p>
        ) : (
          <p className="text-sm text-muted-foreground">Not yet scored. Click "Score now" to run the AI review of trips, rating, license, and screenshots.</p>
        )}
        {flags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {flags.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-red-50 text-red-800 border border-red-200">
                <AlertTriangle className="w-3 h-3" /> {f}
              </span>
            ))}
          </div>
        )}
        {scoredAt && (
          <p className="text-[11px] text-muted-foreground">Scored {scoredAt.toLocaleString()}</p>
        )}
      </div>
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

function SidebarStat({ icon, label, value, tone, muted }: {
  icon: React.ReactNode; label: string; value: React.ReactNode;
  tone?: "good" | "warn"; muted?: boolean;
}) {
  const toneCls = tone === "good" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : "";
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="inline-flex items-center gap-2 text-xs text-muted-foreground">
        <span className="text-muted-foreground">{icon}</span>{label}
      </dt>
      <dd className={`text-xs font-medium text-right truncate ${muted ? "text-muted-foreground" : toneCls || "text-foreground"}`}>{value}</dd>
    </div>
  );
}

function AISnapshotCard({ driver, onUpdate }: { driver: Application; onUpdate: (p: Partial<Application>) => void }) {
  const [busy, setBusy] = useState(false);
  const rescore = useServerFn(scoreApplication);
  const flags = Array.isArray(driver.ai_flags) ? (driver.ai_flags as string[]) : [];
  const scoredAt = driver.scored_at ? new Date(driver.scored_at) : null;
  const score = typeof driver.ai_score === "number" ? driver.ai_score : null;
  const tier = driver.ai_tier as string | null | undefined;
  const tierGrad =
    tier === "hot" ? "from-red-500 to-orange-500"
    : tier === "warm" ? "from-amber-400 to-yellow-500"
    : tier === "cold" ? "from-slate-400 to-slate-500"
    : "from-slate-200 to-slate-300";
  async function run() {
    setBusy(true);
    try {
      const res = await rescore({ data: { id: driver.id } });
      if (res && (res as any).ok !== false) {
        const r = res as any;
        onUpdate({
          ai_score: r.score, ai_tier: r.tier, ai_flags: r.flags,
          ai_summary: r.summary, scored_at: new Date().toISOString(),
        } as any);
        toast.success(`AI scored: ${r.tier} (${r.score})`);
      } else {
        toast.error(`Scoring failed: ${(res as any)?.error ?? "unknown"}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scoring failed");
    } finally { setBusy(false); }
  }
  return (
    <div className="rounded-xl border border-border bg-white overflow-hidden shadow-[0_1px_0_rgba(0,0,0,0.02)]">
      <div className={`h-1 w-full bg-gradient-to-r ${tierGrad}`} />
      <div className="p-5">
        <div className="flex items-start gap-5">
          <div className="shrink-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">AI score</div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-4xl font-bold tabular-nums">{score ?? "—"}</span>
              <span className="text-xs text-muted-foreground">/100</span>
            </div>
            {tier && <div className="mt-1"><TierBadge tier={tier} score={null} size="md" /></div>}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Sparkles className="w-3.5 h-3.5 text-real-red" /> AI Prospect Snapshot
              </div>
              <button
                onClick={run}
                disabled={busy}
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-border bg-white hover:bg-soft disabled:opacity-60"
              >
                <Sparkles className="w-3.5 h-3.5" /> {busy ? "Scoring…" : tier ? "Re-score" : "Score now"}
              </button>
            </div>
            {driver.ai_summary ? (
              <p className="text-sm text-foreground leading-relaxed">{driver.ai_summary}</p>
            ) : (
              <p className="text-sm text-muted-foreground">Not yet scored. Run the AI review to grade trips, rating, license, and screenshots.</p>
            )}
            {flags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {flags.map((f, i) => (
                  <span key={i} className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-red-50 text-red-800 border border-red-200">
                    <AlertTriangle className="w-3 h-3" /> {f}
                  </span>
                ))}
              </div>
            )}
            {scoredAt && (
              <p className="mt-2 text-[11px] text-muted-foreground">Scored {scoredAt.toLocaleString()}</p>
            )}
          </div>
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

function cardLinkFor(applicationId: string) {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/card/${applicationId}`;
}

function CardOnFileActions({ driver, onUpdate }: { driver: any; onUpdate: (p: any) => void }) {
  const link = cardLinkFor(driver.id);
  const hasCard = !!driver.card_last4;
  const [chargeOpen, setChargeOpen] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Card-on-file link copied");
    } catch {
      toast.error("Failed to copy link");
    }
  }

  async function remove() {
    if (!confirm("Remove card on file?")) return;
    try {
      const res = await removeCardOnFile({
        data: { applicationId: driver.id, environment: getStripeEnvironment() },
      });
      if ("error" in res) throw new Error(res.error);
      onUpdate({
        stripe_payment_method_id: null,
        card_brand: null,
        card_last4: null,
        card_exp_month: null,
        card_exp_year: null,
        card_on_file_at: null,
      });
      toast.success("Card removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove card");
    }
  }

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex items-center gap-1.5 rounded-md border border-border bg-white px-3 py-1.5 text-xs font-medium hover:bg-soft">
        <CreditCard className="w-3.5 h-3.5" />
        {hasCard ? `Card ····${driver.card_last4}` : "Card On File"}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {hasCard && (
          <DropdownMenuItem onClick={() => setChargeOpen(true)}>
            <CreditCard className="w-4 h-4 mr-2" /> Charge Card…
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={copyLink}>
          <Copy className="w-4 h-4 mr-2" /> Copy card-on-file link
        </DropdownMenuItem>
        {driver.phone && (
          <DropdownMenuItem asChild>
            <a href={`sms:${driver.phone}?&body=${encodeURIComponent(`Save your card on file for Real Rentals: ${link}`)}`}>
              <MessageSquare className="w-4 h-4 mr-2" /> Text link to driver
            </a>
          </DropdownMenuItem>
        )}
        {driver.email && (
          <DropdownMenuItem asChild>
            <a href={`mailto:${driver.email}?subject=${encodeURIComponent("Save your card on file")}&body=${encodeURIComponent(`Save your card on file for Real Rentals: ${link}`)}`}>
              <Mail className="w-4 h-4 mr-2" /> Email link to driver
            </a>
          </DropdownMenuItem>
        )}
        {hasCard && (
          <DropdownMenuItem className="text-real-red focus:text-real-red" onClick={remove}>
            <Trash2 className="w-4 h-4 mr-2" /> Remove card
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
    {chargeOpen && <ChargeCardDialog driver={driver} onClose={() => setChargeOpen(false)} />}
    </>
  );
}

function ChargeCardDialog({ driver, onClose }: { driver: any; onClose: () => void }) {
  const [amount, setAmount] = useState<string>("");
  const [reason, setReason] = useState<ChargeReason>("rent");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [rentalId, setRentalId] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("rentals")
      .select("id")
      .eq("application_id", driver.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setRentalId((data?.id as string) ?? null));
  }, [driver.id]);

  async function submit() {
    const cents = Math.round(parseFloat(amount || "0") * 100);
    if (!rentalId) return toast.error("No active rental found for this driver");
    if (!Number.isFinite(cents) || cents < 50) return toast.error("Amount must be at least $0.50");
    setBusy(true);
    try {
      const res = await chargeCardOnRental({
        data: { rentalId, amountCents: cents, reason, note: note || undefined, environment: getStripeEnvironment() },
      });
      if ("error" in res) throw new Error(res.error);
      toast.success(`Charged $${(cents / 100).toFixed(2)} to card`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Charge failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-1">Charge Card On File</h2>
        <p className="text-xs text-muted-foreground mb-4">
          {driver.card_brand} ····{driver.card_last4} — {driver.full_name}
        </p>
        {!rentalId && <p className="text-xs text-real-red mb-3">No active rental linked to this driver.</p>}
        <div className="space-y-3 text-sm">
          <label className="block text-xs">
            Amount (USD)
            <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-soft rounded-md px-3 py-2 mt-1" placeholder="0.00" autoFocus />
          </label>
          <label className="block text-xs">
            Reason
            <Select value={reason} onValueChange={(v) => setReason(v as ChargeReason)}>
              <SelectTrigger className="bg-white text-foreground mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rent">Rent</SelectItem>
                <SelectItem value="late_fee">Late Fee</SelectItem>
                <SelectItem value="toll">Toll</SelectItem>
                <SelectItem value="damage">Damage</SelectItem>
                <SelectItem value="cleaning">Cleaning</SelectItem>
                <SelectItem value="fuel">Fuel</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="block text-xs">
            Note (optional)
            <input value={note} onChange={(e) => setNote(e.target.value)}
              className="w-full bg-soft rounded-md px-3 py-2 mt-1" placeholder="Toll from 3/12 SunPass" />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm">Cancel</button>
          <button onClick={submit} disabled={busy || !rentalId}
            className="rounded-lg bg-real-red text-white px-4 py-2 text-sm disabled:opacity-50">
            {busy ? "Charging…" : "Charge Card"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AutopayActions({ driver }: { driver: any }) {
  const [rental, setRental] = useState<{ id: string; autopay_active: boolean; weekly_rate: number | null } | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const { data } = await supabase
      .from("rentals")
      .select("id, autopay_active, weekly_rate")
      .eq("application_id", driver.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setRental((data as any) ?? null);
  }
  useEffect(() => { refresh(); }, [driver.id]);

  if (!rental) return null;
  const active = rental.autopay_active;

  async function toggle() {
    setBusy(true);
    try {
      const fn = active ? stopRentalAutopay : startRentalAutopay;
      const res = await fn({ data: { rentalId: rental!.id, environment: getStripeEnvironment() } });
      if ("error" in res) throw new Error(res.error);
      toast.success(active ? "Autopay stopped" : "Weekly autopay started");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Autopay update failed");
    } finally { setBusy(false); }
  }

  return (
    <button onClick={toggle} disabled={busy}
      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-soft disabled:opacity-50 ${
        active ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-border bg-white"
      }`}>
      <Wallet className="w-3.5 h-3.5" />
      {busy ? "Working…" : active ? "Autopay On" : "Start Autopay"}
    </button>
  );
}

function CardOnFileCard({ driver, onUpdate: _onUpdate }: { driver: any; onUpdate: (p: any) => void }) {
  const link = cardLinkFor(driver.id);
  const hasCard = !!driver.card_last4;
  return (
    <div className="rounded-xl border border-border bg-white p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Card On File</div>
        {hasCard ? (
          <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 text-[10px]">Saved</Badge>
        ) : (
          <Badge variant="secondary" className="bg-gray-100 text-gray-700 hover:bg-gray-100 text-[10px]">Not On File</Badge>
        )}
      </div>
      {hasCard ? (
        <div className="space-y-1.5 text-sm">
          <div className="capitalize font-medium">{driver.card_brand} ····{driver.card_last4}</div>
          {driver.card_exp_month && driver.card_exp_year && (
            <div className="text-xs text-muted-foreground">
              Expires {String(driver.card_exp_month).padStart(2, "0")}/{String(driver.card_exp_year).slice(-2)}
            </div>
          )}
          {driver.card_on_file_at && (
            <div className="text-xs text-muted-foreground">
              Saved {new Date(driver.card_on_file_at).toLocaleDateString()}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Send this driver a secure link to save a card. No charge is made.
          </p>
          <div className="flex gap-1.5">
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  toast.success("Link copied");
                } catch {
                  toast.error("Failed to copy");
                }
              }}
              className="flex-1 h-7 text-xs rounded-md border border-border bg-white hover:bg-soft"
            >
              Copy link
            </button>
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 h-7 text-xs rounded-md border border-border bg-white hover:bg-soft inline-flex items-center justify-center"
            >
              Preview
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
const DOC_ITEMS: { key: "license" | "gig_screenshot" | "insurance" | "other"; label: string }[] = [
  { key: "license", label: "License Photo" },
  { key: "gig_screenshot", label: "Driving Profile Screenshot (Uber, Lyft, DoorDash, etc.)" },
  { key: "insurance", label: "Insurance Information" },
  { key: "other", label: "Other (specify below)" },
];

function RequestDocumentsAction({
  driver,
  onUpdate,
}: {
  driver: Application;
  onUpdate: (patch: Partial<Application>) => void;
}) {
  const requestDocs = useServerFn(requestApplicationDocuments);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  const sentAt = driver.doc_request_sent_at ? new Date(driver.doc_request_sent_at) : null;
  const hoursSince = sentAt ? (Date.now() - sentAt.getTime()) / 3600000 : Infinity;
  const canResend = hoursSince >= 24;

  function toggle(k: string) {
    setItems((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  async function send() {
    if (items.size === 0) return toast.error("Select at least one item");
    if (!driver.email) return toast.error("No email on file for this applicant");
    setSending(true);
    try {
      const res: any = await requestDocs({
        data: {
          applicationId: driver.id,
          items: Array.from(items) as any,
          note: note.trim() || null,
        },
      });
      onUpdate({
        doc_request_sent_at: res.sent_at,
        requested_docs: res.items,
        doc_request_note: note.trim() || null,
      } as any);
      toast.success("Document request sent");
      setOpen(false);
      setItems(new Set());
      setNote("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  const requested = Array.isArray((driver as any).requested_docs)
    ? ((driver as any).requested_docs as string[])
    : [];

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={!driver.email || (sentAt !== null && !canResend)}
        title={
          !driver.email
            ? "No email on file"
            : sentAt && !canResend
              ? `Sent ${sentAt.toLocaleString()} — can resend after 24h`
              : "Request missing documents"
        }
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-white px-3 py-1.5 text-xs font-medium hover:bg-soft disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <FileText className="w-3.5 h-3.5" />
        {sentAt ? "Re-request Docs" : "Request Documents"}
      </button>

      {sentAt && (
        <span className="text-[10px] text-muted-foreground hidden md:inline">
          Sent {sentAt.toLocaleDateString()} ({requested.length} items)
        </span>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request Documents</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">
              Select what's needed. We'll email {driver.email} with a checklist and a link back to their application.
            </p>
            {DOC_ITEMS.map((it) => (
              <label key={it.key} className="flex items-start gap-2.5 rounded-md border border-border p-2.5 cursor-pointer hover:bg-soft">
                <Checkbox
                  checked={items.has(it.key)}
                  onCheckedChange={() => toggle(it.key)}
                  className="mt-0.5"
                />
                <span className="text-sm">{it.label}</span>
              </label>
            ))}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                Note (optional)
              </div>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Anything specific the applicant should know"
                rows={3}
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter>
            <button
              onClick={() => setOpen(false)}
              className="px-4 py-2 text-sm rounded-md border border-border hover:bg-soft"
            >
              Cancel
            </button>
            <button
              onClick={send}
              disabled={sending || items.size === 0}
              className="px-4 py-2 text-sm rounded-md bg-real-red text-white hover:opacity-90 disabled:opacity-50"
            >
              {sending ? "Sending…" : "Send Email"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
