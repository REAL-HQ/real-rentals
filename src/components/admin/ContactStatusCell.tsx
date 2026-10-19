import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronDown, Check, Loader2, CalendarDays } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { fmtDate } from "@/lib/date-format";
import {
  CONTACT_STATUSES,
  CONTACT_STATUS_TONE,
  contactStatusBlockers,
  contactStatusForm,
  contactStatusLabel,
  readContactStatus,
  type ContactStatusDraft,
  type ContactStatusKey,
  type ContactStatusState,
} from "@/lib/contact-status";
import { setContactStatus } from "@/lib/contact-status.functions";

/**
 * The Drivers list's Contact Status cell: a badge, a list, a short form.
 *
 * Two steps in ONE popover rather than a dropdown that opens a second layer.
 * Nested portals are the thing that breaks on a phone — the menu closes as the
 * popover opens, or the keyboard pushes the second layer off-screen — and
 * staff are using this one-handed between calls. Click the badge, pick a
 * status, fill only what that status needs, Save.
 *
 * The badge shows the stored status; the form shows only the fields
 * `contactStatusForm` says that status has, and Save is refused by the same
 * `contactStatusBlockers` the server re-runs. Nothing here writes to the
 * database: the one write is the setContactStatus server function, which
 * checks the caller's tier itself.
 */
