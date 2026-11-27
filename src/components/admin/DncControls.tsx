import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { PhoneOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DNC_REASON_MAX,
  MOVE_TO_DNC_LABEL,
  REMOVE_FROM_DNC_LABEL,
  dncReasonBlockers,
  type DncPerson,
} from "@/lib/dnc";
import { moveToDnc, removeFromDncList } from "@/lib/dnc.functions";
import { fmtDate } from "@/lib/date-format";
import { DncBadge, announceDncChanged, useDnc } from "@/components/admin/DncGuard";

const input = "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm";
const primary =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-[#D03020] px-4 text-sm font-semibold text-white hover:bg-[#B52818] disabled:opacity-50";
const secondary =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-[#D6D6DB] bg-white px-4 text-sm font-medium text-[#111114] hover:bg-[#FAFAFB] disabled:opacity-50";

/** Ask a profile's DNC card to open its Move To / Remove From dialog (e.g. from a More Actions menu). */
export const OPEN_DNC_DIALOG_EVENT = "open-dnc-dialog";
export function openDncDialog(target: { applicationId?: string; waitlistId?: string }) {
  window.dispatchEvent(new CustomEvent(OPEN_DNC_DIALOG_EVENT, { detail: target }));
}

export type DncTarget = { applicationId?: string; waitlistId?: string; name: string | null };

/**
 * Move To DNC (reason required) or Remove From DNC (reason required, Manager / Owner).
 * Both ask for an explicit confirmation before saving; who and when are recorded server-side.
 */
export function DncActionDialog({
  mode,
  target,
  entryId,
  onClose,
}: {
  mode: "add" | "remove";
  target: DncTarget;
  entryId?: string | null;
  onClose: () => void;
}) {
  const add = useServerFn(moveToDnc);
  const remove = useServerFn(removeFromDncList);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const issues = dncReasonBlockers(reason);
  const who = target.name || "this person";
  const title = mode === "add" ? MOVE_TO_DNC_LABEL : REMOVE_FROM_DNC_LABEL;

  async function save() {
    setBusy(true);
    try {
      if (mode === "add") {
        await add({
          data: { applicationId: target.applicationId, waitlistId: target.waitlistId, reason },
        });
        toast.success("Moved To DNC.");
      } else {
        if (!entryId) throw new Error("This Person Is Not On The DNC List.");
        await remove({ data: { id: entryId, reason } });
        toast.success("Removed From DNC.");
      }
      announceDncChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could Not Save.");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
    >
      <DialogContent
        className="max-w-md bg-white"
        data-testid={mode === "add" ? "dnc-add-dialog" : "dnc-remove-dialog"}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {!confirming ? (
          <div className="space-y-3 text-sm">
            <p className="text-[#55555E]">
              {mode === "add"
                ? `${who} will show a DNC badge everywhere, staff get a warning before contacting them, and automated texts and emails stop.`
                : `${who} will be contactable again and automated texts and emails resume.`}
            </p>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-[#111114]">Reason</span>
              <textarea
                className={`${input} min-h-[88px]`}
                value={reason}
                maxLength={DNC_REASON_MAX}
                onChange={(e) => setReason(e.target.value)}
                aria-label="DNC Reason"
                data-testid="dnc-reason"
                autoFocus
              />
            </label>
          </div>
        ) : (
          <p className="text-sm text-[#111114]" data-testid="dnc-confirm-text">
            {mode === "add" ? `Move ${who} To The DNC List?` : `Remove ${who} From The DNC List?`}
            <span className="mt-2 block rounded-md bg-[#F4F4F6] px-3 py-2 text-[#55555E]">
              Reason: {reason.trim()}
            </span>
          </p>
        )}
        <DialogFooter className="gap-2">
          <button
            type="button"
            className={secondary}
            disabled={busy}
            onClick={() => (confirming ? setConfirming(false) : onClose())}
          >
            {confirming ? "Back" : "Cancel"}
          </button>
          {!confirming ? (
            <button
              type="button"
              className={primary}
              disabled={issues.length > 0}
              onClick={() => setConfirming(true)}
              data-testid="dnc-continue"
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              className={primary}
              disabled={busy}
              onClick={save}
              data-testid="dnc-confirm"
            >
              {busy ? "Saving…" : title}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Driver profile card: DNC status, reason, who/when, and the Move To / Remove From actions. */
export function DncCard({
  applicationId,
  name,
  phone,
  email,
  canRemove,
}: {
  applicationId: string;
  name: string | null;
  phone?: string | null;
  email?: string | null;
  canRemove: boolean;
}) {
  const { lookup, installed } = useDnc();
  const person: DncPerson = { applicationId, phone, email };
  const entry = lookup(person);
  const [mode, setMode] = useState<null | "add" | "remove">(null);
  // Matched by phone/email to someone else's entry: show it, but removal happens on that entry (DNC section).
  const ownEntry = entry && entry.applicationId === applicationId ? entry : null;

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as { applicationId?: string } | undefined;
      if (d?.applicationId === applicationId)
        setMode(entry ? (canRemove && ownEntry ? "remove" : null) : "add");
    };
    window.addEventListener(OPEN_DNC_DIALOG_EVENT, on);
    return () => window.removeEventListener(OPEN_DNC_DIALOG_EVENT, on);
  }, [applicationId, entry, ownEntry, canRemove]);

  if (!installed) return null;

  return (
    <section
      data-testid="dnc-card"
      className={`rounded-xl border p-4 ${entry ? "border-[#D03020]/30 bg-[#FFF8F7]" : "border-[#EDEDF0] bg-white"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <PhoneOff
          className={`h-4 w-4 ${entry ? "text-[#B52818]" : "text-[#9A9AA3]"}`}
          aria-hidden="true"
        />
        <h3 className="text-[13px] font-semibold text-[#111114]">Do Not Contact</h3>
        <DncBadge entry={entry} />
        <div className="ml-auto flex flex-wrap gap-2">
          {!entry ? (
            <button
              type="button"
              className={secondary}
              onClick={() => setMode("add")}
              data-testid="dnc-move"
            >
              {MOVE_TO_DNC_LABEL}
            </button>
          ) : canRemove && ownEntry ? (
            <button
              type="button"
              className={secondary}
              onClick={() => setMode("remove")}
              data-testid="dnc-remove"
            >
              {REMOVE_FROM_DNC_LABEL}
            </button>
          ) : null}
        </div>
      </div>
      {entry ? (
        <dl className="mt-3 grid gap-1 text-[12px] text-[#3A3A42] sm:grid-cols-[140px_minmax(0,1fr)]">
          <dt className="text-[#9A9AA3]">Reason</dt>
          <dd className="whitespace-pre-wrap">{entry.reason}</dd>
          <dt className="text-[#9A9AA3]">Added By</dt>
          <dd>{entry.addedBy}</dd>
          <dt className="text-[#9A9AA3]">Added</dt>
          <dd>{entry.createdAt ? fmtDate(entry.createdAt) : "—"}</dd>
          {!ownEntry ? (
            <>
              <dt className="text-[#9A9AA3]">Matched</dt>
              <dd>Same phone or email as {entry.fullName || "a person"} on the DNC List.</dd>
            </>
          ) : null}
        </dl>
      ) : (
        <p className="mt-2 text-[12px] text-[#55555E]">Not On The DNC List.</p>
      )}
      {mode ? (
        <DncActionDialog
          mode={mode}
          target={{ applicationId, name }}
          entryId={ownEntry?.id ?? null}
          onClose={() => setMode(null)}
        />
      ) : null}
    </section>
  );
}
