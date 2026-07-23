import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Users, Car, CreditCard, ShieldCheck, TrendingUp, ArrowUpRight, Flame, Phone, Mail, MapPin, Clock, Wrench, DollarSign, Wallet, Receipt, AlertTriangle, ArrowUp, ArrowDown } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, LineChart, Line } from "recharts";

type Kpis = {
  leads7: number;
  leadsPrev7: number;
  apps7: number;
  activeDrivers: number;
  vehicles: number;
  vehiclesAvailable: number;
  hotLeads: number;
  screeningsPending: number;
};

type FleetBreak = { available: number; rented: number; maintenance: number };
type DriverBreak = { active: number; screening: number; leads: number; hot: number };

type FinancePoint = { day: string; value: number };
type Finance = {
  revenue30: number;
  revenuePrev30: number;
  revenueSeries: FinancePoint[];
  outstanding: number;
  outstandingSeries: FinancePoint[];
  expenses30: number;
  expensesPrev30: number;
  expensesSeries: FinancePoint[];
  lateFees30: number;
  lateFeesPrev30: number;
  lateFeesSeries: FinancePoint[];
};

type DayPoint = { day: string; leads: number; apps: number };

function fmtDay(d: Date) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function OverviewPanel() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [series, setSeries] = useState<DayPoint[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const [hot, setHot] = useState<any[]>([]);
  const [fleet, setFleet] = useState<FleetBreak>({ available: 0, rented: 0, maintenance: 0 });
  const [drivers, setDrivers] = useState<DriverBreak>({ active: 0, screening: 0, leads: 0, hot: 0 });
  const [activityTab, setActivityTab] = useState<"fleet" | "drivers">("fleet");
  const [finance, setFinance] = useState<Finance | null>(null);

  useEffect(() => {
    (async () => {
      const now = new Date();
      const d7 = new Date(now.getTime() - 7 * 864e5).toISOString();
      const d14 = new Date(now.getTime() - 14 * 864e5).toISOString();
      const d30 = new Date(now.getTime() - 30 * 864e5).toISOString();

      const [leads7q, leadsPrevQ, apps7q, activeQ, vehiclesQ, vehiclesAvailQ, hotQ, screenQ, recentAppsQ, seriesAppsQ, hotListQ, rentedQ, maintQ] = await Promise.all([
        supabase.from("applications").select("id", { count: "exact", head: true }).gte("created_at", d7),
        supabase.from("applications").select("id", { count: "exact", head: true }).gte("created_at", d14).lt("created_at", d7),
        supabase.from("applications").select("id", { count: "exact", head: true }).gte("created_at", d7).not("current_step", "is", null),
        supabase.from("applications").select("id", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("vehicles").select("id", { count: "exact", head: true }),
        supabase.from("vehicles").select("id", { count: "exact", head: true }).eq("status", "available"),
        supabase.from("applications").select("id", { count: "exact", head: true }).eq("ai_tier", "hot"),
        supabase.from("driver_screenings").select("id", { count: "exact", head: true }).is("interview_completed_at", null),
        supabase.from("applications").select("id, full_name, city, status, ai_tier, ai_score, created_at, phone, email, current_step, source, rental_duration_days, referral_source").order("created_at", { ascending: false }).limit(6),
        supabase.from("applications").select("created_at").gte("created_at", d30),
        supabase.from("applications").select("id, full_name, city, ai_score, ai_tier, created_at, phone, email").eq("ai_tier", "hot").order("ai_score", { ascending: false }).limit(5),
        supabase.from("rentals").select("vehicle_id", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("maintenance_records").select("vehicle_id", { count: "exact", head: true }).neq("status", "completed"),
      ]);

      setKpis({
        leads7: leads7q.count ?? 0,
        leadsPrev7: leadsPrevQ.count ?? 0,
        apps7: apps7q.count ?? 0,
        activeDrivers: activeQ.count ?? 0,
        vehicles: vehiclesQ.count ?? 0,
        vehiclesAvailable: vehiclesAvailQ.count ?? 0,
        hotLeads: hotQ.count ?? 0,
        screeningsPending: screenQ.count ?? 0,
      });

      const rented = rentedQ.count ?? 0;
      const maintenance = maintQ.count ?? 0;
      const available = vehiclesAvailQ.count ?? 0;
      setFleet({ available, rented, maintenance });
      setDrivers({
        active: activeQ.count ?? 0,
        screening: screenQ.count ?? 0,
        leads: leads7q.count ?? 0,
        hot: hotQ.count ?? 0,
      });

      // ---- Finance ----
      const d60 = new Date(now.getTime() - 60 * 864e5).toISOString();
      const d30Date = new Date(now.getTime() - 30 * 864e5);
      const [payQ, maintCostQ] = await Promise.all([
        supabase.from("payments").select("amount, late_fees, status, paid_date, due_date, created_at").gte("created_at", d60),
        supabase.from("maintenance_records").select("total_cost, completed_at, created_at").gte("created_at", d60),
      ]);

      const buildSeries = (): FinancePoint[] => {
        const arr: FinancePoint[] = [];
        for (let i = 29; i >= 0; i--) {
          const d = new Date(now.getTime() - i * 864e5);
          arr.push({ day: fmtDay(d), value: 0 });
        }
        return arr;
      };
      const revenueSeries = buildSeries();
      const outstandingSeries = buildSeries();
      const expensesSeries = buildSeries();
      const lateFeesSeries = buildSeries();
      const idxFor = (iso: string) => {
        const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 864e5);
        return 29 - days;
      };

      let revenue30 = 0, revenuePrev30 = 0, expenses30 = 0, expensesPrev30 = 0, lateFees30 = 0, lateFeesPrev30 = 0, outstanding = 0;

      for (const p of (payQ.data ?? []) as any[]) {
        const amt = Number(p.amount ?? 0);
        const late = Number(p.late_fees ?? 0);
        if (p.status === "paid" && p.paid_date) {
          const paid = new Date(p.paid_date);
          if (paid >= d30Date) {
            revenue30 += amt;
            const i = idxFor(p.paid_date);
            if (i >= 0 && i < 30) revenueSeries[i].value += amt;
          } else {
            revenuePrev30 += amt;
          }
        }
        if (p.status !== "paid") {
          outstanding += amt;
          const i = idxFor(p.created_at);
          if (i >= 0 && i < 30) outstandingSeries[i].value += amt;
        }
        if (late > 0) {
          const when = new Date(p.paid_date ?? p.created_at);
          if (when >= d30Date) {
            lateFees30 += late;
            const i = idxFor((p.paid_date ?? p.created_at) as string);
            if (i >= 0 && i < 30) lateFeesSeries[i].value += late;
          } else {
            lateFeesPrev30 += late;
          }
        }
      }
      for (const m of (maintCostQ.data ?? []) as any[]) {
        const cost = Number(m.total_cost ?? 0);
        if (!cost) continue;
        const when = new Date(m.completed_at ?? m.created_at);
        if (when >= d30Date) {
          expenses30 += cost;
          const i = idxFor((m.completed_at ?? m.created_at) as string);
          if (i >= 0 && i < 30) expensesSeries[i].value += cost;
        } else {
          expensesPrev30 += cost;
        }
      }

      setFinance({
        revenue30, revenuePrev30, revenueSeries,
        outstanding, outstandingSeries,
        expenses30, expensesPrev30, expensesSeries,
        lateFees30, lateFeesPrev30, lateFeesSeries,
      });

      // Build 30-day series
      const days: DayPoint[] = [];
      const buckets: Record<string, DayPoint> = {};
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 864e5);
        const key = d.toISOString().slice(0, 10);
        const p = { day: fmtDay(d), leads: 0, apps: 0 } as DayPoint;
        buckets[key] = p;
        days.push(p);
      }
      for (const r of (seriesAppsQ.data ?? []) as Array<{ created_at: string }>) {
        const k = new Date(r.created_at as string).toISOString().slice(0, 10);
        if (buckets[k]) {
          buckets[k].leads += 1;
          buckets[k].apps += 1;
        }
      }
      setSeries(days);
      setRecent(recentAppsQ.data ?? []);
      setHot(hotListQ.data ?? []);
    })();
  }, []);

  const trend = (curr: number, prev: number) => {
    if (prev === 0) return curr > 0 ? 100 : 0;
    return Math.round(((curr - prev) / prev) * 100);
  };

  const timeAgo = (iso: string) => {
    const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  };

  const stepLabel = (a: any) => {
    if (a.status === "active") return "Active driver";
    if (a.status === "approved") return "Approved";
    if (a.status === "rejected") return "Rejected";
    if (!a.current_step) return "Lead only";
    return `Step ${a.current_step} of 4`;
  };

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          icon={Users}
          label="New Leads (7d)"
          value={kpis?.leads7 ?? "—"}
          delta={kpis ? trend(kpis.leads7, kpis.leadsPrev7) : undefined}
          hint="vs. previous 7d"
        />
        <KpiCard
          icon={TrendingUp}
          label="Applications (7d)"
          value={kpis?.apps7 ?? "—"}
          hint="Completed Profile Step"
        />
        <KpiCard
          icon={Flame}
          label="Hot Prospects"
          value={kpis?.hotLeads ?? "—"}
          hint="AI-Scored"
          accent="red"
        />
        <KpiCard
          icon={ShieldCheck}
          label="Screenings Pending"
          value={kpis?.screeningsPending ?? "—"}
          hint="Interview Not Completed"
        />
      </div>

      {/* Finance strip + Activity donut */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <MiniFinanceCard
            icon={DollarSign}
            tone="emerald"
            label="Revenue"
            hint="Last 30 Days"
            value={finance?.revenue30}
            prev={finance?.revenuePrev30}
            series={finance?.revenueSeries}
            format="usd"
          />
          <MiniFinanceCard
            icon={Wallet}
            tone="sky"
            label="Outstanding"
            hint="Open Balances"
            value={finance?.outstanding}
            series={finance?.outstandingSeries}
            format="usd"
            noDelta
          />
          <MiniFinanceCard
            icon={Receipt}
            tone="violet"
            label="Expenses"
            hint="Maintenance 30d"
            value={finance?.expenses30}
            prev={finance?.expensesPrev30}
            series={finance?.expensesSeries}
            format="usd"
            invertDelta
          />
          <MiniFinanceCard
            icon={AlertTriangle}
            tone="red"
            label="Late Fees"
            hint="Collected 30d"
            value={finance?.lateFees30}
            prev={finance?.lateFeesPrev30}
            series={finance?.lateFeesSeries}
            format="usd"
          />
        </div>
        <div className="lg:col-span-2">
          <ActivityDonut
            tab={activityTab}
            onTab={setActivityTab}
            fleet={fleet}
            drivers={drivers}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Chart */}
        <div className="lg:col-span-2 bg-white border border-[#ececf0] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-neutral-900">Lead & Application Flow</h3>
              <p className="text-xs text-neutral-500 mt-0.5">Last 30 Days</p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="inline-flex items-center gap-1.5 text-neutral-600">
                <span className="w-2 h-2 rounded-full bg-emerald-500" /> Leads
              </span>
              <span className="inline-flex items-center gap-1.5 text-neutral-600">
                <span className="w-2 h-2 rounded-full bg-emerald-600" /> Apps
              </span>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="fillLeads" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22c55e" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="fillApps" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="2 4" stroke="#eef0f3" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#9aa0a6" }} axisLine={false} tickLine={false} interval={4} />
                <YAxis orientation="right" tick={{ fontSize: 11, fill: "#9aa0a6" }} axisLine={false} tickLine={false} allowDecimals={false} width={32} />
                <Tooltip
                  contentStyle={{ background: "#fff", border: "1px solid #ececf0", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#111", fontWeight: 600 }}
                />
                <Area type="monotone" dataKey="leads" stroke="#22c55e" strokeWidth={2.5} fill="url(#fillLeads)" dot={false} activeDot={{ r: 4 }} />
                <Area type="monotone" dataKey="apps" stroke="#16a34a" strokeWidth={2.5} fill="url(#fillApps)" dot={false} activeDot={{ r: 4 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Fleet summary */}
        <div className="bg-white border border-[#ececf0] rounded-xl p-5">
          <h3 className="text-sm font-semibold text-neutral-900">Fleet</h3>
          <p className="text-xs text-neutral-500 mt-0.5 mb-4">Inventory At A Glance</p>
          <div className="space-y-4">
            <SummaryRow icon={Car} label="Total Vehicles" value={kpis?.vehicles ?? "—"} />
            <SummaryRow icon={CreditCard} label="Available" value={kpis?.vehiclesAvailable ?? "—"} tone="emerald" />
            <SummaryRow icon={Users} label="Active Drivers" value={kpis?.activeDrivers ?? "—"} />
          </div>
          <div className="mt-5 pt-4 border-t border-[#f0f0f3]">
            <div className="text-xs text-neutral-500">Utilization</div>
            <div className="mt-2 h-2 rounded-full bg-[#f5f6f8] overflow-hidden">
              <div
                className="h-full bg-neutral-900"
                style={{
                  width: `${
                    kpis && kpis.vehicles > 0
                      ? Math.min(100, Math.round(((kpis.vehicles - kpis.vehiclesAvailable) / kpis.vehicles) * 100))
                      : 0
                  }%`,
                }}
              />
            </div>
            <div className="mt-1.5 text-[11px] text-neutral-500">
              {kpis && kpis.vehicles > 0
                ? `${kpis.vehicles - kpis.vehiclesAvailable} of ${kpis.vehicles} on the road`
                : "—"}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent applications */}
        <div className="lg:col-span-2 bg-white border border-[#ececf0] rounded-xl">
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <div>
              <h3 className="text-sm font-semibold text-neutral-900">Recent Applications</h3>
              <p className="text-xs text-neutral-500 mt-0.5">Latest Driver Activity</p>
            </div>
            <Link to="/admin" search={{ tab: "drivers" } as any} className="text-xs text-neutral-500 hover:text-neutral-900 inline-flex items-center gap-1">
              View all <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
           <div className="divide-y divide-[#f0f0f3]">
            {recent.length === 0 && (
              <div className="px-5 py-8 text-center text-sm text-neutral-500">No applications yet.</div>
            )}
            {recent.map((a) => (
              <Link
                key={a.id}
                to="/admin"
                search={{ tab: "drivers", id: a.id } as any}
                className="block px-5 py-3.5 hover:bg-[#fafbfc] transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-full bg-[#f5f6f8] grid place-items-center text-[12px] font-semibold text-neutral-700 shrink-0">
                    {(a.full_name || "?").slice(0, 1).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-neutral-900 truncate">{a.full_name || "Unnamed"}</span>
                      {a.ai_tier && (
                        <span
                          className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${
                            a.ai_tier === "hot"
                              ? "bg-red-50 text-red-700 border-red-100"
                              : a.ai_tier === "warm"
                              ? "bg-amber-50 text-amber-700 border-amber-100"
                              : "bg-neutral-50 text-neutral-600 border-neutral-100"
                          }`}
                        >
                          {a.ai_tier}
                          {a.ai_score != null && <span className="ml-1 opacity-70">{a.ai_score}</span>}
                        </span>
                      )}
                      <span className="text-[10px] uppercase tracking-wide font-medium text-neutral-500 border border-[#ececf0] rounded px-1.5 py-0.5">
                        {a.status || "new"}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 flex-wrap text-xs text-neutral-500">
                      <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{a.city || "—"}</span>
                      <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{timeAgo(a.created_at)}</span>
                      <span className="text-neutral-400">•</span>
                      <span className="text-neutral-600 font-medium">{stepLabel(a)}</span>
                      {a.rental_duration_days && (
                        <>
                          <span className="text-neutral-400">•</span>
                          <span>{a.rental_duration_days}d rental</span>
                        </>
                      )}
                    </div>
                    <div className="mt-1.5 flex items-center gap-3 flex-wrap text-xs">
                      {a.phone && (
                        <a
                          href={`tel:${a.phone}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-neutral-700 hover:text-real-red"
                        >
                          <Phone className="w-3 h-3" />{a.phone}
                        </a>
                      )}
                      {a.email && (
                        <a
                          href={`mailto:${a.email}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-neutral-700 hover:text-real-red truncate max-w-[220px]"
                        >
                          <Mail className="w-3 h-3 shrink-0" /><span className="truncate">{a.email}</span>
                        </a>
                      )}
                      {!a.phone && !a.email && (
                        <span className="text-neutral-400">No contact info yet</span>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Hot prospects */}
        <div className="bg-white border border-[#ececf0] rounded-xl">
          <div className="px-5 pt-5 pb-3">
            <h3 className="text-sm font-semibold text-neutral-900 flex items-center gap-1.5">
              <Flame className="w-4 h-4 text-real-red" /> Hot Prospects
            </h3>
            <p className="text-xs text-neutral-500 mt-0.5">Top AI-Scored Leads</p>
          </div>
          <div className="divide-y divide-[#f0f0f3]">
            {hot.length === 0 && (
              <div className="px-5 py-8 text-center text-sm text-neutral-500">No hot prospects yet.</div>
            )}
            {hot.map((a) => (
              <div key={a.id} className="px-5 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-neutral-900 truncate">{a.full_name || "Unnamed"}</div>
                  <div className="text-xs text-neutral-500 truncate">{a.city || "—"}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-neutral-900">{a.ai_score ?? "—"}</div>
                  <div className="text-[10px] text-neutral-500">score</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  delta,
  hint,
  accent,
}: {
  icon: any;
  label: string;
  value: number | string;
  delta?: number;
  hint?: string;
  accent?: "red";
}) {
  const deltaPositive = (delta ?? 0) >= 0;
  return (
    <div className="bg-white border border-[#ececf0] rounded-xl p-5">
      <div className="flex items-center justify-between">
        <div className={`w-9 h-9 rounded-lg grid place-items-center ${accent === "red" ? "bg-[#fef2f2] text-real-red" : "bg-[#f5f6f8] text-neutral-700"}`}>
          <Icon className="w-[18px] h-[18px]" />
        </div>
        {delta !== undefined && (
          <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${deltaPositive ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
            {deltaPositive ? "+" : ""}
            {delta}%
          </span>
        )}
      </div>
      <div className="mt-4 text-[26px] leading-none font-semibold tracking-tight text-neutral-900">{value}</div>
      <div className="mt-1.5 text-xs text-neutral-500">{label}</div>
      {hint && <div className="mt-0.5 text-[11px] text-neutral-400">{hint}</div>}
    </div>
  );
}

function SummaryRow({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number | string; tone?: "emerald" }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-[#f5f6f8] grid place-items-center text-neutral-600">
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 text-sm text-neutral-700">{label}</div>
      <div className={`text-sm font-semibold ${tone === "emerald" ? "text-emerald-700" : "text-neutral-900"}`}>{value}</div>
    </div>
  );
}

function ActivityDonut({
  tab,
  onTab,
  fleet,
  drivers,
}: {
  tab: "fleet" | "drivers";
  onTab: (t: "fleet" | "drivers") => void;
  fleet: FleetBreak;
  drivers: DriverBreak;
}) {
  const fleetSegs = [
    { key: "Available", value: fleet.available, color: "#facc15" },
    { key: "Rented", value: fleet.rented, color: "#22c55e" },
    { key: "Maintenance", value: fleet.maintenance, color: "#E61919" },
  ];
  const driverSegs = [
    { key: "Active", value: drivers.active, color: "#22c55e" },
    { key: "Screening", value: drivers.screening, color: "#facc15" },
    { key: "Leads", value: drivers.leads, color: "#0ea5e9" },
    { key: "Hot", value: drivers.hot, color: "#E61919" },
  ];
  const segs = tab === "fleet" ? fleetSegs : driverSegs;
  const total = segs.reduce((a, s) => a + s.value, 0);
  const totalLabel = tab === "fleet" ? "Total Vehicles" : "Total Drivers";

  // Utilization = rented / (available + rented) ignoring maintenance
  const utilBase = fleet.available + fleet.rented;
  const utilization = utilBase > 0 ? Math.round((fleet.rented / utilBase) * 100) : 0;
  const earning = fleet.rented; // rented vehicles are earning
  const weeklyRate = 350;
  const earningRevenue = earning * weeklyRate;

  const pieData = total > 0 ? segs : [{ key: "Empty", value: 1, color: "#eef0f3" }];

  return (
    <div className="bg-white border border-[#ececf0] rounded-xl p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">
            {tab === "fleet" ? "Fleet Activity" : "Driver Activity"}
          </h3>
          <p className="text-xs text-neutral-500 mt-0.5">
            {tab === "fleet" ? "Vehicles By Status" : "Drivers By Stage"}
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-[#ececf0] p-0.5 bg-[#fafbfc]">
          {(["fleet", "drivers"] as const).map((t) => (
            <button
              key={t}
              onClick={() => onTab(t)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors ${
                tab === t ? "bg-white text-neutral-900 shadow-sm border border-[#ececf0]" : "text-neutral-500 hover:text-neutral-900"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
        <div className="relative h-64">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="key"
                innerRadius="70%"
                outerRadius="95%"
                paddingAngle={total > 0 ? 3 : 0}
                stroke="none"
                startAngle={90}
                endAngle={-270}
              >
                {pieData.map((s, i) => <Cell key={i} fill={s.color} />)}
              </Pie>
              {total > 0 && (
                <Tooltip
                  contentStyle={{ background: "#fff", border: "1px solid #ececf0", borderRadius: 8, fontSize: 12 }}
                />
              )}
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <div className="text-center">
              <div className="text-3xl font-semibold tracking-tight text-neutral-900 tabular-nums">
                {total.toLocaleString()}
              </div>
              <div className="mt-1 text-xs text-neutral-500">{totalLabel}</div>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {segs.map((s) => {
            const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
            return (
              <div key={s.key} className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                <div className="text-sm text-neutral-800 flex-1">{s.key}</div>
                <div className="text-sm font-semibold text-neutral-900 tabular-nums">{s.value.toLocaleString()}</div>
                <div className="text-[11px] text-neutral-500 w-10 text-right tabular-nums">{pct}%</div>
              </div>
            );
          })}

          {tab === "fleet" && (
            <div className="mt-4 pt-4 border-t border-[#f0f0f3] space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-neutral-500">Utilization</span>
                <span className="font-semibold text-neutral-900 tabular-nums">{utilization}%</span>
              </div>
              <div className="h-2 rounded-full bg-[#f5f6f8] overflow-hidden">
                <div className="h-full bg-[#22c55e]" style={{ width: `${utilization}%` }} />
              </div>
              <div className="text-xs text-neutral-500 pt-1">
                {fleet.rented} Of {total} On The Road
              </div>
              <div className="flex items-center justify-between rounded-lg border border-[#ececf0] p-3 bg-[#fafbfc]">
                <span className="inline-flex items-center gap-1.5 text-xs text-neutral-500">
                  <DollarSign className="w-3.5 h-3.5" /> Earning Now
                </span>
                <span className="text-sm font-semibold tabular-nums text-[#16a34a]">
                  ${earningRevenue.toLocaleString()}/wk
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MiniFinanceCard({
  icon: Icon,
  tone,
  label,
  hint,
  value,
  prev,
  series,
  format,
  invertDelta,
  noDelta,
}: {
  icon: any;
  tone: "emerald" | "sky" | "violet" | "red";
  label: string;
  hint?: string;
  value?: number;
  prev?: number;
  series?: { day: string; value: number }[];
  format?: "usd";
  invertDelta?: boolean;
  noDelta?: boolean;
}) {
  const toneMap = {
    emerald: { text: "text-emerald-600", bg: "bg-emerald-50", stroke: "#22c55e", fill: "rgba(34,197,94,0.12)" },
    sky: { text: "text-sky-600", bg: "bg-sky-50", stroke: "#0ea5e9", fill: "rgba(14,165,233,0.12)" },
    violet: { text: "text-violet-600", bg: "bg-violet-50", stroke: "#8b5cf6", fill: "rgba(139,92,246,0.12)" },
    red: { text: "text-real-red", bg: "bg-red-50", stroke: "#E61919", fill: "rgba(230,25,25,0.12)" },
  } as const;
  const t = toneMap[tone];

  const fmt = (n?: number) => {
    if (n == null) return "—";
    if (format === "usd") {
      return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    }
    return n.toLocaleString();
  };

  let deltaPct: number | undefined;
  if (!noDelta && value != null && prev != null) {
    if (prev === 0) deltaPct = value > 0 ? 100 : 0;
    else deltaPct = Math.round(((value - prev) / prev) * 100);
  }
  const isGood = deltaPct == null ? true : invertDelta ? deltaPct <= 0 : deltaPct >= 0;
  const gradId = `mini-${tone}-${label.replace(/\s+/g, "")}`;

  return (
    <div className="bg-white border border-[#ececf0] rounded-xl p-5">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-lg grid place-items-center ${t.bg} ${t.text}`}>
            <Icon className="w-4 h-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-neutral-900">{label}</div>
            {hint && <div className="text-[11px] text-neutral-500">{hint}</div>}
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <div className="text-[22px] leading-none font-semibold tracking-tight text-neutral-900 tabular-nums">
            {fmt(value)}
          </div>
          {deltaPct !== undefined && (
            <div className={`mt-2 inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded ${isGood ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
              {isGood ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
              {Math.abs(deltaPct)}%
            </div>
          )}
        </div>
        <div className="h-12 flex-1 max-w-[140px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series ?? []} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={t.stroke} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={t.stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="value" stroke={t.stroke} strokeWidth={2} fill={`url(#${gradId})`} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}