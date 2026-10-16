import type { ReactNode } from "react";
import { ArrowRight, Check, Circle, ClipboardList, ShieldCheck, Sparkles, AlertTriangle } from "lucide-react";
import { nextActions, type ReadinessResult } from "@/lib/readiness";
import { ReadinessStatePill } from "./ui";

export function OverviewCard({ title, icon, right, children }: { title: string; icon: ReactNode; right?: ReactNode; children: ReactNode }) {
  return <section className="min-w-0 rounded-lg border border-border bg-card text-card-foreground">
    <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-5 py-4">
      <div className="flex min-w-0 items-center gap-2.5"><span className="shrink-0 text-muted-foreground">{icon}</span><h3 className="truncate text-sm font-semibold tracking-normal">{title}</h3></div>{right}
    </header><div className="p-5">{children}</div>
  </section>;
}

export function RentalChecklist({ requirements }: { requirements: { label: string; ok: boolean }[] }) {
  const done = requirements.filter(row => row.ok).length;
  return <OverviewCard title="Rental Readiness" icon={<ClipboardList className="size-4" />} right={<span className="rounded-md bg-secondary px-2 py-1 text-xs font-semibold tabular-nums text-secondary-foreground">{done}/{requirements.length}</span>}>
    <div className="mb-4 flex gap-1.5" role="progressbar" aria-label="Rental Readiness" aria-valuemin={0} aria-valuemax={requirements.length} aria-valuenow={done}>
      {requirements.map((row, index) => <span key={row.label} className={`h-1.5 min-w-0 flex-1 rounded-full ${index < done ? "bg-success" : "bg-muted"}`} />)}
    </div>
    <ul className="space-y-1">{requirements.map(row => <li key={row.label} className={`grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-2.5 ${row.ok ? "bg-success-soft" : "bg-muted/50"}`}>
      {row.ok ? <Check className="size-4 text-success" /> : <Circle className="size-4 text-muted-foreground/50" />}
      <span className="min-w-0 text-xs font-medium">{row.label}</span><span className={`text-[10px] ${row.ok ? "text-success" : "text-muted-foreground"}`}>{row.ok ? "Complete" : "Pending"}</span>
    </li>)}</ul>
  </OverviewCard>;
}

export function DriverAssessment({ result, remedyActions }: { result: ReadinessResult; remedyActions: Partial<Record<string, ReactNode>> }) {
  const gaps = nextActions(result);
  const metrics = [
    { label: "Qualification", value: result.qualification === null ? "—" : `${result.qualification}`, icon: Sparkles },
    { label: "Known", value: `${result.coverage}%`, icon: ClipboardList },
    { label: "Verified", value: `${result.verifiedCoverage}%`, icon: ShieldCheck },
  ];
  return <section aria-label="Applicant Readiness" className="space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold tracking-normal">Applicant Readiness</h3><ReadinessStatePill state={result.state} label={result.stateLabel} /></header>
    <div className="grid grid-cols-3 gap-3">{metrics.map(({ label, value, icon: Icon }) => <div key={label} className="min-w-0 rounded-lg border border-border bg-card px-3 py-4 sm:px-5">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground sm:text-xs"><Icon className="hidden size-4 shrink-0 sm:block" />{label}</div><div className="mt-2 text-2xl font-semibold tabular-nums text-card-foreground">{value}</div>
    </div>)}</div>
    {result.disqualifiers.length > 0 && <ul className="space-y-2 rounded-lg border border-destructive/25 bg-destructive/5 p-4">{result.disqualifiers.map(item => <li key={item} className="flex items-start gap-2 text-xs text-destructive"><AlertTriangle className="size-4 shrink-0" />{item}</li>)}</ul>}
    <div className="grid items-start gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {([{ title: "Positive Signals", factors: result.positives, icon: Sparkles, empty: "Nothing favourable recorded yet.", positive: true }, { title: "Needs Attention", factors: result.attention, icon: AlertTriangle, empty: "Nothing concerning in what we know.", positive: false }]).map(({ title, factors, icon: Icon, empty, positive }) => <OverviewCard key={title} title={title} icon={<Icon className={`size-4 ${positive ? "text-success" : "text-warning-foreground"}`} />} right={<span className="text-xs tabular-nums text-muted-foreground">{factors.length}</span>}>
          {factors.length === 0 ? <div className="flex items-start gap-3 py-2"><div className="grid size-8 shrink-0 place-items-center rounded-md bg-muted"><Icon className="size-4 text-muted-foreground" /></div><p className="pt-1 text-xs leading-relaxed text-muted-foreground">{empty}</p></div> : <ul className="divide-y divide-border">{factors.map(factor => <li key={factor.key} className="flex items-start gap-2 py-3 first:pt-0 last:pb-0">{positive ? <Check className="mt-0.5 size-4 shrink-0 text-success" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-foreground" />}<div className="text-xs leading-relaxed">{factor.detail}{factor.evidence && <p className="mt-1 text-[11px] text-muted-foreground">{factor.evidence === "staff_verified" ? "Staff Verified" : factor.evidence === "document" ? "Document Supported" : "Self-Reported"}</p>}</div></li>)}</ul>}
        </OverviewCard>)}
      </div>
      <OverviewCard title="Next Steps" icon={<ArrowRight className="size-4" />} right={<span className="text-xs text-muted-foreground">{gaps.length} Remaining</span>}>
        {gaps.length === 0 ? <p className="text-xs text-muted-foreground">Nothing outstanding.</p> : <ol className="grid items-start gap-3 lg:grid-cols-2">{gaps.map((gap, index) => <li key={gap.remedy} className="rounded-md bg-muted/60 p-3.5">
          <div className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2"><span className="grid size-6 place-items-center rounded-full border border-border bg-card text-[11px] font-semibold tabular-nums">{index + 1}</span><h4 className="text-xs font-semibold tracking-normal">{gap.label}</h4><span className="text-[10px] tabular-nums text-muted-foreground">+{gap.coverageGain}% Known</span></div>
          <ul className="my-3 grid gap-1.5 pl-8 sm:grid-cols-2">{gap.factors.map(factor => <li key={factor.key} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground"><Circle className="mt-0.5 size-3 shrink-0 text-muted-foreground/50" />{factor.label}</li>)}</ul>
          {remedyActions[gap.remedy] && <div className="pl-8">{remedyActions[gap.remedy]}</div>}
        </li>)}</ol>}
      </OverviewCard>
    </div>
  </section>;
}
