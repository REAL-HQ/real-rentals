import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Car, Users, CreditCard, MessageSquare, ArrowUpRight, Plus, Flame } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { ResponsiveContainer, AreaChart, Area, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { SectionCard, MicroLabel, StatusPill } from "./ui";
import { resolvePhotoUrl } from "@/lib/photoUrl";

type WeekPoint = { label: string; iso: string; amount: number };

function usd(n: number | undefined | null) {
  if (n == null) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function timeAgo(iso?: string | null) {
  if (!iso) return "—";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); return `${d}d ago`;
}
function initials(name?: string | null) {
  const parts = (name || "?").trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export function OverviewPanel() {
  const [vehiclesAvail, setVehiclesAvail] = useState(0);
  const [vehiclesTotal, setVehiclesTotal] = useState(0);
  const [rented, setRented] = useState(0);
  const [maintOpen, setMaintOpen] = useState(0);
  const [reserved, setReserved] = useState(0);
  const [unreadMsgs, setUnreadMsgs] = useState(0);
  const [newApps, setNewApps] = useState(0);
  const [paymentsLate, setPaymentsLate] = useState(0);
  const [outstandingAmt, setOutstandingAmt] = useState(0);
  const [weekly, setWeekly] = useState<WeekPoint[]>([]);
  const [weekTotal, setWeekTotal] = useState(0);
  const [prevWeekTotal, setPrevWeekTotal] = useState(0);
  const [vehiclePreview, setVehiclePreview] = useState<any[]>([]);
  const [recentApps, setRecentApps] = useState<any[]>([]);
  const [hot, setHot] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const now = new Date();
      const d7 = new Date(now.getTime() - 7 * 864e5).toISOString();
      const d14 = new Date(now.getTime() - 14 * 864e5).toISOString();
      const d84 = new Date(now.getTime() - 84 * 864e5).toISOString();

      const [
        vTotalQ, vAvailQ, vRentedQ, vMaintQ, vReservedQ,
        newAppsQ, paymentsLateQ, paymentsOutQ, unreadQ,
        payWeekQ, payPrevWeekQ, pay12wQ,
        vehiclePreviewQ, recentAppsQ, hotAppsQ,
      ] = await Promise.all([
        supabase.from("vehicles").select("id", { count: "exact", head: true }),
        supabase.from("vehicles").select("id", { count: "exact", head: true }).eq("status", "available"),
        supabase.from("vehicles").select("id", { count: "exact", head: true }).eq("status", "rented"),
        supabase.from("vehicles").select("id", { count: "exact", head: true }).eq("status", "maintenance"),
        supabase.from("vehicles").select("id", { count: "exact", head: true }).eq("status", "reserved"),
        supabase.from("applications").select("id", { count: "exact", head: true }).eq("status", "new"),
        supabase.from("payments").select("id", { count: "exact", head: true }).eq("status", "past_due"),
        supabase.from("payments").select("amount").neq("status", "paid"),
        supabase.from("message_threads").select("id", { count: "exact", head: true }).gt("unread_count", 0),
        supabase.from("payments").select("amount").eq("status", "paid").gte("paid_date", d7),
        supabase.from("payments").select("amount").eq("status", "paid").gte("paid_date", d14).lt("paid_date", d7),
        supabase.from("payments").select("amount, paid_date").eq("status", "paid").gte("paid_date", d84),
        supabase.from("vehicles").select("id, make, model, status, photos").order("updated_at", { ascending: false }).limit(6),
        supabase.from("applications").select("id, full_name, status, current_step, ai_tier, ai_score, created_at").order("created_at", { ascending: false }).limit(5),
        supabase.from("applications").select("id, full_name, ai_score").eq("ai_tier", "hot").order("ai_score", { ascending: false }).limit(3),
      ]);

      setVehiclesTotal(vTotalQ.count ?? 0);
      setVehiclesAvail(vAvailQ.count ?? 0);
      setRented(vRentedQ.count ?? 0);
      setMaintOpen(vMaintQ.count ?? 0);
      setReserved(vReservedQ.count ?? 0);
      setNewApps(newAppsQ.count ?? 0);
      setPaymentsLate(paymentsLateQ.count ?? 0);
      setUnreadMsgs(unreadQ.count ?? 0);
      const sumAmt = (rows?: any[] | null) => (rows ?? []).reduce((a, r) => a + Number(r.amount ?? 0), 0);
      setOutstandingAmt(sumAmt(paymentsOutQ.data));
      setWeekTotal(sumAmt(payWeekQ.data));
      setPrevWeekTotal(sumAmt(payPrevWeekQ.data));

      // 12-week weekly buckets
      const bucketStart = (d: Date) => { const c = new Date(d); c.setHours(0,0,0,0); c.setDate(c.getDate() - c.getDay()); return c; };
      const start = bucketStart(new Date(now.getTime() - 11 * 7 * 864e5));
      const series: WeekPoint[] = [];
      for (let i = 0; i < 12; i++) {
        const d = new Date(start.getTime() + i * 7 * 864e5);
        series.push({ label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), iso: d.toISOString(), amount: 0 });
      }
      for (const p of (pay12wQ.data ?? []) as any[]) {
        if (!p.paid_date) continue;
        const w = bucketStart(new Date(p.paid_date));
        const idx = Math.round((w.getTime() - start.getTime()) / (7 * 864e5));
        if (idx >= 0 && idx < 12) series[idx].amount += Number(p.amount ?? 0);
      }
      setWeekly(series);
      setVehiclePreview(vehiclePreviewQ.data ?? []);
      setRecentApps(recentAppsQ.data ?? []);
      setHot(hotAppsQ.data ?? []);
    })();
  }, []);

  const utilBase = vehiclesAvail + rented + reserved + maintOpen;
  const onRentPct = utilBase > 0 ? Math.round((rented / utilBase) * 100) : 0;
  const availPct = utilBase > 0 ? Math.round((vehiclesAvail / utilBase) * 100) : 0;
  const weekDelta = useMemo(() => {
    if (prevWeekTotal === 0) return weekTotal > 0 ? 100 : 0;
    return Math.round(((weekTotal - prevWeekTotal) / prevWeekTotal) * 100);
  }, [weekTotal, prevWeekTotal]);

  return (
    <div className="space-y-6">
      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <QuickAction
          icon={Car}
          eyebrow="Fleet"
          title="Add Vehicle"
          hint={`${vehiclesTotal} In Fleet`}
          href="/admin?tab=vehicles"
        />
        <QuickAction
          icon={Users}
          eyebrow="Applications"
          title="Review Drivers"
          hint={`${newApps} New`}
          badge={newApps > 0 ? newApps : undefined}
          href="/admin?tab=drivers"
        />
        <QuickAction
          icon={CreditCard}
          eyebrow="Collections"
          title="Payments"
          hint={paymentsLate > 0 ? `${paymentsLate} Past Due` : "All Current"}
          badge={paymentsLate > 0 ? paymentsLate : undefined}
          href="/admin?tab=payments"
          solid
        />
        <QuickAction
          icon={MessageSquare}
          eyebrow="Inbox"
          title="Messages"
          hint={unreadMsgs > 0 ? `${unreadMsgs} Unread` : "All Read"}
          badge={unreadMsgs > 0 ? unreadMsgs : undefined}
          href="/admin?tab=messages"
        />
      </div>

      {/* Fleet snapshot + Applications queue */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <SectionCard
          className="lg:col-span-3"
          title="Fleet Snapshot"
          subtitle="Utilization And Current Inventory"
          right={
            <Link to="/admin" search={{ tab: "vehicles" } as any} className="inline-flex items-center gap-1 text-[12px] text-[#55555E] hover:text-[#D03020]">
              Open Fleet <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          }
        >
          <div className="grid grid-cols-2 gap-4 sm:gap-6 items-center">
            <ProgressRing label="On Rent" value={rented} pct={onRentPct} color="#50C060" total={utilBase} />
            <ProgressRing label="Available" value={vehiclesAvail} pct={availPct} color="#9A9AA3" total={utilBase} />
          </div>
          <div className="mt-5 pt-5 border-t border-[#EDEDF0]">
            <div className="flex items-center justify-between mb-3">
              <MicroLabel>Recent Vehicles</MicroLabel>
              <div className="flex items-center gap-3 text-[11px] text-[#9A9AA3]">
                <LegendDot color="#50C060" label="Rented" />
                <LegendDot color="#9A9AA3" label="Available" />
                <LegendDot color="#F0C040" label="Reserved" />
                <LegendDot color="#D03020" label="Maintenance" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {vehiclePreview.slice(0, 6).map((v) => {
                const img = resolvePhotoUrl(v.photos?.[0]);
                const dot = v.status === "rented" ? "#50C060"
                  : v.status === "reserved" ? "#F0C040"
                  : v.status === "maintenance" ? "#D03020"
                  : "#9A9AA3";
                return (
                  <Link
                    key={v.id}
                    to="/admin"
                    search={{ tab: "vehicles" } as any}
                    className="flex items-center gap-2.5 rounded-xl border border-[#EDEDF0] bg-white p-2 hover:border-[#D03020] transition-colors min-w-0"
                  >
                    <div className="h-10 w-14 rounded-md bg-[#F4F4F6] overflow-hidden shrink-0 grid place-items-center">
                      {img ? <img src={img} alt="" className="w-full h-full object-cover" /> : <Car className="w-4 h-4 text-[#9A9AA3]" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium text-[#111114] truncate">{v.make} {v.model}</div>
                      <div className="flex items-center gap-1.5 text-[10px] text-[#55555E] mt-0.5 capitalize">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
                        {v.status || "—"}
                      </div>
                    </div>
                  </Link>
                );
              })}
              {vehiclePreview.length === 0 && (
                <div className="col-span-3 text-[12px] text-[#9A9AA3] py-4 text-center">No Vehicles Yet.</div>
              )}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          className="lg:col-span-2"
          title="Applications Queue"
          subtitle={`${newApps} New · ${recentApps.length} Recent`}
          padded={false}
          right={
            <Link to="/admin" search={{ tab: "drivers" } as any} className="inline-flex items-center gap-1 text-[12px] text-[#55555E] hover:text-[#D03020]">
              View All <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          }
        >
          {recentApps.length === 0 ? (
            <div className="px-5 py-10 text-center text-[13px] text-[#9A9AA3]">No Applications Yet.</div>
          ) : (
            <ul>
              {recentApps.map((a) => {
                const stage = a.status === "active" ? "Active"
                  : a.status === "approved" ? "Approved"
                  : a.current_step ? "In Wizard"
                  : "New Lead";
                const tone = a.ai_tier === "hot" ? "green"
                  : a.ai_tier === "warm" ? "amber"
                  : a.ai_tier === "cold" ? "red"
                  : "neutral";
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
                        <div className="text-[13px] font-medium text-[#111114] truncate">{a.full_name || "Unnamed Driver"}</div>
                        <div className="text-[11px] text-[#9A9AA3] mt-0.5">{timeAgo(a.created_at)}</div>
                      </div>
                      <StatusPill status={stage} />
                      {a.ai_score != null && (
                        <StatusPill tone={tone as any}>{a.ai_score}</StatusPill>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* Weekly Rent Collected — full width */}
      <SectionCard
        title="Weekly Rent Collected"
        subtitle="Last 12 Weeks"
        right={
          <div className="flex items-baseline gap-3">
            <div className="text-[20px] font-semibold text-[#111114] tabular-nums leading-none">{usd(weekTotal)}</div>
            <span className={`text-[11px] font-medium ${weekDelta >= 0 ? "text-[#50C060]" : "text-[#D03020]"}`}>
              {weekDelta >= 0 ? "+" : ""}{weekDelta}% vs Prior Week
            </span>
            <span className="text-[11px] text-[#9A9AA3]">· {usd(outstandingAmt)} Outstanding</span>
          </div>
        }
      >
        <div className="h-[240px] -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={weekly} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="rentGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#50C060" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#50C060" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#EDEDF0" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "#9A9AA3", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "#EDEDF0" }} />
              <YAxis tick={{ fill: "#9A9AA3", fontSize: 10 }} tickLine={false} axisLine={false} width={48}
                tickFormatter={(v) => v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`} />
              <Tooltip contentStyle={{ background: "#fff", border: "1px solid #EDEDF0", borderRadius: 8, fontSize: 12 }}
                formatter={(v: any) => [usd(Number(v)), "Collected"]} />
              <Area type="monotone" dataKey="amount" stroke="#50C060" strokeWidth={2.5} fill="url(#rentGrad)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      {hot.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-[12px] text-[#55555E]">
          <MicroLabel>Hot Prospects</MicroLabel>
          {hot.map((h) => (
            <Link key={h.id} to="/admin" search={{ tab: "drivers", id: h.id } as any}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#EDEDF0] bg-white px-2.5 py-1 hover:border-[#D03020] transition-colors">
              <Flame className="w-3 h-3 text-[#D03020]" /> {h.full_name} · {h.ai_score}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function QuickAction({
  icon: Icon, eyebrow, title, hint, href, badge, solid,
}: {
  icon: any; eyebrow: string; title: string; hint?: string;
  href: string; badge?: number; solid?: boolean;
}) {
  const base = solid
    ? "bg-[#D03020] text-white border-transparent hover:bg-[#B82818]"
    : "bg-white text-[#111114] border-[#EDEDF0] hover:border-[#D03020]";
  return (
    <Link
      to={href}
      className={`group relative rounded-2xl border shadow-sm px-5 py-4 transition-colors ${base}`}
    >
      <div className="flex items-center justify-between">
        <div className={`h-9 w-9 rounded-full grid place-items-center ${solid ? "bg-white/15 text-white" : "bg-[#F4F4F6] text-[#55555E]"}`}>
          <Icon className="w-4 h-4" strokeWidth={1.75} />
        </div>
        <div className={`h-7 w-7 rounded-full grid place-items-center ${solid ? "bg-white/15 text-white" : "bg-[#111114] text-white group-hover:bg-[#D03020]"} transition-colors`}>
          <Plus className="w-3.5 h-3.5" strokeWidth={2} />
        </div>
      </div>
      <div className={`mt-4 text-[10px] uppercase tracking-[0.12em] font-semibold ${solid ? "text-white/70" : "text-[#9A9AA3]"}`}>
        {eyebrow}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className={`text-[18px] font-semibold tracking-tight ${solid ? "text-white" : "text-[#111114]"}`}>{title}</div>
        {badge != null && (
          <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-semibold ${solid ? "bg-white text-[#D03020]" : "bg-[#D03020] text-white"}`}>
            {badge}
          </span>
        )}
      </div>
      {hint && (
        <div className={`mt-0.5 text-[11px] ${solid ? "text-white/80" : "text-[#55555E]"}`}>{hint}</div>
      )}
    </Link>
  );
}

function ProgressRing({ label, value, pct, color, total }: {
  label: string; value: number; pct: number; color: string; total: number;
}) {
  const size = 120, stroke = 10, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const off = c - (pct / 100) * c;
  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size/2} cy={size/2} r={r} stroke="#F4F4F6" strokeWidth={stroke} fill="none" />
          <circle cx={size/2} cy={size/2} r={r} stroke={color} strokeWidth={stroke} fill="none"
            strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 600ms ease" }} />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center">
            <div className="text-[20px] font-semibold text-[#111114] tabular-nums leading-none">{pct}%</div>
            <div className="text-[10px] text-[#9A9AA3] mt-1 tabular-nums">{value}/{total}</div>
          </div>
        </div>
      </div>
      <div className="min-w-0">
        <MicroLabel>{label}</MicroLabel>
        <div className="mt-1 text-[15px] font-semibold text-[#111114] tabular-nums">{value} Vehicles</div>
        <div className="text-[11px] text-[#9A9AA3] mt-0.5">Of {total} In Fleet</div>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
