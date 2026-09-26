import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Car,
  CreditCard,
  Wrench,
  ArrowUpRight,
  Plus,
  Flame,
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
import { SectionCard, MicroLabel, StatusPill, ReadinessStatePill, ReadinessMetrics } from "./ui";
import { isHotProspect, compareReadiness, type ReadinessResult } from "@/lib/readiness";
import {
  buildReadinessIndex,
  READINESS_APPLICATION_SELECT,
  READINESS_DOCUMENT_SELECT,
  READINESS_SCREENING_SELECT,
} from "@/lib/readiness-index";
import { computeDueReasons, needsOdometer } from "./MaintenancePanel";
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
const APPLICANT_WINDOW = 500;

type ApplicantRow = {
  id: string;
  full_name: string | null;
  status: string | null;
  current_step: string | null;
  created_at: string | null;
  reviewed_at: string | null;
  [key: string]: unknown;
};
type ScreeningRow = { lead_id: string; [key: string]: unknown };
import {
  RANGE_LABELS,
  resolveRange,
  priorRange,
  describeRange,
  type RangeKey,
  type DayRange,
} from "@/lib/date-range";

type WeekPoint = { label: string; iso: string; collected: number; billed: number };

/**
 * What counts as revenue.
 *
 * The same rule vehicle_pl() uses: money actually received, excluding
 * deposits. A deposit is the renter's money held against damage — it is on the
 * balance sheet, not the income statement, and counting it made a good week
 * look better than it was. The old Weekly Revenue figure summed every paid
 * row regardless of type, deposits included.
 */
const REVENUE_TYPES = ["rent", "late_fee", "other"] as const;

/**
 * What counts as collections.
 *
 * Money that was due and did not arrive. Not the same as "unpaid": the old
 * figure summed every row whose status was not 'paid', which swept in
 * invoices that are simply not due yet and showed them as outstanding debt.
 */
