import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, X, Zap, MessageSquare, Mail, Clock, Trash2, Send } from "lucide-react";
import { StatusPill, EmptyState, MicroLabel } from "./ui";

type Workflow = {
  id: string;
  name: string;
  description: string | null;
  trigger_event: string;
  is_active: boolean;
  quiet_hours_start: number;
  quiet_hours_end: number;
  stop_on_reply: boolean;
  stop_on_statuses: string[];
};

type Step = {
  id: string;
  workflow_id: string;
  step_order: number;
  delay_minutes: number;
  channel: string;
  subject: string | null;
  body: string;
  is_active: boolean;
};

type LogRow = {
  id: string;
  channel: string;
  to_address: string;
  body: string;
  status: string;
  error: string | null;
  kind: string | null;
  created_at: string;
};

const TRIGGERS = [
  { value: "application_submitted", label: "Someone completes an application" },
  { value: "application_abandoned", label: "Someone abandons the application" },
  { value: "application_approved", label: "An application is approved" },
  { value: "rental_started", label: "A rental starts" },
  { value: "payment_past_due", label: "A payment goes past due" },
];

const TOKENS = ["first_name", "full_name", "city", "phone", "email"];

/** Turn minutes into something an operator reads at a glance. */
export function humanDelay(minutes: number): string {
  if (minutes <= 0) return "Immediately";
  if (minutes < 60) return `${minutes} min after`;
  if (minutes < 1440) {
    const h = minutes / 60;
    return `${Number.isInteger(h) ? h : h.toFixed(1)} hr after`;
  }
  const d = minutes / 1440;
  return `${Number.isInteger(d) ? d : d.toFixed(1)} day${d === 1 ? "" : "s"} after`;
}

