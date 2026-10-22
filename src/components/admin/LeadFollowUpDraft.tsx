import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { prepareLeadFollowUp } from "@/lib/lead-followups.functions";
import { LEAD_FOLLOWUPS_ENABLED, followUpDateLabel, type LeadFollowUpDraft } from "@/lib/lead-followups";

/**
 * Renders nothing while the flag is off, and does not mount the loader.
 * There is no Send action. Copy only puts the wording on the clipboard.
 */
export function LeadFollowUpDraft({
  applicationId,
  bucket,
}: {
  applicationId: string;
  bucket: string;
}) {
  if (!LEAD_FOLLOWUPS_ENABLED) return null;
  if (bucket !== "overdue" && bucket !== "today") return null;
  return <LeadFollowUpDraftBody applicationId={applicationId} />;
}

function LeadFollowUpDraftBody({ applicationId }: { applicationId: string }) {
  const load = useServerFn(prepareLeadFollowUp);
  const [draft, setDraft] = useState<LeadFollowUpDraft | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!LEAD_FOLLOWUPS_ENABLED) return;
    let live = true;
    setState("loading");
    load({ data: { applicationId } })
      .then((res) => {
        if (!live) return;
        if (res.ok) {
          setDraft(res.draft);
          setState("ready");
        } else {
          setDraft(null);
          setState("empty");
        }
      })
      .catch(() => {
        if (!live) return;
        setDraft(null);
        setState("error");
      });
    return () => {
      live = false;
    };
  }, [load, applicationId]);

  if (state === "loading") {
    return <p className="mt-3 text-xs text-muted-foreground">Loading Draft…</p>;
  }
  if (state === "error") {
    return <p className="mt-3 text-xs text-red-700">The Draft Could Not Be Loaded.</p>;
  }
  if (state === "empty" || !draft) return null;

  const when = followUpDateLabel(draft.followUpOn);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-border bg-[#F7F7F8] p-3">
      <p className="text-xs font-medium text-muted-foreground">Follow-Up Draft · {draft.label}</p>
      {when ? <p className="mt-1 text-xs text-muted-foreground">Follow-Up Date {when}</p> : null}
      <p className="mt-2 text-sm font-medium">{draft.subject}</p>
      <p className="mt-1 text-sm text-muted-foreground">{draft.body}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" onClick={copy} className="text-xs font-medium text-primary">
          Copy Draft
        </button>
        <span className="text-xs text-muted-foreground">
          {copied ? "Copied. Nothing Was Sent." : "Nothing Is Sent From This Draft."}
        </span>
      </div>
    </div>
  );
}
