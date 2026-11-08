import { Check, Circle, Minus } from "lucide-react";
import type { ActivationRequirement, RequirementEnforcement } from "@/lib/activation-readiness";
import type { FixTarget } from "@/lib/next-step";
import { Button } from "@/components/ui/button";
import { checklistAction } from "./checklist-actions";

// Renders the server's readiness checklist. Nothing here decides anything:
// the list, each state and each enforcement level come from
// getActivationReadiness, and activateRental re-checks them on the server.

const ENFORCEMENT_LABEL: Record<RequirementEnforcement, string> = {
  hard: "Required",
  acknowledge: "Owner Exception: Acknowledge Warning",
  soft: "Override With Written Reason",
  advisory: "Advisory",
};

export function ActivationRequirementList({
  requirements,
  onRun,
}: {
  requirements: ActivationRequirement[];
  onRun?: (target: FixTarget) => void;
}) {
  // Advisory items (insurance card, gig profile, gig platform) never block, so
  // they are not counted as outstanding.
  const open = requirements.filter((r) => r.met !== true && r.enforcement !== "advisory").length;
  return (
    <div
      className="rounded-xl border border-border bg-card p-3"
      aria-label="Activation Readiness"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <div className="min-w-0 text-xs font-semibold text-muted-foreground">Activation Readiness</div>
        <div className="shrink-0 text-[11px] text-muted-foreground">
          {open === 0 ? "Required Items Complete" : `${open} Required Incomplete`}
        </div>
      </div>
      <ul className="mt-2 divide-y divide-border">
        {requirements.map((r) => {
          const action = onRun ? checklistAction(r) : null;
          const status = r.met === true ? "Complete" : r.met === null ? "Choose A Vehicle" : ENFORCEMENT_LABEL[r.enforcement];
          const icon = r.met === true ? <Check className="h-4 w-4 shrink-0 text-success" aria-label="Complete" /> : r.met === null ? <Minus className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Not Checked Yet" /> : <Circle className={`h-4 w-4 shrink-0 ${r.enforcement === "hard" ? "text-destructive" : r.enforcement === "soft" || r.enforcement === "acknowledge" ? "text-warning-foreground" : "text-muted-foreground"}`} aria-label="Incomplete" />;
          return (
          <li
            key={r.key}
            className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-1 text-[13px]"
            data-requirement={r.key}
            data-met={String(r.met)}
          >
            {action && onRun ? (
              <Button type="button" variant="ghost" className="h-auto min-h-10 min-w-0 justify-start gap-2 px-1 py-2 text-left text-[13px] font-normal whitespace-normal" aria-label={`${action.label}: ${r.label}`} onClick={() => onRun(action.target)}>
                {icon}
                <span className="min-w-0 break-words text-foreground">{r.label}{r.detail && r.met !== true ? <span className="text-muted-foreground"> · {r.detail}</span> : null}</span>
              </Button>
            ) : <span className="flex min-w-0 items-center gap-2 px-1 py-2">{icon}<span className="min-w-0 break-words text-foreground">{r.label}{r.detail && r.met !== true ? <span className="text-muted-foreground"> · {r.detail}</span> : null}</span></span>}
            <div className="flex max-w-36 shrink-0 flex-col items-end gap-1">
              <span className="text-right text-[10px] text-muted-foreground">{status}</span>
              {action && onRun ? <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => onRun(action.target)}>{action.label}</Button> : r.key === "gig_platform" ? <span className="text-right text-[10px] text-muted-foreground">No Platform Verification Connected</span> : null}
            </div>
          </li>
          );
        })}
      </ul>
    </div>
  );
}
