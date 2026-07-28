import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Car, Users, CreditCard, Wrench, ArrowUpRight, Plus, Flame, CheckCircle2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { ResponsiveContainer, ComposedChart, Bar, Line, Tooltip, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import { SectionCard, MicroLabel, StatusPill } from "./ui";
import { computeDueReasons, needsOdometer } from "./MaintenancePanel";

type WeekPoint = { label: string; iso: string; collected: number; billed: number };

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
  const [paymentsLate, setPaymentsLate] = useState(0);
  const [outstandingAmt, setOutstandingAmt] = useState(0);
  const [weekly, setWeekly] = useState<WeekPoint[]>([]);
  const [weekTotal, setWeekTotal] = useState(0);
  const [prevWeekTotal, setPrevWeekTotal] = useState(0);
  const [nextReturn, setNextReturn] = useState<string | null>(null);
  const [recentApps, setRecentApps] = useState<any[]>([]);
  const [hot, setHot] = useState<any[]>([]);
  const [serviceDue, setServiceDue] = useState(0);
  const [serviceNeedsOdo, setServiceNeedsOdo] = useState(0);

  useEffect(() => {
    (async () => {
      const now = new Date();
      const d7 = new Date(now.getTime() - 7 * 864e5).toISOString();
      const d14 = new Date(now.getTime() - 14 * 864e5).toISOString();
      const d84 = new Date(now.getTime() - 84 * 864e5).toISOString();

      const [
        vTotalQ, vAvailQ, vRentedQ, vMaintQ, vReservedQ,
        newAppsQ, paymentsLateQ, paymentsOutQ,
        payWeekQ, payPrevWeekQ, pay12wQ, billed12wQ,
        nextReturnQ, recentAppsQ, hotAppsQ, allVehiclesQ,
      ] = await Promise.all([
        supabase.from("vehicles").select("id", { count: "exact", head: true }),
        supabase.from("vehicles").select("id", { count: "exact", head: true }).eq("status", "available"),
        supabase.from("vehicles").select("id", { count: "exact", head: true }).eq("status", "rented"),
        supabase.from("vehicles").select("id", { count: "exact", head: true }).eq("status", "maintenance"),
        supabase.from("vehicles").select("id", { count: "exact", head: true }).eq("status", "reserved"),
        supabase.from("applications").select("id", { count: "exact", head: true }).eq("status", "new"),
        supabase.from("payments").select("id", { count: "exact", head: true }).eq("status", "past_due"),
        supabase.from("payments").select("amount").neq("status", "paid"),
        supabase.from("payments").select("amount").eq("status", "paid").gte("paid_date", d7),
        supabase.from("payments").select("amount").eq("status", "paid").gte("paid_date", d14).lt("paid_date", d7),
        supabase.from("payments").select("amount, paid_date").eq("status", "paid").gte("paid_date", d84),
        supabase.from("payments").select("amount, due_date").gte("due_date", d84),
        supabase.from("rentals").select("end_date").eq("status", "active").not("end_date", "is", null).gte("end_date", new Date().toISOString().slice(0,10)).order("end_date", { ascending: true }).limit(1),
        supabase.from("applications").select("id, full_name, status, current_step, ai_tier, ai_score, score, created_at").neq("status", "duplicate").order("score", { ascending: false, nullsFirst: false } as any).order("created_at", { ascending: false }).limit(5),
        supabase.from("applications").select("id, full_name, score").neq("status", "duplicate").gte("score", 80).order("score", { ascending: false }).limit(3),
        supabase.from("vehicles").select("id, status, current_odometer, last_oil_change_miles, oil_interval_miles, last_tire_date, last_brake_inspection_date"),
      ]);

      setVehiclesTotal(vTotalQ.count ?? 0);
      setVehiclesAvail(vAvailQ.count ?? 0);
      setRented(vRentedQ.count ?? 0);
      setMaintOpen(vMaintQ.count ?? 0);
      setReserved(vReservedQ.count ?? 0);
      setNewApps(newAppsQ.count ?? 0);
      setPaymentsLate(paymentsLateQ.count ?? 0);
      const sumAmt = (rows?: any[] | null) => (rows ?? []).reduce((a, r) => a + Number(r.amount ?? 0), 0);
      setOutstandingAmt(sumAmt(paymentsOutQ.data));
      setWeekTotal(sumAmt(payWeekQ.data));
      setPrevWeekTotal(sumAmt(payPrevWeekQ.data));
      const dueCount = (allVehiclesQ.data ?? []).filter((v: any) => v.status !== "maintenance" && computeDueReasons(v).length > 0).length;
      setServiceDue(dueCount);
      const needsOdoCount = (allVehiclesQ.data ?? []).filter((v: any) => v.status !== "maintenance" && needsOdometer(v)).length;
      setServiceNeedsOdo(needsOdoCount);

      // 12-week weekly buckets
      const bucketStart = (d: Date) => { const c = new Date(d); c.setHours(0,0,0,0); c.setDate(c.getDate() - c.getDay()); return c; };
      const start = bucketStart(new Date(now.getTime() - 11 * 7 * 864e5));
      const series: WeekPoint[] = [];
      for (let i = 0; i < 12; i++) {
        const d = new Date(start.getTime() + i * 7 * 864e5);
        series.push({ label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), iso: d.toISOString(), collected: 0, billed: 0 });
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
      setRecentApps(recentAppsQ.data ?? []);
      setHot(hotAppsQ.data ?? []);
    })();
  }, []);

  const total = vehiclesAvail + rented + reserved + maintOpen;
  const rentable = Math.max(0, total - maintOpen);
  const utilPct = rentable > 0 ? Math.round((rented / rentable) * 100) : 0;
  const pctOf = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  const weekDelta = useMemo(() => {
    if (prevWeekTotal === 0) return weekTotal > 0 ? 100 : 0;
    return Math.round(((weekTotal - prevWeekTotal) / prevWeekTotal) * 100);
  }, [weekTotal, prevWeekTotal]);

  return (
    <div className="space-y-6">
      {/* Header + Weekly Revenue summary */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[#111114]">Overview</h1>
          <p className="text-[13px] text-[#55555E] mt-1">Pipeline, Fleet And Revenue At A Glance</p>
        </div>
        <div className="md:text-right">
          <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-[#9A9AA3]">Weekly Revenue</div>
          <div className="text-[22px] font-semibold text-[#111114] tabular-nums leading-tight mt-0.5">{usd(weekTotal)}</div>
          <div className="text-[12px] text-[#55555E] mt-0.5">
            <span className={`font-medium ${weekDelta >= 0 ? "text-[#0F8A4B]" : "text-[#CC0000]"}`}>
              {weekDelta >= 0 ? "+" : ""}{weekDelta}% vs prior week
            </span>
            <span className="mx-1.5 text-[#C7C7CC]">·</span>
            <span className={outstandingAmt > 0 ? "text-[#CC0000]" : "text-[#9A9AA3]"}>{usd(outstandingAmt)} outstanding</span>
          </div>
        </div>
      </div>

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
        {paymentsLate > 0 ? (
          <QuickAction
            icon={CreditCard}
            eyebrow="Collections"
            title="Payments"
            hint={`${paymentsLate} Past Due`}
            badge={paymentsLate}
            href="/admin?tab=payments"
            solid
          />
        ) : (
          <QuickAction
            icon={CheckCircle2}
            eyebrow="Collections"
            title="All Current"
            hint="$0 Outstanding"
            href="/admin?tab=payments"
          />
        )}
        <QuickAction
          icon={Wrench}
          eyebrow="Service"
          title="Service"
          hint={`${maintOpen} Down · ${serviceDue} Due${serviceNeedsOdo > 0 ? ` · ${serviceNeedsOdo} Need Reading` : ""}`}
          badge={maintOpen > 0 ? maintOpen : serviceDue > 0 ? serviceDue : undefined}
          href="/admin?tab=maintenance"
          tint={maintOpen > 0 ? "red" : serviceDue > 0 ? "amber" : undefined}
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
          <div className="grid grid-cols-[auto_1fr] gap-6 items-center">
            <SegmentedDonut
              total={total}
              segments={[
                { key: "rented",      label: "Rented",      value: rented,        color: "#4CD964" },
                { key: "reserved",    label: "Reserved",    value: reserved,      color: "#FFCC33" },
                { key: "available",   label: "Available",   value: vehiclesAvail, color: "#C7C7CC" },
                { key: "maintenance", label: "Maintenance", value: maintOpen,     color: "#FF3B30" },
              ]}
            />
            <div>
              <ul className="space-y-1.5">
                {[
                  { key: "rented",      label: "Rented",      value: rented,        color: "#4CD964" },
                  { key: "reserved",    label: "Reserved",    value: reserved,      color: "#FFCC33" },
                  { key: "available",   label: "Available",   value: vehiclesAvail, color: "#C7C7CC" },
                  { key: "maintenance", label: "Maintenance", value: maintOpen,     color: "#FF3B30" },
                ].map((s) => (
                  <li key={s.key} className="flex items-center gap-2 text-[13px]">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: s.color }} />
                    <span className="text-[#111114] flex-1">{s.label}</span>
                    <span className="tabular-nums font-medium text-[#111114]">{s.value}</span>
                    <span className="tabular-nums text-[11px] text-[#9A9AA3] w-9 text-right">{pctOf(s.value)}%</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4">
                <div className="flex items-baseline justify-between mb-1">
                  <MicroLabel>Utilization {utilPct}% (Of Rentable)</MicroLabel>
                  <span className="text-[11px] text-[#9A9AA3] tabular-nums">{rented}/{rentable}</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-[#EDEDF0] overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${utilPct}%`, background: "#4CD964" }} />
                </div>
              </div>
            </div>
          </div>
          <div className="mt-5 pt-5 border-t border-[#EDEDF0]">
            <div className="grid grid-cols-3 gap-2">
              <OpStat label="Available Now" value={String(vehiclesAvail)} />
              <OpStat label="In Service" value={String(maintOpen)} tone={maintOpen > 0 ? "red" : undefined} />
              <OpStat label="Next Return" value={shortDate(nextReturn)} />
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
                      <ScorePill score={a.score} />
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
        // Worst week = biggest shortfall (billed - collected) among weeks with billing.
        let worst: WeekPoint | null = null;
        let worstGap = 0;
        for (const w of weekly) {
          const gap = w.billed - w.collected;
          if (w.billed > 0 && gap > worstGap) { worstGap = gap; worst = w; }
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
                <span className="text-[11px] text-[#55555E]">Billed <span className="tabular-nums font-medium text-[#111114]">{usd(totBilled)}</span></span>
                <span className="text-[11px] text-[#55555E]">Collected <span className="tabular-nums font-medium text-[#0F8A4B]">{usd(totCollected)}</span></span>
                <span className={`text-[11px] ${outstandingAmt > 0 ? "text-[#CC0000]" : "text-[#9A9AA3]"}`}>Outstanding <span className="tabular-nums font-medium">{usd(outstandingAmt)}</span></span>
              </div>
            }
          >
            <div className="h-[240px] -mx-2">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={weekly} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#EDEDF0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "#9A9AA3", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "#EDEDF0" }} />
                  <YAxis tick={{ fill: "#9A9AA3", fontSize: 10 }} tickLine={false} axisLine={false} width={48}
                    tickFormatter={(v) => v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`} />
                  <Tooltip contentStyle={{ background: "#fff", border: "1px solid #EDEDF0", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: any, name: any) => [usd(Number(v)), name === "billed" ? "Billed" : "Collected"]} />
                  <Legend wrapperStyle={{ fontSize: 11, color: "#55555E" }} iconType="circle" />
                  <Bar dataKey="billed" name="Billed" fill="#EDEDF0" radius={[4,4,0,0]} isAnimationActive={false} />
                  <Line type="monotone" dataKey="collected" name="Collected" stroke="#50C060" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        );
      })()}

      {hot.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-[12px] text-[#55555E]">
          <MicroLabel>Hot Prospects</MicroLabel>
          {hot.map((h) => (
            <Link key={h.id} to="/admin" search={{ tab: "drivers", id: h.id } as any}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#EDEDF0] bg-white px-2.5 py-1 hover:border-[#D03020] transition-colors">
              <Flame className="w-3 h-3 text-[#D03020]" /> {h.full_name} · {h.score}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function QuickAction({
  icon: Icon, eyebrow, title, hint, href, badge, solid, tint,
}: {
  icon: any; eyebrow: string; title: string; hint?: string;
  href: string; badge?: number; solid?: boolean; tint?: "red" | "amber";
}) {
  const base = solid
    ? "bg-[#CC0000] text-white border-transparent hover:bg-[#B00000]"
    : tint === "red"
      ? "bg-white text-[#111114] border-[#CC0000]/40 hover:border-[#CC0000]"
      : tint === "amber"
        ? "bg-white text-[#111114] border-[#B77900]/40 hover:border-[#B77900]"
        : "bg-white text-[#111114] border-[#EDEDF0] hover:border-[#D03020]";
  const badgeBg = solid
    ? "bg-white text-[#CC0000]"
    : tint === "amber"
      ? "bg-[#B77900] text-white"
      : "bg-[#CC0000] text-white";
  return (
    <Link
      to={href}
      className={`group relative rounded-2xl border shadow-sm px-5 py-4 transition-colors ${base}`}
    >
      <div className="flex items-center justify-between">
        <div className={`h-9 w-9 rounded-full grid place-items-center ${solid ? "bg-white/15 text-white" : "bg-[#F4F4F6] text-[#55555E]"}`}>
          <Icon className="w-4 h-4" strokeWidth={1.75} />
        </div>
        <div className={`h-7 w-7 rounded-full grid place-items-center ${solid ? "bg-white/15 text-white" : "bg-[#111114] text-white group-hover:bg-[#CC0000]"} transition-colors`}>
          <Plus className="w-3.5 h-3.5" strokeWidth={2} />
        </div>
      </div>
      <div className={`mt-4 text-[10px] uppercase tracking-[0.12em] font-semibold ${solid ? "text-white/70" : "text-[#9A9AA3]"}`}>
        {eyebrow}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className={`text-[18px] font-semibold tracking-tight ${solid ? "text-white" : "text-[#111114]"}`}>{title}</div>
        {badge != null && (
          <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-semibold ${badgeBg}`}>
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

function ScorePill({ score }: { score: number | null | undefined }) {
  if (score == null) return null;
  const tone = score >= 80 ? "green" : score >= 50 ? "amber" : "neutral";
  return <StatusPill tone={tone as any}>{score}</StatusPill>;
}

function OpStat({ label, value, tone }: { label: string; value: string; tone?: "red" }) {
  return (
    <div className="rounded-xl border border-[#EDEDF0] bg-white px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-[#9A9AA3]">{label}</div>
      <div className={`mt-1 text-[18px] font-semibold tabular-nums leading-none ${tone === "red" ? "text-[#CC0000]" : "text-[#111114]"}`}>{value}</div>
    </div>
  );
}

function SegmentedDonut({ total, segments }: {
  total: number;
  segments: { key: string; label: string; value: number; color: string }[];
}) {
  const size = 160, stroke = 16, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const gap = 2; // px gap between segments
  let offset = 0;
  const sum = segments.reduce((a, s) => a + s.value, 0) || 1;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} stroke="#EDEDF0" strokeWidth={stroke} fill="none" />
        {segments.map((s) => {
          if (s.value <= 0) return null;
          const len = (s.value / sum) * c;
          const dash = Math.max(0, len - gap);
          const el = (
            <circle
              key={s.key}
              cx={size/2} cy={size/2} r={r}
              stroke={s.color} strokeWidth={stroke} fill="none"
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
          <div className="text-[26px] font-semibold text-[#111114] tabular-nums leading-none">{total}</div>
          <div className="text-[10px] text-[#9A9AA3] mt-1 uppercase tracking-[0.12em] font-semibold">Total Vehicles</div>
        </div>
      </div>
    </div>
  );
}
