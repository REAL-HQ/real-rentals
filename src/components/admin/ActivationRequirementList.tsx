import { Check, Circle, Minus } from "lucide-react";
import { NEXT_STEP_REQUIREMENT_KEYS, type ActivationRequirement, type ActivationRequirementKey, type RequirementEnforcement } from "@/lib/activation-readiness";
import type { ReactNode } from "react";
import type { FixTarget } from "@/lib/next-step";
import type { Blocker } from "@/lib/next-step";
import { Button } from "@/components/ui/button";
import { checklistAction } from "./checklist-actions";
import type { EvidencePresentationMap } from "@/lib/checklist-evidence";

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
  renderEvidence,
  evidence,
  embedded = false,
  blockers = [],
}: {
  requirements: ActivationRequirement[];
  onRun?: (target: FixTarget) => void;
  renderEvidence?: (key: ActivationRequirementKey) => ReactNode;
  evidence?: EvidencePresentationMap;
  embedded?: boolean;
  blockers?: Blocker[];
}) {
  // Advisory items (insurance card, gig profile, gig platform) never block, so
  // they are not counted as outstanding.
  const open = requirements.filter((r) => r.met !== true && r.enforcement !== "advisory").length;
  return (
    <div
      className={embedded ? "mt-3" : "rounded-xl border border-border bg-card p-3"}
      aria-label="Activation Readiness"
    >
      {!embedded ? <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <div className="min-w-0 text-xs font-semibold text-muted-foreground">Activation Readiness</div>
        <div className="shrink-0 text-[11px] text-muted-foreground">
          {open === 0 ? "Required Items Complete" : `${open} Required Incomplete`}
        </div>
      </div> : null}
      <ul className="mt-2 divide-y divide-border">
        {requirements.filter((r) => !embedded || (NEXT_STEP_REQUIREMENT_KEYS as readonly ActivationRequirementKey[]).includes(r.key)).map((r) => {
          const blocker = blockers.find((item) => item.key === r.key || (item.key === "local" && r.key === "interview" && item.target.kind === "record_call"));
          const action = onRun ? blocker ? { label: blocker.fix, target: blocker.target } : checklistAction(r) : null;
          const fileState = evidence?.[r.key];
          const status = fileState?.label ?? (r.met === true ? "Complete" : r.met === null ? "Choose A Vehicle" : ENFORCEMENT_LABEL[r.enforcement]);
          const completedIcon = (
            <span role="img" aria-label={fileState?.label ?? "Complete"} className="grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-success bg-success text-primary-foreground">
              <Check className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
            </span>
          );
          const icon = fileState ? fileState.tone === "green" ? completedIcon : <Circle className={`h-6 w-6 shrink-0 ${fileState.tone === "red" ? "text-destructive" : "text-warning"}`} aria-label={fileState.label} /> : r.met === true ? completedIcon : r.met === null ? <Minus className="h-6 w-6 shrink-0 text-muted-foreground" aria-label="Not Checked Yet" /> : <Circle className={`h-6 w-6 shrink-0 ${r.enforcement === "hard" ? "text-destructive" : r.enforcement === "soft" || r.enforcement === "acknowledge" ? "text-warning-foreground" : "text-muted-foreground"}`} aria-label="Incomplete" />;
          const marker = fileState?.onToggle ? (
            <button
              type="button"
              disabled={fileState.busy}
              onClick={fileState.onToggle}
              className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              aria-label={fileState.toggleLabel ?? (fileState.tone === "yellow" ? `${r.label}: Upload Due. Click To Mark Not Collected` : `Check Off ${r.label}`)}
              title={fileState.toggleTitle ?? (fileState.tone === "yellow" ? "Checked Off — Upload Due. Click To Mark Not Collected." : "Click To Check Off. Upload The File Later.")}
            >
              {fileState.tone === "yellow" ? (
                <span className="grid h-6 w-6 place-items-center rounded-full border-2 border-warning bg-warning text-warning-foreground"><Check className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" /></span>
              ) : icon}
            </button>
          ) : icon;
          return (
          <li
            key={r.key}
            className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-1 text-[13px] max-sm:grid-cols-1"
            data-requirement={r.key}
            data-met={String(r.met)}
            data-blocker={blocker?.key}
          >
            {/* Status markers never navigate or pretend an unsaved attestation
                is complete. Explicit review/upload actions remain separate. */}
            <span className="flex min-w-0 items-center gap-2 px-1 py-2">{marker}<span className="min-w-0 break-words text-foreground">{r.label}{r.key === "inspection" && r.met !== true ? <span className="text-muted-foreground"> · Pickup Photos; Inspection Report Optional</span> : r.detail && r.met !== true ? <span className="text-muted-foreground"> · {r.detail}</span> : null}</span></span>
            <div className={embedded ? "ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5 max-sm:w-full" : `flex shrink-0 flex-col items-end gap-1 ${fileState ? "max-w-80 max-sm:w-full" : "max-w-36"}`}>
              <span className="text-right text-[10px] text-muted-foreground">{status}</span>
              {embedded && renderEvidence ? renderEvidence(r.key) : null}
              {action && onRun && !(fileState?.tone === "yellow" && embedded && renderEvidence && ["license_documents", "insurance_verified", "insurance_document", "gig_profile"].includes(r.key)) ? <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => onRun(action.target)}>{fileState?.tone === "yellow" && r.key === "signed_agreement" ? "Add / Review" : action.label}</Button> : r.key === "gig_platform" ? <span className="text-right text-[10px] text-muted-foreground">No Platform Verification Connected</span> : null}
              {!embedded && renderEvidence ? renderEvidence(r.key) : null}
            </div>
          </li>
          );
        })}
      </ul>
    </div>
  );
}
