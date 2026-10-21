import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getPricingReminderSettings } from "@/lib/pricing-reminder-settings.functions";
import {
  PRICING_REMINDER_SETTINGS_ENABLED,
  type PricingReminderView,
} from "@/lib/pricing-reminder-settings";

/**
 * Renders nothing while the flag is off, and does not mount the loader.
 * There is no save and no send.
 */
export function PricingReminderSettings() {
  if (!PRICING_REMINDER_SETTINGS_ENABLED) return null;
  return <PricingReminderSettingsBody />;
}

function money(value: number | null): string {
  return value == null ? "Not Set" : `$${value.toLocaleString("en-US")}`;
}

function hours(start: number | null, end: number | null): string {
  if (start == null || end == null) return "Not Recorded";
  const label = (hour: number) => {
    const suffix = hour < 12 ? "AM" : "PM";
    const clock = hour % 12 === 0 ? 12 : hour % 12;
    return `${clock} ${suffix}`;
  };
  return `${label(start)} – ${label(end)}`;
}

function delayLabel(minutes: number | null): string {
  if (minutes == null) return "Not Recorded";
  if (minutes < 60) return `${minutes} Minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} Hours` : `${hours} Hours ${rest} Minutes`;
}

function PricingReminderSettingsBody() {
  const load = useServerFn(getPricingReminderSettings);
  const [view, setView] = useState<PricingReminderView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!PRICING_REMINDER_SETTINGS_ENABLED) return;
    let live = true;
    load()
      .then((res) => {
        if (!live) return;
        if (res.ok) {
          setView(res.view);
          setState("ready");
        } else {
          setState("error");
        }
      })
      .catch(() => {
        if (live) setState("error");
      });
    return () => {
      live = false;
    };
  }, [load]);

  if (state === "loading") return <p className="mb-4 text-sm text-muted-foreground">Loading Pricing And Reminders…</p>;
  if (state === "error" || !view) return <p className="mb-4 text-sm text-red-700">Pricing And Reminders Could Not Be Loaded.</p>;

  return (
    <section aria-labelledby="pricing-reminder-title" className="mb-4 rounded-xl border border-border bg-white p-4">
      <h3 id="pricing-reminder-title" className="text-sm font-semibold">Pricing And Reminder Schedule</h3>
      <p className="mt-1 text-xs text-muted-foreground">Read Only. Nothing Is Sent.</p>
      <h4 className="mt-4 text-xs font-medium text-muted-foreground">Vehicle Pricing</h4>
      {view.prices.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No Vehicle Pricing Set.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {view.prices.map((price) => (
            <li key={price.bodyType} className="py-2 text-sm">
              <span className="font-medium">{price.label}</span>
              <span className="mt-1 block text-muted-foreground">
                Weekly Rate {money(price.weeklyRate)} · Monthly Rate {money(price.monthlyRate)} · Deposit {money(price.deposit)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <h4 className="mt-4 text-xs font-medium text-muted-foreground">Reminder Schedule</h4>
      {view.reminders.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No Reminder Steps.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {view.reminders.map((step) => (
            <li key={`${step.workflowName}-${step.stepOrder}`} className="py-2 text-sm">
              <span className="font-medium">{step.workflowName}</span>
              <span className="mt-1 block text-muted-foreground">
                Step {step.stepOrder} · {step.channel} · {delayLabel(step.delayMinutes)} · Quiet Hours {hours(step.quietHoursStart, step.quietHoursEnd)}
                {step.workflowActive && step.stepActive ? "" : " · Inactive"}
                {step.stopOnReply ? " · Stops On Reply" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
