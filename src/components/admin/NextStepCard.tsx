import { Circle, Car, ClipboardList, Loader2, RotateCw } from "lucide-react";
import type { ActivationReadiness } from "@/lib/activation-readiness";
import type { NextStep } from "@/lib/next-step";
import { ActivationRequirementList } from "./ActivationRequirementList";
import type { ActivationRequirementKey } from "@/lib/activation-readiness";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { EvidencePresentationMap } from "@/lib/checklist-evidence";

/**
 * The profile's one "what now" card. It shows the server's blockers with a
 * button that opens the existing section that fixes each, and keeps Activate
 * Rental in sight even while blocked (opening it re-checks on the server).
 * It never changes a status or a requirement itself.
 */
export function NextStepCard({
  model,
  readiness,
  onRun,
  onActivate,
  onRetry,
  renderEvidence,
  evidence,
}: {
  model: NextStep;
  readiness: ActivationReadiness | null;
  onRun: (b: NextStep["blockers"][number]["target"]) => void;
  onActivate: () => void;
  onRetry: () => void;
  renderEvidence?: (key: ActivationRequirementKey) => ReactNode;
  evidence?: EvidencePresentationMap;
}) {
  const { activation } = model;
  if (activation === "rental_active") return null;
  const primary = "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md bg-[#D03020] px-3.5 text-[12px] font-semibold text-white hover:bg-[#B00000] disabled:cursor-not-allowed disabled:opacity-50";
  const secondary = "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border border-[#EDEDF0] bg-white px-3 text-[12px] font-semibold text-[#55555E] hover:border-[#C4C4CB] hover:text-[#111114] disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <section
      aria-label="Next Step"
      data-testid="next-step"
      data-activation={activation}
      className="rounded-xl border border-[#EDEDF0] bg-white p-4 shadow-[0_1px_2px_rgba(17,17,20,0.05)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-[1_1_16rem]">
          <h3 className="text-[14px] font-semibold text-[#111114]">Next Step</h3>
          <p className="mt-0.5 text-[12px] text-[#55555E]" role={activation === "unknown" ? "alert" : undefined}>
            {activation === "checking" ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : null}
            {model.note}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
          {activation === "unknown" ? (
            <button type="button" onClick={onRetry} className={secondary}>
              <RotateCw className="h-3.5 w-3.5" /> Retry
            </button>
          ) : null}
          {/* Activate Rental is always findable; it is the primary only when nothing blocks it. */}
          {activation === "manager_only" ? (
            <button type="button" disabled title="Only a Manager or Owner can start a rental" className={secondary}>
              <Car className="h-3.5 w-3.5" /> Activate Rental
            </button>
          ) : model.target.kind !== "activate" ? (
            <button type="button" onClick={onActivate} disabled={activation === "checking"} className={secondary}>
              <Car className="h-3.5 w-3.5" /> Activate Rental
            </button>
          ) : null}
          <Button type="button" variant="outline" title="Optional Interview Script" className="h-9 shrink-0 gap-1.5 px-3 text-[12px]" onClick={() => onRun({ kind: "interview" })}>
            <ClipboardList className="h-3.5 w-3.5" /> Interview Script
          </Button>
          {model.target.kind !== "none" ? (
            <button
              type="button"
              data-testid="next-step-primary"
              disabled={model.busy}
              onClick={() => (model.target.kind === "activate" ? onActivate() : onRun(model.target as any))}
              className={`${primary} max-sm:flex-1`}
            >
              {model.target.kind === "activate" ? <Car className="h-3.5 w-3.5" /> : null}
              {model.label}
            </button>
          ) : null}
        </div>
      </div>
      {!readiness && model.blockers.length ? (
        <ul className="mt-3 divide-y divide-[#F1F1F4] rounded-lg border border-[#F1F1F4]" aria-label="Blocking">
          {model.blockers.map((b, i) => (
            <li key={`${b.key}-${i}`} data-blocker={b.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13px]">
              <span className="flex min-h-10 min-w-0 items-center gap-2 px-1 text-left text-[13px] font-normal">
                <Circle className="h-4 w-4 shrink-0 text-destructive" />
                <span>
                  {b.label}
                  {b.detail ? <span className="text-[#9A9AA3]"> · {b.detail}</span> : null}
                </span>
              </span>
              <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                {b.key !== "local" && renderEvidence ? renderEvidence(b.key) : null}
                <button type="button" onClick={() => onRun(b.target)} className={`${secondary} h-8`}>
                  {b.fix}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {readiness ? (
        <ActivationRequirementList embedded blockers={model.blockers} requirements={readiness.requirements} evidence={evidence} onRun={model.activation === "manager_only" || model.busy ? undefined : onRun} renderEvidence={renderEvidence} />
      ) : null}
    </section>
  );
}
