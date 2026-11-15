import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { History, MessageSquare, Phone, Voicemail, FileText, Mail, ArrowRightLeft } from "lucide-react";
import { getLeadActivity, type LeadActivityRow } from "@/lib/lead-activity.functions";
import { fmtDateTime } from "@/lib/date-format";

// One activity log per lead: texts, calls, voicemails, transcripts, emails
// and stage changes, newest first. Calls and texts show the line they came
// in on (Primary 813 or REAL Rentals 888).

const LABEL: Record<LeadActivityRow["activity_type"], string> = {
  text: "Text",
  call: "Call",
  voicemail: "Voicemail",
  transcript: "Transcript",
  recording: "Recording",
  call_summary: "Call Summary",
  email: "Email",
  status_change: "Stage",
};

function Icon({ t }: { t: LeadActivityRow["activity_type"] }) {
  const cls = "w-4 h-4 text-[#55555E]";
  if (t === "text") return <MessageSquare className={cls} />;
  if (t === "voicemail") return <Voicemail className={cls} />;
  if (t === "email") return <Mail className={cls} />;
  if (t === "status_change") return <ArrowRightLeft className={cls} />;
  if (t === "transcript" || t === "call_summary") return <FileText className={cls} />;
  return <Phone className={cls} />;
}

export function activityHeadline(r: LeadActivityRow): string {
  const dir = r.direction === "incoming" || r.direction === "inbound" ? "In" : r.direction === "outbound" || r.direction === "outgoing" ? "Out" : "";
  return [LABEL[r.activity_type] ?? r.activity_type, dir, r.line_label ? `· ${r.line_label}` : ""].filter(Boolean).join(" ");
}

export function LeadActivity({ applicationId }: { applicationId: string }) {
  const load = useServerFn(getLeadActivity);
  const [rows, setRows] = useState<LeadActivityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    load({ data: { applicationId } })
      .then((r) => { if (live) { setRows(r.rows); setError(r.error); } })
      .catch(() => { if (live) { setRows([]); setError("Couldn't load activity."); } });
    return () => { live = false; };
  }, [applicationId, load]);

  return (
    <div className="rounded-xl border border-[#EDEDF0] bg-white p-4" data-testid="lead-activity">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#111114]">
        <History className="w-4 h-4" /> Activity
      </div>
      {rows === null ? (
        <p className="text-sm text-[#9A9AA3]">Loading…</p>
      ) : error ? (
        <p className="text-sm text-[#9A9AA3]">{error}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[#9A9AA3]">No Activity Yet</p>
      ) : (
        <ul className="divide-y divide-[#F1F1F4]">
          {rows.map((r) => (
            <li key={`${r.source_table}:${r.source_id}`} className="flex gap-3 py-2.5">
              <Icon t={r.activity_type} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-[13px] font-medium text-[#111114]">{activityHeadline(r)}</span>
                  <span className="text-[11px] text-[#9A9AA3]">{fmtDateTime(r.occurred_at)}</span>
                </div>
                {r.summary ? <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] text-[#55555E] line-clamp-4">{r.summary}</p> : null}
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-[#9A9AA3]">
                  {r.status ? <span>{r.status}</span> : null}
                  {r.template && r.activity_type !== "status_change" ? <span>{r.template}</span> : null}
                  {r.line_e164 ? <span>{r.line_e164}</span> : null}
                  {r.recording_url ? (
                    <a href={r.recording_url} target="_blank" rel="noreferrer" className="underline">Recording</a>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
