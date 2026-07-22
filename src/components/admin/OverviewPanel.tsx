import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Users, Car, CreditCard, ShieldCheck, TrendingUp, ArrowUpRight, Flame } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

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
        supabase.from("applications").select("id, full_name, city, status, ai_tier, ai_score, created_at").order("created_at", { ascending: false }).limit(6),
        supabase.from("applications").select("created_at").gte("created_at", d30),
        supabase.from("applications").select("id, full_name, city, ai_score, ai_tier, created_at").eq("ai_tier", "hot").order("ai_score", { ascending: false }).limit(5),
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

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          icon={Users}
          label="New leads (7d)"
          value={kpis?.leads7 ?? "—"}
          delta={kpis ? trend(kpis.leads7, kpis.leadsPrev7) : undefined}
          hint="vs. previous 7d"
        />
        <KpiCard
          icon={TrendingUp}
          label="Applications (7d)"
          value={kpis?.apps7 ?? "—"}
          hint="Completed profile step"
        />
        <KpiCard
          icon={Flame}
          label="Hot prospects"
          value={kpis?.hotLeads ?? "—"}
          hint="AI-scored"
          accent="red"
        />
        <KpiCard
          icon={ShieldCheck}
          label="Screenings pending"
          value={kpis?.screeningsPending ?? "—"}
          hint="Interview not completed"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Chart */}
        <div className="lg:col-span-2 bg-white border border-[#ececf0] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-neutral-900">Lead & Application Flow</h3>
              <p className="text-xs text-neutral-500 mt-0.5">Last 30 days</p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="inline-flex items-center gap-1.5 text-neutral-600">
                <span className="w-2 h-2 rounded-full bg-real-red" /> Leads
              </span>
              <span className="inline-flex items-center gap-1.5 text-neutral-600">
                <span className="w-2 h-2 rounded-full bg-neutral-800" /> Apps
              </span>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="gLeads" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#E61919" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#E61919" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gApps" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#111" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#111" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f3" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#8a8a94" }} axisLine={false} tickLine={false} interval={4} />
                <YAxis tick={{ fontSize: 11, fill: "#8a8a94" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: "#fff", border: "1px solid #ececf0", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#111", fontWeight: 600 }}
                />
                <Area type="monotone" dataKey="leads" stroke="#E61919" strokeWidth={2} fill="url(#gLeads)" />
                <Area type="monotone" dataKey="apps" stroke="#111" strokeWidth={2} fill="url(#gApps)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Fleet summary */}
        <div className="bg-white border border-[#ececf0] rounded-xl p-5">
          <h3 className="text-sm font-semibold text-neutral-900">Fleet</h3>
          <p className="text-xs text-neutral-500 mt-0.5 mb-4">Inventory at a glance</p>
          <div className="space-y-4">
            <SummaryRow icon={Car} label="Total vehicles" value={kpis?.vehicles ?? "—"} />
            <SummaryRow icon={CreditCard} label="Available" value={kpis?.vehiclesAvailable ?? "—"} tone="emerald" />
            <SummaryRow icon={Users} label="Active drivers" value={kpis?.activeDrivers ?? "—"} />
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
              <h3 className="text-sm font-semibold text-neutral-900">Recent applications</h3>
              <p className="text-xs text-neutral-500 mt-0.5">Latest driver activity</p>
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
              <div key={a.id} className="px-5 py-3 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-[#f5f6f8] grid place-items-center text-[11px] font-semibold text-neutral-700">
                  {(a.full_name || "?").slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-neutral-900 truncate">{a.full_name || "Unnamed"}</div>
                  <div className="text-xs text-neutral-500 truncate">
                    {a.city || "—"} · {new Date(a.created_at).toLocaleDateString()}
                  </div>
                </div>
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
                <span className="text-[10px] uppercase tracking-wide font-medium text-neutral-500">{a.status}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Hot prospects */}
        <div className="bg-white border border-[#ececf0] rounded-xl">
          <div className="px-5 pt-5 pb-3">
            <h3 className="text-sm font-semibold text-neutral-900 flex items-center gap-1.5">
              <Flame className="w-4 h-4 text-real-red" /> Hot prospects
            </h3>
            <p className="text-xs text-neutral-500 mt-0.5">Top AI-scored leads</p>
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