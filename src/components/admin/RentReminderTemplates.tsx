import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { RENT_REMINDER_STAGES, templateProblem, type RentReminderStage, type RentReminderTemplates as T } from "@/lib/rent-reminders";
import { getRentReminderTemplates, saveRentReminderTemplates } from "@/lib/rent-reminders.functions";

// Settings → Automations → Rent Reminder Templates. Each stage's on/off
// switch is in the Automations list above (all Off by default). Saving a
// template never sends anything.

const STAGE_LABEL: Record<RentReminderStage, string> = {
  due_tomorrow: "Due Tomorrow",
  due_today: "Due Today",
  overdue: "Overdue",
  daily: "Daily Past Due",
};
const input = "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm";
const PLACEHOLDERS = "{{first_name}} {{amount}} {{due_date}} {{days_late}} {{late_fee_line}} {{balance}} (manual only) {{link}} {{other_invoices_line}} (autopay only) {{payment_instructions}} (manual only)";

export function RentReminderTemplates() {
  const load = useServerFn(getRentReminderTemplates);
  const save = useServerFn(saveRentReminderTemplates);
  const [t, setT] = useState<T | null>(null);
  const [defaults, setDefaults] = useState<T | null>(null);
  const [mode, setMode] = useState<"stripe" | "manual">("stripe");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    load().then((r) => { setT(r.templates); setDefaults(r.defaults); }).catch(() => toast.error("Could Not Load Rent Reminder Templates"));
  }, [load]);

  if (!t) return <p className="text-sm text-muted-foreground">Loading Rent Reminder Templates…</p>;

  const set = (stage: RentReminderStage, field: "sms" | "subject" | "email", value: string) =>
    setT({ ...t, [mode]: { ...t[mode], [stage]: { ...t[mode][stage], [field]: value } } });

  const submit = async () => {
    setBusy(true);
    try {
      await save({ data: t as any });
      toast.success("Rent Reminder Templates Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could Not Save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-[#EDEDF0] bg-white p-4" data-testid="rent-reminder-templates">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[15px] font-semibold text-[#111114]">Rent Reminder Templates</h3>
          <p className="mt-0.5 text-[13px] text-[#55555E]">
            One schedule for every renter. Autopay renters only ever get their own Stripe invoice link; the day-before heads-up has no link. Late fees appear only through {"{{late_fee_line}}"}, which is left out when a week is waived.
            Turn each stage on in the list above; all start Off.
          </p>
        </div>
        <div className="flex gap-1.5">
          {(["stripe", "manual"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${mode === m ? "border-[#D03020] bg-[#D03020] text-white" : "border-[#EDEDF0] text-[#55555E]"}`}>
              {m === "stripe" ? "Autopay (Stripe)" : "Manual Payers"}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 text-[11px] text-[#55555E]">Placeholders: {PLACEHOLDERS}</p>
      <div className="mt-3 space-y-4">
        {RENT_REMINDER_STAGES.map((stage) => {
          const problem = templateProblem(mode, stage, t[mode][stage]);
          return (
            <div key={stage} className="rounded-xl border border-[#EDEDF0] p-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-[#111114]">{STAGE_LABEL[stage]}</h4>
                {defaults ? (
                  <button type="button" className="text-xs text-[#55555E] underline" onClick={() => setT({ ...t, [mode]: { ...t[mode], [stage]: defaults[mode][stage] } })}>Reset To Default</button>
                ) : null}
              </div>
              <label className="mt-2 block text-xs font-medium text-muted-foreground">Text</label>
              <textarea className={input} rows={3} value={t[mode][stage].sms} onChange={(e) => set(stage, "sms", e.target.value)} aria-label={`${STAGE_LABEL[stage]} Text`} />
              <label className="mt-2 block text-xs font-medium text-muted-foreground">Email Subject</label>
              <input className={input} value={t[mode][stage].subject} onChange={(e) => set(stage, "subject", e.target.value)} aria-label={`${STAGE_LABEL[stage]} Subject`} />
              <label className="mt-2 block text-xs font-medium text-muted-foreground">Email</label>
              <textarea className={input} rows={4} value={t[mode][stage].email} onChange={(e) => set(stage, "email", e.target.value)} aria-label={`${STAGE_LABEL[stage]} Email`} />
              {problem ? <p className="mt-1 text-xs text-[#D03020]">{problem}</p> : null}
            </div>
          );
        })}
        {mode === "manual" ? (
          <div className="rounded-xl border border-[#EDEDF0] p-3">
            <h4 className="text-sm font-semibold text-[#111114]">How Manual Payers Pay</h4>
            <p className="text-xs text-[#55555E]">Fills {"{{payment_instructions}}"}. Never shown to autopay renters.</p>
            <textarea className={`${input} mt-2`} rows={2} value={t.manualInstructions} onChange={(e) => setT({ ...t, manualInstructions: e.target.value })} aria-label="Payment Instructions" />
          </div>
        ) : null}
      </div>
      <div className="mt-4 flex justify-end">
        <button type="button" disabled={busy} onClick={submit}
          className="inline-flex h-9 items-center justify-center rounded-md bg-[#D03020] px-4 text-sm font-semibold text-white hover:bg-[#B52818] disabled:opacity-50">
          {busy ? "Saving…" : "Save Templates"}
        </button>
      </div>
    </section>
  );
}
