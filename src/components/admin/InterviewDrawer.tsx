import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { InterviewTab } from "./DriverScreening";
import type { Application, DriverScreening } from "./types";
import { ClipboardList } from "lucide-react";

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
            <ClipboardList className="w-4 h-4 text-[#CC0000]" strokeWidth={1.75} />
            Interview · {driver.full_name ?? "Driver"}
          </SheetTitle>
          <p className="text-[12px] text-[#55555E] mt-1">
            Step-by-step qualification workflow. Progress autosaves when you click Complete Interview.
          </p>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <InterviewTab driver={driver} screening={screening} onSaved={(next) => { onSaved(next); }} />
        </div>
      </SheetContent>
    </Sheet>
  );
}