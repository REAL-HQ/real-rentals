import type { MyNextSteps } from "@/lib/next-steps.functions";
import type { NextStepState } from "@/lib/next-steps";

function PickupLine({ line }: { line: string }) {
  const phone = "(888) 833-8280";
  const at = line.indexOf(phone);
  if (at < 0) return <>{line}</>;
  return (
    <>
      {line.slice(0, at)}
      <a href="tel:18888338280" className="font-medium text-real-red hover:underline">
        {phone}
      </a>
      {line.slice(at + phone.length)}
    </>
  );
}

const STATE_LABEL: Record<NextStepState, string> = {
  done: "Done",
  needed: "Needed",
  unknown: "Unknown",
};

const STATE_TONE: Record<NextStepState, string> = {
  done: "bg-emerald-100 text-emerald-800",
  needed: "bg-amber-100 text-amber-900",
  unknown: "bg-[#F4F4F6] text-[#5B5B66]",
};

/**
 * The driver's own next steps. The parent only mounts this while the card
 * flag is on, and the server has already refused every other person's rows.
 */
export function NextStepsCard({
  data,
  loading,
  failed,
}: {
  data: MyNextSteps | undefined;
  loading: boolean;
  failed: boolean;
}) {
  if (failed) {
    return (
      <section className="rounded-2xl border border-border bg-white p-6 md:p-8" data-next-steps="error">
        <h2 className="text-lg font-semibold">Your Next Steps</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Could not load your next steps. Refresh and try again.
        </p>
      </section>
    );
  }
  if (loading || !data) {
    return (
      <section className="rounded-2xl border border-border bg-white p-6 md:p-8 text-sm text-muted-foreground">
        Loading Your Next Steps…
      </section>
    );
  }
  if (!data.enabled || !data.show) return null;

  return (
    <section className="rounded-2xl border border-border bg-white p-6 md:p-8" data-next-steps="ready">
      <h2 className="text-lg font-semibold">Your Next Steps</h2>
      <ul className="mt-4 divide-y divide-border">
        {data.steps.map((step) => (
          <li key={step.key} className="flex items-center justify-between gap-3 py-3">
            <span className="text-sm font-medium">{step.label}</span>
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${STATE_TONE[step.state]}`}>
              {STATE_LABEL[step.state]}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-foreground">
        <PickupLine line={data.pickupLine} />
      </p>
    </section>
  );
}