const OVERDUE_STATUSES = ["late", "past_due", "collections"] as const;

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
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function OverviewPanel() {
  const [vehiclesAvail, setVehiclesAvail] = useState(0);
  const [vehiclesTotal, setVehiclesTotal] = useState(0);
  const [rented, setRented] = useState(0);
  const [maintOpen, setMaintOpen] = useState(0);
  const [reserved, setReserved] = useState(0);
  const [newApps, setNewApps] = useState(0);
  const [pendingApps, setPendingApps] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);
  const [overdueRenters, setOverdueRenters] = useState(0);
  const [overdueAmt, setOverdueAmt] = useState(0);
  const [weekly, setWeekly] = useState<WeekPoint[]>([]);
  const [rangeKey, setRangeKey] = useState<RangeKey>("last_7");
  const [customRange, setCustomRange] = useState<Partial<DayRange>>({});
  const [revenue, setRevenue] = useState(0);
  const [priorRevenue, setPriorRevenue] = useState(0);
  const [revenueLoading, setRevenueLoading] = useState(true);
  const [appSort, setAppSort] = useState<"newest" | "oldest" | "readiness" | "attention">("newest");
  const [nextReturn, setNextReturn] = useState<string | null>(null);
  const [recentApps, setRecentApps] = useState<ApplicantRow[]>([]);
  const [screenings, setScreenings] = useState<ScreeningRow[]>([]);
  const [leadDocs, setLeadDocs] = useState<{ lead_id: string; doc_type: string }[]>([]);
  const [serviceDue, setServiceDue] = useState(0);
  const [serviceNeedsOdo, setServiceNeedsOdo] = useState(0);

  useEffect(() => {
    (async () => {
      const now = new Date();
      const d84 = new Date(now.getTime() - 84 * 864e5).toISOString();

      const [
        vTotalQ,
        vAvailQ,
        vRentedQ,
        vMaintQ,
        vReservedQ,
        newAppsQ,
        pendingAppsQ,
        overdueQ,
        pay12wQ,
        billed12wQ,
        nextReturnQ,
        recentAppsQ,
        screeningsQ,
        leadDocsQ,
        allVehiclesQ,
      ] = await Promise.all([
        supabase.from("vehicles").select("id", { count: "exact", head: true }),
        supabase
          .from("vehicles")
          .select("id", { count: "exact", head: true })
          .eq("status", "available"),
        supabase
          .from("vehicles")
          .select("id", { count: "exact", head: true })
          .eq("status", "rented"),
        supabase
          .from("vehicles")
          .select("id", { count: "exact", head: true })
          .eq("status", "maintenance"),
        supabase
          .from("vehicles")
          .select("id", { count: "exact", head: true })
          .eq("status", "reserved"),
        // New = finished the wizard AND nobody has opened it. Status alone
        // would keep counting work somebody already read and left alone.
        supabase
          .from("applications")
          .select("id", { count: "exact", head: true })
          .eq("status", "new")
          .is("reviewed_at", null),
        supabase
          .from("applications")
          .select("id", { count: "exact", head: true })
          .eq("status", "partial"),
        // Collections: due and not received. `current` is issued-but-not-yet-due
        // and is deliberately absent.
        supabase
          .from("payments")
          .select("amount, driver_id")
          .in("status", OVERDUE_STATUSES as unknown as string[]),
        supabase
          .from("payments")
          .select("amount, paid_date")
          .eq("status", "paid")
          .in("type", REVENUE_TYPES as unknown as string[])
          .gte("paid_date", d84),
        supabase.from("payments").select("amount, due_date").gte("due_date", d84),
        supabase
          .from("rentals")
          .select("end_date")
          .eq("status", "active")
          .not("end_date", "is", null)
          .gte("end_date", new Date().toISOString().slice(0, 10))
          .order("end_date", { ascending: true })
          .limit(1),
        // One applicant query feeds both the recent list and the priority
        // strip. Hot Prospect is no longer a column you can filter on — it is
        // derived from the application, the screening and the documents — so
        // the strip cannot be a `.gte("score", 80)` any more.
        //
        // The window is bounded (APPLICANT_WINDOW) rather than unbounded: the
        // cost of computing readiness on read is that the rows have to come
        // back. At the current pipeline size this is every applicant several
        // times over. When it stops being, the answer is a projection built
        // from the same module, not a cached column that goes stale the moment
        // somebody uploads a document.
        supabase
          .from("applications")
          .select(
            `id, full_name, status, current_step, created_at, reviewed_at, ${READINESS_APPLICATION_SELECT}`,
          )
          .neq("status", "duplicate")
          .order("created_at", { ascending: false })
          .limit(APPLICANT_WINDOW),
        supabase.from("driver_screenings").select(READINESS_SCREENING_SELECT),
        supabase.from("lead_documents").select(READINESS_DOCUMENT_SELECT),
        supabase
          .from("vehicles")
          .select(
            "id, status, current_odometer, last_oil_change_miles, oil_interval_miles, last_tire_date, last_brake_inspection_date",
          ),
      ]);

      setVehiclesTotal(vTotalQ.count ?? 0);
      setVehiclesAvail(vAvailQ.count ?? 0);
      setRented(vRentedQ.count ?? 0);
      setMaintOpen(vMaintQ.count ?? 0);
      setReserved(vReservedQ.count ?? 0);
      setNewApps(newAppsQ.count ?? 0);
      setPendingApps(pendingAppsQ.count ?? 0);
      const sumAmt = (rows?: any[] | null) =>
        (rows ?? []).reduce((a, r) => a + Number(r.amount ?? 0), 0);
      const overdueRows = (overdueQ.data ?? []) as any[];
      setOverdueAmt(sumAmt(overdueRows));
      setOverdueCount(overdueRows.length);
      setOverdueRenters(new Set(overdueRows.map((r) => r.driver_id).filter(Boolean)).size);
      const dueCount = (allVehiclesQ.data ?? []).filter(
        (v: any) => v.status !== "maintenance" && computeDueReasons(v).length > 0,
      ).length;
      setServiceDue(dueCount);
      const needsOdoCount = (allVehiclesQ.data ?? []).filter(
        (v: any) => v.status !== "maintenance" && needsOdometer(v),
      ).length;
      setServiceNeedsOdo(needsOdoCount);

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
          label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
          iso: d.toISOString(),
          collected: 0,
          billed: 0,
        });
      }
      for (const p of (pay12wQ.data ?? []) as any[]) {
        if (!p.paid_date) continue;
        const w = bucketStart(new Date(p.paid_date));
        const idx = Math.round((w.getTime() - start.getTime()) / (7 * 864e5));
        if (idx >= 0 && idx < 12) series[idx].collected += Number(p.amount ?? 0);
      }
      for (const p of (billed12wQ.data ?? []) as any[]) {
        if (!p.due_date) continue;
        const w = bucketStart(new Date(p.due_date));
        const idx = Math.round((w.getTime() - start.getTime()) / (7 * 864e5));
        if (idx >= 0 && idx < 12) series[idx].billed += Number(p.amount ?? 0);
      }
      setWeekly(series);
      setNextReturn((nextReturnQ.data?.[0]?.end_date as string | undefined) ?? null);
      // Cast: the generated client cannot type a select built from a shared
      // column list, so the shape is asserted here and guaranteed by
      // READINESS_*_SELECT rather than by inference.
      setRecentApps((recentAppsQ.data ?? []) as unknown as ApplicantRow[]);
      setScreenings((screeningsQ.data ?? []) as unknown as ScreeningRow[]);
      setLeadDocs((leadDocsQ.data ?? []) as unknown as { lead_id: string; doc_type: string }[]);
    })();
  }, []);

  const total = vehiclesAvail + rented + reserved + maintOpen;
  const rentable = Math.max(0, total - maintOpen);
  const utilPct = rentable > 0 ? Math.round((rented / rentable) * 100) : 0;
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
    let live = true;
    setRevenueLoading(true);
    (async () => {
      const q = (r: DayRange) =>
        supabase
          .from("payments")
          .select("amount")
          .eq("status", "paid")
          .in("type", REVENUE_TYPES as unknown as string[])
          .gte("paid_date", r.from)
          .lte("paid_date", r.to);
      const [cur, prev] = await Promise.all([q(range), q(compare)]);
      if (!live) return;
      const sum = (rows?: any[] | null) =>
        (rows ?? []).reduce((a, r) => a + Number(r.amount ?? 0), 0);
      setRevenue(sum(cur.data));
      setPriorRevenue(sum(prev.data));
      setRevenueLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [range, compare]);

  const revenueDelta = useMemo(() => {
    // No prior revenue is not a 100% rise; it is a comparison that cannot be
    // made, and saying so is more honest than printing a number.
    if (priorRevenue === 0) return null;
    return Math.round(((revenue - priorRevenue) / priorRevenue) * 100);
  }, [revenue, priorRevenue]);

  const serviceAttention = maintOpen + serviceDue;

  // Readiness for every applicant in the window, from the three result sets
  // already fetched. Both the priority strip and the recent list read this
  // map, so they cannot disagree about the same person.
  const readinessIndex = useMemo(
    () => buildReadinessIndex(recentApps, screenings, leadDocs),
    [recentApps, screenings, leadDocs],
  );

  /**
   * Hot Prospect: worth prioritising for follow-up. Not approved, not decision
   * ready, not verified, not rental ready. The rule lives in the readiness
   * module — qualification, coverage and no critical concern — and this strip
   * only renders what it returns.
   */
  const hot = useMemo(() => {
    return recentApps
      .flatMap((a) => {
        const r = readinessIndex.get(a.id);
        return r && isHotProspect(r) ? [{ app: a, readiness: r }] : [];
      })
      .sort((x, y) => compareReadiness(x.readiness, y.readiness))
      .slice(0, 5);
  }, [recentApps, readinessIndex]);

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

      {/* Priority strip — who is worth calling first, above everything else.
          Absent entirely when there is nobody, rather than an empty module.

          Hot Prospect means "worth prioritising for follow-up" and nothing
          more. It is not approval, not Decision Ready, not verification. So
          the strip carries the readiness state alongside the name: a hot
          prospect who is still 55% known says so on its face. */}
      {hot.length > 0 && (
        <div className="rounded-2xl border border-[#D03020]/25 bg-[rgba(208,48,32,0.03)] px-4 py-3">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-[#D03020]" strokeWidth={2} />
            <span className="text-[12px] font-semibold text-[#111114]">Hot Prospects</span>
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[#D03020] text-white text-[10px] font-semibold">
              {hot.length}
            </span>
            <span className="text-[11px] text-[#9A9AA3]">Worth following up first</span>
            <Link
              to="/admin"
              search={{ tab: "drivers" } as any}
              className="ml-auto shrink-0 inline-flex items-center gap-1 text-[12px] font-medium text-[#D03020] hover:opacity-80"
            >
              {hot.length === 1 ? "View" : "View All"} <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <ul className="mt-2.5 flex flex-wrap gap-x-6 gap-y-2.5">
            {hot.map(({ app, readiness }) => (
              <li key={app.id} className="min-w-0">
                <Link
                  to="/admin"
                  search={{ tab: "drivers", id: app.id } as any}
                  className="group inline-flex flex-col gap-1 min-w-0"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-[13px] font-semibold text-[#111114] truncate group-hover:text-[#D03020] transition-colors">
                      {app.full_name || "Unnamed"}
                    </span>
                    <ReadinessStatePill state={readiness.state} short />
                  </span>
                  <ReadinessMetrics result={readiness} compact />
                  {readiness.positives.length > 0 && (
                    <span className="text-[11px] text-[#9A9AA3] truncate">
                      {readiness.positives
                        .slice(0, 2)
                        .map((f) => f.detail)
                        .join(" · ")}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

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
          amount={revenue}
          delta={revenueDelta}
          loading={revenueLoading}
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
          icon={serviceAttention > 0 ? Wrench : CheckCircle2}
          eyebrow="Service"
          title={serviceAttention > 0 ? `${serviceAttention} Need Attention` : "All Clear"}
          hint={
            serviceAttention > 0
              ? [
                  maintOpen > 0 ? `${maintOpen} down` : null,
                  serviceDue > 0 ? `${serviceDue} service due` : null,
                  serviceNeedsOdo > 0 ? `${serviceNeedsOdo} need a reading` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "0 due"
          }
          href="/admin"
          search={{ tab: "maintenance" }}
          control="view"
          tint={maintOpen > 0 ? "red" : serviceDue > 0 ? "amber" : undefined}
          badge={serviceAttention > 0 ? serviceAttention : undefined}
        />
      </div>

      {/* Fleet snapshot + Applications queue */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <SectionCard
          className="lg:col-span-3"
          title="Fleet Snapshot"
          subtitle="Utilization And Current Inventory"
          right={
            <Link
              to="/admin"
              search={{ tab: "vehicles" } as any}
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
              ]}
            />
            <div>
              <ul className="space-y-1.5">
                {[
                  { key: "rented", label: "Rented", value: rented, color: "#4CD964" },
                  { key: "reserved", label: "Reserved", value: reserved, color: "#FFCC33" },
                  { key: "available", label: "Available", value: vehiclesAvail, color: "#C7C7CC" },
                  { key: "maintenance", label: "Maintenance", value: maintOpen, color: "#FF3B30" },
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
                  <MicroLabel>Utilization {utilPct}% (Of Rentable)</MicroLabel>
                  <span className="text-[11px] text-[#9A9AA3] tabular-nums">
                    {rented}/{rentable}
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-[#EDEDF0] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${utilPct}%`, background: "#4CD964" }}
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
                value={String(maintOpen)}
                tone={maintOpen > 0 ? "red" : undefined}
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
              {newApps > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-[#D03020] text-white text-[10px] font-semibold">
                  {newApps}
                </span>
              )}
            </span>
          }
          subtitle={
            [
              newApps > 0 ? `${newApps} New` : null,
              pendingApps > 0 ? `${pendingApps} Pending` : null,
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
                <option value="readiness">Readiness</option>
                <option value="attention">Needs Attention</option>
              </select>
              <Link
                to="/admin"
                search={{ tab: "drivers" } as any}
                className="inline-flex items-center gap-1 text-[12px] text-[#55555E] hover:text-[#D03020]"
              >
                View All <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          }
        >
          {recentApps.length === 0 ? (
            <div className="px-5 py-10 text-center text-[13px] text-[#9A9AA3]">
              No Applications Yet.
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
                      search={{ tab: "drivers", id: a.id } as any}
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
                              title="Not yet opened"
                            />
                          )}
                          <span className="truncate">{a.full_name || "Unnamed Driver"}</span>
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

      {/* Billed vs Collected — full width */}
      {(() => {
        const totBilled = weekly.reduce((a, w) => a + w.billed, 0);
        const totCollected = weekly.reduce((a, w) => a + w.collected, 0);
        const collectionRate = totBilled > 0 ? Math.round((totCollected / totBilled) * 100) : null;
        const hasActivity = totBilled > 0 || totCollected > 0;

        // A flat $0 chart 240px tall says nothing and takes the space of the
        // thing that would. Until money moves, say so in one line.
        if (!hasActivity) {
          return (
            <SectionCard title="Billed Vs Collected">
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
            title="Billed Vs Collected"
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
  search: Record<string, string>;
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
      search={search as any}
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
 * Not a link: the control here is the range, so the card is a panel rather
 * than a destination. The figure is money received in the range, excluding
 * deposits, against the equally long stretch immediately before it.
 */
function RevenueCard({
  amount,
  delta,
  loading,
  range,
  compare,
  rangeKey,
  onRangeKey,
  custom,
  onCustom,
}: {
  amount: number;
  delta: number | null;
  loading: boolean;
  range: DayRange;
  compare: DayRange;
  rangeKey: RangeKey;
  onRangeKey: (k: RangeKey) => void;
  custom: Partial<DayRange>;
  onCustom: (c: Partial<DayRange>) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = RANGE_LABELS.find((r) => r.key === rangeKey)?.label ?? "Range";

  return (
    <div className="relative rounded-2xl border border-[#EDEDF0] bg-white shadow-sm px-5 py-4">
      <div className="flex items-center justify-between">
        <div className="h-9 w-9 rounded-full grid place-items-center bg-[#F4F4F6] text-[#55555E]">
          <Receipt className="w-4 h-4" strokeWidth={1.75} />
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 rounded-md border border-[#EDEDF0] px-2 py-1 text-[11px] font-medium text-[#55555E] hover:border-[#D03020] hover:text-[#111114] transition-colors"
        >
          {label} <ChevronDown className="w-3 h-3" />
        </button>
      </div>

      <div className="mt-4 text-[10px] uppercase tracking-[0.12em] font-semibold text-[#9A9AA3]">
        Revenue
      </div>
      <div className="mt-1 text-[22px] font-semibold tracking-tight tabular-nums leading-none">
        {loading ? <span className="text-[#C7C7CC]">—</span> : usd(amount)}
      </div>
      <div className="mt-1 text-[11px] text-[#55555E] truncate">
        {describeRange(range)}
        {delta != null ? (
          <>
            <span className="mx-1 text-[#C7C7CC]">·</span>
            <span className={`font-medium ${delta >= 0 ? "text-[#0F8A4B]" : "text-[#CC0000]"}`}>
              {delta >= 0 ? "+" : ""}
              {delta}%
            </span>
            <span className="text-[#9A9AA3]"> vs prior</span>
          </>
        ) : (
          <>
            <span className="mx-1 text-[#C7C7CC]">·</span>
            <span className="text-[#9A9AA3]">no prior revenue to compare</span>
          </>
        )}
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute z-30 right-4 top-14 w-52 rounded-lg border border-[#EDEDF0] bg-white shadow-lg py-1">
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
