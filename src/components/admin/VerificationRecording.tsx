import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Mic, History, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { FileUploader } from "@/components/FileUploader";
import {
  ownerListVerificationRecordings,
  createDocumentUploadUrl,
  confirmDocumentUpload,
  type VaultDocument,
} from "@/lib/documents.functions";

// The insurance verification call recording. Owner only.
//
// This used to live in `lead_documents`, the last workflow standing on that
// table. It now uses the same vault as every other applicant document, which
// gains it version history: replacing a recording supersedes the old one
// instead of deleting it, and a verification call is exactly the kind of thing
// somebody asks to hear again a year later.
//
// The tier boundary is not this component. A Manager or Coordinator is refused
// by the RLS policy on `documents` and again by requireOwner inside
// ownerListVerificationRecordings; rendering nothing here is the third and
// least important layer.

const MAX_MB = 50;

function fmtSize(n: number | null) {
  if (!n) return null;
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

export function VerificationRecording({
  applicationId,
  canAccess,
  onChange,
}: {
  applicationId: string;
  /** Owner. Anything else must not even request the list. */
  canAccess: boolean;
  /** Reports whether a current recording exists, for the pipeline gate. */
  onChange?: (hasCurrent: boolean) => void;
}) {
  const list = useServerFn(ownerListVerificationRecordings);
  const startUpload = useServerFn(createDocumentUploadUrl);
  const confirmUpload = useServerFn(confirmDocumentUpload);

  const [docs, setDocs] = useState<VaultDocument[]>([]);
  const [loading, setLoading] = useState(canAccess);
  const [showHistory, setShowHistory] = useState(false);

  const refresh = useCallback(async () => {
    if (!canAccess) return;
    try {
      const rows = await list({ data: { applicationId } });
      setDocs(rows);
      onChange?.(rows.some((d) => d.is_current && d.review_status !== "rejected"));
    } catch {
      // A tier that cannot see recordings is not an error worth shouting about.
    } finally {
      setLoading(false);
    }
    // onChange is a parent callback; including it would refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId, canAccess, list]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function uploadRecording(file: File, onProgress: (pct: number) => void) {
    try {
      onProgress(10);
      const signed = await startUpload({
        data: {
          applicationId,
          category: "verification_recording",
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
        },
      });
      onProgress(40);
      const { error } = await supabase.storage
        .from(signed.bucket)
        .uploadToSignedUrl(signed.path, signed.token, file);
      if (error) throw new Error(error.message);
      onProgress(80);
      await confirmUpload({
        data: {
          applicationId: signed.applicationId!,
          category: "verification_recording",
          path: signed.path,
          fileName: file.name,
          mimeType: file.type || null,
          sizeBytes: file.size,
          internal: true,
        },
      });
      onProgress(100);
      toast.success("Recording saved. The previous version is kept in history.");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
      throw err;
    }
  }

  if (!canAccess) {
    return (
      <div className="rounded-lg border border-[#EDEDF0] bg-[#FAFAFB] px-3 py-2.5 flex items-center gap-2 text-[12px] text-[#9A9AA3]">
        <Lock className="h-3.5 w-3.5 shrink-0" />
        Verification call recordings are restricted to the account owner.
      </div>
    );
  }

  const current = docs.find((d) => d.is_current) ?? null;
  const history = docs.filter((d) => !d.is_current);

  return (
    <div className="rounded-lg border border-[#EDEDF0] bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#111114]">
            <Mic className="h-3.5 w-3.5" /> Call Recording
            <span className="rounded bg-[#F4F4F6] px-1.5 py-0.5 text-[10px] font-medium text-[#55555E]">
              Owner only
            </span>
          </div>
          <div className="text-[11px] text-[#9A9AA3] mt-0.5">
            Label the file: DriverName_Date_Vehicle
          </div>
        </div>
        <FileUploader
          variant="inline"
          label={current ? "Replace" : "Upload"}
          context="Verification Call Recording"
          accept="audio/*,video/*"
          maxBytes={MAX_MB * 1024 * 1024}
          upload={(file, { onProgress }) => uploadRecording(file, onProgress)}
          className="shrink-0"
        />
      </div>

      <div className="mt-3">
        {loading ? (
          <div className="text-[12px] text-[#9A9AA3]">Loading…</div>
        ) : current ? (
          <div className="space-y-1">
            {current.url ? (
              <audio controls src={current.url} className="w-full h-9" />
            ) : (
              <div className="text-[12px] text-[#D03020]">File missing from storage</div>
            )}
            <div className="text-[11px] text-[#9A9AA3]">
              {current.file_name}
              {fmtSize(current.size_bytes) ? ` · ${fmtSize(current.size_bytes)}` : ""} ·{" "}
              {new Date(current.created_at).toLocaleDateString()}
            </div>
          </div>
        ) : (
          <div className="text-[12px] text-[#9A9AA3]">No recording on file yet.</div>
        )}
      </div>

      {history.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#55555E] hover:text-[#111114]"
          >
            <History className="h-3 w-3" />
            {showHistory ? "Hide" : "Show"} earlier recordings ({history.length})
          </button>
          {showHistory && (
            <ul className="mt-2 space-y-2">
              {history.map((d) => (
                <li key={d.id}>
                  {d.url && <audio controls src={d.url} className="w-full h-8" />}
                  <div className="text-[10px] text-[#9A9AA3]">
                    {d.file_name} · {new Date(d.created_at).toLocaleDateString()}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
