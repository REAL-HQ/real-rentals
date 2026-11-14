import { useState, type ComponentType } from "react";
import {
  Ban,
  CarFront,
  Check,
  ChevronDown,
  CreditCard,
  CircleDot,
  KeyRound,
  ListChecks,
  Phone,
  Receipt,
  ShieldAlert,
  ShieldOff,
  UserCog,
  Wrench,
} from "lucide-react";
import { DRIVER_GUIDES, type DriverGuideId } from "@/lib/driver-guides";

const ICONS: Record<DriverGuideId, ComponentType<{ className?: string }>> = {
  accident: CarFront,
  breakdown: Wrench,
  flat: CircleDot,
  lockout: KeyRound,
  theft: ShieldAlert,
  ticket: Receipt,
  insurance: ShieldOff,
  changes: UserCog,
  payment: CreditCard,
};

/**
 * "What To Do If..." checklists for the renter portal.
 *
 * Static content, no queries and no writes: the ticks are a working aid kept
 * only on this screen, so a renter can follow the steps at the roadside. They
 * are not a report. Reporting stays with the Roadside Request and Report an
 * Issue forms on the same tab.
 */
export function WhatToDoGuides({ phone }: { phone: { tel: string; display: string } }) {
  const [open, setOpen] = useState<DriverGuideId | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>({});

  return (
    <section
      className="rounded-2xl border border-border bg-white p-5"
      data-testid="what-to-do-guides"
    >
      <div className="flex items-start gap-3">
        <ListChecks className="w-5 h-5 text-real-red shrink-0 mt-0.5" />
        <div>
          <h3 className="font-semibold">What To Do If Something Happens</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick what happened and follow the steps in order. In an emergency, call 911 first.
          </p>
        </div>
      </div>

      <div className="mt-4 divide-y divide-border rounded-xl border border-border">
        {DRIVER_GUIDES.map((g) => {
          const Icon = ICONS[g.id];
          const isOpen = open === g.id;
          const ticked = g.steps.filter((_, i) => done[`${g.id}:${i}`]).length;
          return (
            <div key={g.id}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : g.id)}
                aria-expanded={isOpen}
                aria-controls={`guide-${g.id}`}
                className="flex w-full items-center gap-3 px-4 py-3 text-left min-h-[52px] hover:bg-soft"
              >
                <Icon className="w-5 h-5 shrink-0 text-[#55555E]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{g.title}</span>
                  <span className="block text-xs text-muted-foreground">{g.summary}</span>
                </span>
                {ticked > 0 ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {ticked} of {g.steps.length}
                  </span>
                ) : null}
                <ChevronDown
                  className={`w-4 h-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </button>

              {isOpen ? (
                <div id={`guide-${g.id}`} className="px-4 pb-4">
                  {g.call ? (
                    <a
                      href={phone.tel}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#D03020] px-4 py-2.5 text-sm font-semibold text-white"
                    >
                      <Phone className="w-4 h-4" />
                      Call REAL RENTALS {phone.display}
                    </a>
                  ) : null}

                  <ol className="mt-3 space-y-2">
                    {g.steps.map((step, i) => {
                      const key = `${g.id}:${i}`;
                      const checked = !!done[key];
                      return (
                        <li key={key}>
                          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 min-h-[44px]">
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={checked}
                              onChange={(e) => setDone((d) => ({ ...d, [key]: e.target.checked }))}
                            />
                            <span
                              aria-hidden
                              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                                checked
                                  ? "border-[#1E7A32] bg-[#1E7A32] text-white"
                                  : "border-[#B8B8C0] bg-white"
                              }`}
                            >
                              {checked ? <Check className="w-3.5 h-3.5" /> : null}
                            </span>
                            <span
                              className={`text-sm ${checked ? "text-muted-foreground line-through" : ""}`}
                            >
                              <span className="font-semibold">{i + 1}.</span> {step}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ol>

                  {g.dont?.length ? (
                    <div className="mt-3 rounded-lg border border-[#F3C5CB] bg-[#FDE4E6] p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-[#8A1024]">
                        Do Not
                      </div>
                      <ul className="mt-1.5 space-y-1.5">
                        {g.dont.map((line) => (
                          <li key={line} className="flex items-start gap-2 text-sm text-[#111114]">
                            <Ban className="mt-0.5 w-4 h-4 shrink-0 text-[#C8102E]" />
                            <span>{line}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <p className="mt-3 text-xs text-muted-foreground">
                    Source: {g.source}. The checkmarks are for your own use and are not sent to us.
                    Use the forms on this page to report what happened.
                  </p>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