export function AutomationsPanel() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingStep, setEditingStep] = useState<{ workflowId: string; step: Step | null } | null>(
    null,
  );

  async function load() {
    setLoading(true);
    const [w, s, l] = await Promise.all([
      supabase.from("automation_workflows").select("*").order("created_at"),
      supabase.from("automation_steps").select("*").order("step_order"),
      supabase
        .from("outbound_messages")
        .select("id,channel,to_address,body,status,error,kind,created_at")
        .order("created_at", { ascending: false })
        .limit(25),
    ]);
    if (w.error) toast.error(w.error.message);
    setWorkflows((w.data as any) ?? []);
    setSteps((s.data as any) ?? []);
    setLog((l.data as any) ?? []);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function toggleActive(wf: Workflow) {
    if (!wf.is_active) {
      const count = steps.filter((s) => s.workflow_id === wf.id && s.is_active).length;
      if (count === 0) {
        return toast.error("Add at least one message before turning this on.");
      }
      if (!confirm(`Turn on "${wf.name}"? Real messages will start going out to applicants.`))
        return;
    }
    const { error } = await supabase
      .from("automation_workflows")
      .update({ is_active: !wf.is_active })
      .eq("id", wf.id);
    if (error) return toast.error(error.message);
    toast.success(wf.is_active ? "Automation paused" : "Automation is live");
    load();
  }

  async function removeStep(id: string) {
    if (!confirm("Delete this message?")) return;
    const { error } = await supabase.from("automation_steps").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  }

  async function removeWorkflow(id: string) {
    if (!confirm("Delete this automation and all of its messages?")) return;
    const { error } = await supabase.from("automation_workflows").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    load();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {workflows.length} automation(s) · {workflows.filter((w) => w.is_active).length} live
        </span>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-[#D03020] text-white px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity duration-150"
        >
          <Plus className="w-4 h-4" /> New Automation
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : workflows.length === 0 ? (
        <EmptyState
          icon={<Zap className="w-6 h-6" strokeWidth={1.75} />}
          title="No Automations Yet"
          hint="Create a sequence to text or email applicants automatically after they apply."
        />
      ) : (
        <div className="space-y-4">
          {workflows.map((wf) => {
            const mine = steps
              .filter((s) => s.workflow_id === wf.id)
              .sort((a, b) => a.step_order - b.step_order);
            return (
              <div
                key={wf.id}
                className="rounded-2xl border border-[#EDEDF0] bg-white shadow-sm overflow-hidden"
              >
                <div className="p-4 flex items-start justify-between gap-3 border-b border-[#EDEDF0]">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold truncate">{wf.name}</h3>
                      <StatusPill status={wf.is_active ? "active" : "paused"}>
                        {wf.is_active ? "Live" : "Paused"}
                      </StatusPill>
                    </div>
                    {wf.description ? (
                      <p className="mt-1 text-sm text-muted-foreground">{wf.description}</p>
                    ) : null}
                    <p className="mt-2 text-xs text-muted-foreground">
                      Trigger:{" "}
                      {TRIGGERS.find((t) => t.value === wf.trigger_event)?.label ??
                        wf.trigger_event}
                      {" · "}
                      Quiet hours {wf.quiet_hours_start}:00–{wf.quiet_hours_end}:00
                      {wf.stop_on_reply ? " · Stops when they reply" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => toggleActive(wf)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold border transition-colors ${
                        wf.is_active
                          ? "border-[#EDEDF0] text-[#55555E] hover:border-[#D6D6DB]"
                          : "border-transparent bg-[#D03020] text-white hover:opacity-90"
                      }`}
                    >
                      {wf.is_active ? "Pause" : "Turn on"}
                    </button>
                    <button
                      onClick={() => removeWorkflow(wf.id)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#EDEDF0] text-[#55555E] hover:text-[#D03020] hover:border-[#D6D6DB]"
                      title="Delete automation"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <ol className="divide-y divide-[#EDEDF0]">
                  {mine.map((s) => (
                    <li key={s.id} className="p-4 flex items-start gap-3">
                      <div className="mt-0.5 shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#F6F6F8] text-xs font-semibold">
                        {s.step_order}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {s.channel === "sms" ? (
                            <MessageSquare className="w-3.5 h-3.5" />
                          ) : (
                            <Mail className="w-3.5 h-3.5" />
                          )}
                          <span className="uppercase tracking-wide font-semibold">{s.channel}</span>
                          <Clock className="w-3.5 h-3.5 ml-1" />
                          <span>{humanDelay(s.delay_minutes)} they apply</span>
                          {!s.is_active ? <span className="text-[#D03020]">· disabled</span> : null}
                        </div>
                        {s.subject ? (
                          <div className="mt-1 text-sm font-medium">{s.subject}</div>
                        ) : null}
                        <p className="mt-1 text-sm whitespace-pre-wrap break-words">{s.body}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => setEditingStep({ workflowId: wf.id, step: s })}
                          className="text-xs font-semibold text-[#D03020] px-2 py-1"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => removeStep(s.id)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#55555E] hover:text-[#D03020]"
                          title="Delete message"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                  <li className="p-3">
                    <button
                      onClick={() => setEditingStep({ workflowId: wf.id, step: null })}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-[#D03020]"
                    >
                      <Plus className="w-4 h-4" /> Add message
                    </button>
                  </li>
                </ol>
              </div>
            );
          })}
        </div>
      )}

      <RecentSends rows={log} />

      {showForm ? (
        <WorkflowForm
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            load();
          }}
        />
      ) : null}
      {editingStep ? (
        <StepForm
          workflowId={editingStep.workflowId}
          step={editingStep.step}
          existing={steps.filter((s) => s.workflow_id === editingStep.workflowId)}
          onClose={() => setEditingStep(null)}
          onSaved={() => {
            setEditingStep(null);
            load();
          }}
        />
      ) : null}
    </div>
  );
}

function RecentSends({ rows }: { rows: LogRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-2xl border border-[#EDEDF0] bg-white shadow-sm">
      <div className="p-4 border-b border-[#EDEDF0] flex items-center gap-2">
        <Send className="w-4 h-4 text-[#55555E]" />
        <h3 className="font-semibold text-sm">Recent Sends</h3>
      </div>
      <ul className="divide-y divide-[#EDEDF0] max-h-80 overflow-y-auto">
        {rows.map((r) => (
          <li key={r.id} className="p-3 flex items-start gap-3 text-sm">
            <StatusPill
              status={
                r.status === "sent" ? "active" : r.status === "failed" ? "overdue" : "pending"
              }
            >
              {r.status}
            </StatusPill>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-muted-foreground">
                {r.channel.toUpperCase()} → {r.to_address}
                {r.kind ? ` · ${r.kind}` : ""} · {new Date(r.created_at).toLocaleString()}
              </div>
              <p className="truncate">{r.body}</p>
              {r.error ? <p className="text-xs text-[#D03020]">{r.error}</p> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-[#EDEDF0]">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="text-[#55555E] hover:text-[#111114]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-4">{children}</div>
      </div>
    </div>
  );
}

function WorkflowForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [trigger, setTrigger] = useState(TRIGGERS[0].value);
  const [quietStart, setQuietStart] = useState(21);
  const [quietEnd, setQuietEnd] = useState(8);
  const [stopOnReply, setStopOnReply] = useState(true);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (name.trim().length < 2) return toast.error("Give this automation a name.");
    setBusy(true);
    const { error } = await supabase.from("automation_workflows").insert({
      name: name.trim(),
      description: description.trim() || null,
      trigger_event: trigger,
      quiet_hours_start: quietStart,
      quiet_hours_end: quietEnd,
      stop_on_reply: stopOnReply,
      // New automations start paused so nothing sends before it's reviewed.
      is_active: false,
      stop_on_statuses:
        trigger === "application_submitted" ? ["approved", "rejected", "active"] : [],
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Automation created — add your messages, then turn it on.");
    onSaved();
  }

  return (
    <Modal title="New Automation" onClose={onClose}>
      <Field label="Name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New Applicant Follow-Up"
          className="w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
        />
      </Field>
      <Field label="Description">
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this sequence does"
          className="w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
        />
      </Field>
      <Field label="When should it start?">
        <select
          value={trigger}
          onChange={(e) => setTrigger(e.target.value)}
          className="w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm bg-white"
        >
          {TRIGGERS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Quiet hours start">
          <HourSelect value={quietStart} onChange={setQuietStart} />
        </Field>
        <Field label="Quiet hours end">
          <HourSelect value={quietEnd} onChange={setQuietEnd} />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">
        Messages due during quiet hours are held until the window closes — nobody gets a text at
        3am.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={stopOnReply}
          onChange={(e) => setStopOnReply(e.target.checked)}
        />
        Stop the sequence when they reply
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="rounded-lg border border-[#EDEDF0] px-4 py-2 text-sm">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-[#D03020] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          {busy ? "Saving…" : "Create"}
        </button>
      </div>
    </Modal>
  );
}

function StepForm({
  workflowId,
  step,
  existing,
  onClose,
  onSaved,
}: {
  workflowId: string;
  step: Step | null;
  existing: Step[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [channel, setChannel] = useState(step?.channel ?? "sms");
  const [subject, setSubject] = useState(step?.subject ?? "");
  const [body, setBody] = useState(step?.body ?? "");
  const [amount, setAmount] = useState(() => {
    const m = step?.delay_minutes ?? 5;
    if (m % 1440 === 0 && m >= 1440) return String(m / 1440);
    if (m % 60 === 0 && m >= 60) return String(m / 60);
    return String(m);
  });
  const [unit, setUnit] = useState(() => {
    const m = step?.delay_minutes ?? 5;
    if (m % 1440 === 0 && m >= 1440) return "days";
    if (m % 60 === 0 && m >= 60) return "hours";
    return "minutes";
  });
  const [busy, setBusy] = useState(false);

  const delayMinutes = (() => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(unit === "days" ? n * 1440 : unit === "hours" ? n * 60 : n);
  })();

  async function save() {
    if (body.trim().length < 5) return toast.error("Write the message you want sent.");
    if (channel === "sms" && body.length > 480) {
      return toast.error("Keep SMS under 480 characters (that's 3 segments).");
    }
    setBusy(true);
    if (step) {
      const { error } = await supabase
        .from("automation_steps")
        .update({
          channel,
          subject: channel === "email" ? subject.trim() || null : null,
          body: body.trim(),
          delay_minutes: delayMinutes,
        })
        .eq("id", step.id);
      setBusy(false);
      if (error) return toast.error(error.message);
    } else {
      const nextOrder = existing.length ? Math.max(...existing.map((s) => s.step_order)) + 1 : 1;
      const { error } = await supabase.from("automation_steps").insert({
        workflow_id: workflowId,
        step_order: nextOrder,
        channel,
        subject: channel === "email" ? subject.trim() || null : null,
        body: body.trim(),
        delay_minutes: delayMinutes,
      });
      setBusy(false);
      if (error) return toast.error(error.message);
    }
    toast.success("Saved");
    onSaved();
  }

  const segments = Math.max(1, Math.ceil(body.length / 160));

  return (
    <Modal title={step ? "Edit Message" : "Add Message"} onClose={onClose}>
      <Field label="Channel">
        <div className="flex gap-2">
          {["sms", "email"].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setChannel(c)}
              className={`rounded-lg border px-4 py-2 text-sm capitalize ${
                channel === c ? "border-[#D03020] bg-[#D03020] text-white" : "border-[#EDEDF0]"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Send this long after the trigger">
        <div className="flex gap-2">
          <input
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-24 rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
          />
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className="rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm bg-white"
          >
            <option value="minutes">minutes</option>
            <option value="hours">hours</option>
            <option value="days">days</option>
          </select>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{humanDelay(delayMinutes)} they apply.</p>
      </Field>

      {channel === "email" ? (
        <Field label="Subject">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
          />
        </Field>
      ) : null}

      <Field label="Message">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          className="w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
          placeholder="Hi {{first_name}}, thanks for applying…"
        />
        {channel === "sms" ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {body.length} characters · {segments} segment{segments === 1 ? "" : "s"}. Always leave
            "Reply STOP to opt out" in the first message of a sequence.
          </p>
        ) : null}
      </Field>

      <div>
        <MicroLabel>Personalisation</MicroLabel>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {TOKENS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setBody((b) => `${b}{{${t}}}`)}
              className="rounded-md border border-[#EDEDF0] px-2 py-1 text-xs font-mono hover:border-[#D6D6DB]"
            >
              {`{{${t}}}`}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="rounded-lg border border-[#EDEDF0] px-4 py-2 text-sm">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-[#D03020] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <MicroLabel>{label}</MicroLabel>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function HourSelect({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm bg-white"
    >
      {Array.from({ length: 24 }, (_, h) => (
        <option key={h} value={h}>
          {String(h).padStart(2, "0")}:00
        </option>
      ))}
    </select>
  );
}
