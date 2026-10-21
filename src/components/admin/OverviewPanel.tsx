import { createRevenueBoundary, type RevenueSession } from "@/lib/revenue-state";
import { tierFromRoles, tierAllows } from "@/lib/roles";
import LeadPriorities from "./LeadPriorities";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { displayPersonName } from "@/lib/display-normalize";
import {
  Car,
  CreditCard,
  Wrench,
  ArrowUpRight,
  Plus,
  CheckCircle2,
  ChevronDown,
  TrendingUp,
  Receipt,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";
import { SectionCard, MicroLabel, StatusPill, ReadinessStatePill } from "./ui";
import { compareReadiness, selectHotProspects, type ReadinessResult } from "@/lib/readiness";
import { isRevenuePayment, readEveryPage, revenuePaymentsSearch, summarizePayments, type RefundLink, type ReportingPayment } from "@/lib/payment-reporting";
import { summarizeFleet, type FleetSummary } from "@/lib/fleet-summary";
import { getOverviewApplicants } from "@/lib/admin-overview.functions";
import {
  type OverviewApplicantRow,
} from "@/lib/admin-overview";
import { useServerFn } from "@tanstack/react-start";
import { getFleetMaintenance } from "@/lib/maintenance.functions";
import { applicationStage, wizardProgress } from "@/lib/application-stage";

/**
 * How many applicants the dashboard pulls in to derive readiness from.
 *
 * Readiness is computed, not stored, so "who is a Hot Prospect" cannot be a
 * WHERE clause. This bounds the work instead. Raise it, or move to a
 * projection built from the same module, when the pipeline outgrows it — do
 * not add a cached column, which is how the old score came to disagree with
 * the data it was derived from.
 */

type ApplicantRow = OverviewApplicantRow;
import {
  RANGE_LABELS,
  resolveRange,
  priorRange,
  describeRange,
  type RangeKey,
  type DayRange,
} from "@/lib/date-range";
import { fmtDate } from "@/lib/date-format";
import type React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getStripeCollections } from "@/lib/stripe-collections.functions";
import { useNavigate } from "@tanstack/react-router";
import { DocumentsExpiringChip } from "./DocumentsExpiring";
import { stripeCollectionsQuery } from "@/lib/stripe-collections-query";
import { COLLECTIONS_WATCH_STATUSES } from "@/lib/collections-watch";

type WeekPoint = { label: string; iso: string; collected: number; billed: number };

/**
 * What counts as collections.
 *
 * Money that was due and did not arrive. Not the same as "unpaid": the old
 * figure summed every row whose status was not 'paid', which swept in
 * invoices that are simply not due yet and showed them as outstanding debt.
 */
function usd(n: number | undefined | null) {
  if (n == null) return "—";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}
