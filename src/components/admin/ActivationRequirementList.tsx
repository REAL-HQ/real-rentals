import { Check, Circle, Minus } from "lucide-react";
import type { ActivationRequirement, RequirementEnforcement } from "@/lib/activation-readiness";

// Renders the server's readiness checklist. Nothing here decides anything:
// the list, each state and each enforcement level come from
// getActivationReadiness, and activateRental re-checks them on the server.

const ENFORCEMENT_LABEL: Record<RequirementEnforcement, string> = {
  hard: "Required",
  soft: "Override With Written Reason",
  advisory: "Advisory",
};

export function ActivationRequirementList({
  requirements,
}: {
  requirements: ActivationRequirement[];
}) {
  const open = requirements.filter((r) => r.met !== true).length;
  return (
    <div
      className="rounded-xl border border-[#EDEDF0] bg-white p-3"
      aria-label="Activation Readiness"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-[#55555E]">Activation Readiness</div>
        <div className="text-[11px] text-[#9A9AA3]">
          {open === 0 ? "All Complete" : `${open} Incomplete`}
        </div>
      </div>
      <ul className="mt-2 space-y-1.5">
        {requirements.map((r) => (
          <li
            key={r.key}
            className="flex items-start justify-between gap-3 text-[13px]"
            data-requirement={r.key}
            data-met={String(r.met)}
          >
            <span className="inline-flex items-start gap-1.5 min-w-0">
              {r.met === true ? (
                <Check
                  className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#1F7A3A]"
                  aria-label="Complete"
                />
              ) : r.met === null ? (
                <Minus
                  className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#9A9AA3]"
                  aria-label="Not Checked Yet"
                />
              ) : (
                <Circle
                  className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${r.enforcement === "hard" ? "text-[#B00000]" : r.enforcement === "soft" ? "text-[#8A5A00]" : "text-[#9A9AA3]"}`}
                  aria-label="Incomplete"
                />
              )}
              <span className={r.met === true ? "text-[#55555E]" : "text-[#111114]"}>
                {r.label}
              </span>
            </span>
            {r.met !== true ? (
              <span className="shrink-0 text-[11px] text-[#9A9AA3]">
                {r.met === null ? "Choose A Vehicle" : ENFORCEMENT_LABEL[r.enforcement]}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
