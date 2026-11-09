import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import {
  ModalBody,
  ModalButton,
  ModalFooter,
  ModalHeader,
  ModalShell,
  inputCls,
} from "./modal";
import {
  WAITLIST_TAG_SUGGESTIONS,
  normalizeWaitlistTags,
  validateWaitlistTags,
} from "@/lib/waitlist-tags";
import type { WaitlistEntry } from "@/lib/waitlist.functions";

export function WaitlistTagsDialog({
  entry,
  saving,
  storageAvailable,
  onClose,
  onSave,
}: {
  entry: WaitlistEntry | null;
  saving: boolean;
  storageAvailable: boolean;
  onClose: () => void;
  onSave: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(entry?.tags ?? []);
    setCustomTag("");
    setError(null);
  }, [entry?.id]);

  if (!entry) return null;

  function addCustomTag() {
    const next = normalizeWaitlistTags([...draft, customTag]);
    setDraft(next);
    setCustomTag("");
    setError(null);
  }

  function save() {
    try {
      onSave(validateWaitlistTags(draft));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check the tags and try again.");
    }
  }

  return (
    <ModalShell onClose={saving ? () => {} : onClose} size="sm" label={`Edit Tags For ${entry.full_name}`}>
      <ModalHeader
        title="Edit Waitlist Tags"
        subtitle={`${entry.full_name} · Visible to staff only`}
        onClose={saving ? undefined : onClose}
      />
      <ModalBody className="space-y-5">
        {!storageAvailable ? (
          <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Tag storage is not connected yet. You can review the editor, but saving is disabled and no changes will be made.
          </p>
        ) : null}
        <div>
          <div className="mb-2 text-[13px] font-medium text-foreground">Suggestions</div>
          <div className="flex flex-wrap gap-2">
            {WAITLIST_TAG_SUGGESTIONS.map((tag) => {
              const selected = draft.some((candidate) => candidate.toLocaleLowerCase("en-US") === tag.toLocaleLowerCase("en-US"));
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setDraft((current) => selected
                    ? current.filter((candidate) => candidate.toLocaleLowerCase("en-US") !== tag.toLocaleLowerCase("en-US"))
                    : normalizeWaitlistTags([...current, tag]))}
                  className={`min-h-9 rounded-full border px-3 text-xs font-medium transition ${selected
                    ? "border-brand bg-brand/10 text-brand"
                    : "border-border bg-card text-foreground hover:bg-muted"}`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label htmlFor="waitlist-custom-tag" className="mb-2 block text-[13px] font-medium text-foreground">Add A Custom Tag</label>
          <div className="flex gap-2">
            <input
              id="waitlist-custom-tag"
              value={customTag}
              maxLength={40}
              onChange={(event) => setCustomTag(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                if (customTag.trim()) addCustomTag();
              }}
              placeholder="For Example, Call Back Friday"
              className={inputCls}
            />
            <ModalButton onClick={addCustomTag} disabled={!customTag.trim()} className="shrink-0">
              <Plus className="h-4 w-4" /> Add
            </ModalButton>
          </div>
        </div>

        <div>
          <div className="mb-2 text-[13px] font-medium text-foreground">Current Tags</div>
          {draft.length ? (
            <div className="flex flex-wrap gap-2">
              {draft.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-foreground">
                  {tag}
                  <button
                    type="button"
                    aria-label={`Remove ${tag}`}
                    onClick={() => setDraft((current) => current.filter((candidate) => candidate !== tag))}
                    className="grid h-5 w-5 place-items-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No tags. Saving will clear this person's tags.</p>
          )}
        </div>
        {error ? <p role="alert" className="text-sm text-brand">{error}</p> : null}
      </ModalBody>
      <ModalFooter left={<span className="text-xs text-muted-foreground">Up To 12 Tags</span>}>
        <ModalButton onClick={onClose} disabled={saving}>Cancel</ModalButton>
        <ModalButton variant="primary" onClick={save} disabled={saving || !storageAvailable}>{saving ? "Saving…" : "Save Tags"}</ModalButton>
      </ModalFooter>
    </ModalShell>
  );
}
