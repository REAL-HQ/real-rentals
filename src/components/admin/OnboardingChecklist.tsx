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
  if (step.state === "unknown") return <span className="text-[#9A9AA3]">Unknown</span>;
  if (step.state !== "done") return <span className="text-[#9A9AA3]">Missing</span>;
  return (
    <span className="block text-right">
      <span className="block text-[#111114]">{step.source ?? "—"}</span>
      <span className="block text-[#55555E]">{formatWhen(step.at)}</span>
    </span>
  );
}

export function OnboardingReadinessRows({ driver }: { driver: OnboardingDriver }) {
  if (ONBOARDING_CHECKLIST_ENABLED !== true) return null;
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

export function OnboardingLoadError() {
  if (ONBOARDING_CHECKLIST_ENABLED !== true) return null;
  return <p className="mb-2 text-[12px] text-[#9B2C2C]">Could Not Load Onboarding Checklist</p>;
}

function statusLabel(status: string): string {
  if (status === "active") return "Active";
  if (status === "closed") return "Closed";
  return "Approved";
}

export function OnboardingChecklist({
  canView,
  result,
  failed,
}: {
  canView: boolean;
  result: OnboardingChecklistResult | null;
  failed: boolean;
}) {
  if (ONBOARDING_CHECKLIST_ENABLED !== true || canView !== true) return null;
  if (failed || result?.failed) return <OnboardingLoadError />;
  if (!result) return <p className="mb-4 text-[12px] text-[#55555E]">Loading Onboarding Checklist</p>;

  return (
    <section className="mb-4 rounded-lg border border-[#EDEDF0] bg-white">
      <div className="border-b border-[#EDEDF0] px-4 py-3">
        <h2 className="text-[15px] font-semibold text-[#111114]">Onboarding Checklist</h2>
        <p className="mt-0.5 text-[12px] text-[#55555E]">
          Approved, Active, And Closed Drivers, With The Source And Time Of Each Step
        </p>
        {result.truncated ? (
          <p className="mt-1 text-[12px] text-[#55555E]">
            Showing The First {result.cap || ONBOARDING_ROW_CAP} Approved Drivers. Later Drivers Were Not Read.
          </p>
        ) : null}
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
                    {step.key === "documents" ? "Documents" : step.label}
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
                    <span className="block text-[#55555E]">{statusLabel(driver.status)}</span>
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
