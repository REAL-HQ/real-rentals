import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getOnboardingChecklist } from "@/lib/onboarding-checklist.functions";
import {
  ONBOARDING_CHECKLIST_ENABLED,
  ONBOARDING_ROW_CAP,
  type OnboardingChecklistResult,
  type OnboardingDriver,
  type OnboardingStep,
} from "@/lib/onboarding-checklist";

function formatWhen(at: string | null): string {
  if (!at) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) {
    const [year, month, day] = at.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(date);
  }
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(date);
}

function StepFact({ step }: { step: OnboardingStep }) {
  if (!step.done) return <span className="text-[#9A9AA3]">Missing</span>;
  return (
    <span className="block text-right">
      <span className="block text-[#111114]">{step.source ?? "—"}</span>
      <span className="block text-[#55555E]">{formatWhen(step.at)}</span>
    </span>
  );
}

function DriverSteps({ driver }: { driver: OnboardingDriver }) {
  return (
    <div className="space-y-2 text-[12px]">
      {driver.steps.map((step) => (
        <div key={step.key} className="flex items-start justify-between gap-3">
          <span className="text-[#55555E]">{step.label}</span>
          <StepFact step={step} />
        </div>
      ))}
      <div className="flex items-start justify-between gap-3 border-t border-[#EDEDF0] pt-2">
        <span className="text-[#55555E]">Next Missing Step</span>
        <span className="text-right font-semibold text-[#111114]">{driver.nextMissingStep}</span>
      </div>
    </div>
  );
}

export function OnboardingChecklist({ canView, focusId }: { canView: boolean; focusId?: string }) {
  if (ONBOARDING_CHECKLIST_ENABLED !== true || canView !== true) return null;
  return <OnboardingChecklistLive focusId={focusId} />;
}

function OnboardingChecklistLive({ focusId }: { focusId?: string }) {
  const load = useServerFn(getOnboardingChecklist);
  const [result, setResult] = useState<OnboardingChecklistResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setFailed(false);
    load()
      .then((loaded) => {
        if (cancel) return;
        setResult(loaded);
      })
      .catch(() => {
        if (cancel) return;
        setFailed(true);
        setResult(null);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [load]);

  if (loading) return <p className="text-[12px] text-[#55555E]">Loading Onboarding Checklist</p>;
  if (failed || !result) return <p className="text-[12px] text-[#9B2C2C]">Could Not Load Onboarding Checklist</p>;
  if (result.truncated) {
    return (
      <p className="text-[12px] text-[#55555E]">
        Checked The First {ONBOARDING_ROW_CAP} Approved Drivers. The Checklist Is Not Shown Because The Read Was Capped.
      </p>
    );
  }

  if (focusId) {
    const driver = result.drivers.find((row) => row.id === focusId);
    if (!driver) return <p className="text-[12px] text-[#55555E]">This Driver Is Not On The Approved Checklist</p>;
    return <DriverSteps driver={driver} />;
  }

  return (
    <section className="mb-4 rounded-lg border border-[#EDEDF0] bg-white">
      <div className="border-b border-[#EDEDF0] px-4 py-3">
        <h2 className="text-[15px] font-semibold text-[#111114]">Onboarding Checklist</h2>
        <p className="mt-0.5 text-[12px] text-[#55555E]">Approved, Active, And Closed Drivers, With The Source And Time Of Each Step</p>
      </div>
      {result.drivers.length === 0 ? (
        <p className="px-4 py-3 text-[12px] text-[#55555E]">No Approved Drivers</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-[#FAFAFB] text-[#55555E]">
              <tr>
                <th className="px-3 py-2 font-medium">Driver</th>
                {result.drivers[0].steps.map((step) => (
                  <th key={step.key} className="px-3 py-2 font-medium">
                    {step.label}
                  </th>
                ))}
                <th className="px-3 py-2 font-medium">Next Missing Step</th>
              </tr>
            </thead>
            <tbody>
              {result.drivers.map((driver) => (
                <tr key={driver.id} className="border-t border-[#EDEDF0]">
                  <td className="px-3 py-2 align-top text-[#111114]">
                    <span className="block font-medium">{driver.name}</span>
                    <span className="block text-[#55555E]">
                      {driver.status === "active" ? "Active" : driver.status === "closed" ? "Closed" : "Approved"}
                    </span>
                  </td>
                  {driver.steps.map((step) => (
                    <td key={step.key} className="px-3 py-2 align-top">
                      <StepFact step={step} />
                    </td>
                  ))}
                  <td className="px-3 py-2 align-top font-medium text-[#111114]">{driver.nextMissingStep}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
