import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getRentalCloseoutReadiness,
  type CloseoutReadiness as Evidence,
} from "@/lib/closeout-readiness.functions";
import { fmtDateTime } from "@/lib/date-format";

export function CloseoutReadiness({ rentalId }: { rentalId: string }) {
  const load = useServerFn(getRentalCloseoutReadiness);
  const [result, setResult] = useState<Evidence | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    setResult(null);
    setFailed(false);
    load({ data: { rentalId } })
      .then((value) => {
        if (current) setResult(value);
      })
      .catch(() => {
        if (current) setFailed(true);
      });
    return () => {
      current = false;
    };
  }, [load, rentalId]);
  return (
    <section
      className="rounded-lg border border-[#EDEDF0] p-3 space-y-3"
      aria-label="Closeout Readiness"
      data-testid="closeout-readiness"
    >
      <div>
        <h4 className="text-sm font-semibold">Closeout Readiness</h4>
        <p className="text-xs text-[#55555E]">
          Informational snapshot only. This does not change the End Rental action.
        </p>
      </div>
      {!result && (
        <p role="status" className="text-xs">
          Unknown — {failed ? "Could not load closeout evidence." : "Loading closeout evidence…"}
        </p>
      )}
      {result?.checks.map((check) => (
        <div key={check.key} className="text-xs space-y-1">
          <div className="flex flex-wrap justify-between gap-2">
            <span className="font-medium">{check.title}</span>
            <span
              className={
                check.state === "Ready"
                  ? "text-green-700"
                  : check.state === "Needs Attention"
                    ? "text-amber-700"
                    : "text-[#55555E]"
              }
            >
              {check.state}
            </span>
          </div>
          <p className="text-[#55555E]">{check.explanation}</p>
          {check.completedAt && <p>Completed: {fmtDateTime(check.completedAt)}</p>}
          {!!check.criticalFailures?.length && (
            <p>Critical failures: {check.criticalFailures.join(", ")}</p>
          )}
        </div>
      ))}
    </section>
  );
}
