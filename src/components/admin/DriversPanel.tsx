import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import type { Application, DriverScreening as DriverScreeningRow, Vehicle } from "./types";
import { REQUIRED_DOC_TYPES, type RequiredDocType } from "./types";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import {
  mergeDuplicateApplications,
  approveApplication,
  reissueApplicantLink,
} from "@/lib/applications.functions";
import { ActivateRentalDialog } from "./ActivateRentalDialog";
import { DepositDialog } from "./DepositDialog";
import { endRental } from "@/lib/rentals.functions";
import { scoreApplication } from "@/lib/scoring.functions";
import {
  InsuranceVerificationCard,
  InterviewTab,
  ScreeningPipeline,
  useDriverScreening,
} from "./DriverScreening";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  MoreVertical,
  Search,
  Check,
  ChevronDown,
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  Car,
  CreditCard,
  ShieldCheck,
  Activity,
  User as UserIcon,
  FileText,
  Star,
  Trash2,
  Copy,
  GitMerge,
  MessageSquare,
  PhoneOutgoing,
  BadgeDollarSign,
  Globe,
  Sparkles,
  AlertTriangle,
  Wallet,
  CalendarDays,
  Link2 as LinkIcon,
  Loader2,
} from "lucide-react";
import { removeCardOnFile } from "@/lib/payments.functions";
import { AgreementsCard } from "./AgreementsCard";
import {
  chargeCardOnRental,
  startRentalAutopay,
  stopRentalAutopay,
  type ChargeReason,
} from "@/lib/rental-payments.functions";
import { requestApplicationDocuments } from "@/lib/admin-communications.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { SourceBadge } from "./SourceBadge";
import {
  Timeline,
  buildDriverTimeline,
  StatusPill,
  LifecycleRail,
  ReadinessSummary,
  ReadinessStatePill,
  ReadinessMetrics,
  SectionCard,
  MicroLabel,
  EmptyState,
  type LifecycleStage,
} from "./ui";
import {
  computeReadiness,
  nextActions,
  type ReadinessDocument,
  type ReadinessResult,
  type Remedy,
} from "@/lib/readiness";

/** Vault category -> the required-document name the list counts. */
const VAULT_TO_REQUIRED: Record<string, string> = {
  insurance: "insurance_card",
  gig_profile: "driver_profile_screenshot",
};
import { buildReadinessIndex } from "@/lib/readiness-index";
import { ApplicantDocuments, REQUIRED_VAULT_CATEGORIES } from "./ApplicantDocuments";
import { adminListDriverDocuments, type VaultDocument } from "@/lib/documents.functions";
import { InterviewDrawer } from "./InterviewDrawer";
import { acknowledgeApplication } from "@/lib/applications.functions";
import { ClipboardList } from "lucide-react";
import { WaitlistPanel } from "./WaitlistPanel";
import { listWaitlist } from "@/lib/waitlist.functions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";

/**
 * What arrived, at a glance, above the tabs.
 *
 * The profile led with lifecycle, summary, rental need and readiness — four
 * panels about what is outstanding — and the evidence the applicant had
 * actually sent sat behind a tab nobody had reason to click. An operator
 * looking at a driver who had uploaded a licence, an insurance PDF, a gig
 * profile and a trip screenshot could not tell any of them existed.
 */
