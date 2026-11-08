import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { InterviewTab } from "./DriverScreening";
import type { Application, DriverScreening } from "./types";
import { ClipboardList } from "lucide-react";
import { fmtDateTime } from "@/lib/date-format";

/**
 * Right-side drawer that hosts the full interview workflow so it never
 * competes with the driver profile for main-canvas space.
 */
export function InterviewDrawer({
  open,
  onOpenChange,
  driver,
  screening,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  driver: Application;
  screening: DriverScreening | null;
  onSaved: (next: DriverScreening) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[760px] p-0 bg-[#FAFAFB] flex flex-col"
      >
        <SheetHeader className="px-6 py-4 border-b border-[#EDEDF0] bg-white shrink-0">
          <SheetTitle className="flex items-center gap-2 text-[15px]">
            <ClipboardList className="w-4 h-4 text-[#D03020]" strokeWidth={1.75} />
            Interview · {driver.full_name ?? "Driver"}
          </SheetTitle>
          <p className="text-[12px] text-[#55555E] mt-1">
            Step-by-step qualification workflow. Answers save when you click Complete Interview on the last step.
          </p>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {screening?.interview_completed_at ? <div className="mb-4 space-y-1 rounded-lg border border-border bg-card p-3 text-sm" aria-label="Recorded Call">
            <div className="font-semibold text-foreground">Interview Complete · {fmtDateTime(screening.interview_completed_at)}</div>
            {screening.interviewed_by ? <div className="text-xs text-muted-foreground">Recorded By: {screening.interviewed_by}</div> : null}
            {screening.interview_notes ? <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{screening.interview_notes}</p> : null}
          </div> : null}
          <InterviewTab
            stepped
            driver={driver}
            screening={screening}
            onSaved={(next) => {
              onSaved(next);
              onOpenChange(false);
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}