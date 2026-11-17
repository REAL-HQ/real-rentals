import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A normal-size (18px) native checkbox that looks the same in every browser.
 *
 * It is still a real <input type="checkbox"> — same checked/onChange, same
 * form name, keyboard and screen-reader behavior — but it is drawn with
 * appearance-none and fixed pixel sizes, so no engine (iOS Safari included)
 * can stretch it into an oversized native control. Wrap it in a <label> with
 * the wording so the whole row stays the tap target.
 */
export const CheckboxInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { boxClassName?: string }
>(function CheckboxInput({ className, boxClassName, ...props }, ref) {
  return (
    <span
      className={cn(
        "relative inline-flex h-[18px] w-[18px] min-h-0 min-w-0 shrink-0",
        boxClassName,
      )}
      data-checkbox-box=""
    >
      <input
        ref={ref}
        type="checkbox"
        className={cn(
          "peer m-0 h-[18px] w-[18px] min-h-0 min-w-0 shrink-0 cursor-pointer appearance-none rounded-[4px] border-[1.5px] border-[#9A9AA3] bg-white p-0 transition-colors",
          "checked:border-[#D03020] checked:bg-[#D03020]",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D03020]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
      <Check
        aria-hidden
        strokeWidth={3}
        className="pointer-events-none absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 text-white opacity-0 peer-checked:opacity-100"
      />
    </span>
  );
});