export function ContactStatusCell({
  applicationId,
  row,
  onSaved,
}: {
  applicationId: string;
  /** The applications row, read for its contact_* fields. */
  row: unknown;
  onSaved: (state: ContactStatusState) => void;
}) {
  const { supported, state } = useMemo(() => readContactStatus(row), [row]);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<ContactStatusKey | null>(null);
  const [note, setNote] = useState("");
  const [followUpOn, setFollowUpOn] = useState("");
  const [saving, setSaving] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const save = useServerFn(setContactStatus);

  // Opening starts from what is stored, so correcting a note does not mean
  // retyping it, and closing throws the edit away rather than keeping a
  // half-finished one against the next person opened.
  useEffect(() => {
    if (open) {
      setPicked(null);
      setNote(state.note ?? "");
      setFollowUpOn(state.followUpOn ?? "");
    }
  }, [open, state.note, state.followUpOn]);

  const form = picked ? contactStatusForm(picked) : null;
  const draft: ContactStatusDraft | null = picked ? { status: picked, note, followUpOn } : null;
  const blockers = draft ? contactStatusBlockers(draft) : [];

  function pick(status: ContactStatusKey) {
    const f = contactStatusForm(status);
    setPicked(status);
    // A status that takes no note keeps none: carrying the old text into
    // Unqualified would file the wrong reason.
    if (f.note === "off") setNote("");
    if (f.followUp === "off") setFollowUpOn("");
    setTimeout(() => noteRef.current?.focus(), 0);
  }

  async function commit() {
    if (!draft || blockers.length || saving) return;
    setSaving(true);
    try {
      const res = await save({
        data: {
          applicationId,
          status: draft.status,
          note: draft.note.trim() || undefined,
          followUpOn: draft.followUpOn || undefined,
        },
      });
      onSaved(res.state);
      setOpen(false);
      toast.success(`Contact Status set to ${contactStatusLabel(res.state.status)}`);
    } catch (e) {
      // The server's own words: a missing migration, a refused tier and a
      // failed rule each need a different fix, so none of them become
      // "Something went wrong".
      toast.error(e instanceof Error ? e.message : "Could not save the contact status");
    } finally {
      setSaving(false);
    }
  }

  const tone = CONTACT_STATUS_TONE[state.status] ?? CONTACT_STATUS_TONE.new;

  // Without the migration there is nothing to read and nowhere to save, and
  // saying so beats showing every lead as New.
  if (!supported) {
    return (
      <span
        title="Contact Status needs its database migration applied before it can be used."
        className="inline-flex items-center rounded-full bg-[#F4F4F6] px-2 py-0.5 text-[11px] font-medium text-[#9A9AA3]"
      >
        Not Enabled
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-contact-status={state.status}
        title={
          state.changedAt
            ? `Contact Status: ${contactStatusLabel(state.status)} — set ${fmtDate(state.changedAt)}`
            : `Contact Status: ${contactStatusLabel(state.status)}`
        }
        className={`inline-flex items-center gap-1 rounded-full px-3 py-0.5 text-[11px] font-medium hover:opacity-80 ${tone}`}
      >
        {contactStatusLabel(state.status)}
        <ChevronDown className="h-3 w-3 shrink-0" />
      </PopoverTrigger>
      {/* Two columns on wider screens; stacks within a 390px screen's 16px gutter. */}
      <PopoverContent
        align="start"
        collisionPadding={16}
        className={`${picked ? "w-[min(20rem,calc(100vw-2rem))]" : "w-[min(34rem,calc(100vw-2rem))]"} max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-0`}
      >
        {!picked ? (
          <div className="flex flex-col sm:flex-row" data-contact-status-list>
            <div className="py-1 sm:w-[15rem] sm:shrink-0">
              <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Contact Status
              </div>
              {CONTACT_STATUSES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => pick(s.key)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] hover:bg-soft"
                >
                  <span className="inline-flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${CONTACT_STATUS_TONE[s.key].split(" ")[0]}`}
                    />
                    {s.label}
                  </span>
                  {s.key === state.status && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
                </button>
              ))}
            </div>
            <div
              className="min-w-0 flex-1 border-t border-border px-3 py-2 sm:border-l sm:border-t-0"
              data-contact-status-details
            >
              <div className="py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Follow-Up
              </div>
              <div className="mt-1 text-[12px] text-foreground">
                {state.followUpOn ? (
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="h-3 w-3 text-muted-foreground" />
                    {fmtDate(state.followUpOn)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Not Set</span>
                )}
              </div>
              <div className="mt-4 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Latest Note
              </div>
              <NotePreview note={state.note} />
            </div>
          </div>
        ) : (
          <div className="p-3" data-contact-status-form={picked}>
            <div className="text-[13px] font-medium">{contactStatusLabel(picked)}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{form?.hint}</div>

            {form?.note !== "off" && (
              <label className="mt-3 block">
                <span className="text-[11px] font-medium text-muted-foreground">
                  {form?.noteLabel}
                  {form?.note === "required" ? "" : " (optional)"}
                </span>
                <Textarea
                  ref={noteRef}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  className="mt-1 text-[13px]"
                  placeholder={form?.note === "required" ? "Needed before this can be saved" : ""}
                />
              </label>
            )}

            {form?.followUp !== "off" && (
              <label className="mt-3 block">
                <span className="text-[11px] font-medium text-muted-foreground">
                  Follow-Up Date{form?.followUp === "required" ? "" : " (optional)"}
                </span>
                <input
                  type="date"
                  value={followUpOn}
                  onChange={(e) => setFollowUpOn(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-border bg-white px-2 text-[13px]"
                />
              </label>
            )}

            {blockers.length > 0 && (
              <div className="mt-2 text-[11px] text-rose-700">
                {blockers.map((b) => b.why).join(" ")}
              </div>
            )}

            <div className="mt-3 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setPicked(null)}
                className="rounded-md px-2 py-1.5 text-[12px] text-muted-foreground hover:bg-soft"
              >
                Back
              </button>
              <button
                type="button"
                data-contact-status-save
                disabled={saving || blockers.length > 0}
                onClick={() => void commit()}
                className="inline-flex items-center gap-1.5 rounded-md bg-black px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {saving ? "Saving…" : "Save"}
              </button>
            </div>

            {state.changedAt && (
              <div className="mt-2 border-t border-border pt-2 text-[10px] text-muted-foreground">
                Last set {fmtDate(state.changedAt)}
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Display-only preview of the stored note: clamps to ~5 lines, never alters the text. */
function NotePreview({ note }: { note: string | null | undefined }) {
  const [expanded, setExpanded] = useState(false);
  if (!note) return <div className="mt-1 text-[12px] text-muted-foreground">No Note</div>;
  const long = note.length > 220 || note.split("\n").length > 5;
  return (
    <div className="mt-1">
      <p
        className={`whitespace-pre-wrap break-words text-[12px] leading-[1.45] text-foreground ${
          expanded ? "max-h-48 overflow-y-auto" : "line-clamp-5"
        }`}
        data-contact-status-note
      >
        {note}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[11px] font-medium text-muted-foreground underline-offset-2 hover:underline"
        >
          {expanded ? "View Less" : "View More"}
        </button>
      )}
    </div>
  );
}
