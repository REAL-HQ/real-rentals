import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Users, Car, CreditCard, ShieldCheck, TrendingUp, ArrowUpRight, Flame, Phone, Mail, MapPin, Clock, Wrench } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell } from "recharts";

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

type DayPoint = { day: string; leads: number; apps: number };

function fmtDay(d: Date) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function OverviewPanel() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [series, setSeries] = useState<DayPoint[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const [hot, setHot] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const now = new Date();
      const d7 = new Date(now.getTime() - 7 * 864e5).toISOString();
      const d14 = new Date(now.getTime() - 14 * 864e5).toISOString();
      const d30 = new Date(now.getTime() - 30 * 864e5).toISOString();

      const [leads7q, leadsPrevQ, apps7q, activeQ, vehiclesQ, vehiclesAvailQ, hotQ, screenQ, recentAppsQ, seriesAppsQ, hotListQ] = await Promise.all([
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
                <span className="w-2 h-2 rounded-full bg-real-red" /> Leads
              </span>
              <span className="inline-flex items-center gap-1.5 text-neutral-600">
                <span className="w-2 h-2 rounded-full bg-emerald-500" /> Apps
              </span>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="fillLeads" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#E61919" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#E61919" stopOpacity={0} />
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
                <Area type="monotone" dataKey="leads" stroke="#E61919" strokeWidth={2.5} fill="url(#fillLeads)" dot={false} activeDot={{ r: 4 }} />
                <Area type="monotone" dataKey="apps" stroke="#22c55e" strokeWidth={2.5} fill="url(#fillApps)" dot={false} activeDot={{ r: 4 }} />
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