function DocumentsStrip({
  docs,
  loading,
  onOpen,
}: {
  docs: VaultDocument[];
  loading: boolean;
  onOpen: () => void;
}) {
  const GROUPS: { keys: string[]; label: string }[] = [
    { keys: ["license_front", "license_back"], label: "Driver's License" },
    { keys: ["insurance"], label: "Insurance" },
    { keys: ["gig_profile"], label: "Gig Profile" },
    { keys: ["trip_history"], label: "Trip History" },
  ];
  const current = docs.filter((d) => d.is_current);
  const total = current.length;

  return (
    <SectionCard
      padded={false}
      title="Documents"
      right={
        <button
          onClick={onOpen}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#EDEDF0] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#55555E] hover:border-[#C4C4CB] transition-colors"
        >
          {total > 0 ? `Open All ${total}` : "Open Documents"}
        </button>
      }
    >
      <div className="px-5 py-4">
        {loading ? (
          <p className="text-[12.5px] text-[#77777F]">Loading what they sent…</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {GROUPS.map((g) => {
              const hits = current.filter((d) => g.keys.includes(d.category));
              const verified = hits.length > 0 && hits.every((d) => d.review_status === "verified");
              const rejected = hits.some((d) => d.review_status === "rejected");
              const tone = !hits.length
                ? "bg-[#F4F4F6] text-[#77777F] border-[#EDEDF0]"
                : rejected
                  ? "bg-red-50 text-red-700 border-red-200"
                  : verified
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-sky-50 text-sky-700 border-sky-200";
              return (
                <button
                  key={g.label}
                  onClick={onOpen}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11.5px] font-semibold transition-opacity hover:opacity-80 ${tone}`}
                >
                  {g.label}
                  <span className="tabular-nums font-normal">
                    {!hits.length
                      ? "Not Received"
                      : rejected
                        ? "Needs Replacement"
                        : hits.length > 1
                          ? `${hits.length} Files`
                          : verified
                            ? "Verified"
                            : "Uploaded"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

const DRIVER_STATUSES = [
  "new",
  "reviewing",
  "approved",
  "active",
  "suspended",
  "declined",
  "closed",
] as const;
const DEPOSIT_STATUSES = ["not_paid", "partially_paid", "paid", "refunded"] as const;
const PAYMENT_STATUSES = ["current", "late", "past_due", "collections"] as const;
const CHECK_STATUSES = ["pending", "passed", "failed"] as const;

const statusBadge: Record<string, string> = {
  new: "bg-blue-100 text-blue-800",
  reviewing: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  active: "bg-green-100 text-green-800",
  suspended: "bg-orange-100 text-orange-800",
  declined: "bg-red-100 text-red-800",
  closed: "bg-gray-200 text-gray-700",
};

/**
 * The list's readiness cell.
 *
 * State, then coverage, then document progress. Qualification is deliberately
 * absent from this cell: in a table row there is no space to carry the
 * coverage that makes it meaningful, and a bare "100" next to a name is the
 * exact misreading this whole model exists to prevent.
 */
function ReadinessCell({ result, docCount }: { result?: ReadinessResult; docCount: number }) {
  if (!result) return <span className="text-[11px] text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col items-start gap-0.5">
      <ReadinessStatePill state={result.state} short />
      <span className="text-[10px] text-muted-foreground tabular-nums">
        {result.coverage}% Known · {docCount}/4 Docs
      </span>
    </div>
  );
}

function formatPhone(p?: string | null): string {
  if (!p) return "—";
  const d = p.replace(/\D/g, "");
  const n = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (n.length === 10) return `${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6)}`;
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

export function DriversPanel({
  externalSearch = "",
  initialOpenId,
  isOwner = false,
  urlFilter,
}: {
  externalSearch?: string;
  initialOpenId?: string;
  /** ?filter= from the address bar; only "waitlist" is honoured (old ?tab=waitlist links land here). */
  urlFilter?: string;
  /** Verification recordings are Owner-only. See VerificationRecording. */
  isOwner?: boolean;
} = {}) {
  const [drivers, setDrivers] = useState<Application[]>([]);
  // Whether the applications fetch has come back, as distinct from having
  // come back empty. A deep link needs to tell those apart.
  const [driversLoaded, setDriversLoaded] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  /*
   * Which applicant is open is a fact about the URL, not about this
   * component.
   *
   * It used to be local state seeded once from `initialOpenId` behind a
   * one-shot ref. That made the sidebar's "Drivers" unable to close the
   * drawer — the tab was already "drivers", nothing re-rendered, and the
   * selection lived somewhere the navigation could not reach. Derived from
   * the id in the address bar, ?tab=drivers is the list and
   * ?tab=drivers&id=… is that applicant, always, including on a refresh, a
   * pasted link and the back button.
   *
   * An id naming nobody in the list resolves to null, so a stale or
   * hand-edited link lands on the listing rather than a blank screen.
   */
  const navigate = useNavigate();
  const openId = initialOpenId ?? null;
  const setOpenId = useCallback(
    (id: string | null) =>
      void navigate({
        to: "/admin",
        search: id ? { tab: "drivers", id } : { tab: "drivers" },
      }),
    [navigate],
  );
  const [localFilter, setLocalFilter] = useState<string>("all");
  // Waitlist lives in the URL so old ?tab=waitlist bookmarks and the back button work.
  const filter = urlFilter === "waitlist" ? "waitlist" : localFilter;
  const setFilter = useCallback(
    (f: string) => {
      if (f === "waitlist") {
        void navigate({ to: "/admin", search: { tab: "drivers", filter: "waitlist" } });
        return;
      }
      setLocalFilter(f);
      if (urlFilter === "waitlist") void navigate({ to: "/admin", search: { tab: "drivers" } });
    },
    [navigate, urlFilter],
  );
  // Live waitlist size (entries not yet promoted) — never hard-coded.
  const loadWaitlist = useServerFn(listWaitlist);
  const [waitlistCount, setWaitlistCount] = useState<number | null>(null);
  useEffect(() => {
    loadWaitlist()
      .then((r) => setWaitlistCount(r.entries.filter((e) => e.status !== "promoted").length))
      .catch(() => setWaitlistCount(null));
  }, [loadWaitlist]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [screenings, setScreenings] = useState<Record<string, DriverScreeningRow>>({});
  const [docCounts, setDocCounts] = useState<Record<string, number>>({});
  const [docRows, setDocRows] = useState<ReadinessDocument[]>([]);
  const runMerge = useServerFn(mergeDuplicateApplications);
  const acknowledge = useServerFn(acknowledgeApplication);
  const now = useNow();

  /**
   * Open an applicant and record that somebody looked.
   *
   * The dashboard's "New" count means unacknowledged, so it only falls when
   * this runs. Fire-and-forget: the record opens whether or not the stamp
   * lands, because failing to write a timestamp is no reason to refuse
   * somebody the page they asked for.
   */
  const openDriver = useCallback(
    (a: Application) => {
      setOpenId(a.id);
      if (!(a as any).reviewed_at) {
        void acknowledge({ data: { id: a.id } })
          .then(() =>
            setDrivers((rows) =>
              rows.map((r) =>
                r.id === a.id
                  ? ({ ...r, reviewed_at: new Date().toISOString() } as Application)
                  : r,
              ),
            ),
          )
          .catch(() => {});
      }
    },
    [acknowledge, setOpenId],
  );

  /*
   * The open applicant, resolved from the URL against the loaded list.
   *
   * A dashboard link names somebody: ?tab=drivers&id=<uuid>. An id that
   * matches nobody — a deleted record, a vehicle id pasted by hand, a link
   * from a filter that no longer includes them — resolves to null and the
   * listing renders. No blank screen, and no need for a one-shot ref: there
   * is nothing to seed, because there is no second copy of this fact.
   */
  const open = useMemo(
    () => (openId ? (drivers.find((d) => d.id === openId) ?? null) : null),
    [openId, drivers],
  );

  /*
   * A URL naming an applicant we have not loaded yet is not "no applicant".
   *
   * The list arrives asynchronously, so for the few hundred milliseconds
   * before it does, a deep link resolves to nothing and the LIST renders —
   * then the drawer replaces it. Measured on this branch and on main: the
   * flash shows up in roughly half of cold loads either way, so it predates
   * this change, but the derived selection makes it trivial to state
   * properly. Pending, not absent.
   */
  const resolvingDeepLink = Boolean(openId) && !driversLoaded;

  // Opening an applicant from a dashboard link should still clear their
  // unacknowledged flag, exactly as clicking the row does.
  const acknowledged = useRef<string | null>(null);
  useEffect(() => {
    if (!open || acknowledged.current === open.id) return;
    acknowledged.current = open.id;
    if ((open as any).reviewed_at) return;
    void acknowledge({ data: { id: open.id } })
      .then(() =>
        setDrivers((rows) =>
          rows.map((r) =>
            r.id === open.id
              ? ({ ...r, reviewed_at: new Date().toISOString() } as Application)
              : r,
          ),
        ),
      )
      .catch(() => {});
  }, [open, acknowledge]);

  useEffect(() => {
    supabase
      .from("applications")
      .select("*")
      .neq("status", "duplicate")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setDrivers(data || []);
        setDriversLoaded(true);
      });
    supabase
      .from("vehicles")
      .select("*")
      .then(({ data }) => setVehicles((data as any) || []));
    supabase
      .from("driver_screenings")
      .select("*")
      .then(({ data }) => {
        const map: Record<string, DriverScreeningRow> = {};
        (data || []).forEach((s) => {
          map[s.lead_id] = s as DriverScreeningRow;
        });
        setScreenings(map);
      });
    // The document vault, in bulk. One source.
    //
    // This used to union `documents` with `lead_documents` and de-duplicate by
    // category name. lead_documents is retired — nothing writes it and nothing
    // reads it — so the union is gone and with it the chance of the two
    // disagreeing about the same applicant.
    void (async () => {
      const { data } = await supabase
        .from("documents")
        .select("driver_id,category,review_status,is_current")
        .not("driver_id", "is", null);
      const rows: ReadinessDocument[] = (
        (data ?? []) as {
          driver_id: string;
          category: string;
          review_status: string | null;
          is_current: boolean | null;
        }[]
      ).map((d) => ({
        lead_id: d.driver_id,
        category: d.category,
        review_status: d.review_status,
        is_current: d.is_current,
      }));
      const seen: Record<string, Set<string>> = {};
      for (const r of rows) {
        const id = (r as { lead_id?: string }).lead_id;
        if (!id || r.is_current === false || r.review_status === "rejected") continue;
        const canonical = VAULT_TO_REQUIRED[(r.category ?? "").trim()] ?? (r.category ?? "").trim();
        if (!REQUIRED_DOC_TYPES.includes(canonical as RequiredDocType)) continue;
        (seen[id] ?? (seen[id] = new Set())).add(canonical);
      }
      setDocCounts(Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, v.size])));
      setDocRows(rows);
    })();
  }, []);

  const vehicleMap = useMemo(() => Object.fromEntries(vehicles.map((v) => [v.id, v])), [vehicles]);

  // Readiness for the whole list, from the three result sets already loaded
  // above. No per-row query: the list stays three round trips whether it holds
  // nineteen applicants or nineteen thousand.
  const readinessIndex = useMemo(
    () => buildReadinessIndex(drivers, Object.values(screenings), docRows),
    [drivers, screenings, docRows],
  );

  // Group by primary_application_id (falls back to id). Primary row = the one
  // whose id === groupKey; others render as collapsed history.
  const grouped = useMemo(() => {
    const q = externalSearch.trim().toLowerCase();
    const filteredRows = (
      filter === "all" ? drivers : drivers.filter((a) => a.status === filter)
    ).filter((a) => {
      if (!q) return true;
      const hay =
        `${a.full_name ?? ""} ${a.email ?? ""} ${a.phone ?? ""} ${a.city ?? ""} ${a.state ?? ""}`.toLowerCase();
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
    if (target && !target.contacted_at && patch.status && patch.status !== "new") {
      patchWithStamp.contacted_at = new Date().toISOString();
    }
    const { error } = await supabase.from("applications").update(patchWithStamp).eq("id", id);
    if (error) return toast.error(error.message);
    // One list, one update. `open` is derived from this list, so patching it
    // here is all that is needed — there is no second copy to keep in step.
    setDrivers((a) => a.map((x) => (x.id === id ? { ...x, ...patchWithStamp } : x)));
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
    setOpenId(null);
    toast.success("Deleted");
  }

  async function handleMerge() {
    if (
      !confirm(
        "Merge existing duplicate leads by phone/email? This links older rows to the newest and cannot be undone.",
      )
    )
      return;
    setMerging(true);
    try {
      const res = await runMerge();
      toast.success(`Linked ${res.merged} duplicate rows.`);
      const { data } = await supabase
        .from("applications")
        .select("*")
        .neq("status", "duplicate")
        .order("created_at", { ascending: false });
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

  // Resolving a deep link: say so, rather than showing the list we are about
  // to replace.
  if (resolvingDeepLink) {
    return (
      <div className="flex items-center gap-2 px-1 py-16 text-[13px] text-[#9A9AA3]">
        <Loader2 className="w-4 h-4 animate-spin" /> Opening…
      </div>
    );
  }

  if (open) {
    return (
      <DriverDetail
        /*
         * Keyed by applicant, so switching applicants rebuilds the drawer
         * rather than carrying one person's state onto the next.
         *
         * Today the list is unreachable while the drawer is open, so `open`
         * always passes through null between two applicants and this never
         * fires — but that is an accident of the current layout, not a
         * guarantee. The drawer now holds the document vault, and readiness
         * reads it without a loading guard, so the first "open the next
         * applicant" control anybody adds would show A's documents against
         * B's name until the fetch returned. An editing patch reuses the
         * same id, so this does not remount on every field change.
         */
        key={open.id}
        driver={open}
        vehicles={vehicles}
        onBack={() => setOpenId(null)}
        onUpdate={(p) => update(open.id, p)}
        onDelete={() => remove(open.id)}
        onScreeningChange={(s) => setScreenings((prev) => ({ ...prev, [open.id]: s }))}
        onVaultChange={(count) => setDocCounts((prev) => ({ ...prev, [open.id]: count }))}
        isOwner={isOwner}
      />
    );
  }

  const FILTER_LABEL: Record<string, string> = {
    all: "All", new: "New", reviewing: "Reviewing", approved: "Approved", waitlist: "Waitlist",
    active: "Active", suspended: "Suspended", declined: "Declined", closed: "Closed",
  };
  const FILTER_ORDER = ["all", "new", "reviewing", "approved", "waitlist", "active", "suspended", "declined", "closed"];
  const filterCount = (s: string) =>
    s === "waitlist"
      ? waitlistCount ?? "…"
      : s === "all"
        ? drivers.length
        : drivers.filter((a) => a.status === s).length;
  const filterButtons = FILTER_ORDER.map((s) => (
    <button
      key={s}
      onClick={() => setFilter(s)}
      className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-md ${filter === s ? "bg-black text-white" : "bg-white border border-border"}`}
    >
      {FILTER_LABEL[s]} ({filterCount(s)})
    </button>
  ));

  if (filter === "waitlist") {
    return (
      <div>
        <div className="flex gap-2 mb-4 text-xs overflow-x-auto -mx-1 px-1 pb-1">{filterButtons}</div>
        <div className="mb-4">
          <h2 className="text-[15px] font-semibold text-[#111114]">Waitlist</h2>
          <p className="text-[12px] text-[#55555E] mt-0.5">Drivers Waiting When No Cars Are Available</p>
        </div>
        <WaitlistPanel
          onEntriesChange={(n) => setWaitlistCount(n)}
          onPromoted={() =>
            void supabase
              .from("applications")
              .select("*")
              .neq("status", "duplicate")
              .order("created_at", { ascending: false })
              .then(({ data }) => data && setDrivers(data))
          }
        />
      </div>
    );
  }

  return (
    <div>
      <div className="flex gap-2 mb-4 text-xs overflow-x-auto -mx-1 px-1 pb-1">
        {filterButtons}
        <div className="ml-auto shrink-0">
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
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">
                  Readiness
                </th>
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">
                  Payment
                </th>
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">
                  Deposit
                </th>
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">Status</th>
                <th className="text-left font-medium px-4 py-2.5 border-b border-border">
                  Created
                </th>
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
                const respondedMs = createdMs && contactedMs ? contactedMs - createdMs : null;
                const waitColor =
                  waitingMs < 15 * 60_000
                    ? "bg-emerald-100 text-emerald-800"
                    : waitingMs < 60 * 60_000
                      ? "bg-amber-100 text-amber-800"
                      : "bg-red-100 text-red-800";
                const rows = [
                  <tr
                    key={a.id}
                    onClick={() => openDriver(a)}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-soft/60 transition-colors"
                  >
                    <td className="px-4 py-2.5 font-medium whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <span>{a.full_name}</span>
                      </span>
                      <SourceBadge
                        source={a.gclid ? "google" : "organic"}
                        campaign={a.utm_campaign}
                        className="ml-2 align-middle"
                      />
                      {dupeCount > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (history.length) toggleExpand(a.id);
                          }}
                          className="ml-2 inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 hover:bg-amber-200"
                          title="Duplicate submissions from same phone/email"
                        >
                          <Copy className="w-3 h-3" />×{dupeCount + 1}
                        </button>
                      )}
                    </td>
                    <td
                      className="px-4 py-2.5 whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {a.phone ? (
                        <a
                          href={`tel:${a.phone}`}
                          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                        >
                          <Phone className="w-3 h-3" /> {formatPhone(a.phone)}
                        </a>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </td>
                    <td
                      className="px-4 py-2.5 whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {a.email ? (
                        <a
                          href={`mailto:${a.email}`}
                          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                        >
                          <Mail className="w-3 h-3" /> {a.email}
                        </a>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <ReadinessCell
                        result={readinessIndex.get(a.id)}
                        docCount={docCounts[a.id] ?? 0}
                      />
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap capitalize text-muted-foreground">
                      {a.payment_status?.replace(/_/g, " ")}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                      ${Number(a.deposit_paid ?? 0).toLocaleString()}
                    </td>
                    <td
                      className="px-4 py-2.5 whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Select
                        value={a.status || ""}
                        onValueChange={(status) => update(a.id, { status })}
                      >
                        <SelectTrigger className="h-7 w-auto min-w-[7rem] border-0 bg-transparent p-0 shadow-none hover:opacity-80 focus:ring-0 [&>svg]:hidden">
                          {a.status ? (
                            <StatusPill status={a.status} />
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[#F4F4F6] px-2 py-0.5 text-[11px] font-medium text-[#9A9AA3]">
                              Select status <ChevronDown className="w-3 h-3" />
                            </span>
                          )}
                        </SelectTrigger>
                        <SelectContent align="start" className="min-w-[10rem]">
                          {DRIVER_STATUSES.map((s) => (
                            <SelectItem key={s} value={s} className="capitalize text-[13px]">
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-muted-foreground whitespace-nowrap">
                      <div>{new Date(a.created_at!).toLocaleDateString()}</div>
                      <div className="text-[10px] opacity-70">
                        {new Date(a.created_at!).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-soft text-muted-foreground">
                          <MoreVertical className="w-4 h-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openDriver(a)}>Open</DropdownMenuItem>
                          {a.phone && (
                            <DropdownMenuItem
                              onClick={() => (window.location.href = `tel:${a.phone}`)}
                            >
                              <Phone className="w-4 h-4 mr-2" /> Call
                            </DropdownMenuItem>
                          )}
                          {a.phone && (
                            <DropdownMenuItem
                              onClick={() => (window.location.href = smsHref(a.phone))}
                            >
                              <MessageSquare className="w-4 h-4 mr-2" /> Text
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent("open-messages", { detail: { applicationId: a.id } }))}>
                            <MessageSquare className="w-4 h-4 mr-2" /> Open in Messages
                          </DropdownMenuItem>
                          {!contactedMs && (
                            <DropdownMenuItem onClick={() => markContacted(a.id)}>
                              <PhoneOutgoing className="w-4 h-4 mr-2" /> Mark contacted
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            className="text-real-red focus:text-real-red"
                            onClick={() => remove(a.id)}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>,
                ];
                if (isExpanded) {
                  for (const h of history) {
                    rows.push(
                      <tr
                        key={h.id}
                        onClick={() => openDriver(h)}
                        className="cursor-pointer bg-soft/30 border-b border-border text-xs text-muted-foreground hover:bg-soft/60"
                      >
                        <td className="pl-10 pr-4 py-2 italic">↳ earlier submission</td>
                        <td className="px-4 py-2">{h.phone ? formatPhone(h.phone) : "—"}</td>
                        <td className="px-4 py-2">{h.email || "—"}</td>
                        <td className="px-4 py-2">—</td>
                        <td className="px-4 py-2 capitalize">
                          {h.payment_status?.replace(/_/g, " ")}
                        </td>
                        <td className="px-4 py-2">
                          ${Number(h.deposit_paid ?? 0).toLocaleString()}
                        </td>
                        <td className="px-4 py-2 capitalize">{h.status}</td>
                        <td className="px-4 py-2">
                          <div>{new Date(h.created_at!).toLocaleDateString()}</div>
                          <div className="opacity-70">
                            {new Date(h.created_at!).toLocaleTimeString([], {
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </div>
                        </td>
                        <td />
                      </tr>,
                    );
                  }
                }
                return rows;
              })}
              {grouped.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-4">
                    <EmptyState
                      title="No Drivers Yet"
                      hint="Drivers appear here as soon as someone completes the quote form or an application."
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function DriverDetail({
  driver,
  vehicles,
  onBack,
  onUpdate,
  onDelete,
  onScreeningChange,
  onVaultChange,
  isOwner,
}: {
  driver: Application;
  vehicles: Vehicle[];
  onBack: () => void;
  onUpdate: (patch: Partial<Application>) => void;
  onDelete: () => void;
  onScreeningChange?: (s: DriverScreeningRow) => void;
  onVaultChange?: (requiredCount: number) => void;
  isOwner: boolean;
}) {
  const veh = driver.vehicle_id ? vehicles.find((v) => v.id === driver.vehicle_id) : null;
  const initials = (driver.full_name || "?")
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const trips = Number(driver.trips_completed);
  // The 200-trip threshold that used to sit beside this is gone with the
  // submission gate. Trip volume is still a readiness factor and still shown
  // to staff; it is no longer a pass/fail badge on the record.
  const { screening, setScreening } = useDriverScreening(driver.id);

  async function advanceStatus(next: import("./types").ScreeningStatus) {
    try {
      const base = screening ?? {
        lead_id: driver.id,
        status: "new_lead" as import("./types").ScreeningStatus,
      };
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
  // Controlled so the Documents strip and the readiness remedies can send the
  // operator straight to the tab that answers them.
  const [tab, setTab] = useState("overview");
  /*
   * The document vault for this applicant, loaded by the drawer itself.
   *
   * It used to be loaded by <ApplicantDocuments>, which lives inside the
   * Documents tab — and Radix unmounts an inactive tab, so on the Overview
   * tab the vault had never been fetched. Readiness therefore computed with
   * zero documents and told the operator the licence and insurance were still
   * needed, on the very screen they land on, for an applicant whose licence
   * and insurance were sitting in the vault marked current. Nothing was
   * missing; nothing had been asked for.
   *
   * One fetch, at the drawer, feeding both the readiness model and the tab.
   * Still one vault and one server function — the tab renders what this holds
   * instead of holding its own copy.
   */
  const listVaultDocs = useServerFn(adminListDriverDocuments);
  const [vaultDocs, setVaultDocs] = useState<VaultDocument[]>([]);
  const [vaultLoading, setVaultLoading] = useState(true);
  const refreshVault = useCallback(async () => {
    try {
      setVaultDocs(await listVaultDocs({ data: { applicationId: driver.id } }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load documents");
    } finally {
      setVaultLoading(false);
    }
  }, [driver.id, listVaultDocs]);
  useEffect(() => {
    setVaultLoading(true);
    void refreshVault();
  }, [refreshVault]);

  const vaultDocCount = useMemo(() => {
    const current = new Set(vaultDocs.filter((d) => d.is_current).map((d) => d.category));
    return REQUIRED_VAULT_CATEGORIES.filter((c) => current.has(c)).length;
  }, [vaultDocs]);
  useEffect(() => {
    if (!vaultLoading) onVaultChange?.(vaultDocCount);
    // onVaultChange is parent-owned; depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultDocCount, vaultLoading]);
  // Owner-only; for every other tier this stays false and the gate reads the
  // recording as outstanding. The database decides regardless.
  const [hasRecording, setHasRecording] = useState(false);

  // ---- Derive lifecycle stages from driver + screening ------------------
  const scrStatus = String((screening as any)?.status ?? "").toLowerCase();
  const dStatus = String(driver.status ?? "").toLowerCase();
  const contacted = !!driver.contacted_at || scrStatus !== "new_lead";
  const screeningDone = !!screening?.interview_completed_at;
  // From the vault, not from lead_documents. lead_documents only ever held
  // files a staff member uploaded in the back office, so an applicant who sent
  // everything through the application still read as having sent nothing.
  const docsComplete = vaultDocCount >= REQUIRED_VAULT_CATEGORIES.length;
  const insuranceOk = !!(screening as any)?.insurance_verified;
  const approved = dStatus === "approved" || dStatus === "active";
  const pickedUp = !!(driver as any).pickup_at || dStatus === "active";
  const active = dStatus === "active";

  const stageFlags: { key: string; label: string; done: boolean }[] = [
    { key: "applied", label: "Applied", done: true },
    { key: "contacted", label: "Contacted", done: contacted },
    { key: "screening", label: "Screening", done: screeningDone },
    { key: "docs", label: "Documents", done: docsComplete },
    { key: "insurance", label: "Insurance", done: insuranceOk },
    { key: "approved", label: "Approved", done: approved },
    { key: "pickup", label: "Pickup", done: pickedUp },
    { key: "active", label: "Active", done: active },
  ];
  let markedCurrent = false;
  const lifecycle: LifecycleStage[] = stageFlags.map((s) => {
    if (s.done) return { key: s.key, label: s.label, state: "done" };
    if (!markedCurrent) {
      markedCurrent = true;
      return { key: s.key, label: s.label, state: "current" };
    }
    return { key: s.key, label: s.label, state: "upcoming" };
  });
  const currentStage =
    lifecycle.find((s) => s.state === "current") ?? lifecycle[lifecycle.length - 1];
  const doneCount = lifecycle.filter((s) => s.state === "done").length;
  const percentComplete = Math.round((doneCount / lifecycle.length) * 100);

  // Time in current stage — best-effort from most relevant timestamp
  const stageStartIso =
    currentStage.key === "contacted"
      ? (driver.created_at as any)
      : currentStage.key === "screening"
        ? ((driver.contacted_at as any) ?? (driver.created_at as any))
        : currentStage.key === "docs"
          ? ((screening as any)?.interview_completed_at ?? (driver.created_at as any))
          : (driver.created_at as any);
  const timeInStage = stageStartIso
    ? formatDuration(Date.now() - new Date(stageStartIso).getTime())
    : undefined;

  // ---- Readiness -------------------------------------------------------
  //
  // One deterministic model over the application row, the screening row and
  // the document vault. This used to be a hand-written ladder here, which is
  // how the profile and the drivers list came to disagree about the same
  // applicant. Nothing is derived locally any more; if a rule needs changing
  // it changes in src/lib/readiness.ts and every surface follows.
  const readiness = useMemo(
    () => computeReadiness(driver, screening, vaultDocs),
    [driver, screening, vaultDocs],
  );

  // ---- Primary action -------------------------------------------------
  const approve = useServerFn(approveApplication);
  const closeRental = useServerFn(endRental);
  const [activateOpen, setActivateOpen] = useState(false);
  const [approving, setApproving] = useState(false);
  const [depositRentalId, setDepositRentalId] = useState<string | null>(null);
  const [activeRentalId, setActiveRentalId] = useState<string | null>(null);

  // The rental is what deposit disposition and ending hang off, so look it up
  // once the driver is active.
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("rentals")
      .select("id,status")
      .eq("application_id", driver.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setActiveRentalId((data?.id as string) ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [driver.id, driver.status]);

  async function doEndRental() {
    if (!activeRentalId) return;
    // Return Mileage: prefilled from a return inspection on this car, if one exists (one observation, not two).
    const { data: r } = await supabase.from("rentals").select("vehicle_id,start_date").eq("id", activeRentalId).maybeSingle();
    const { data: insp } = r?.vehicle_id
      ? await supabase.from("inspections").select("odometer").eq("vehicle_id", r.vehicle_id).eq("inspection_type", "return")
          .not("completed_at", "is", null).gte("completed_at", r.start_date ?? "1970-01-01").order("completed_at", { ascending: false }).limit(1).maybeSingle()
      : { data: null };
    const entered = window.prompt(
      "End this rental? The vehicle is released and any running automations stop.\n\nReturn Mileage (odometer now):",
      insp?.odometer != null ? String(insp.odometer) : "",
    );
    if (entered === null) return;
    const digits = entered.replace(/[^\d]/g, "");
    if (!digits && !confirm("End without recording Return Mileage?")) return;
    try {
      const res: any = await closeRental({ data: { rentalId: activeRentalId, vehicleStatus: "available", returnMileage: digits ? Number(digits) : null } });
      if (res && res.ok === false) { toast.error(res.error ?? "Could not end the rental"); return; }
      toast.success("Rental ended — settle the deposit next");
      setDepositRentalId(activeRentalId);
      onUpdate({ status: "closed" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not end the rental");
    }
  }

  // Approving and sending the contract used to be two separate manual steps,
  // so an approved driver could sit waiting on a contract nobody sent.
  async function approveAndSend() {
    setApproving(true);
    try {
      const res = await approve({ data: { id: driver.id } });
      if (!res.ok) throw new Error(res.error ?? "Could not approve");
      // Say what happened to the portal login too. Approval now creates the
      // driver's account, and whether they were emailed a set-password link is
      // the first thing anybody asks when the applicant says they can't get in.
      const portal =
        res.portalAccount === "created"
          ? " Portal invite emailed."
          : res.portalAccount === "existing"
            ? " They already have a portal login."
            : res.portalAccount === "conflict"
              ? " Portal login NOT linked: this application belongs to a different account. Check the email on file."
              : res.portalAccount === "failed"
                ? " Portal login could not be created — it will retry on activation."
                : "";
      if (res.agreementSent) {
        toast.success(`Approved — rental agreement sent for signature.${portal}`);
      } else {
        toast.success(
          `Approved. Agreement not sent: ${res.agreementSkippedReason ?? "unknown"}.${portal}`,
        );
      }
      onUpdate({ status: "approved" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not approve this driver");
    } finally {
      setApproving(false);
    }
  }

  const primaryAction = !screeningDone
    ? { label: "Continue Interview", onClick: () => setInterviewOpen(true), icon: ClipboardList }
    : !docsComplete
      ? {
          label: "Review Documents",
          onClick: () => setTab("documents"),
          icon: FileText,
        }
      : !insuranceOk
        ? {
            label: "Verify Insurance",
            onClick: () => setTab("screening"),
            icon: ShieldCheck,
          }
        : !approved
          ? {
              label: approving ? "Approving…" : "Approve & Send Contract",
              onClick: approveAndSend,
              icon: Check,
            }
          : driver.status !== "active"
            ? { label: "Activate Rental", onClick: () => setActivateOpen(true), icon: Car }
            : {
                label: "View Rental",
                onClick: () => setTab("rental"),
                icon: Car,
              };
  const PrimaryIcon = primaryAction.icon;

  // What to collect next, ordered by how much coverage each action unlocks.
  //
  // Every entry here opens a workflow that already exists on this page. There
  // is deliberately no generic "collect information" button: a gap the app
  // cannot act on is shown in Still Needed as text and nothing more, because a
  // button that does nothing is worse than no button.
  const readinessActions = useMemo(() => {
    // The tabs are controlled now, so a remedy selects one directly rather
    // than synthesising a click on its trigger.
    const open = (value: string) => () => setTab(value);
    const route: Partial<Record<Remedy, { label: string; onClick: () => void }>> = {
      interview: { label: "Complete Interview", onClick: () => setInterviewOpen(true) },
      request_document: { label: "Review Documents", onClick: open("documents") },
      verify: { label: "Verify Insurance", onClick: open("screening") },
      applicant: { label: "Review Driver Information", onClick: open("application") },
    };
    return nextActions(readiness).flatMap((g) => {
      const r = route[g.remedy];
      return r ? [{ ...r, coverageGain: g.coverageGain }] : [];
    });
  }, [readiness]);

  // Where the person is in the journey decides what Overview leads with.
  // Derived from the same flags the lifecycle rail uses — no new state.
  const phase: "screening" | "pickup" | "active" =
    driver.status === "active" ? "active" : approved ? "pickup" : "screening";

  const stageTargets: Partial<Record<string, () => void>> = {
    screening: () => setTab("screening"),
    docs: () => setTab("documents"),
    insurance: () => setTab("screening"),
    approved: () => setTab("application"),
    pickup: () => setTab("rental"),
    active: () => setTab("rental"),
  };

  const btnSecondary =
    "inline-flex items-center gap-1.5 rounded-md border border-[#EDEDF0] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#55555E] hover:border-[#C4C4CB] hover:text-[#111114] transition-colors";

  // Remedy buttons live inside Next Steps, beside the gap they close. The
  // header keeps the single primary CTA; anything it already covers is not
  // repeated as a red button here.
  const remedyActions: Record<string, React.ReactNode> = Object.fromEntries(
    readinessActions.map((a) => {
      const remedy =
        a.label === "Complete Interview"
          ? "interview"
          : a.label === "Review Documents"
            ? "request_document"
            : a.label === "Verify Insurance"
              ? "verify"
              : "applicant";
      return [
        remedy,
        <button key={a.label} onClick={a.onClick} className={btnSecondary}>
          {a.label}
        </button>,
      ];
    }),
  );

  // Real, timestamped events only — nothing inferred, nothing scheduled.
  const activity = useMemo(() => {
    const ev: { at: string; label: string; detail?: string }[] = [];
    const push = (at: unknown, label: string, detail?: string) => {
      if (typeof at === "string" && !Number.isNaN(new Date(at).getTime())) ev.push({ at, label, detail });
    };
    push(driver.created_at, "Application Submitted", driver.gclid ? "Google Ads" : driver.utm_source || undefined);
    push(driver.contacted_at, "Contacted");
    push((screening as any)?.created_at, "Screening Started");
    push((driver as any).documents_requested_at, "Documents Requested");
    for (const d of vaultDocs) {
      push(d.created_at, "Document Received", d.label || d.category.replace(/_/g, " "));
      if (d.reviewed_at && d.review_status !== "uploaded") {
        push(d.reviewed_at, d.review_status === "verified" ? "Document Verified" : "Replacement Requested", d.label || d.category.replace(/_/g, " "));
      }
    }
    push((driver as any).approved_at, "Approved");
    push((driver as any).agreement_signed_at, "Agreement Signed");
    push((driver as any).pickup_at, "Vehicle Picked Up");
    push((driver as any).return_at, "Vehicle Returned");
    return ev.sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 12);
  }, [driver, screening, vaultDocs]);

  const requirements: { ok: boolean; label: string }[] = [
    { ok: screeningDone, label: "Interview Complete" },
    { ok: docsComplete, label: `Documents ${vaultDocCount}/${REQUIRED_VAULT_CATEGORIES.length}` },
    { ok: !!driver.license_photo_url || !!driver.license_valid, label: "License Uploaded" },
    { ok: insuranceOk, label: "Insurance Verified" },
    { ok: !!(screening as any)?.mvr_authorized, label: "MVR Authorized" },
    { ok: !!driver.card_last4, label: "Card On File" },
    { ok: approved, label: "Approved" },
    { ok: !!(driver as any).agreement_signed_at, label: "Agreement Signed" },
    { ok: !!(driver as any).pickup_at, label: "Pickup Scheduled" },
  ];
  const reqDone = requirements.filter((r) => r.ok).length;

  const summaryRow = (
    <div className="grid gap-4 md:grid-cols-3">
      <SectionCard title="Driver Summary">
        <div className="space-y-2 text-[12px]">
          {driver.phone && (
            <div className="flex items-center gap-2 text-[#111114]">
              <Phone className="w-3.5 h-3.5 text-[#9A9AA3] shrink-0" /> {formatPhone(driver.phone)}
            </div>
          )}
          {driver.email && (
            <div className="flex items-center gap-2 text-[#111114] min-w-0">
              <Mail className="w-3.5 h-3.5 text-[#9A9AA3] shrink-0" /> <span className="truncate">{driver.email}</span>
            </div>
          )}
          {(driver.city || driver.state) && (
            <div className="flex items-center gap-2 text-[#111114]">
              <MapPin className="w-3.5 h-3.5 text-[#9A9AA3] shrink-0" />{" "}
              {[driver.city, driver.state].filter(Boolean).join(", ")}
            </div>
          )}
          <div className="flex items-center gap-2 text-[#55555E]">
            <Globe className="w-3.5 h-3.5 text-[#9A9AA3] shrink-0" />{" "}
            {driver.gclid ? "Google Ads" : driver.utm_source || "Direct"}
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Rental Need">
        <dl className="space-y-2 text-[12px]">
          <Row2
            label="Needed By"
            value={
              (screening as any)?.needed_by_date
                ? new Date((screening as any).needed_by_date).toLocaleDateString()
                : "—"
            }
          />
          <Row2
            label="Weekly Rate"
            value={driver.weekly_rent ? `$${Number(driver.weekly_rent).toLocaleString()}` : "$350"}
          />
          <Row2
            label="Drive Type"
            value={
              ((screening as any)?.drive_type as string | undefined)?.replace("_", " ") ??
              ((driver as any).drive_type as string | null)?.replace("_", " ") ??
              "—"
            }
          />
          <Row2
            label="Expected Duration"
            value={
              (driver as any).expected_duration
                ? (DURATION_LABEL[(driver as any).expected_duration as string] ??
                  ((driver as any).expected_duration as string))
                : "—"
            }
          />
          <Row2
            label="Current Vehicle"
            value={veh ? `${veh.year} ${veh.make} ${veh.model}` : "Unassigned"}
          />
        </dl>
      </SectionCard>

      {/* The one operational checklist. Replaces the separate Readiness
          Signals card and Requirements Checklist, which showed the same state twice. */}
      <SectionCard
        title="Rental Readiness"
        right={<span className="text-[11px] text-[#9A9AA3] tabular-nums">{reqDone}/{requirements.length}</span>}
      >
        <dl className="space-y-2 text-[12px]">
          {requirements.map((r) => (
            <SignalRow key={r.label} label={r.label} ok={r.ok} />
          ))}
        </dl>
      </SectionCard>
    </div>
  );

  const readinessCard = <ReadinessSummary result={readiness} remedyActions={remedyActions} />;

  const docsPreview = (
    <DocumentsStrip docs={vaultDocs} loading={vaultLoading} onOpen={() => setTab("documents")} />
  );

  const factsCard = (
    <SectionCard title="Driver Facts">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Fact
          label="Platforms"
          value={
            (driver.platforms?.length
              ? driver.platforms.join(", ")
              : (screening as any)?.gig_apps?.join(", ")) || "—"
          }
        />
        <Fact
          label="Trips"
          value={Number.isNaN(trips) || !driver.trips_completed ? "—" : trips.toLocaleString()}
        />
        <Fact label="Rating" value={driver.rating ? `${driver.rating}/5` : "—"} />
        <Fact label="Years Licensed" value={driver.years_licensed ?? "—"} />
        <Fact label="Weekly Hours" value={driver.weekly_hours ?? "—"} />
        <Fact label="Accidents (3y)" value={(screening as any)?.accidents_last_3yr ?? "—"} />
        <Fact label="License Points" value={(screening as any)?.license_points ?? "—"} />
        <Fact label="Card On File" value={driver.card_last4 ? `····${driver.card_last4}` : "Not Saved"} />
      </div>
    </SectionCard>
  );

  // Secondary actions not already the header CTA or a Next Steps button.
  const moreActions = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9A9AA3] mr-1">Actions</span>
      <button className={btnSecondary} onClick={() => setTab("documents")}>
        <FileText className="w-3.5 h-3.5" /> Request Documents
      </button>
      <button className={btnSecondary} onClick={() => setTab("screening")}>
        <ShieldCheck className="w-3.5 h-3.5" /> Verify Insurance
      </button>
      <button className={btnSecondary} onClick={() => setTab("rental")}>
        <Car className="w-3.5 h-3.5" /> Assign Vehicle
      </button>
      <button className={btnSecondary} onClick={() => setTab("notes")}>
        <FileText className="w-3.5 h-3.5" /> Add Note
      </button>
      {activeRentalId ? (
        <>
          <button className={btnSecondary} onClick={() => setDepositRentalId(activeRentalId)}>
            <Wallet className="w-3.5 h-3.5" /> Deposit Disposition
          </button>
          {driver.status === "active" ? (
            <button className={btnSecondary} onClick={doEndRental}>
              <Car className="w-3.5 h-3.5" /> End Rental
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );

  const activityCard = (
    <SectionCard title="Recent Activity">
      {activity.length === 0 ? (
        <p className="text-[12px] text-[#9A9AA3]">No recorded activity yet.</p>
      ) : (
        <ol className="space-y-2.5">
          {activity.map((e, i) => (
            <li key={`${e.at}-${i}`} className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 text-[12px]">
              <span className="text-[#9A9AA3] tabular-nums">
                {new Date(e.at).toLocaleDateString([], { month: "short", day: "numeric" })}
              </span>
              <span className="min-w-0 text-[#111114]">
                {e.label}
                {e.detail && <span className="text-[#9A9AA3] capitalize"> · {e.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );

  const tabs = [
    ["overview", "Overview"],
    ["application", "Application"],
    ["documents", "Documents"],
    ["screening", "Screening"],
    ["rental", "Rental"],
    ["payments", "Payments"],
    ["notes", "Notes"],
  ] as const;

  return (
    <div className="-m-4 md:-mx-8 md:-mt-4 md:-mb-8 min-h-full bg-[#FAFAFB] overflow-x-clip">
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        {/* Header + record navigation, sticky together */}
        <div className="sticky top-0 z-10 bg-[#FAFAFB] border-b border-[#EDEDF0] px-4 sm:px-8 pt-3 pb-3">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-[13px] text-[#55555E] hover:text-[#111114] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Drivers
          </button>
          {/* Identity: its own box, with the record tabs directly below it */}
          <div className="mt-3 rounded-xl border border-[#EDEDF0] bg-white p-4 shadow-[0_1px_2px_rgba(17,17,20,0.05)]">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex">

            <div className="flex min-w-0 flex-1 items-center gap-4">
              <div className="h-12 w-12 shrink-0 rounded-full bg-[#141416] text-white grid place-items-center text-[15px] font-semibold">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-[18px] font-semibold text-[#111114] truncate">
                    {driver.full_name || "Unnamed"}
                  </h2>
                  <StatusPill status={driver.status} />
                  {driver.gclid && (
                    <span className="text-[10px] font-semibold tracking-[0.04em] text-[#C68A12] bg-[rgba(240,192,64,0.08)] rounded px-1.5 py-0.5">
                      Google Ads
                    </span>
                  )}
                  {(driver.resubmission_count ?? 0) > 0 && (
                    <span className="text-[10px] font-semibold text-[#55555E] bg-[#F4F4F6] rounded px-1.5 py-0.5">
                      Merged {driver.resubmission_count} Duplicate
                      {driver.resubmission_count === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                <div className="mt-1 hidden sm:flex items-center gap-3 flex-wrap text-[12px] text-[#55555E]">
                  {(driver.city || driver.state) && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-[#9A9AA3]" />{" "}
                      {[driver.city, driver.state].filter(Boolean).join(", ")}
                    </span>
                  )}
                  {driver.phone && (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="w-3 h-3 text-[#9A9AA3]" /> {formatPhone(driver.phone)}
                    </span>
                  )}
                  {driver.email && (
                    <span className="inline-flex items-center gap-1 truncate max-w-[240px]">
                      <Mail className="w-3 h-3 text-[#9A9AA3]" /> {driver.email}
                    </span>
                  )}
                  {driver.created_at && (
                    <span className="text-[#9A9AA3]">
                      Applied {new Date(driver.created_at).toLocaleDateString()}
                    </span>
                  )}
                  {driver.contacted_at && (
                    <span className="text-[#9A9AA3]">
                      · Last Contact {new Date(driver.contacted_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              <button
                onClick={primaryAction.onClick}
                className="hidden sm:inline-flex items-center gap-1.5 rounded-md bg-[#D03020] text-white px-3.5 py-1.5 text-[12px] font-semibold hover:bg-[#B00000] transition-colors"
              >
                <PrimaryIcon className="w-3.5 h-3.5" strokeWidth={2} /> {primaryAction.label}
              </button>
              {driver.phone && (
                <a
                  href={`tel:${driver.phone}`}
                  className="hidden sm:inline-flex items-center justify-center h-8 w-8 rounded-md text-[#55555E] hover:text-[#111114] hover:bg-[#F4F4F6] transition-colors"
                  title="Call"
                  aria-label="Call"
                >
                  <Phone className="w-3.5 h-3.5" />
                </a>
              )}
              {driver.phone && (
                <a
                  href={smsHref(driver.phone)}
                  className="hidden sm:inline-flex items-center justify-center h-8 w-8 rounded-md text-[#55555E] hover:text-[#111114] hover:bg-[#F4F4F6] transition-colors"
                  title="Text"
                  aria-label="Text"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                </a>
              )}
              {driver.email && (
                <a
                  href={`mailto:${driver.email}`}
                  className="hidden sm:inline-flex items-center justify-center h-8 w-8 rounded-md text-[#55555E] hover:text-[#111114] hover:bg-[#F4F4F6] transition-colors"
                  title="Email"
                  aria-label="Email"
                >
                  <Mail className="w-3.5 h-3.5" />
                </a>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger aria-label="More actions" className="h-8 w-8 inline-flex items-center justify-center rounded-md text-[#55555E] hover:text-[#111114] hover:bg-[#F4F4F6] transition-colors">
                  <MoreVertical className="w-4 h-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {driver.phone && (
                    <DropdownMenuItem className="sm:hidden" onClick={() => (window.location.href = `tel:${driver.phone}`)}>
                      <Phone className="w-4 h-4 mr-2" /> Call
                    </DropdownMenuItem>
                  )}
                  {driver.email && (
                    <DropdownMenuItem className="sm:hidden" onClick={() => (window.location.href = `mailto:${driver.email}`)}>
                      <Mail className="w-4 h-4 mr-2" /> Email
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem title="Open In Messages" aria-label="Open In Messages" onClick={() => window.dispatchEvent(new CustomEvent("open-messages", { detail: { applicationId: driver.id } }))}>
                    <MessageSquare className="w-4 h-4 mr-2" /> Messages
                  </DropdownMenuItem>
                  <DropdownMenuItem title="Edit Interview" aria-label="Edit Interview" onClick={() => setInterviewOpen(true)}>
                    <ClipboardList className="w-4 h-4 mr-2" /> Interview
                  </DropdownMenuItem>
                  <RequestDocumentsAction driver={driver} onUpdate={onUpdate} />
                  <ReissueLinkAction applicationId={driver.id} />
                  <CardOnFileActions driver={driver} onUpdate={onUpdate} />
                  <DropdownMenuItem
                    className="text-[#D03020] focus:text-[#D03020]"
                    onClick={onDelete}
                  >
                    <Trash2 className="w-4 h-4 mr-2" /> Delete Driver
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            </div>
            {/* Mobile primary action: full width under identity */}
            <div className="pt-3 sm:hidden">
              <button
                onClick={primaryAction.onClick}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-[#D03020] text-white px-3.5 py-2 text-[13px] font-semibold"
              >
                <PrimaryIcon className="w-3.5 h-3.5" strokeWidth={2} /> {primaryAction.label}
              </button>
            </div>
          </div>
          {/* Primary record navigation: one button per tab, below the identity box */}
          <div className="mt-3 overflow-x-auto [scrollbar-width:none]">

            <TabsList className="h-auto bg-transparent p-0 gap-2 rounded-none flex w-max">
              {tabs.map(([value, label]) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  id={`tab-${value}`}
                  className="rounded-lg border border-[#E4E4E9] bg-white px-3.5 py-1.5 text-[12px] font-medium text-[#55555E] shadow-none transition-colors hover:border-[#C9C9D2] hover:text-[#111114] data-[state=active]:border-[#111114] data-[state=active]:bg-[#111114] data-[state=active]:text-white data-[state=active]:shadow-none"
                >
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>

          </div>
        </div>

        <div className="px-4 sm:px-8 py-6 max-w-[1400px]">
              <TabsContent value="overview" className="mt-0 space-y-5">
                <LifecycleRail
                  stages={lifecycle}
                  percent={percentComplete}
                  timeInStage={timeInStage}
                  blocker={readiness.disqualifiers[0]}
                  onStageClick={stageTargets}
                />
                {phase === "screening" ? (
                  <>
                    {readinessCard}
                    {summaryRow}
                    {docsPreview}
                  </>
                ) : (
                  <>
                    {summaryRow}
                    {docsPreview}
                    {readinessCard}
                  </>
                )}
                {moreActions}
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
                  {factsCard}
                  {activityCard}
                </div>
              </TabsContent>

              <TabsContent value="documents" className="mt-0 space-y-4">
                <AgreementsCard applicationId={driver.id} />
                <SectionCard
                  title="Documents"
                  subtitle="Everything this applicant sent us. Shared with the driver unless marked team only."
                  padded={false}
                >
                  <div className="p-5">
                    {/* One view over the document vault. It used to be three
                        stacked surfaces — the vault as a text list, a card
                        backed by a different table, and two one-off cards
                        reading the raw application columns — so the same
                        licence could appear three times with different
                        controls and the insurance document appeared nowhere. */}
                    <ApplicantDocuments
                      applicationId={driver.id}
                      docs={vaultDocs}
                      loading={vaultLoading}
                      onRefresh={refreshVault}
                    />
                  </div>
                </SectionCard>
              </TabsContent>

              <TabsContent value="screening" className="mt-0 space-y-4">
                <ScreeningPipeline
                  screening={screening}
                  docCount={vaultDocCount}
                  hasRecording={hasRecording}
                  onAdvance={advanceStatus}
                />
                <InsuranceVerificationCard
                  leadId={driver.id}
                  screening={screening}
                  isOwner={isOwner}
                  onScreening={(s) => {
                    setScreening(s);
                    onScreeningChange?.(s);
                  }}
                  onRecordingChange={setHasRecording}
                />
                <AISnapshotCard driver={driver} />
              </TabsContent>

              <TabsContent value="application" className="mt-0 space-y-4">
                <Card title="Driver Info" icon={<UserIcon className="w-4 h-4" />}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <Field label="DOB" value={driver.dob} />
                    <Field label="License #" value={driver.license_number} />
                    <Field label="License State" value={driver.license_state} />
                    <Field label="License exp." value={driver.license_expiration} />
                    <Field label="Years Licensed" value={driver.years_licensed} />
                    <Field
                      label="Address"
                      value={
                        [driver.address, driver.city, driver.state, driver.zip]
                          .filter(Boolean)
                          .join(", ") || null
                      }
                    />
                    <Field label="Platforms" value={driver.platforms?.join(", ") || null} />
                    <Field label="Weekly Hours" value={driver.weekly_hours} />
                    <Field label="Term" value={driver.rental_term} />
                    <Field label="Payment Method" value={driver.payment_method} />
                  </div>
                </Card>
                <Card title="Status & Compliance" icon={<ShieldCheck className="w-4 h-4" />}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <SelField
                      label="Driver Status"
                      value={driver.status}
                      options={[...DRIVER_STATUSES]}
                      onChange={(v) => onUpdate({ status: v })}
                    />
                    <SelField
                      label="Deposit Status"
                      value={driver.deposit_status}
                      options={[...DEPOSIT_STATUSES]}
                      onChange={(v) => onUpdate({ deposit_status: v })}
                    />
                    <SelField
                      label="Payment Status"
                      value={driver.payment_status}
                      options={[...PAYMENT_STATUSES]}
                      onChange={(v) => onUpdate({ payment_status: v })}
                    />
                    <SelField
                      label="Background Check"
                      value={driver.background_check_status}
                      options={[...CHECK_STATUSES]}
                      onChange={(v) => onUpdate({ background_check_status: v })}
                    />
                    <SelField
                      label="MVR Status"
                      value={driver.mvr_status}
                      options={[...CHECK_STATUSES]}
                      onChange={(v) => onUpdate({ mvr_status: v })}
                    />
                    <NumField
                      label="Incident Count"
                      value={driver.incident_count}
                      onSave={(v) => onUpdate({ incident_count: v ?? 0 })}
                    />
                  </div>
                </Card>
                <Card
                  title="Attribution"
                  icon={
                    driver.gclid ? (
                      <BadgeDollarSign className="w-4 h-4" />
                    ) : (
                      <Globe className="w-4 h-4" />
                    )
                  }
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <Field
                      label="Source"
                      value={driver.gclid ? "Google Ads" : "Organic / Direct"}
                    />
                    <Field label="utm_source" value={driver.utm_source} />
                    <Field label="utm_medium" value={driver.utm_medium} />
                    <Field label="utm_campaign" value={driver.utm_campaign} />
                    <Field label="Landing Page" value={driver.landing_page} />
                    <Field label="Referrer" value={driver.referrer} />
                  </div>
                </Card>
              </TabsContent>

              <TabsContent value="rental" className="mt-0">
                <Card title="Assigned Vehicle" icon={<Car className="w-4 h-4" />}>
                  <div className="rounded-lg border border-[#EDEDF0] bg-[#FAFAFB] p-4 mb-3">
                    {veh ? (
                      <div>
                        <div className="text-[15px] font-semibold text-[#111114]">
                          {veh.year} {veh.make} {veh.model}
                          {veh.trim ? ` ${veh.trim}` : ""}
                        </div>
                        <div className="text-[11px] text-[#55555E] mt-1">
                          {[veh.body_type, veh.fuel_type, veh.status].filter(Boolean).join(" · ")} ·
                          ID {veh.id.slice(0, 8)}
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

              <TabsContent value="payments" className="mt-0 space-y-4">
                <Card title="Payment Terms" icon={<CreditCard className="w-4 h-4" />}>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <NumField
                      label="Deposit Amount ($)"
                      value={driver.deposit_amount as any}
                      onSave={(v) => onUpdate({ deposit_amount: v as any })}
                    />
                    <NumField
                      label="Deposit Paid ($)"
                      value={driver.deposit_paid as any}
                      onSave={(v) => onUpdate({ deposit_paid: v as any })}
                    />
                    <NumField
                      label="Weekly Rent ($)"
                      value={driver.weekly_rent as any}
                      onSave={(v) => onUpdate({ weekly_rent: v as any })}
                    />
                  </div>
                </Card>
                <Card title="Contract Dates" icon={<CalendarDays className="w-4 h-4" />}>
                  {/* These are the agreement's dates, and only these. What the
                      applicant told us — their desired start and how long they
                      expect to need the car — is shown alongside as context,
                      never copied in. An estimate typed on a marketing page is
                      not a term somebody should be asked to sign. */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <DateField
                      label="Contract Start"
                      value={(driver as any).contract_start_date ?? null}
                      onSave={(v) => onUpdate({ contract_start_date: v } as any)}
                    />
                    <DateField
                      label="Scheduled End"
                      value={(driver as any).contract_end_date ?? null}
                      onSave={(v) => onUpdate({ contract_end_date: v } as any)}
                    />
                  </div>
                  <p className="text-[11px] text-[#9A9AA3] mt-2">
                    They asked to start{" "}
                    <span className="font-medium text-[#55555E]">
                      {driver.pickup_date
                        ? new Date(driver.pickup_date).toLocaleDateString()
                        : "— no date given"}
                    </span>
                    {(driver as any).expected_duration
                      ? ` and expect to need the vehicle for ${DURATION_LABEL[(driver as any).expected_duration as string] ?? (driver as any).expected_duration}`
                      : ""}
                    . Agree the real dates with them before sending an agreement — it will not send
                    without both.
                  </p>
                </Card>
                <Card title="Driver Address" icon={<MapPin className="w-4 h-4" />}>
                  {/* The agreement names the driver's address, and Part 1 no
                      longer asks for it — by design, it is contract
                      information rather than lead capture. Part 2 collects it
                      when the applicant gets that far; when they do not, this
                      is where staff put what the driver confirms on the call.
                      Without it the agreement will not generate, and before
                      this card existed there was nowhere in the back office to
                      enter it. */}
                  <TxtField
                    label="Street Address"
                    value={driver.address ?? null}
                    onSave={(v) => onUpdate({ address: v } as any)}
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                    <TxtField
                      label="City"
                      value={driver.city ?? null}
                      onSave={(v) => onUpdate({ city: v } as any)}
                    />
                    <TxtField
                      label="State"
                      value={driver.state ?? null}
                      onSave={(v) => onUpdate({ state: v } as any)}
                    />
                    <TxtField
                      label="ZIP"
                      value={driver.zip ?? null}
                      onSave={(v) => onUpdate({ zip: v } as any)}
                    />
                    <TxtField
                      label="Phone"
                      value={driver.phone ?? null}
                      onSave={(v) => onUpdate({ phone: v } as any)}
                    />
                    <TxtField
                      label="License #"
                      value={driver.license_number ?? null}
                      onSave={(v) => onUpdate({ license_number: v } as any)}
                    />
                    <TxtField
                      label="License State"
                      value={driver.license_state ?? null}
                      onSave={(v) => onUpdate({ license_state: v } as any)}
                    />
                    <TxtField
                      label="License Exp. (YYYY-MM-DD)"
                      value={driver.license_expiration ?? null}
                      onSave={(v) => onUpdate({ license_expiration: v } as any)}
                    />
                  </div>
                  <p className="text-[11px] text-[#9A9AA3] mt-2">
                    Must match the address on their licence. Never fill this in from a guess.
                  </p>
                </Card>
                <CardOnFileCard driver={driver} onUpdate={onUpdate} />
              </TabsContent>

              <TabsContent value="notes" className="mt-0">
                <Card title="Internal Notes" icon={<FileText className="w-4 h-4" />}>
                  <textarea
                    defaultValue={driver.notes || ""}
                    rows={6}
                    placeholder="Add internal notes about this driver…"
                    onBlur={(e) => onUpdate({ notes: e.target.value })}
                    className="w-full border border-[#EDEDF0] rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#D03020]/15"
                  />
                  <p className="text-[11px] text-[#9A9AA3] mt-2">
                    Saved automatically when you click away.
                  </p>
                </Card>
              </TabsContent>
        </div>
      </Tabs>

      <InterviewDrawer
        open={interviewOpen}
        onOpenChange={setInterviewOpen}
        driver={driver}
        screening={screening}
        onSaved={(next) => {
          setScreening(next);
          onScreeningChange?.(next);
        }}
      />

      {depositRentalId ? (
        <DepositDialog rentalId={depositRentalId} onClose={() => setDepositRentalId(null)} />
      ) : null}

      {activateOpen ? (
        <ActivateRentalDialog
          driver={driver}
          vehicles={vehicles}
          onClose={() => setActivateOpen(false)}
          onActivated={() => {
            setActivateOpen(false);
            onUpdate({ status: "active" });
          }}
        />
      ) : null}
    </div>
  );
}

function Row2({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[#9A9AA3]">{label}</dt>
      <dd className="font-medium text-[#111114] text-right truncate max-w-[180px]">
        {value ?? "—"}
      </dd>
    </div>
  );
}
function SignalRow({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[#55555E] inline-flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-[#50C060]" : "bg-[#C4C4CB]"}`} />
        {label}
      </dt>
      <dd
        className={`text-[11px] font-medium tabular-nums ${ok ? "text-[#50C060]" : "text-[#9A9AA3]"}`}
      >
        {detail ?? (ok ? "Ready" : "Pending")}
      </dd>
    </div>
  );
}
function QuickAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: any;
  label: string;
  onClick: () => void;
}) {
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
    <li
      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-[12px] ${
        ok
          ? "border-[#EDEDF0] bg-[#FAFAFB] text-[#111114]"
          : "border-[#EDEDF0] bg-white text-[#55555E]"
      }`}
    >
      <span
        className={`h-4 w-4 rounded-full grid place-items-center ${ok ? "bg-[#50C060] text-white" : "bg-[#F4F4F6] text-[#9A9AA3]"}`}
      >
        {ok ? (
          <Check className="w-2.5 h-2.5" strokeWidth={3} />
        ) : (
          <span className="text-[8px]">·</span>
        )}
      </span>
      {label}
    </li>
  );
}

function Card({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
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

function StatCard({
  icon,
  label,
  value,
  hint,
  hintTone,
  muted,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint?: string;
  hintTone?: "good" | "warn";
  muted?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-white p-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div
        className={`mt-2 text-lg font-semibold truncate ${muted ? "text-muted-foreground" : ""}`}
      >
        {value}
      </div>
      {hint && (
        <div
          className={`mt-1 text-[11px] ${hintTone === "good" ? "text-emerald-700" : "text-amber-700"}`}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

function SidebarStat({
  icon,
  label,
  value,
  tone,
  muted,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone?: "good" | "warn";
  muted?: boolean;
}) {
  const toneCls = tone === "good" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : "";
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="inline-flex items-center gap-2 text-xs text-muted-foreground">
        <span className="text-muted-foreground">{icon}</span>
        {label}
      </dt>
      <dd
        className={`text-xs font-medium text-right truncate ${muted ? "text-muted-foreground" : toneCls || "text-foreground"}`}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * The AI second opinion, read-only.
 *
 * Re-scoring used to write ai_score, ai_tier, ai_flags and ai_summary back to
 * the applications row from here, on the staff member's own session. It was a
 * duplicate — runScoring has already persisted exactly those values server-side
 * by the time the call returns — and it was a second write path into columns
 * whose whole point is that nothing reaches them without passing the
 * assessment guard. The fresh result is now held locally for display and the
 * database copy is the server's alone.
 */
function AISnapshotCard({ driver }: { driver: Application }) {
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<{
    score: number;
    tier: string;
    flags: string[];
    summary: string;
  } | null>(null);
  const rescore = useServerFn(scoreApplication);
  const storedFlags = Array.isArray(driver.ai_flags) ? (driver.ai_flags as string[]) : [];
  const flags = fresh ? fresh.flags : storedFlags;
  const summary = fresh ? fresh.summary : driver.ai_summary;
  const scoredAt = fresh ? new Date() : driver.scored_at ? new Date(driver.scored_at) : null;
  const score = fresh ? fresh.score : typeof driver.ai_score === "number" ? driver.ai_score : null;
  const tier = fresh ? fresh.tier : (driver.ai_tier as string | null | undefined);
  const tierGrad =
    tier === "hot"
      ? "from-red-500 to-orange-500"
      : tier === "warm"
        ? "from-amber-400 to-yellow-500"
        : tier === "cold"
          ? "from-slate-400 to-slate-500"
          : "from-slate-200 to-slate-300";
  async function run() {
    setBusy(true);
    try {
      const res = await rescore({ data: { id: driver.id } });
      if (res && (res as any).ok !== false) {
        const r = res as any;
        setFresh({
          score: r.score,
          tier: r.tier,
          flags: Array.isArray(r.flags) ? r.flags : [],
          summary: typeof r.summary === "string" ? r.summary : "",
        });
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
    <div className="rounded-xl border border-[#EDEDF0] bg-white px-4 py-3 flex items-center gap-4">
      <div className="shrink-0 flex items-center gap-2.5">
        <span
          className={`h-8 w-8 rounded-full bg-gradient-to-br ${tierGrad} grid place-items-center text-white text-[11px] font-bold tabular-nums`}
        >
          {score ?? "—"}
        </span>
        <div className="leading-tight">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9A9AA3]">
            AI Score
          </div>
          <div className="text-[12px] font-semibold text-[#111114] capitalize">
            {tier ?? "Unscored"}
          </div>
        </div>
      </div>
      <div className="min-w-0 flex-1 flex items-center gap-2">
        <Sparkles className="w-3.5 h-3.5 text-[#D03020] shrink-0" />
        <p className="text-[12px] text-[#55555E] leading-snug truncate">
          {summary ||
            "Not yet scored. Run the AI review to grade trips, rating, license, and screenshots."}
        </p>
        {flags.length > 0 && (
          <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-red-50 text-red-800 border border-red-200">
            <AlertTriangle className="w-3 h-3" /> {flags.length}
          </span>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-2">
        {scoredAt && (
          <span className="hidden sm:block text-[11px] text-[#9A9AA3]">
            {scoredAt.toLocaleDateString()}
          </span>
        )}
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
function SelField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="bg-soft rounded-md px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 bg-white text-foreground">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o.replace(/_/g, " ")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
function NumField({
  label,
  value,
  onSave,
}: {
  label: string;
  value: number | null;
  onSave: (v: number | null) => void;
}) {
  return (
    <div className="bg-soft rounded-md px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <input
        type="number"
        defaultValue={value ?? ""}
        onBlur={(e) => onSave(e.target.value === "" ? null : Number(e.target.value))}
        className="w-full bg-white border border-border rounded-md px-2 py-1 text-sm"
      />
    </div>
  );
}
function TxtField({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string | null;
  onSave: (v: string | null) => void;
}) {
  return (
    <div className="bg-soft rounded-md px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <input
        type="text"
        defaultValue={value ?? ""}
        onBlur={(e) => onSave(e.target.value.trim() || null)}
        className="w-full bg-white border border-border rounded-md px-2 py-1 text-sm"
      />
    </div>
  );
}

function DateField({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string | null;
  onSave: (v: string | null) => void;
}) {
  return (
    <div className="bg-soft rounded-md px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <input
        type="date"
        defaultValue={value ?? ""}
        onBlur={(e) => onSave(e.target.value || null)}
        className="w-full bg-white border border-border rounded-md px-2 py-1 text-sm"
      />
    </div>
  );
}

/** How the applicant's duration band reads to a person. */
const DURATION_LABEL: Record<string, string> = {
  // Current vocabulary.
  "1_month": "1 month",
  "2_months": "2 months",
  "3_months": "3 months",
  "4plus_months": "4+ months",
  not_sure: "a period they weren't sure of yet",
  // Historical. Applications answered before the options changed still read
  // the way the applicant meant them; nothing was rewritten.
  "1-2_weeks": "1–2 weeks",
  "3-4_weeks": "3–4 weeks",
  "1-2_months": "1–2 months",
  "2plus_months": "2+ months",
  ongoing: "an open-ended period",
};

function VehiclePicker({
  vehicles,
  value,
  onChange,
}: {
  vehicles: Vehicle[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [make, setMake] = useState<string>("all");
  const [body, setBody] = useState<string>("all");
  const [fuel, setFuel] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");

  const selected = value ? vehicles.find((v) => v.id === value) : null;

  const uniq = (arr: (string | null | undefined)[]) =>
    Array.from(new Set(arr.filter((x): x is string => !!x))).sort();
  const makes = useMemo(() => uniq(vehicles.map((v) => v.make)), [vehicles]);
  const bodies = useMemo(() => uniq(vehicles.map((v) => v.body_type)), [vehicles]);
  const fuels = useMemo(() => uniq(vehicles.map((v) => v.fuel_type)), [vehicles]);
  const statuses = useMemo(() => uniq(vehicles.map((v) => v.status)), [vehicles]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return vehicles.filter((v) => {
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
          {selected
            ? `${selected.year} ${selected.make} ${selected.model}${selected.trim ? " " + selected.trim : ""}`
            : "Assign Vehicle"}
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
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-soft rounded flex items-center gap-2 text-muted-foreground"
              >
                {!value && <Check className="w-3.5 h-3.5" />} — None —
              </button>
              {filtered.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => {
                    onChange(v.id);
                    setOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-soft rounded flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    {value === v.id && <Check className="w-3.5 h-3.5 shrink-0" />}
                    <span className="truncate">
                      {v.year} {v.make} {v.model}
                      {v.trim ? ` ${v.trim}` : ""}
                    </span>
                  </span>
                  <span className="text-[10px] text-muted-foreground shrink-0 capitalize">
                    {[v.body_type, v.fuel_type, v.status].filter(Boolean).join(" · ")}
                  </span>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                  No matches
                </div>
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

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 text-xs bg-white border border-border rounded px-1.5 capitalize"
    >
      <option value="all">{label}: all</option>
      {options.map((o) => (
        <option key={o} value={o} className="capitalize">
          {o}
        </option>
      ))}
    </select>
  );
}

/**
 * Kill every live application link and hand back a fresh one.
 *
 * Resume tokens are stored hashed, so nobody — us included — can recover a
 * link once it has gone out. That makes "they lost the email" and "that link
 * ended up somewhere it shouldn't" the same operation: revoke, mint, send.
 */
function ReissueLinkAction({ applicationId }: { applicationId: string }) {
  const reissue = useServerFn(reissueApplicantLink);
  const [busy, setBusy] = useState(false);
  return (
    <DropdownMenuItem
      onSelect={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        try {
          const res = await reissue({ data: { id: applicationId } });
          await navigator.clipboard.writeText(res.url).catch(() => {});
          toast.success(
            res.revoked
              ? `New link copied. ${res.revoked} older ${res.revoked === 1 ? "link" : "links"} revoked.`
              : "New link copied.",
          );
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Could not reissue the link");
        } finally {
          setBusy(false);
        }
      }}
    >
      <LinkIcon className="w-4 h-4 mr-2" /> {busy ? "Reissuing…" : "Copy Link"}
    </DropdownMenuItem>
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
        <DropdownMenuTrigger className="w-full inline-flex items-center rounded-sm px-2 py-1.5 text-sm outline-none text-[#111114] hover:bg-[#F4F4F6] focus:bg-[#F4F4F6] transition-colors cursor-pointer">
          <CreditCard className="w-4 h-4 mr-2" />
          {hasCard ? `Card ····${driver.card_last4}` : "Card On File"}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {hasCard && (
            <DropdownMenuItem onClick={() => setChargeOpen(true)}>
              <CreditCard className="w-4 h-4 mr-2" /> Charge Card…
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={copyLink}>
            <Copy className="w-4 h-4 mr-2" /> Copy Card-On-File Link
          </DropdownMenuItem>
          {driver.phone && (
            <DropdownMenuItem asChild>
              <a
                href={`sms:${driver.phone}?&body=${encodeURIComponent(`Save your card on file for Real Rentals: ${link}`)}`}
              >
                <MessageSquare className="w-4 h-4 mr-2" /> Text link to driver
              </a>
            </DropdownMenuItem>
          )}
          {driver.email && (
            <DropdownMenuItem asChild>
              <a
                href={`mailto:${driver.email}?subject=${encodeURIComponent("Save your card on file")}&body=${encodeURIComponent(`Save your card on file for Real Rentals: ${link}`)}`}
              >
                <Mail className="w-4 h-4 mr-2" /> Email link to driver
              </a>
            </DropdownMenuItem>
          )}
          {hasCard && (
            <DropdownMenuItem className="text-real-red focus:text-real-red" onClick={remove}>
              <Trash2 className="w-4 h-4 mr-2" /> Remove Card
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
        data: {
          rentalId,
          amountCents: cents,
          reason,
          note: note || undefined,
          environment: getStripeEnvironment(),
        },
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
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-1">Charge Card on File</h2>
        <p className="text-xs text-muted-foreground mb-4">
          {driver.card_brand} ····{driver.card_last4} — {driver.full_name}
        </p>
        {!rentalId && (
          <p className="text-xs text-real-red mb-3">No active rental linked to this driver.</p>
        )}
        <div className="space-y-3 text-sm">
          <label className="block text-xs">
            Amount (USD)
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-soft rounded-md px-3 py-2 mt-1"
              placeholder="0.00"
              autoFocus
            />
          </label>
          <label className="block text-xs">
            Reason
            <Select value={reason} onValueChange={(v) => setReason(v as ChargeReason)}>
              <SelectTrigger className="bg-white text-foreground mt-1">
                <SelectValue />
              </SelectTrigger>
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
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full bg-soft rounded-md px-3 py-2 mt-1"
              placeholder="Toll from 3/12 SunPass"
            />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || !rentalId}
            className="rounded-lg bg-real-red text-white px-4 py-2 text-sm disabled:opacity-50"
          >
            {busy ? "Charging…" : "Charge Card"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AutopayActions({ driver }: { driver: any }) {
  const [rental, setRental] = useState<{
    id: string;
    autopay_active: boolean;
    weekly_rate: number | null;
  } | null>(null);
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
  useEffect(() => {
    refresh();
  }, [driver.id]);

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
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-soft disabled:opacity-50 ${
        active ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-border bg-white"
      }`}
    >
      <Wallet className="w-3.5 h-3.5" />
      {busy ? "Working…" : active ? "Autopay On" : "Start Autopay"}
    </button>
  );
}

function CardOnFileCard({
  driver,
  onUpdate: _onUpdate,
}: {
  driver: any;
  onUpdate: (p: any) => void;
}) {
  const link = cardLinkFor(driver.id);
  const hasCard = !!driver.card_last4;
  return (
    <div className="rounded-xl border border-border bg-white p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Card On File
        </div>
        {hasCard ? (
          <Badge
            variant="secondary"
            className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 text-[10px]"
          >
            Saved
          </Badge>
        ) : (
          <Badge
            variant="secondary"
            className="bg-gray-100 text-gray-700 hover:bg-gray-100 text-[10px]"
          >
            Not On File
          </Badge>
        )}
      </div>
      {hasCard ? (
        <div className="space-y-1.5 text-sm">
          <div className="capitalize font-medium">
            {driver.card_brand} ····{driver.card_last4}
          </div>
          {driver.card_exp_month && driver.card_exp_year && (
            <div className="text-xs text-muted-foreground">
              Expires {String(driver.card_exp_month).padStart(2, "0")}/
              {String(driver.card_exp_year).slice(-2)}
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
  { key: "other", label: "Other (Specify Below)" },
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
      if (next.has(k)) next.delete(k);
      else next.add(k);
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
        className="w-full inline-flex items-center rounded-sm px-2 py-1.5 text-sm outline-none text-[#111114] hover:bg-[#F4F4F6] focus:bg-[#F4F4F6] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
              Select what's needed. We'll email {driver.email} with a checklist and a link back to
              their application.
            </p>
            {DOC_ITEMS.map((it) => (
              <label
                key={it.key}
                className="flex items-start gap-2.5 rounded-md border border-border p-2.5 cursor-pointer hover:bg-soft"
              >
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
