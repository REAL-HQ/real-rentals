import { useState } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import {
  buildAttributionRows,
  hasTrackingDetails,
  rawAttributionLines,
  type AttributionInput,
} from "@/lib/attribution-display";

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy Value"
      title="Copy"
      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-soft"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export function AttributionDetails({ data }: { data: AttributionInput }) {
  const [open, setOpen] = useState(false);
  const rows = buildAttributionRows(data);
  const raw = rawAttributionLines(data);
  return (
    <div className="min-w-0">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {rows.map((r) => (
          <div key={r.label} className="min-w-0 bg-soft rounded-md px-3 py-2">
            <div className="text-[10px] tracking-wider text-muted-foreground">{r.label}</div>
            <div className="text-sm break-words" title={r.raw ?? r.value}>
              {r.value}
            </div>
          </div>
        ))}
      </div>
      {!hasTrackingDetails(data) && (
        <div className="mt-2 text-xs text-muted-foreground">No Tracking Details</div>
      )}
      {raw.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
            {open ? "Hide Raw Details" : "Show Raw Details"}
          </button>
          {open && (
            <div className="mt-2 space-y-1.5">
              {raw.map((r) => (
                <div key={r.label} className="flex min-w-0 items-start gap-2 rounded-md bg-soft px-3 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] text-muted-foreground">{r.label}</div>
                    <div className="break-all font-mono text-[11px]">{r.raw}</div>
                  </div>
                  <CopyButton text={r.raw} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
