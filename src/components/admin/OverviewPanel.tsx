import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Car, Users, ShieldCheck, DollarSign, FileText, ClipboardList, CheckCircle2,
  CreditCard, AlertTriangle, Wrench, Wallet, ArrowUp, ArrowDown, ArrowUpRight, Flame, Sparkles,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Tooltip, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import { MetricCard, SectionCard, MicroLabel, ActionQueueRow, StatusPill } from "./ui";

type FinancePoint = { day: string; billed: number; collected: number };

function fmtDay(d: Date) { return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
function usd(n: number | undefined) {
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

export function OverviewPanel() {
  const [vehiclesAvail, setVehiclesAvail] = useState(0);
  const [vehiclesTotal, setVehiclesTotal] = useState(0);
  const [rented, setRented] = useState(0);
  const [maintOpen, setMaintOpen] = useState(0);
  const [reserved, setReserved] = useState(0);
  const [screeningsPending, setScreeningsPending] = useState(0);
  const [docsPending, setDocsPending] = useState(0);
  const [approvalReady, setApprovalReady] = useState(0);
  const [insuranceNeeded, setInsuranceNeeded] = useState(0);
  const [paymentsDue, setPaymentsDue] = useState(0);
  const [paymentsLate, setPaymentsLate] = useState(0);
  const [weekRevenue, setWeekRevenue] = useState<number | null>(null);
  const [prevWeekRevenue, setPrevWeekRevenue] = useState<number | null>(null);

  const [revenue30, setRevenue30] = useState(0);
  const [collected30, setCollected30] = useState(0);
  const [outstanding, setOutstanding] = useState(0);
  const [expenses30, setExpenses30] = useState(0);
  const [revenueSeries, setRevenueSeries] = useState<FinancePoint[]>([]);

  const [recent, setRecent] = useState<any[]>([]);
  const [hot, setHot] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const now = new Date();
      const d7 = new Date(now.getTime() - 7 * 864e5).toISOString();
      const d14 = new Date(now.getTime() - 14 * 864e5).toISOString();
      const d30 = new Date(now.getTime() - 30 * 864e5).toISOString();

      const [
        vTotalQ, vAvailQ, vRentedQ, vMaintQ, vReservedQ,
        screenPendQ, appApprovedNoVehQ, insMissingQ,
        payDueTodayQ, payLateQ,
        payWeekQ, payPrevWeekQ,
        payLast60Q, maintLast60Q,
        recentAppsQ, hotAppsQ,
      ] = await Promise.all([
        supabase.from("vehicles").select("id", { count: "exact", head: true }),
        supabase.from("vehicles").select("id", { count: "exact", head: true }).eq("status", "available"),
        supabase.from("vehicles").select("id", { count: "exact", head: true }).eq("status", "rented"),
        supabase.from("vehicles").select("id", { count: "exact", head: true }).eq("status", "maintenance"),
        supabase.from("vehicles").select("id", { count: "exact", head: true }).eq("status", "reserved"),
        supabase.from("driver_screenings").select("id", { count: "exact", head: true }).is("interview_completed_at", null),
        supabase.from("applications").select("id", { count: "exact", head: true }).eq("status", "approved").is("vehicle_id", null),
        supabase.from("driver_screenings").select("id", { count: "exact", head: true }).eq("insurance_verified", false),
        supabase.from("payments").select("id", { count: "exact", head: true }).neq("status", "paid").lte("due_date", new Date(now.getTime() + 864e5).toISOString().slice(0,10)),
        supabase.from("payments").select("id", { count: "exact", head: true }).eq("status", "past_due"),
        supabase.from("payments").select("amount, paid_date").eq("status", "paid").gte("paid_date", d7),
        supabase.from("payments").select("amount, paid_date").eq("status", "paid").gte("paid_date", d14).lt("paid_date", d7),
        supabase.from("payments").select("amount, status, paid_date, created_at").gte("created_at", d30),
        supabase.from("maintenance_records").select("total_cost, completed_at, created_at").gte("created_at", d30),
        supabase.from("applications").select("id, full_name, city, status, current_step, ai_tier, ai_score, created_at, source").order("created_at", { ascending: false }).limit(7),
        supabase.from("applications").select("id, full_name, ai_score").eq("ai_tier", "hot").order("ai_score", { ascending: false }).limit(3),
      ]);

      setVehiclesTotal(vTotalQ.count ?? 0);
      setVehiclesAvail(vAvailQ.count ?? 0);
      setRented(vRentedQ.count ?? 0);
      setMaintOpen(vMaintQ.count ?? 0);
      setReserved(vReservedQ.count ?? 0);
      setScreeningsPending(screenPendQ.count ?? 0);
      setApprovalReady(appApprovedNoVehQ.count ?? 0);
      setInsuranceNeeded(insMissingQ.count ?? 0);
      setPaymentsDue(payDueTodayQ.count ?? 0);
      setPaymentsLate(payLateQ.count ?? 0);
      // Rough: docs pending = drivers with screening in "docs_pending" — approximate via count of screenings where status = 'docs_pending'
      const { count: docsCount } = await supabase.from("driver_screenings").select("id", { count: "exact", head: true }).eq("status", "docs_pending");
      setDocsPending(docsCount ?? 0);

      const sumPay = (rows?: any[] | null) => (rows ?? []).reduce((a, r) => a + Number(r.amount ?? 0), 0);
      setWeekRevenue(sumPay(payWeekQ.data));
      setPrevWeekRevenue(sumPay(payPrevWeekQ.data));

      // Revenue & Collections aggregate (30d)
      let rev = 0, out = 0, exp = 0;
      const series: FinancePoint[] = [];
      for (let i = 29; i >= 0; i--) series.push({ day: fmtDay(new Date(now.getTime() - i * 864e5)), billed: 0, collected: 0 });
      const idxFor = (iso: string) => 29 - Math.floor((now.getTime() - new Date(iso).getTime()) / 864e5);
      for (const p of (payLast60Q.data ?? []) as any[]) {
        const amt = Number(p.amount ?? 0);
        const createdIdx = p.created_at ? idxFor(p.created_at) : -1;
        if (createdIdx >= 0 && createdIdx < 30) series[createdIdx].billed += amt;
        if (p.status === "paid" && p.paid_date) {
          rev += amt;
          const i = idxFor(p.paid_date);
          if (i >= 0 && i < 30) series[i].collected += amt;
        } else if (p.status !== "paid") {
          out += amt;
        }
      }
      for (const m of (maintLast60Q.data ?? []) as any[]) {
        exp += Number(m.total_cost ?? 0);
      }
      setRevenue30(rev);
      setCollected30(rev);
      setOutstanding(out);
      setExpenses30(exp);
      setRevenueSeries(series);

      setRecent(recentAppsQ.data ?? []);
      setHot(hotAppsQ.data ?? []);
    })();
  }, []);

  const awaitingTotal = docsPending + screeningsPending + approvalReady;
  const utilBase = vehiclesAvail + rented;
  const utilization = utilBase > 0 ? Math.round((rented / utilBase) * 100) : 0;
  const potentialWeekly = utilBase * 350;
  const currentWeekly = rented * 350;
  const netRev = revenue30 - expenses30;
  const weekDelta = useMemo(() => {
    if (weekRevenue == null || prevWeekRevenue == null) return undefined;
    if (prevWeekRevenue === 0) return weekRevenue > 0 ? 100 : 0;
    return Math.round(((weekRevenue - prevWeekRevenue) / prevWeekRevenue) * 100);
  }, [weekRevenue, prevWeekRevenue]);

  return (
    <div className="space-y-6">
      {/* Row A — operational metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          icon={Car}
          label="Available Fleet"
          value={vehiclesAvail}
          hint={`${vehiclesTotal} total · Ready to rent`}
        />
        <MetricCard
          icon={ShieldCheck}
          label="Active Rentals"
          value={rented}
          hint={`${utilization}% fleet utilization`}
        />
        <MetricCard
          icon={ClipboardList}
          label="Driver Actions"
          value={awaitingTotal}
          hint={`${docsPending} document${docsPending===1?"":"s"} · ${screeningsPending} interview${screeningsPending===1?"":"s"}`}
        />
        <MetricCard
          icon={DollarSign}
          label="Weekly Revenue"
          value={usd(weekRevenue ?? 0)}
          hint={weekDelta != null ? `${weekDelta >= 0 ? weekDelta : Math.abs(weekDelta)}% ${weekDelta >= 0 ? "above" : "below"} prior week` : "vs previous 7 days"}
          delta={weekDelta}
        />
      </div>

      {/* Row B — Collections + Fleet Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <SectionCard
          className="lg:col-span-3"
          title="Collections"
          subtitle="Billed vs collected · Last 30 days"
        >
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <FinanceStat label="Billed" value={revenue30 + outstanding} tone="ink" />
            <FinanceStat label="Collected" value={collected30} tone="green" />
            <FinanceStat label="Outstanding" value={outstanding} tone={outstanding > 0 ? "amber" : "ink"} />
            <FinanceStat label="Expenses" value={expenses30} tone="ink" />
            <FinanceStat label="Net" value={netRev} tone={netRev >= 0 ? "green" : "red"} />
          </div>
          <div className="mt-4 h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={revenueSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#EDEDF0" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" tick={{ fill: "#9A9AA3", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "#EDEDF0" }} interval={5} />
                <YAxis tick={{ fill: "#9A9AA3", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => v >= 1000 ? `$${Math.round(v/1000)}k` : `$${v}`} width={44} />
                <Tooltip contentStyle={{ background: "#fff", border: "1px solid #EDEDF0", borderRadius: 8, fontSize: 12 }} formatter={(v: any, name: any) => [usd(Number(v)), name === "billed" ? "Billed" : "Collected"]} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} iconType="circle" formatter={(v) => v === "billed" ? "Billed" : "Collected"} />
                <Line type="monotone" dataKey="billed" stroke="#9A9AA3" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="collected" stroke="#0F8A4B" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard className="lg:col-span-2" title="Fleet Activity" subtitle="Vehicles by status">
          <FleetDonut available={vehiclesAvail} rented={rented} maintenance={maintOpen} reserved={reserved} />
          <div className="mt-4 pt-4 border-t border-[#EDEDF0] space-y-2">
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-[#55555E]">Utilization</span>
              <span className="font-semibold text-[#111114] tabular-nums">{utilization}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-[#F4F4F6] overflow-hidden">
              <div className="h-full bg-[#0F8A4B]" style={{ width: `${utilization}%` }} />
            </div>
            <div className="flex items-center justify-between text-[12px] pt-1">
              <span className="text-[#55555E]">Earning now</span>
              <span className="font-semibold text-[#111114] tabular-nums">{usd(currentWeekly)}/wk</span>
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-[#55555E]">Potential at full utilization</span>
              <span className="text-[#9A9AA3] tabular-nums">{usd(potentialWeekly)}/wk</span>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* Row C — Action Queue */}
      <SectionCard title="Action Queue" subtitle="What needs your attention today" padded={false}>
        <ActionQueueRow icon={FileText} label="Drivers missing documents" count={docsPending}
          description="Complete license, insurance, and profile uploads."
          tone="neutral"
          onAction={() => (window.location.href = "/admin?tab=drivers")} />
        <ActionQueueRow icon={ClipboardList} label="Interviews incomplete" count={screeningsPending}
          description="Screening interview not yet completed."
          tone="neutral"
          onAction={() => (window.location.href = "/admin?tab=drivers")} />
        <ActionQueueRow icon={CheckCircle2} label="Drivers ready for approval" count={approvalReady}
          description="Approved status with no vehicle assigned yet."
          tone="green"
          onAction={() => (window.location.href = "/admin?tab=drivers")} />
        <ActionQueueRow icon={ShieldCheck} label="Insurance verification required" count={insuranceNeeded}
          description="Screening flagged insurance as unverified."
          tone="neutral"
          onAction={() => (window.location.href = "/admin?tab=drivers")} />
        <ActionQueueRow icon={CreditCard} label="Payments due today" count={paymentsDue}
          description="Unpaid invoices with due date today or earlier."
          tone="neutral"
          onAction={() => (window.location.href = "/admin?tab=payments")} />
        <ActionQueueRow icon={AlertTriangle} label="Late payments" count={paymentsLate}
          description="Rentals in past-due state."
          tone={paymentsLate > 0 ? "red" : "neutral"}
          onAction={() => (window.location.href = "/admin?tab=payments")} />
        <ActionQueueRow icon={Wrench} label="Vehicles needing maintenance" count={maintOpen}
          description="Open maintenance items across the fleet."
          tone="neutral"
          onAction={() => (window.location.href = "/admin?tab=maintenance")} />
      </SectionCard>

      {/* Row D — Recent Applications */}
      <SectionCard
        title="Recent Drivers"
        subtitle="Latest driver activity"
        padded={false}
        right={
          <Link to="/admin" search={{ tab: "drivers" } as any} className="inline-flex items-center gap-1 text-[12px] text-[#55555E] hover:text-[#CC0000]">
            View all drivers <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        }
      >
        {recent.length === 0 ? (
          <div className="px-5 py-10 text-center text-[13px] text-[#9A9AA3]">No applications yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left border-b border-[#EDEDF0] bg-[#FAFAFB]">
                  <th className="px-5 py-2.5 font-medium text-[11px] uppercase tracking-wide text-[#9A9AA3]">Driver</th>
                  <th className="px-3 py-2.5 font-medium text-[11px] uppercase tracking-wide text-[#9A9AA3]">Stage</th>
                  <th className="px-3 py-2.5 font-medium text-[11px] uppercase tracking-wide text-[#9A9AA3]">Readiness</th>
                  <th className="px-3 py-2.5 font-medium text-[11px] uppercase tracking-wide text-[#9A9AA3]">Needed By</th>
                  <th className="px-3 py-2.5 font-medium text-[11px] uppercase tracking-wide text-[#9A9AA3]">Blocker</th>
                  <th className="px-3 py-2.5 font-medium text-[11px] uppercase tracking-wide text-[#9A9AA3]">Last Activity</th>
                  <th className="px-5 py-2.5 font-medium text-[11px] uppercase tracking-wide text-[#9A9AA3] text-right">Assigned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F4F4F6]">
                {recent.slice(0, 7).map((a) => {
                  const stage = a.status === "active" ? "Active"
                    : a.status === "approved" ? "Approved"
                    : a.current_step ? "Interview"
                    : "Lead";
                  const blocker = a.current_step && a.current_step < 4 ? "Application incomplete"
                    : a.status === "approved" ? "Assign vehicle"
                    : "Interview incomplete";
                  const readinessLabel = a.ai_tier === "hot" ? "High Readiness"
                    : a.ai_tier === "warm" ? "Medium Readiness"
                    : a.ai_tier === "cold" ? "Low Readiness"
                    : "Unscored";
                  const readinessTone: "green" | "amber" | "red" | "neutral" =
                    a.ai_tier === "hot" ? "green"
                    : a.ai_tier === "warm" ? "amber"
                    : a.ai_tier === "cold" ? "red"
                    : "neutral";
                  return (
                    <tr key={a.id} onClick={() => (window.location.href = `/admin?tab=drivers&id=${a.id}`)}
                        className="hover:bg-[#FAFAFB] cursor-pointer transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-7 h-7 rounded-full bg-[#F4F4F6] grid place-items-center text-[11px] font-semibold text-[#55555E] shrink-0">
                            {(a.full_name || "?").slice(0, 1).toUpperCase()}
                          </div>
                          <span className="font-medium text-[#111114] truncate max-w-[180px]">{a.full_name || "Unnamed"}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3"><StatusPill status={stage} /></td>
                      <td className="px-3 py-3">
                        <StatusPill tone={readinessTone}>
                          {readinessLabel}{a.ai_score != null ? ` · ${a.ai_score}` : ""}
                        </StatusPill>
                      </td>
                      <td className="px-3 py-3 text-[#55555E]">—</td>
                      <td className="px-3 py-3 text-[#55555E] text-[12px]">{blocker}</td>
                      <td className="px-3 py-3 text-[#55555E] text-[12px] tabular-nums">{timeAgo(a.created_at)}</td>
                      <td className="px-5 py-3 text-right text-[#9A9AA3] text-[12px]">Unassigned</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Hot prospects — subtle secondary strip */}
      {hot.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-[12px] text-[#55555E]">
          <MicroLabel>Hot Prospects</MicroLabel>
          {hot.map((h) => (
            <Link key={h.id} to="/admin" search={{ tab: "drivers", id: h.id } as any}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#EDEDF0] bg-white px-2.5 py-1 hover:border-[#CC0000] transition-colors">
              <Flame className="w-3 h-3 text-[#CC0000]" /> {h.full_name} · {h.ai_score}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function FinanceStat({ label, value, tone }: { label: string; value: number; tone: "ink" | "green" | "amber" | "red" }) {
  const color =
    tone === "green" ? "text-[#0F8A4B]" :
    tone === "amber" ? "text-[#B77900]" :
    tone === "red" ? "text-[#CC0000]" : "text-[#111114]";
  return (
    <div>
      <MicroLabel>{label}</MicroLabel>
      <div className={`mt-1 text-[18px] font-semibold tracking-tight tabular-nums ${color}`}>{usd(value)}</div>
    </div>
  );
}

function FleetDonut({ available, rented, maintenance, reserved }: {
  available: number; rented: number; maintenance: number; reserved: number;
}) {
  const segs = [
    { key: "Available", value: available, color: "#111114" },
    { key: "Rented", value: rented, color: "#0F8A4B" },
    { key: "Reserved", value: reserved, color: "#9A9AA3" },
    { key: "Maintenance", value: maintenance, color: "#CC0000" },
  ];
  const total = segs.reduce((a, s) => a + s.value, 0);
  const pie = total > 0 ? segs : [{ key: "Empty", value: 1, color: "#F4F4F6" }];
  return (
    <div className="grid grid-cols-2 gap-4 items-center">
      <div className="relative h-40">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={pie} dataKey="value" nameKey="key" innerRadius="70%" outerRadius="95%" paddingAngle={total > 0 ? 3 : 0} stroke="none" startAngle={90} endAngle={-270}>
              {pie.map((s, i) => <Cell key={i} fill={s.color} />)}
            </Pie>
            {total > 0 && <Tooltip contentStyle={{ background: "#fff", border: "1px solid #EDEDF0", borderRadius: 8, fontSize: 12 }} />}
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="text-center">
            <div className="text-[22px] font-semibold tracking-tight text-[#111114] tabular-nums">{total}</div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[#9A9AA3] mt-0.5">Vehicles</div>
          </div>
        </div>
      </div>
      <ul className="space-y-2">
        {segs.map((s) => {
          const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
          return (
            <li key={s.key} className="flex items-center gap-2 text-[12px]">
              <span className="h-2 w-2 rounded-full shrink-0" style={{ background: s.color }} />
              <span className="text-[#55555E] flex-1 truncate">{s.key}</span>
              <span className="font-semibold text-[#111114] tabular-nums">{s.value}</span>
              <span className="text-[10px] text-[#9A9AA3] tabular-nums w-8 text-right">{pct}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}