function timeAgo(iso?: string | null) {
  if (!iso) return "—";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
function initials(name?: string | null) {
  const parts = (name || "?").trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}
function shortDate(iso?: string | null) {
  if (!iso) return "—";
  return fmtDate(iso);
}
/**
 * How long ago the person applied, counted in whole calendar days so an
 * application filed at 11pm still reads "Today" a few minutes later and
 * "Yesterday" the next morning.
 */
export function OverviewPanel({ canSeeCollections = false }: { canSeeCollections?: boolean }) {
  const client=useQueryClient();
  const [boundary,setBoundary]=useState<RevenueSession>({epoch:0,ready:false,collections:false});
  useEffect(()=>{
    let currentUser:string|null=null;
    const gate=createRevenueBoundary(async userId=>{
      const {data,error}=await supabase.from("user_roles").select("role").eq("user_id",userId);
      if(error || !data) throw new Error("Revenue authorization unavailable");
      const tier=tierFromRoles(data.map(r=>r.role));
      return {allowed:!!tier,collections:tierAllows(tier,"manager")};
    },()=>{void client.cancelQueries({queryKey:["stripe-collections"]});client.removeQueries({queryKey:["stripe-collections"]});},setBoundary);
    const ticket=gate.ticket();
    const {data:subscription}=supabase.auth.onAuthStateChange((_event,session)=>{
      currentUser=session?.user.id??null;gate.change(currentUser);
    });
    void supabase.auth.getSession().then(({data})=>{
      if(gate.ticket()===ticket){currentUser=data.session?.user.id??null;gate.change(currentUser);}
    }).catch(()=>{if(gate.ticket()===ticket)gate.change(null);});
    const recheck=()=>gate.change(currentUser);
    window.addEventListener("focus",recheck);
    return ()=>{subscription.subscription.unsubscribe();window.removeEventListener("focus",recheck);gate.dispose();};
  },[client]);
  if(!boundary.ready) return <div role="status">Revenue and overview unavailable until current access is verified.</div>;
  return <OverviewContent key={`${boundary.epoch}:${canSeeCollections}`} canSeeCollections={canSeeCollections && boundary.collections} />;
}

function OverviewContent({ canSeeCollections = false }: { canSeeCollections?: boolean }) {
  const [fleet, setFleet] = useState<FleetSummary>(() => summarizeFleet([]));
  const [overdueCount, setOverdueCount] = useState(0);
  const [overdueRenters, setOverdueRenters] = useState(0);
  const [overdueAmt, setOverdueAmt] = useState(0);
  const [weekly, setWeekly] = useState<WeekPoint[]>([]);
  const [rangeKey, setRangeKey] = useState<RangeKey>("last_7");
  const [customRange, setCustomRange] = useState<Partial<DayRange>>({});
  const [ledger, setLedger] = useState<{ payments: ReportingPayment[]; refundLinks: RefundLink[] | null; complete: boolean } | null>(null);
  const [revenueLoading, setRevenueLoading] = useState(true);
  const [appSort, setAppSort] = useState<"newest" | "oldest" | "readiness" | "attention">("newest");
  const [nextReturn, setNextReturn] = useState<string | null>(null);
  const loadApplicants = useServerFn(getOverviewApplicants);
  // Null counts until this resolves. A failure stays null rather than 0.
  // Window focus and lead-priority saves invalidate the same key.
  const applicantsQuery = useQuery({
    queryKey: ["overview-applicants"],
    queryFn: () => loadApplicants({ data: undefined }),
    refetchOnWindowFocus: true,
  });
  const newApps = applicantsQuery.data?.newApps ?? null;
  const pendingApps = applicantsQuery.data?.pendingApps ?? null;
  const recentApps = applicantsQuery.data?.applicants ?? [];
  const readiness = applicantsQuery.data?.readiness ?? {};
  const canSeeReadiness = !!applicantsQuery.data?.canSeeReadiness;
  const appsLoading = applicantsQuery.isLoading && !applicantsQuery.data;
  const appsFailed = applicantsQuery.isError;
  const fleetMaint = useServerFn(getFleetMaintenance);
  const [svc, setSvc] = useState({ overdue: 0, due: 0, dueSoon: 0, open: 0, conflict: 0 });
  useEffect(() => {
    // Canonical maintenance-due engine (same as the Service page) — never a local re-derivation.
    fleetMaint().then((r) => setSvc(r.counts)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      const now = new Date();
      const d84 = new Date(now.getTime() - 84 * 864e5).toISOString();

      // Applicants, including Hot Leads, load through overview-applicants
      // above. Migration 0030 keeps that read on the server.
      const [
        overdueQ,
        pay12wQ,
        billed12wQ,
        nextReturnQ,
        allVehiclesQ,
      ] = await Promise.all([
        // Collections: due and not received. `current` is issued-but-not-yet-due
        // and is deliberately absent.
        supabase
          .from("payments")
          .select("amount, driver_id")
          .in("status", [...COLLECTIONS_WATCH_STATUSES]),
        supabase
          .from("payments")
          .select("net_collected, paid_date, type")
          .in("status", ["paid", "refunded"])
          .gte("paid_date", d84),
        supabase.from("payments").select("amount, due_date, type").gte("due_date", d84),
        supabase
          .from("rentals")
          .select("end_date")
          .eq("status", "active")
          .not("end_date", "is", null)
          .gte("end_date", new Date().toISOString().slice(0, 10))
          .order("end_date", { ascending: true })
          .limit(1),
        supabase
          .from("vehicles")
          .select(
            "id, status, archived_at, current_odometer, last_oil_change_miles, oil_interval_miles, last_tire_date, last_brake_inspection_date",
          ),
      ]);

      setFleet(summarizeFleet((allVehiclesQ.data ?? []) as { status: string | null; archived_at: string | null }[]));

      const sumAmt = (rows?: any[] | null) =>
        (rows ?? []).reduce((a, r) => a + Number(r.net_collected ?? 0), 0);
      const overdueRows = (overdueQ.data ?? []) as any[];
      setOverdueAmt(sumAmt(overdueRows));
      setOverdueCount(overdueRows.length);
      setOverdueRenters(new Set(overdueRows.map((r) => r.driver_id).filter(Boolean)).size);


      // 12-week weekly buckets
      const bucketStart = (d: Date) => {
        const c = new Date(d);
        c.setHours(0, 0, 0, 0);
        c.setDate(c.getDate() - c.getDay());
        return c;
      };
      const start = bucketStart(new Date(now.getTime() - 11 * 7 * 864e5));
      const series: WeekPoint[] = [];
      for (let i = 0; i < 12; i++) {
        const d = new Date(start.getTime() + i * 7 * 864e5);
        series.push({
          label: fmtDate(d),
          iso: d.toISOString(),
          collected: 0,
          billed: 0,
        });
      }
      for (const p of (pay12wQ.data ?? []) as any[]) {
        if (!isRevenuePayment(p) || !p.paid_date) continue;
        const w = bucketStart(new Date(p.paid_date));
        const idx = Math.round((w.getTime() - start.getTime()) / (7 * 864e5));
        if (idx >= 0 && idx < 12) series[idx].collected += Number(p.net_collected ?? 0);
      }
      for (const p of (billed12wQ.data ?? []) as any[]) {
        if (!isRevenuePayment(p) || !p.due_date) continue;
        const w = bucketStart(new Date(p.due_date));
        const idx = Math.round((w.getTime() - start.getTime()) / (7 * 864e5));
        if (idx >= 0 && idx < 12) series[idx].billed += Number(p.amount ?? 0);
      }
      setWeekly(series);
      setNextReturn((nextReturnQ.data?.[0]?.end_date as string | undefined) ?? null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { total, rentable, rented, reserved, needsSetup } = fleet;
  const vehiclesAvail = fleet.available;
  const maintOpen = fleet.maintenance;
  const vehiclesTotal = fleet.total;
  const utilPct = fleet.utilizationPct;
  const pctOf = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  // ---- revenue for the selected range -------------------------------------
  // Its own effect, so changing the range refetches two small queries rather
  // than the whole dashboard.
  const range = useMemo(
    () => resolveRange(rangeKey, new Date(), customRange),
    [rangeKey, customRange],
  );
  const compare = useMemo(() => priorRange(range), [range]);

  useEffect(() => {
    if(!canSeeCollections) { setLedger(null); setRevenueLoading(false); return; }
    let live = true;
    setRevenueLoading(true);
    (async () => {
      const payments = await readEveryPage<ReportingPayment>((from, to) =>
        supabase
          .from("payments")
          .select("id,amount,balance_due,refunded_amount,status,type,paid_date,refunded_at,payment_method,stripe_payment_intent_id,stripe_invoice_id,stripe_subscription_id,rental_id,notes", { count: "exact" })
          .in("status", ["paid", "refunded"])
          .order("id", { ascending: true })
          .range(from, to),
      );
      const links = await readEveryPage<RefundLink>((from, to) =>
        supabase
          .from("payment_refunds")
          .select("stripe_charge_id,stripe_payment_intent_id,payment_ids", { count: "exact" })
          .order("id", { ascending: true })
          .range(from, to),
      );
      if (!live) return;
      setLedger({
        payments: payments.rows,
        refundLinks: links.complete ? links.rows : null,
        complete: payments.complete && links.complete,
      });
      setRevenueLoading(false);
    })().catch(() => {
      if (!live) return;
      setLedger(null);
      setRevenueLoading(false);
    });
    return () => {
      live = false;
    };
  }, [canSeeCollections]);

  const serviceAttention = svc.overdue + svc.due + svc.open + svc.conflict;

  // Readiness for every applicant in the window, computed on the server and
  // keyed by applicant id. Both the priority strip and the recent list read
  // this map, so they cannot disagree about the same person. Empty for a
  // Coordinator, who is not sent the evidence it summarises.
  const readinessIndex = useMemo(
    () => new Map<string, ReadinessResult>(Object.entries(readiness)),
    [readiness],
  );

  /**
   * Hot Leads and the modal list are this one array. Qualification, coverage,
   * and no critical concern — not the interested contact-status bucket.
   */
  const hotProspects = useMemo(
    () => (canSeeReadiness ? selectHotProspects(recentApps, readinessIndex) : []),
    [recentApps, readinessIndex, canSeeReadiness],
  );
  const hot = appsFailed
    ? { state: "unavailable" as const, prospects: [] }
    : appsLoading
      ? { state: "loading" as const, prospects: [] }
      : canSeeReadiness
        ? { state: "ready" as const, prospects: hotProspects }
        : { state: "withheld" as const, prospects: [] };

  const sortedApps = useMemo(() => {
    const rows = [...recentApps];
    const t = (a: ApplicantRow) => new Date(a.created_at ?? 0).getTime();
    switch (appSort) {
      case "oldest":
        return rows.sort((a, b) => t(a) - t(b));
      case "readiness":
        // State first, then how much we know — the module's own ordering, so
        // the dashboard and the drivers list rank people identically.
        return rows.sort((a, b) => {
          const ra = readinessIndex.get(a.id);
          const rb = readinessIndex.get(b.id);
          if (!ra || !rb) return t(b) - t(a);
          return compareReadiness(ra, rb) || t(b) - t(a);
        });
      case "attention":
        return rows.sort((a, b) => {
          const w = (x: ApplicantRow) => (applicationStage(x.status).needsAttention ? 0 : 1);
          return w(a) - w(b) || t(b) - t(a);
        });
      default:
        return rows.sort((a, b) => t(b) - t(a));
    }
  }, [recentApps, appSort, readinessIndex]);

  return (
    <div className="space-y-6">
      {/* Heading — the floating Weekly Revenue metric that sat here has moved
          into the Revenue card, where it has a range and a comparison. */}
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-[#111114]">Overview</h1>
        <p className="text-[13px] text-[#55555E] mt-1">Pipeline, Fleet And Revenue At A Glance</p>
      </div>

      <LeadPriorities hot={hot} />

      {/* Four cards. Each control matches what the card is for — a plus only
          where something gets created. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <ActionCard
          icon={Car}
          eyebrow="Fleet"
          title="Add Vehicle"
          hint={`${vehiclesTotal} In Fleet`}
          href="/admin"
          search={{ tab: "vehicles", add: "1" }}
          control="add"
        />

        <RevenueCard
          loading={revenueLoading}
          ledger={canSeeCollections ? ledger : null}
          enabled={canSeeCollections}
          range={range}
          compare={compare}
          rangeKey={rangeKey}
          onRangeKey={setRangeKey}
          custom={customRange}
          onCustom={setCustomRange}
        />

        <ActionCard
          icon={overdueAmt > 0 ? CreditCard : CheckCircle2}
          eyebrow="Collections"
          title={overdueAmt > 0 ? `${usd(overdueAmt)} Due` : "All Current"}
          hint={
            overdueAmt > 0
              ? `${overdueRenters || overdueCount} ${overdueRenters === 1 ? "renter" : "renters"} past due`
              : "$0 outstanding"
          }
          href="/admin"
          search={{ tab: "payments", filter: "overdue" }}
          control="view"
          tint={overdueAmt > 0 ? "red" : undefined}
          badge={overdueAmt > 0 ? overdueCount : undefined}
        />

        <ActionCard
          icon={serviceAttention > 0 || svc.dueSoon > 0 ? Wrench : CheckCircle2}
          eyebrow="Service"
          title={
            svc.overdue > 0 ? `${svc.overdue} Overdue`
            : svc.due > 0 ? `${svc.due} Due`
            : svc.open + svc.conflict > 0 ? `${svc.open + svc.conflict} Need Attention`
            : svc.dueSoon > 0 ? `${svc.dueSoon} Due Soon`
            : "All Clear"
          }
          hint={
            [
              svc.overdue > 0 && svc.due > 0 ? `${svc.due} due` : null,
              svc.open > 0 && (svc.overdue > 0 || svc.due > 0) ? `${svc.open} open` : null,
              svc.conflict > 0 && (svc.overdue > 0 || svc.due > 0) ? `${svc.conflict} mileage to review` : null,
              svc.dueSoon > 0 && serviceAttention > 0 ? `${svc.dueSoon} due soon` : null,
            ].filter(Boolean).join(" · ") || (serviceAttention + svc.dueSoon === 0 ? "0 due" : "View Service")
          }
          href="/admin"
          search={{ tab: "maintenance" }}
          control="view"
          tint={svc.overdue > 0 ? "red" : svc.due + svc.open + svc.conflict > 0 ? "amber" : undefined}
          badge={serviceAttention > 0 ? serviceAttention : undefined}
        />
      </div>
      {canSeeCollections ? <DocumentsExpiringChip /> : null}

      {/* Fleet snapshot + Applications queue */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <SectionCard
          className="lg:col-span-3"
          title="Fleet Snapshot"
          subtitle="Utilization And Current Inventory"
          right={
            <Link
              to="/admin"
              search={{ tab: "vehicles" }}
              className="inline-flex items-center gap-1 text-[12px] text-[#55555E] hover:text-[#D03020]"
            >
              Open Fleet <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          }
        >
          <div className="grid grid-cols-[auto_1fr] gap-6 items-center">
            <SegmentedDonut
              total={total}
              segments={[
                { key: "rented", label: "Rented", value: rented, color: "#4CD964" },
                { key: "reserved", label: "Reserved", value: reserved, color: "#FFCC33" },
                { key: "available", label: "Available", value: vehiclesAvail, color: "#C7C7CC" },
                { key: "maintenance", label: "Maintenance", value: maintOpen, color: "#FF3B30" },
                { key: "setup", label: "Needs Setup", value: needsSetup, color: "#8E8E93" },
              ]}
            />
            <div>
              <ul className="space-y-1.5">
                {[
                  { key: "rented", label: "Rented", value: rented, color: "#4CD964" },
                  { key: "reserved", label: "Reserved", value: reserved, color: "#FFCC33" },
                  { key: "available", label: "Available", value: vehiclesAvail, color: "#C7C7CC" },
                  { key: "maintenance", label: "Maintenance", value: maintOpen, color: "#FF3B30" },
                  { key: "setup", label: "Needs Setup", value: needsSetup, color: "#8E8E93" },
                ].map((s) => (
                  <li key={s.key} className="flex items-center gap-2 text-[13px]">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ background: s.color }}
                    />
                    <span className="text-[#111114] flex-1">{s.label}</span>
                    <span className="tabular-nums font-medium text-[#111114]">{s.value}</span>
                    <span className="tabular-nums text-[11px] text-[#9A9AA3] w-9 text-right">
                      {pctOf(s.value)}%
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-4">
                <div className="flex items-baseline justify-between mb-1">
                  <MicroLabel>Utilization {utilPct === null ? "—" : `${utilPct}%`} (Of Rentable)</MicroLabel>
                  <span className="text-[11px] text-[#9A9AA3] tabular-nums">
                    {rented} of {rentable} rentable
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-[#EDEDF0] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${utilPct ?? 0}%`, background: "#4CD964" }}
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="mt-5 pt-5 border-t border-[#EDEDF0]">
            <div className="grid grid-cols-3 gap-2">
              <OpStat label="Available Now" value={String(vehiclesAvail)} />
              <OpStat
                label="In Service"
                value={String(rented)}
              />
              <OpStat label="Next Return" value={shortDate(nextReturn)} />
            </div>
          </div>
        </SectionCard>

        <SectionCard
          className="lg:col-span-2"
          title={
            <span className="inline-flex items-center gap-2">
              Recent Applications
              {newApps !== null && newApps > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-[#D03020] text-white text-[10px] font-semibold">
                  {newApps}
                </span>
              )}
            </span>
          }
          subtitle={
            appsFailed
              ? "Counts Unavailable"
              : [
                  newApps !== null && newApps > 0 ? `${newApps} New` : null,
                  pendingApps !== null && pendingApps > 0 ? `${pendingApps} Pending` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Newest first"
          }
          padded={false}
          right={
            <div className="flex items-center gap-2">
              <select
                value={appSort}
                onChange={(e) => setAppSort(e.target.value as typeof appSort)}
                aria-label="Sort applications"
                className="h-7 rounded-md border border-[#EDEDF0] bg-white px-1.5 text-[11px] text-[#55555E] outline-none focus:border-[#D03020]"
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                {canSeeReadiness && <option value="readiness">Readiness</option>}
                <option value="attention">Needs Attention</option>
              </select>
              <Link
                to="/admin"
                search={{ tab: "drivers" }}
                className="inline-flex items-center gap-1 text-[12px] text-[#55555E] hover:text-[#D03020]"
              >
                View All <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          }
        >
          {appsLoading || recentApps.length === 0 ? (
            <div
              className="px-5 py-10 text-center text-[13px] text-[#9A9AA3]"
              data-applicants-state={appsFailed ? "failed" : appsLoading ? "loading" : "empty"}
            >
              {appsFailed ? "Could Not Load Applications." : appsLoading ? "Loading Applications…" : "No Applications Yet."}
            </div>
          ) : (
            <ul>
              {sortedApps.slice(0, 5).map((a) => {
                // Lifecycle from status. current_step only says how far through
                // the wizard a Pending applicant got.
                const stage = applicationStage(a.status);
                const progress = wizardProgress(a.status, a.current_step);
                const unread = a.status === "new" && !a.reviewed_at;
                return (
                  <li key={a.id}>
                    <Link
                      to="/admin"
                      search={{ tab: "drivers", id: a.id }}
                      className="flex items-center gap-3 px-5 py-3 border-b border-[#F4F4F6] last:border-0 hover:bg-[#FAFAFB] transition-colors"
                    >
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#F4F4F6] to-[#EDEDF0] grid place-items-center text-[12px] font-semibold text-[#55555E] shrink-0">
                        {initials(a.full_name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium text-[#111114] truncate flex items-center gap-1.5">
                          {unread && (
                            <span
                              className="h-1.5 w-1.5 rounded-full bg-[#D03020] shrink-0"
                              title="Not Yet Opened"
                            />
                          )}
                          <span className="truncate">{a.full_name ? displayPersonName(a.full_name) : "Unnamed Driver"}</span>
                        </div>
                        <div className="text-[11px] text-[#9A9AA3] mt-0.5 truncate">
                          {timeAgo(a.created_at)}
                          {progress ? ` · ${progress}` : ""}
                        </div>
                      </div>
                      <StatusPill tone={stage.tone as any}>{stage.label}</StatusPill>
                      {(() => {
                        const r = readinessIndex.get(a.id);
                        // The old bare score pill lived here. A number on its
                        // own could not say whether 100 meant a complete
                        // applicant or two lucky answers, so the state goes in
                        // its place and the figures stay on the profile.
                        return r ? <ReadinessStatePill state={r.state} short /> : null;
                      })()}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* Billed vs Collected stays on Overview. Payments lists charges and one
          outstanding total; it does not show this 12-week billed-versus-collected
          trend, the collection rate, or the worst week. Weekly Cash Flow is
          Stripe cash against expenses, not invoices against collections.
          Both series skip deposit rows, the same isRevenuePayment exclusion
          as the Revenue tile. */}
      {(() => {
        const totBilled = weekly.reduce((a, w) => a + w.billed, 0);
        const totCollected = weekly.reduce((a, w) => a + w.collected, 0);
        const collectionRate = totBilled > 0 ? Math.round((totCollected / totBilled) * 100) : null;
        const hasActivity = totBilled > 0 || totCollected > 0;

        // A flat $0 chart 240px tall says nothing and takes the space of the
        // thing that would. Until money moves, say so in one line.
        if (!hasActivity) {
          return (
            <SectionCard title="Billed vs Collected">
              <div className="py-6 text-center">
                <div className="mx-auto h-9 w-9 rounded-full bg-[#F4F4F6] grid place-items-center text-[#9A9AA3]">
                  <TrendingUp className="w-4 h-4" strokeWidth={1.75} />
                </div>
                <div className="mt-3 text-[13px] font-medium text-[#111114]">
                  No payment activity yet
                </div>
                <p className="mt-1 text-[12px] text-[#9A9AA3] max-w-[380px] mx-auto leading-relaxed">
                  Revenue and collections will appear here after your first rental begins.
                </p>
              </div>
            </SectionCard>
          );
        }
        // Worst week = biggest shortfall (billed - collected) among weeks with billing.
        let worst: WeekPoint | null = null;
        let worstGap = 0;
        for (const w of weekly) {
          const gap = w.billed - w.collected;
          if (w.billed > 0 && gap > worstGap) {
            worstGap = gap;
            worst = w;
          }
        }
        return (
          <SectionCard
            title="Billed vs Collected"
            subtitle={
              collectionRate == null
                ? "Last 12 Weeks · No Invoices Yet"
                : `Last 12 Weeks · ${collectionRate}% Collection Rate${worst ? ` · Worst Week ${shortDate(worst.iso)}` : ""}`
            }
            right={
              <div className="flex items-baseline gap-3">
                <span className="text-[11px] text-[#55555E]">
                  Billed{" "}
                  <span className="tabular-nums font-medium text-[#111114]">{usd(totBilled)}</span>
                </span>
                <span className="text-[11px] text-[#55555E]">
                  Collected{" "}
                  <span className="tabular-nums font-medium text-[#0F8A4B]">
                    {usd(totCollected)}
                  </span>
                </span>
                <span
                  className={`text-[11px] ${overdueAmt > 0 ? "text-[#CC0000]" : "text-[#9A9AA3]"}`}
                >
                  Past Due <span className="tabular-nums font-medium">{usd(overdueAmt)}</span>
                </span>
              </div>
            }
          >
            <div className="h-[240px] -mx-2">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={weekly} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#EDEDF0" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "#9A9AA3", fontSize: 10 }}
                    tickLine={false}
                    axisLine={{ stroke: "#EDEDF0" }}
                  />
                  <YAxis
                    tick={{ fill: "#9A9AA3", fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    width={48}
                    tickFormatter={(v) => (v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`)}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#fff",
                      border: "1px solid #EDEDF0",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v: any, name: any) => [
                      usd(Number(v)),
                      name === "billed" ? "Billed" : "Collected",
                    ]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, color: "#55555E" }} iconType="circle" />
                  <Bar
                    dataKey="billed"
                    name="Billed"
                    fill="#EDEDF0"
                    radius={[4, 4, 0, 0]}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="collected"
                    name="Collected"
                    stroke="#50C060"
                    strokeWidth={2.5}
                    dot={false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        );
      })()}
    </div>
  );
}

/**
 * A card that leads somewhere.
 *
 * The control on the right says what the card does. Four identical plus icons
 * implied you could create revenue and create collections; the plus now
 * appears only on Add Vehicle, which is the one card that creates anything.
 */
function ActionCard({
  icon: Icon,
  eyebrow,
  title,
  hint,
  href,
  search,
  control,
  badge,
  tint,
}: {
  icon: any;
  eyebrow: string;
  title: string;
  hint?: string;
  href: string;
  search: { tab?: string; id?: string; filter?: string; add?: "1" };
  control: "add" | "view";
  badge?: number;
  tint?: "red" | "amber";
}) {
  const border =
    tint === "red"
      ? "border-[#CC0000]/40 hover:border-[#CC0000]"
      : tint === "amber"
        ? "border-[#B77900]/40 hover:border-[#B77900]"
        : "border-[#EDEDF0] hover:border-[#D03020]";
  const badgeBg = tint === "amber" ? "bg-[#B77900] text-white" : "bg-[#CC0000] text-white";

  return (
    <Link
      to={href}
      search={search}
      className={`group relative rounded-2xl border bg-white text-[#111114] shadow-sm px-5 py-4 transition-colors ${border}`}
    >
      <div className="flex items-center justify-between">
        <div className="h-9 w-9 rounded-full grid place-items-center bg-[#F4F4F6] text-[#55555E]">
          <Icon className="w-4 h-4" strokeWidth={1.75} />
        </div>
        {control === "add" ? (
          <span className="h-7 w-7 rounded-full grid place-items-center bg-[#111114] text-white group-hover:bg-[#CC0000] transition-colors">
            <Plus className="w-3.5 h-3.5" strokeWidth={2} />
          </span>
        ) : (
          <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-[#9A9AA3] group-hover:text-[#D03020] transition-colors">
            View <ArrowUpRight className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
      <div className="mt-4 text-[10px] uppercase tracking-[0.12em] font-semibold text-[#9A9AA3]">
        {eyebrow}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="text-[18px] font-semibold tracking-tight">{title}</div>
        {badge != null && (
          <span
            className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-semibold ${badgeBg}`}
          >
            {badge}
          </span>
        )}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-[#55555E]">{hint}</div>}
    </Link>
  );
}

/**
 * Revenue, for a range you choose.
 *
 * The figure is Payments → All net collected for this range: the same
 * summarizePayments dedupe, so an invoice-only subscription row is not added
 * on top of the Stripe charge that already includes it.
 */
function RevenueCard({
  loading,
  ledger,
  enabled,
  range,
  compare,
  rangeKey,
  onRangeKey,
  custom,
  onCustom,
}: {
  loading: boolean;
  ledger: { payments: ReportingPayment[]; refundLinks: RefundLink[] | null; complete: boolean } | null;
  enabled: boolean;
  range: DayRange;
  compare: DayRange;
  rangeKey: RangeKey;
  onRangeKey: (k: RangeKey) => void;
  custom: Partial<DayRange>;
  onCustom: (c: Partial<DayRange>) => void;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  // Owner/Manager only (Coordinators never mount the request; server re-checks).
  // Shares the Payments Stripe cache entry — no duplicate provider request.
  const loadCollections = useServerFn(getStripeCollections);
  const sq = useQuery(stripeCollectionsQuery(loadCollections, "live", range.from, range.to, enabled));
  const summary = useMemo(() => {
    if (!enabled || !ledger) return null;
    const stripe = sq.isError
      ? { status: "error" as const, collectionsComplete: false, totals: null, charges: [] }
      : sq.data
        ? {
            status: "ready" as const,
            collectionsComplete: sq.data.collectionsComplete,
            totals: sq.data.totals,
            charges: sq.data.verifiedCollections.charges,
            refunds: sq.data.verifiedCollections.refunds,
          }
        : { status: "loading" as const, collectionsComplete: false, totals: null, charges: [] };
    return summarizePayments({
      payments: ledger.payments,
      refundLinks: ledger.refundLinks,
      stripe,
      deposits: { rentals: [], payments: [] },
      source: "all",
      range,
      truncated: !ledger.complete,
    });
  }, [enabled, ledger, sq.isError, sq.data, range]);
  const shownLoading = enabled && (loading || !ledger || (sq.isFetching && !sq.data));
  const shownAmount = summary?.netCollected.amount ?? null;
  const coverage = summary?.coverage ?? "Unavailable";
  const coverageHint = summary?.coverageReason
    ?? "A required revenue source could not be verified for this period, so no consolidated total is shown. Open Payments and choose Stripe for the verified collections detail.";
  const goPayments = () => {
    if (open) return;
    navigate({ to: "/admin", search: revenuePaymentsSearch(range) });
  };
  const label = RANGE_LABELS.find((r) => r.key === rangeKey)?.label ?? "Range";

  return (
    <div
      role="link"
      tabIndex={0}
      aria-label="Revenue — Open Payments"
      onClick={goPayments}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); goPayments(); } }}
      className="relative cursor-pointer rounded-2xl border border-[#EDEDF0] bg-white shadow-sm px-5 py-4 hover:border-[#D03020] transition-colors"
    >
      <div className="flex items-center justify-between">
        <div className="h-9 w-9 rounded-full grid place-items-center bg-[#F4F4F6] text-[#55555E]">
          <Receipt className="w-4 h-4" strokeWidth={1.75} />
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
          onKeyDown={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 rounded-md border border-[#EDEDF0] px-3 py-1 text-[11px] font-medium text-[#55555E] hover:border-[#D03020] hover:text-[#111114] transition-colors"
        >
          {label} <ChevronDown className="w-3 h-3" />
        </button>
      </div>

      <div className="mt-4 flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] font-semibold text-[#9A9AA3]">
        Revenue
        <span
          title={coverageHint}
          aria-label={`${coverage}: ${coverageHint}`}
          className="normal-case tracking-normal rounded border border-[#EDEDF0] px-1 py-px text-[10px] font-medium text-[#55555E]"
        >
          {coverage}
        </span>
      </div>
      <div className="mt-1 text-[22px] font-semibold tracking-tight tabular-nums leading-none">
        {shownLoading || shownAmount == null ? <span className="text-[#C7C7CC]">—</span> : usd(shownAmount)}
      </div>
      <div className="mt-1 text-[11px] text-[#55555E] truncate">
        {describeRange(range)}
        <span className="mx-1 text-[#C7C7CC]">·</span>
        <span className="text-[#9A9AA3]">same total as Payments, All</span>
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div className="absolute z-30 right-4 top-14 w-52 rounded-lg border border-[#EDEDF0] bg-white shadow-lg py-1" onClick={(e) => e.stopPropagation()}>
            {RANGE_LABELS.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => {
                  onRangeKey(r.key);
                  if (r.key !== "custom") setOpen(false);
                }}
                className={`block w-full text-left px-3 py-1.5 text-[12px] hover:bg-[#FAFAFB] ${
                  rangeKey === r.key ? "text-[#D03020] font-medium" : "text-[#111114]"
                }`}
              >
                {r.label}
              </button>
            ))}
            {rangeKey === "custom" && (
              <div className="px-3 py-2 border-t border-[#EDEDF0] space-y-1.5">
                <label className="block">
                  <span className="text-[10px] uppercase tracking-[0.12em] font-semibold text-[#9A9AA3]">
                    From
                  </span>
                  <input
                    type="date"
                    value={custom.from ?? range.from}
                    onChange={(e) => onCustom({ ...custom, from: e.target.value })}
                    className="mt-0.5 w-full h-7 rounded-md border border-[#EDEDF0] px-1.5 text-[11px] outline-none focus:border-[#D03020]"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] uppercase tracking-[0.12em] font-semibold text-[#9A9AA3]">
                    To
                  </span>
                  <input
                    type="date"
                    value={custom.to ?? range.to}
                    onChange={(e) => onCustom({ ...custom, to: e.target.value })}
                    className="mt-0.5 w-full h-7 rounded-md border border-[#EDEDF0] px-1.5 text-[11px] outline-none focus:border-[#D03020]"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="w-full rounded-md bg-[#111114] text-white py-1 text-[11px] font-medium hover:opacity-90"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </>
      )}
      <span className="sr-only">Comparing against {describeRange(compare)}</span>
    </div>
  );
}

function OpStat({ label, value, tone }: { label: string; value: string; tone?: "red" }) {
  return (
    <div className="rounded-xl border border-[#EDEDF0] bg-white px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-[#9A9AA3]">
        {label}
      </div>
      <div
        className={`mt-1 text-[18px] font-semibold tabular-nums leading-none ${tone === "red" ? "text-[#CC0000]" : "text-[#111114]"}`}
      >
        {value}
      </div>
    </div>
  );
}

function SegmentedDonut({
  total,
  segments,
}: {
  total: number;
  segments: { key: string; label: string; value: number; color: string }[];
}) {
  const size = 160,
    stroke = 16,
    r = (size - stroke) / 2,
    c = 2 * Math.PI * r;
  const gap = 2; // px gap between segments
  let offset = 0;
  const sum = segments.reduce((a, s) => a + s.value, 0) || 1;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="#EDEDF0"
          strokeWidth={stroke}
          fill="none"
        />
        {segments.map((s) => {
          if (s.value <= 0) return null;
          const len = (s.value / sum) * c;
          const dash = Math.max(0, len - gap);
          const el = (
            <circle
              key={s.key}
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={s.color}
              strokeWidth={stroke}
              fill="none"
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className="text-[26px] font-semibold text-[#111114] tabular-nums leading-none">
            {total}
          </div>
          <div className="text-[10px] text-[#9A9AA3] mt-1 uppercase tracking-[0.12em] font-semibold">
            Total Vehicles
          </div>
        </div>
      </div>
    </div>
  );
}
