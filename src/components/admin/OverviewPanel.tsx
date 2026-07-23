import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Users, Car, ShieldCheck, TrendingUp, ArrowUpRight, Flame, Phone, Mail, Plus } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { ResponsiveContainer, AreaChart, Area, PieChart, Pie, Cell } from "recharts";

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
  const [greetName, setGreetName] = useState<string>("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const em = data.session?.user?.email || "";
      setGreetName(em ? em.split("@")[0].split(/[._-]/)[0].replace(/^./, (c) => c.toUpperCase()) : "");
    });
  }, []);

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

  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good Morning" : hour < 18 ? "Good Afternoon" : "Good Evening";
  const spark = series.slice(-14);
  const leadsSpark = spark.map((d) => ({ v: d.leads }));
  const appsSpark = spark.map((d) => ({ v: d.apps }));
  const hotSpark = spark.map((d, i) => ({ v: Math.max(0, d.leads - d.apps + (i % 3 === 0 ? 1 : 0)) }));
  const scrSpark = spark.map((d) => ({ v: d.apps }));

  const activity = [
    { name: "Leads", value: kpis?.leads7 ?? 0, color: "#38bdf8" },
    { name: "Applications", value: kpis?.apps7 ?? 0, color: "#facc15" },
    { name: "Hot Prospects", value: kpis?.hotLeads ?? 0, color: "#ec4899" },
    { name: "Active Drivers", value: kpis?.activeDrivers ?? 0, color: "#10b981" },
  ];
  const activityTotal = activity.reduce((s, a) => s + a.value, 0);

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500 font-medium">Dashboard</div>
          <h1 className="mt-2 text-[34px] leading-[1.05] font-bold tracking-tight text-neutral-900">
            {greet}, {greetName || "There"}.
          </h1>
          <p className="mt-2 text-sm text-neutral-500">
            {kpis ? `${kpis.hotLeads} Hot Prospects · ${kpis.screeningsPending} Screenings Pending · ${kpis.leads7} New Leads This Week.` : "Loading Your Snapshot…"}
          </p>
        </div>
        <Link
          to="/admin"
          search={{ tab: "drivers" } as any}
          className="inline-flex items-center gap-2 rounded-lg bg-real-red hover:bg-red-700 text-white px-5 py-3 text-sm font-semibold transition shrink-0"
        >
          <Plus className="w-4 h-4" /> New Screening
        </Link>
      </div>

      {/* Dark KPI grid + Activity donut */}
      <div className="grid grid-cols-1 lg:grid-cols-6 gap-4">
        <div className="lg:col-span-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <DarkKpi icon={Users} label="New Leads" value={kpis?.leads7 ?? 0} unit="THIS WEEK" delta={kpis ? trend(kpis.leads7, kpis.leadsPrev7) : 0} data={leadsSpark} color="#22c55e" />
          <DarkKpi icon={TrendingUp} label="Applications" value={kpis?.apps7 ?? 0} unit="COMPLETED" delta={0} data={appsSpark} color="#22c55e" />
          <DarkKpi icon={Flame} label="Hot Prospects" value={kpis?.hotLeads ?? 0} unit="AI-SCORED" delta={0} data={hotSpark} color="#ec4899" negative />
          <DarkKpi icon={ShieldCheck} label="Screenings" value={kpis?.screeningsPending ?? 0} unit="PENDING" delta={0} data={scrSpark} color="#22c55e" />
        </div>

        {/* Activity donut */}
        <div className="lg:col-span-2 rounded-xl bg-[#0b0b0f] text-white p-6 border border-black/40 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-white/5 grid place-items-center">
                <Flame className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-[13px] font-medium">Pipeline Activity</div>
            </div>
            <div className="text-[10px] text-white/50 uppercase tracking-widest">7d</div>
          </div>
          <div className="mt-4 flex items-center gap-5">
            <div className="relative w-[130px] h-[130px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={activityTotal > 0 ? activity : [{ name: "empty", value: 1, color: "#1f2028" }]}
                    dataKey="value" innerRadius={48} outerRadius={62} paddingAngle={activityTotal > 0 ? 3 : 0} stroke="none">
                    {(activityTotal > 0 ? activity : [{ color: "#1f2028" }]).map((s, i) => (
                      <Cell key={i} fill={s.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 grid place-items-center text-center">
                <div>
                  <div className="text-[20px] font-semibold leading-none">{activityTotal}</div>
                  <div className="text-[9px] text-white/50 mt-1 uppercase tracking-wider">Total</div>
                </div>
              </div>
            </div>
            <div className="flex-1 space-y-2 text-[12px]">
              {activity.map((a) => (
                <div key={a.name} className="flex items-center justify-between gap-3 border-b border-dashed border-white/10 pb-1.5 last:border-0">
                  <span className="inline-flex items-center gap-2 text-white/70">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: a.color }} />
                    {a.name}
                  </span>
                  <span className="text-white tabular-nums">{a.value.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Spreadsheet-style recent applications */}
      <div className="rounded-xl bg-[#0b0b0f] text-white overflow-hidden border border-black/40">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <div className="flex items-center gap-2">
            <div className="text-[15px] font-semibold">Recent Applications</div>
            <span className="text-[11px] text-white/50 tabular-nums">{recent.length}</span>
          </div>
          <Link to="/admin" search={{ tab: "drivers" } as any} className="text-[12px] text-white/60 hover:text-white inline-flex items-center gap-1">
            View All <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wider text-white/40">
                <th className="text-left font-medium px-5 py-3">Applicant</th>
                <th className="text-left font-medium px-3 py-3">City</th>
                <th className="text-left font-medium px-3 py-3">Stage</th>
                <th className="text-left font-medium px-3 py-3">Score</th>
                <th className="text-left font-medium px-3 py-3">Submitted</th>
                <th className="text-left font-medium px-3 py-3">Phone</th>
                <th className="text-left font-medium px-5 py-3">Email</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {recent.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-white/50">No Applications Yet.</td></tr>
              )}
              {recent.map((a) => (
                <tr key={a.id} className="hover:bg-white/[0.03] transition-colors">
                  <td className="px-5 py-3">
                    <Link to="/admin" search={{ tab: "drivers", id: a.id } as any} className="flex items-center gap-2.5 group">
                      <span className="w-7 h-7 rounded-full bg-white/10 grid place-items-center text-[11px] font-semibold">
                        {(a.full_name || "?").slice(0, 1).toUpperCase()}
                      </span>
                      <span className="font-medium text-white group-hover:text-real-red truncate max-w-[160px]">
                        {a.full_name || "Unnamed"}
                      </span>
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-white/70">{a.city || "—"}</td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-white/5 border border-white/10 px-2 py-0.5 text-[11px] text-white/80">
                      {stepLabel(a)}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    {a.ai_score != null ? (
                      <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium ${
                        a.ai_tier === "hot" ? "bg-pink-500/15 text-pink-300"
                          : a.ai_tier === "warm" ? "bg-amber-500/15 text-amber-300"
                          : "bg-white/5 text-white/70"
                      }`}>
                        {a.ai_score}
                        <span className="text-[9px] uppercase opacity-70">{a.ai_tier || ""}</span>
                      </span>
                    ) : <span className="text-white/40">—</span>}
                  </td>
                  <td className="px-3 py-3 text-white/60 tabular-nums">{timeAgo(a.created_at)}</td>
                  <td className="px-3 py-3">
                    {a.phone ? (
                      <a href={`tel:${a.phone}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1.5 text-white/80 hover:text-white">
                        <Phone className="w-3 h-3" />{a.phone}
                      </a>
                    ) : <span className="text-white/40">—</span>}
                  </td>
                  <td className="px-5 py-3">
                    {a.email ? (
                      <a href={`mailto:${a.email}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1.5 text-white/80 hover:text-white truncate max-w-[220px]">
                        <Mail className="w-3 h-3 shrink-0" /><span className="truncate">{a.email}</span>
                      </a>
                    ) : <span className="text-white/40">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Hot prospects + Fleet — light cards on white */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white border border-[#ececf0] rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-neutral-900 flex items-center gap-1.5">
                <Flame className="w-4 h-4 text-real-red" /> Hot Prospects
              </h3>
              <p className="text-xs text-neutral-500 mt-0.5">Top AI-Scored Leads</p>
            </div>
          </div>
          <div className="divide-y divide-[#f0f0f3]">
            {hot.length === 0 && (
              <div className="px-1 py-8 text-center text-sm text-neutral-500">No Hot Prospects Yet.</div>
            )}
            {hot.map((a) => (
              <Link key={a.id} to="/admin" search={{ tab: "drivers", id: a.id } as any} className="flex items-center gap-3 py-2.5 hover:bg-[#fafbfc] px-2 rounded-md">
                <div className="w-8 h-8 rounded-full bg-[#f5f6f8] grid place-items-center text-[11px] font-semibold text-neutral-700">
                  {(a.full_name || "?").slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-neutral-900 truncate">{a.full_name || "Unnamed"}</div>
                  <div className="text-xs text-neutral-500 truncate">{a.city || "—"}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-neutral-900 tabular-nums">{a.ai_score ?? "—"}</div>
                  <div className="text-[10px] uppercase tracking-wider text-real-red">Hot</div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="bg-white border border-[#ececf0] rounded-xl p-5">
          <h3 className="text-sm font-semibold text-neutral-900">Fleet</h3>
          <p className="text-xs text-neutral-500 mt-0.5">Inventory At A Glance</p>
          <div className="mt-5 space-y-3">
            <FleetRow label="Total Vehicles" value={kpis?.vehicles ?? 0} />
            <FleetRow label="Available" value={kpis?.vehiclesAvailable ?? 0} tone="emerald" />
            <FleetRow label="Active Drivers" value={kpis?.activeDrivers ?? 0} />
          </div>
          <div className="mt-5 pt-4 border-t border-[#f0f0f3]">
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-500">Utilization</span>
              <span className="text-neutral-900 font-medium tabular-nums">
                {kpis && kpis.vehicles > 0 ? `${Math.round(((kpis.vehicles - kpis.vehiclesAvailable) / kpis.vehicles) * 100)}%` : "—"}
              </span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-[#f5f6f8] overflow-hidden">
              <div className="h-full bg-neutral-900" style={{
                width: `${kpis && kpis.vehicles > 0 ? Math.min(100, Math.round(((kpis.vehicles - kpis.vehiclesAvailable) / kpis.vehicles) * 100)) : 0}%`,
              }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DarkKpi({
  icon: Icon, label, value, unit, delta, data, color, negative,
}: {
  icon: any; label: string; value: number | string; unit: string; delta: number;
  data: { v: number }[]; color: string; negative?: boolean;
}) {
  const isDown = negative || delta < 0;
  return (
    <div className="rounded-xl bg-[#0b0b0f] text-white p-5 border border-black/40 relative overflow-hidden">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-white/5 grid place-items-center">
            <Icon className="w-4 h-4 text-white/70" />
          </div>
          <div className="text-[13px] font-medium text-white/90">{label}</div>
        </div>
        <ArrowUpRight className="w-4 h-4 text-white/30" />
      </div>
      <div className="mt-4 flex items-baseline gap-2">
        <div className="text-[28px] font-semibold leading-none tabular-nums">{value}</div>
        <div className="text-[10px] text-white/50 uppercase tracking-wider">{unit}</div>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className={`inline-flex items-center gap-1 text-[11px] font-medium ${isDown ? "text-pink-400" : "text-emerald-400"}`}>
          <span className={isDown ? "rotate-180 inline-block" : "inline-block"}>↑</span>
          {Math.abs(delta || 0)}%
        </div>
        <div className="h-10 w-[110px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`spk-${label}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.75} fill={`url(#spk-${label})`} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function FleetRow({ label, value, tone }: { label: string; value: number | string; tone?: "emerald" }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-neutral-600">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${tone === "emerald" ? "text-emerald-600" : "text-neutral-900"}`}>{value}</span>
    </div>
  );
}