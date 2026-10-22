import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardCheck } from "lucide-react";
import {
  getRentalCloseoutPreview,
} from "@/lib/closeout-preview.functions";
import { CLOSEOUT_PREVIEW_ENABLED } from "@/lib/closeout-preview-flag";
import type { CloseoutFigure, CloseoutPreview as Preview } from "@/lib/closeout-preview";
import { fmtDateTime } from "@/lib/date-format";
import { SectionCard } from "./ui";

const tone: Record<CloseoutFigure["state"], string> = {
  Ready: "text-[#1F7A34]",
  "Needs Attention": "text-[#8A5A00]",
  Unknown: "text-[#55555E]",
};

export function CloseoutPreview({ rentalId }: { rentalId: string }) {
  const load = useServerFn(getRentalCloseoutPreview);
  const [result, setResult] = useState<Preview | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!CLOSEOUT_PREVIEW_ENABLED) return;
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
  if (!CLOSEOUT_PREVIEW_ENABLED) return null;
  return (
    <SectionCard title="Closeout Preview" icon={<ClipboardCheck className="w-4 h-4" strokeWidth={1.75} />}>
      <div className="space-y-3" aria-label="Closeout Preview" data-testid="closeout-preview">
        <p className="text-[12px] text-[#55555E]">
          Informational snapshot of what ending this rental would involve. Staff must settle manually.
        </p>
        {!result && (
          <p role="status" className="text-[12px] text-[#55555E]">
            Unknown — {failed ? "Could not load closeout evidence." : "Loading closeout evidence…"}
          </p>
        )}
        {result && !result.shown && (
          <p className="text-[12px] text-[#55555E]">This rental is not active or ended.</p>
        )}
        {result?.shown && (
          <>
            <p className="text-[12px] text-[#55555E]">{result.note}</p>
            {result.figures.map((figure) => (
              <div key={figure.key} className="text-[12px] space-y-1 border-t border-[#F4F4F6] pt-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-[#111114]">{figure.title}</span>
                  <span className={tone[figure.state]}>{figure.state}</span>
                </div>
                <p className="text-[#111114]">{figure.value}</p>
                <p className="text-[#55555E]">{figure.explanation}</p>
                <p className="text-[#9A9AA3]">Source: {figure.source}</p>
                {figure.completedAt && Number.isFinite(Date.parse(figure.completedAt)) && (
                  <p className="text-[#55555E]">Completed: {fmtDateTime(figure.completedAt)}</p>
                )}
                {!!figure.criticalFailures?.length && (
                  <p className="text-[#55555E]">Critical failures: {figure.criticalFailures.join(", ")}</p>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </SectionCard>
  );
}
