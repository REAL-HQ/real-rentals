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
import { Timeline, buildDriverTimeline, StatusPill, LifecycleRail, ReadinessSummary, SectionCard, MicroLabel, type LifecycleStage, type Readiness } from "./ui";
import { InterviewDrawer } from "./InterviewDrawer";
import { ClipboardList } from "lucide-react";
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

export function DriversPanel({ externalSearch = "" }: { externalSearch?: string } = {}) {
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
    const q = externalSearch.trim().toLowerCase();
    const filteredRows = (filter === "all" ? drivers : drivers.filter((a) => a.status === filter))
      .filter((a) => {
        if (!q) return true;
        const hay = `${a.full_name ?? ""} ${a.email ?? ""} ${a.phone ?? ""} ${a.city ?? ""} ${a.state ?? ""}`.toLowerCase();
        return hay.includes(q);
      });
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
  }, [drivers, filter, externalSearch]);

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
            {s} ({s === "all" ? drivers.length : drivers.filter((a) => a.status === s).length})
          </button>
        ))}
        <div className="ml-auto">
          <button
            onClick={handleMerge}
            disabled={merging}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white border border-border hover:bg-soft disabled:opacity-50"
          >
            <GitMerge className="w-3.5 h-3.5" /> {merging ? "Merging…" : "Merge Duplicates"}
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
                        <td className="px-4 py-2 capitalize">{h.payment_status?.replace(/_/g, " ")}</td>
                        <td className="px-4 py-2">${Number(h.deposit_paid ?? 0).toLocaleString()}</td>
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
                <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-muted-foreground">No drivers.</td></tr>
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

  const [interviewOpen, setInterviewOpen] = useState(false);

  // ---- Derive lifecycle stages from driver + screening ------------------
  const scrStatus = String((screening as any)?.status ?? "").toLowerCase();
  const dStatus = String(driver.status ?? "").toLowerCase();
  const contacted = !!driver.contacted_at || scrStatus !== "new_lead";
  const screeningDone = !!screening?.interview_completed_at;
  const docsComplete = docs.filter((d) => REQUIRED_DOC_TYPES.includes(d.doc_type as RequiredDocType)).length >= 4;
  const insuranceOk = !!(screening as any)?.insurance_verified;
  const approved = dStatus === "approved" || dStatus === "active";
  const pickedUp = !!(driver as any).pickup_at || dStatus === "active";
  const active = dStatus === "active";

  const stageFlags: { key: string; label: string; done: boolean }[] = [
    { key: "applied",   label: "Applied",    done: true },
    { key: "contacted", label: "Contacted",  done: contacted },
    { key: "screening", label: "Screening",  done: screeningDone },
    { key: "docs",      label: "Documents",  done: docsComplete },
    { key: "insurance", label: "Insurance",  done: insuranceOk },
    { key: "approved",  label: "Approved",   done: approved },
    { key: "pickup",    label: "Pickup",     done: pickedUp },
    { key: "active",    label: "Active",     done: active },
  ];
  let markedCurrent = false;
  const lifecycle: LifecycleStage[] = stageFlags.map((s) => {
    if (s.done) return { key: s.key, label: s.label, state: "done" };
    if (!markedCurrent) { markedCurrent = true; return { key: s.key, label: s.label, state: "current" }; }
    return { key: s.key, label: s.label, state: "upcoming" };
  });
  const currentStage = lifecycle.find((s) => s.state === "current") ?? lifecycle[lifecycle.length - 1];
  const doneCount = lifecycle.filter((s) => s.state === "done").length;
  const percentComplete = Math.round((doneCount / lifecycle.length) * 100);

  // Time in current stage — best-effort from most relevant timestamp
  const stageStartIso =
    currentStage.key === "contacted" ? (driver.created_at as any)
    : currentStage.key === "screening" ? (driver.contacted_at as any) ?? (driver.created_at as any)
    : currentStage.key === "docs" ? (screening as any)?.interview_completed_at ?? (driver.created_at as any)
    : (driver.created_at as any);
  const timeInStage = stageStartIso ? formatDuration(Date.now() - new Date(stageStartIso).getTime()) : undefined;

  // ---- Derive readiness ------------------------------------------------
  const blockers: string[] = [];
  const positives: string[] = [];
  const missing: string[] = [];
  if (driver.rating != null) positives.push(`Rating ${driver.rating}/5`);
  else missing.push("Driver rating");
  if (tripsOk) positives.push(`${trips.toLocaleString()} trips completed`);
  else if (!driver.trips_completed) missing.push("Trip history");
  else blockers.push(`Only ${trips} trips (need 200+)`);
  if (driver.license_valid || driver.license_photo_url) positives.push("License on file");
  else missing.push("License image");
  if (insuranceOk) positives.push("Insurance verified");
  else if ((screening as any)?.has_personal_insurance === false) blockers.push("No personal insurance policy");
  else missing.push("Insurance verification");
  if ((screening as any)?.card_in_own_name === false) blockers.push("Payment card not in driver's name");
  if ((screening as any)?.has_dui === true) blockers.push("DUI on record");
  if (driver.card_last4) positives.push(`Card on file ····${driver.card_last4}`);
  if ((screening as any)?.drive_type === "full_time") positives.push("Full-time driver");
  if ((screening as any)?.needed_by_date) {
    const days = Math.ceil((new Date((screening as any).needed_by_date).getTime() - Date.now()) / 864e5);
    if (days > 0 && days <= 7) positives.push(`Needs vehicle within ${days} days`);
  }

  const readinessStatus: Readiness["status"] =
    blockers.length > 0 ? "not_ready"
    : missing.length > 0 || !screeningDone || !docsComplete || !insuranceOk ? "almost"
    : "ready";
  const readinessLabel =
    readinessStatus === "ready" ? "Ready For Approval"
    : readinessStatus === "almost" ? "Almost Ready"
    : "Not Ready";
  const nextAction =
    !screeningDone ? "Continue interview and capture qualification signals"
    : !docsComplete ? "Request the remaining documents from the driver"
    : !insuranceOk ? "Complete insurance verification call"
    : !approved ? "Approve driver and prepare pickup"
    : !driver.card_last4 ? "Send card-on-file link"
    : !pickedUp ? "Schedule vehicle pickup"
    : "Monitor active rental";

  const readiness: Readiness = {
    status: readinessStatus,
    label: readinessLabel,
    blockers,
    positives,
    missing,
    nextAction,
  };

  // ---- Primary action -------------------------------------------------
  const primaryAction = !screeningDone
    ? { label: "Continue Interview", onClick: () => setInterviewOpen(true), icon: ClipboardList }
    : !docsComplete
    ? { label: "Review Documents", onClick: () => document.getElementById("tab-documents")?.click(), icon: FileText }
    : !insuranceOk
    ? { label: "Verify Insurance", onClick: () => document.getElementById("tab-screening")?.click(), icon: ShieldCheck }
    : !approved
    ? { label: "Approve Driver", onClick: () => onUpdate({ status: "approved" }), icon: Check }
    : !veh
    ? { label: "Assign Vehicle", onClick: () => document.getElementById("tab-rental")?.click(), icon: Car }
    : { label: "View Rental", onClick: () => document.getElementById("tab-rental")?.click(), icon: Car };
  const PrimaryIcon = primaryAction.icon;

  return (
    <div className="-mx-8 -my-8 min-h-full bg-[#FAFAFB]">
      {/* Compact header */}
      <div className="sticky top-0 z-10 bg-white border-b border-[#EDEDF0]">
        <div className="px-8 py-3 flex items-center justify-between">
          <button onClick={onBack} className="inline-flex items-center gap-1.5 text-[13px] text-[#55555E] hover:text-[#111114] transition-colors">
            <ArrowLeft className="w-4 h-4" /> Drivers
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={primaryAction.onClick}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#CC0000] text-white px-3.5 py-1.5 text-[12px] font-semibold hover:bg-[#B00000] transition-colors"
            >
              <PrimaryIcon className="w-3.5 h-3.5" strokeWidth={2} /> {primaryAction.label}
            </button>
            {driver.phone && (
              <a href={`tel:${driver.phone}`} className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-[#EDEDF0] bg-white text-[#55555E] hover:text-[#111114] hover:border-[#D6D6DB] transition-colors" title="Call">
                <Phone className="w-3.5 h-3.5" />
              </a>
            )}
            {driver.phone && (
              <a href={smsHref(driver.phone)} className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-[#EDEDF0] bg-white text-[#55555E] hover:text-[#111114] hover:border-[#D6D6DB] transition-colors" title="Text">
                <MessageSquare className="w-3.5 h-3.5" />
              </a>
            )}
            {driver.email && (
              <a href={`mailto:${driver.email}`} className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-[#EDEDF0] bg-white text-[#55555E] hover:text-[#111114] hover:border-[#D6D6DB] transition-colors" title="Email">
                <Mail className="w-3.5 h-3.5" />
              </a>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-[#EDEDF0] bg-white text-[#55555E] hover:text-[#111114] hover:border-[#D6D6DB] transition-colors">
                <MoreVertical className="w-4 h-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setInterviewOpen(true)}>
                  <ClipboardList className="w-4 h-4 mr-2" /> Edit interview
                </DropdownMenuItem>
                <RequestDocumentsAction driver={driver} onUpdate={onUpdate} />
                <CardOnFileActions driver={driver} onUpdate={onUpdate} />
                <DropdownMenuItem className="text-[#CC0000] focus:text-[#CC0000]" onClick={onDelete}>
                  <Trash2 className="w-4 h-4 mr-2" /> Delete driver
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {/* Identity strip */}
        <div className="px-8 pb-4 flex items-center gap-4">
          <div className="h-12 w-12 shrink-0 rounded-full bg-[#141416] text-white grid place-items-center text-[15px] font-semibold">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-[18px] font-semibold text-[#111114] truncate">{driver.full_name || "Unnamed"}</h2>
              <StatusPill status={driver.status} />
              {driver.gclid && <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#B77900] bg-[rgba(183,121,0,0.08)] rounded px-1.5 py-0.5">Google Ads</span>}
            </div>
            <div className="mt-1 flex items-center gap-3 flex-wrap text-[12px] text-[#55555E]">
              {(driver.city || driver.state) && (
                <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3 text-[#9A9AA3]" /> {[driver.city, driver.state].filter(Boolean).join(", ")}</span>
              )}
              {driver.phone && <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3 text-[#9A9AA3]" /> {formatPhone(driver.phone)}</span>}
              {driver.email && <span className="inline-flex items-center gap-1 truncate max-w-[240px]"><Mail className="w-3 h-3 text-[#9A9AA3]" /> {driver.email}</span>}
              {driver.created_at && (
                <span className="inline-flex items-center gap-1 text-[#9A9AA3]">Applied {new Date(driver.created_at).toLocaleDateString()}</span>
              )}
              {driver.contacted_at && (
                <span className="inline-flex items-center gap-1 text-[#9A9AA3]">· Last contact {new Date(driver.contacted_at).toLocaleDateString()}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="px-8 py-6 space-y-6">
        <LifecycleRail
          stages={lifecycle}
          percent={percentComplete}
          timeInStage={timeInStage}
          blocker={readiness.blockers[0]}
        />

        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          {/* Sidebar */}
          <aside className="space-y-4 lg:sticky lg:top-32 lg:self-start">
            <SectionCard title="Driver Summary">
              <div className="space-y-1.5 text-[12px]">
                {driver.phone && <div className="flex items-center gap-2 text-[#111114]"><Phone className="w-3.5 h-3.5 text-[#9A9AA3]" /> {formatPhone(driver.phone)}</div>}
                {driver.email && <div className="flex items-center gap-2 text-[#111114] break-all"><Mail className="w-3.5 h-3.5 text-[#9A9AA3] shrink-0" /> {driver.email}</div>}
                {(driver.city || driver.state) && <div className="flex items-center gap-2 text-[#111114]"><MapPin className="w-3.5 h-3.5 text-[#9A9AA3]" /> {[driver.city, driver.state].filter(Boolean).join(", ")}</div>}
                <div className="flex items-center gap-2 text-[#55555E]"><Globe className="w-3.5 h-3.5 text-[#9A9AA3]" /> {driver.gclid ? "Google Ads" : (driver.utm_source || "Direct")}</div>
              </div>
            </SectionCard>

            <SectionCard title="Rental Need">
              <dl className="space-y-2.5 text-[12px]">
                <Row2 label="Needed by" value={(screening as any)?.needed_by_date ? new Date((screening as any).needed_by_date).toLocaleDateString() : "—"} />
                <Row2 label="Weekly rate" value={driver.weekly_rent ? `$${Number(driver.weekly_rent).toLocaleString()}` : "$350"} />
                <Row2 label="Drive type" value={(screening as any)?.drive_type?.replace("_", " ") ?? "—"} />
                <Row2 label="Current vehicle" value={veh ? `${veh.year} ${veh.make} ${veh.model}` : "Unassigned"} />
                <Row2 label="Card on file" value={driver.card_last4 ? `····${driver.card_last4}` : "Not saved"} />
              </dl>
            </SectionCard>

            <SectionCard title="Readiness Signals">
              <dl className="space-y-2.5 text-[12px]">
                <SignalRow label="Interview" ok={screeningDone} />
                <SignalRow label="Documents" ok={docsComplete} detail={`${docs.filter((d) => REQUIRED_DOC_TYPES.includes(d.doc_type as RequiredDocType)).length}/4`} />
                <SignalRow label="Insurance" ok={insuranceOk} />
                <SignalRow label="Card on file" ok={!!driver.card_last4} />
                <SignalRow label="Approved" ok={approved} />
              </dl>
            </SectionCard>

            <SectionCard title="Quick Actions">
              <div className="space-y-1.5">
                <QuickAction icon={ClipboardList} label="Continue interview" onClick={() => setInterviewOpen(true)} />
                <QuickAction icon={FileText} label="Request documents" onClick={() => (document.getElementById("tab-documents") as HTMLElement | null)?.click()} />
                <QuickAction icon={ShieldCheck} label="Verify insurance" onClick={() => (document.getElementById("tab-screening") as HTMLElement | null)?.click()} />
                <QuickAction icon={Car} label="Assign vehicle" onClick={() => (document.getElementById("tab-rental") as HTMLElement | null)?.click()} />
                <QuickAction icon={FileText} label="Add note" onClick={() => (document.getElementById("tab-notes") as HTMLElement | null)?.click()} />
              </div>
            </SectionCard>
          </aside>

          {/* Main workspace */}
          <div className="min-w-0 space-y-6">
            <ReadinessSummary
              readiness={readiness}
              score={typeof driver.ai_score === "number" ? driver.ai_score : null}
              primary={
                <button
                  onClick={primaryAction.onClick}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#CC0000] text-white px-3.5 py-1.5 text-[12px] font-semibold hover:bg-[#B00000] transition-colors"
                >
                  <PrimaryIcon className="w-3.5 h-3.5" strokeWidth={2} /> {primaryAction.label}
                </button>
              }
            />

            <Tabs defaultValue="overview" className="w-full">
              <TabsList className="bg-white border border-[#EDEDF0]">
                <TabsTrigger value="overview" id="tab-overview">Overview</TabsTrigger>
                <TabsTrigger value="application" id="tab-application">Application</TabsTrigger>
                <TabsTrigger value="documents" id="tab-documents">Documents</TabsTrigger>
                <TabsTrigger value="screening" id="tab-screening">Screening</TabsTrigger>
                <TabsTrigger value="rental" id="tab-rental">Rental</TabsTrigger>
                <TabsTrigger value="payments" id="tab-payments">Payments</TabsTrigger>
                <TabsTrigger value="notes" id="tab-notes">Notes</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="mt-4 space-y-4">
                <SectionCard title="Driver Facts">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Fact label="Platforms" value={(driver.platforms?.length ? driver.platforms.join(", ") : (screening as any)?.gig_apps?.join(", ")) || "—"} />
                    <Fact label="Trips" value={Number.isNaN(trips) || !driver.trips_completed ? "—" : trips.toLocaleString()} />
                    <Fact label="Rating" value={driver.rating ? `${driver.rating}/5` : "—"} />
                    <Fact label="Years licensed" value={driver.years_licensed ?? "—"} />
                    <Fact label="Weekly hours" value={driver.weekly_hours ?? "—"} />
                    <Fact label="Accidents (3y)" value={(screening as any)?.accidents_last_3yr ?? "—"} />
                    <Fact label="License points" value={(screening as any)?.license_points ?? "—"} />
                    <Fact label="Drive type" value={(screening as any)?.drive_type?.replace("_", " ") ?? "—"} />
                  </div>
                </SectionCard>

                <SectionCard title="Requirements Checklist">
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <ReqRow ok={screeningDone} label="Interview complete" />
                    <ReqRow ok={!!driver.license_photo_url || !!driver.license_valid} label="License uploaded" />
                    <ReqRow ok={insuranceOk} label="Insurance verified" />
                    <ReqRow ok={!!(screening as any)?.mvr_authorized} label="MVR authorized" />
                    <ReqRow ok={!!driver.card_last4} label="Card on file" />
                    <ReqRow ok={!!(driver as any).agreement_signed_at} label="Agreement signed" />
                    <ReqRow ok={!!(driver as any).pickup_at} label="Pickup scheduled" />
                    <ReqRow ok={docsComplete} label="All documents received" />
                  </ul>
                </SectionCard>

                <SectionCard title="Recent Activity" padded={false}>
                  <div className="p-5">
                    <Timeline steps={buildDriverTimeline(driver, screening)} title="Rental Timeline" />
                  </div>
                </SectionCard>
              </TabsContent>

              <TabsContent value="documents" className="mt-4 space-y-4">
                <DocumentsCard
                  leadId={driver.id}
                  docs={docs}
                  onChange={(next) => { setDocs(next); onDocsChange?.(next); }}
                />
                {((driver as any).trip_screenshots?.length || driver.profile_screenshot_url) ? (
                  <Card title="Trip / delivery screenshots" icon={<FileText className="w-4 h-4" />}>
                    <TripScreenshots
                      paths={Array.from(new Set([
                        ...(((driver as any).trip_screenshots as string[] | null) ?? []),
                        ...(driver.profile_screenshot_url ? [driver.profile_screenshot_url] : []),
                      ].filter(Boolean)))}
                    />
                  </Card>
                ) : null}
                {driver.license_photo_url ? (
                  <Card title="License photo" icon={<FileText className="w-4 h-4" />}>
                    <LicensePhoto path={driver.license_photo_url} />
                  </Card>
                ) : null}
              </TabsContent>

              <TabsContent value="screening" className="mt-4 space-y-4">
                <ScreeningPipeline screening={screening} docs={docs} onAdvance={advanceStatus} />
                <InsuranceVerificationCard
                  leadId={driver.id}
                  screening={screening}
                  docs={docs}
                  onScreening={(s) => { setScreening(s); onScreeningChange?.(s); }}
                  onDocs={(d) => { setDocs(d); onDocsChange?.(d); }}
                />
                <AISnapshotCard driver={driver} onUpdate={onUpdate} />
              </TabsContent>

              <TabsContent value="application" className="mt-4 space-y-4">
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
                <Card title="Attribution" icon={driver.gclid ? <BadgeDollarSign className="w-4 h-4" /> : <Globe className="w-4 h-4" />}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <Field label="Source" value={driver.gclid ? "Google Ads" : "Organic / Direct"} />
                    <Field label="utm_source" value={driver.utm_source} />
                    <Field label="utm_medium" value={driver.utm_medium} />
                    <Field label="utm_campaign" value={driver.utm_campaign} />
                    <Field label="Landing page" value={driver.landing_page} />
                    <Field label="Referrer" value={driver.referrer} />
                  </div>
                </Card>
              </TabsContent>

              <TabsContent value="rental" className="mt-4">
                <Card title="Assigned vehicle" icon={<Car className="w-4 h-4" />}>
                  <div className="rounded-lg border border-[#EDEDF0] bg-[#FAFAFB] p-4 mb-3">
                    {veh ? (
                      <div>
                        <div className="text-[15px] font-semibold text-[#111114]">{veh.year} {veh.make} {veh.model}{veh.trim ? ` ${veh.trim}` : ""}</div>
                        <div className="text-[11px] text-[#55555E] mt-1">
                          {[veh.body_type, veh.fuel_type, veh.status].filter(Boolean).join(" · ")} · ID {veh.id.slice(0, 8)}
                        </div>
                      </div>
                    ) : (
                      <div className="text-[13px] text-[#55555E]">No vehicle assigned</div>
                    )}
                  </div>
                  <VehiclePicker
                    vehicles={vehicles}
                    value={driver.vehicle_id}
                    onChange={(id) => onUpdate({ vehicle_id: id })}
                  />
                </Card>
              </TabsContent>

              <TabsContent value="payments" className="mt-4 space-y-4">
                <Card title="Payment terms" icon={<CreditCard className="w-4 h-4" />}>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <NumField label="Deposit amount ($)" value={driver.deposit_amount as any} onSave={(v) => onUpdate({ deposit_amount: v as any })} />
                    <NumField label="Deposit paid ($)" value={driver.deposit_paid as any} onSave={(v) => onUpdate({ deposit_paid: v as any })} />
                    <NumField label="Weekly rent ($)" value={driver.weekly_rent as any} onSave={(v) => onUpdate({ weekly_rent: v as any })} />
                  </div>
                </Card>
                <CardOnFileCard driver={driver} onUpdate={onUpdate} />
              </TabsContent>

              <TabsContent value="notes" className="mt-4">
                <Card title="Internal notes" icon={<FileText className="w-4 h-4" />}>
                  <textarea
                    defaultValue={driver.notes || ""} rows={6} placeholder="Add internal notes about this driver…"
                    onBlur={(e) => onUpdate({ notes: e.target.value })}
                    className="w-full border border-[#EDEDF0] rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#CC0000]/15"
                  />
                  <p className="text-[11px] text-[#9A9AA3] mt-2">Saved automatically when you click away.</p>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>

      <InterviewDrawer
        open={interviewOpen}
        onOpenChange={setInterviewOpen}
        driver={driver}
        screening={screening}
        onSaved={(next) => { setScreening(next); onScreeningChange?.(next); }}
      />
    </div>
  );
}

function Row2({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[#9A9AA3]">{label}</dt>
      <dd className="font-medium text-[#111114] text-right truncate max-w-[180px]">{value ?? "—"}</dd>
    </div>
  );
}
function SignalRow({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[#55555E] inline-flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-[#0F8A4B]" : "bg-[#C4C4CB]"}`} />
        {label}
      </dt>
      <dd className={`text-[11px] font-medium tabular-nums ${ok ? "text-[#0F8A4B]" : "text-[#9A9AA3]"}`}>
        {detail ?? (ok ? "Ready" : "Pending")}
      </dd>
    </div>
  );
}
function QuickAction({ icon: Icon, label, onClick }: { icon: any; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[12px] text-[#111114] hover:bg-[#FAFAFB] transition-colors text-left"
    >
      <Icon className="w-3.5 h-3.5 text-[#55555E]" strokeWidth={1.75} />
      {label}
    </button>
  );
}
function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <MicroLabel>{label}</MicroLabel>
      <div className="mt-1 text-[13px] font-medium text-[#111114] truncate">{value ?? "—"}</div>
    </div>
  );
}
function ReqRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={`flex items-center gap-2 rounded-md border px-3 py-2 text-[12px] ${
      ok ? "border-[#EDEDF0] bg-[#FAFAFB] text-[#111114]" : "border-[#EDEDF0] bg-white text-[#55555E]"
    }`}>
      <span className={`h-4 w-4 rounded-full grid place-items-center ${ok ? "bg-[#0F8A4B] text-white" : "bg-[#F4F4F6] text-[#9A9AA3]"}`}>
        {ok ? <Check className="w-2.5 h-2.5" strokeWidth={3} /> : <span className="text-[8px]">·</span>}
      </span>
      {label}
    </li>
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
    <div className="rounded-xl border border-[#EDEDF0] bg-white px-4 py-3 flex items-center gap-4">
      <div className="shrink-0 flex items-center gap-2.5">
        <span className={`h-8 w-8 rounded-full bg-gradient-to-br ${tierGrad} grid place-items-center text-white text-[11px] font-bold tabular-nums`}>
          {score ?? "—"}
        </span>
        <div className="leading-tight">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9A9AA3]">AI Score</div>
          <div className="text-[12px] font-semibold text-[#111114] capitalize">{tier ?? "Unscored"}</div>
        </div>
      </div>
      <div className="min-w-0 flex-1 flex items-center gap-2">
        <Sparkles className="w-3.5 h-3.5 text-[#CC0000] shrink-0" />
        <p className="text-[12px] text-[#55555E] leading-snug truncate">
          {driver.ai_summary || "Not yet scored. Run the AI review to grade trips, rating, license, and screenshots."}
        </p>
        {flags.length > 0 && (
          <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-red-50 text-red-800 border border-red-200">
            <AlertTriangle className="w-3 h-3" /> {flags.length}
          </span>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-2">
        {scoredAt && <span className="hidden sm:block text-[11px] text-[#9A9AA3]">{scoredAt.toLocaleDateString()}</span>}
        <button
          onClick={run}
          disabled={busy}
          className="inline-flex items-center gap-1 text-[12px] px-2.5 py-1 rounded-md border border-[#EDEDF0] bg-white hover:bg-[#FAFAFB] disabled:opacity-60 transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5" /> {busy ? "Scoring…" : tier ? "Re-score" : "Score"}
        </button>
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
