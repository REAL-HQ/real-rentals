import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Lock, X, RotateCcw } from "lucide-react";
import { FileUploader } from "@/components/FileUploader";
import { supabase } from "@/integrations/supabase/client";
import {
  createDocumentUploadUrl,
  confirmDocumentUpload,
  type VaultDocument,
} from "@/lib/documents.functions";
import {
  BATCH_CATEGORY,
  LABEL_MAX,
  cleanLabel,
  planBatch,
  sendable,
  type BatchItem,
} from "@/lib/document-batch";
import { MicroLabel } from "./ui";

/**
 * Staff batch upload into "Other document". One file at a time, in order,
 * stopping nowhere: a failure marks that row and moves on. Nothing retries
 * by itself — a failed row waits for someone to press Retry on it.
 * Team only is on by default and is fixed when the upload is reserved, so a
 * team-only file is never shared with the driver, not even briefly.
 */
export function DocumentBatchUpload({
  applicationId,
  docs,
  onDone,
}: {
  applicationId: string;
  docs: VaultDocument[];
  onDone: () => Promise<void> | void;
}) {
  const startUpload = useServerFn(createDocumentUploadUrl);
  const confirmUpload = useServerFn(confirmDocumentUpload);
  const [queue, setQueue] = useState<BatchItem<File>[]>([]);
  const [teamOnly, setTeamOnly] = useState(true);
  const [running, setRunning] = useState(false);

  const patch = (key: string, p: Partial<BatchItem<File>>) =>
    setQueue((q) => q.map((x) => (x.key === key ? { ...x, ...p } : x)));

  async function sendOne(item: BatchItem<File>, internal: boolean): Promise<boolean> {
    const f = item.file;
    patch(item.key, { status: "uploading", note: undefined });
    try {
      const signed = await startUpload({
        data: {
          applicationId,
          category: BATCH_CATEGORY,
          fileName: f.name,
          mimeType: f.type || "application/octet-stream",
          internal,
        },
      });
      // The File as picked: original bytes, EXIF included.
      const { error } = await supabase.storage
        .from(signed.bucket)
        .uploadToSignedUrl(signed.path, signed.token, f);
      if (error) throw new Error(error.message);
      await confirmUpload({
        data: {
          applicationId: signed.applicationId!,
          category: BATCH_CATEGORY,
          path: signed.path,
          fileName: f.name,
          mimeType: f.type || undefined,
          sizeBytes: f.size,
          label: cleanLabel(item.label, f.name),
          internal,
        },
      });
      patch(item.key, { status: "saved" });
      return true;
    } catch (e) {
      patch(item.key, { status: "failed", note: e instanceof Error ? e.message : "Upload failed" });
      return false;
    }
  }

  async function run(items: BatchItem<File>[]) {
    if (!items.length) return;
    const internal = teamOnly;
    setRunning(true);
    let ok = 0;
    for (const it of items) if (await sendOne(it, internal)) ok += 1;
    setRunning(false);
    await onDone();
    const failed = items.length - ok;
    if (failed) toast.error(`${ok} saved, ${failed} failed. Failed files were not retried.`);
    else toast.success(`${ok} saved${internal ? " · team only" : ""}`);
  }

  const ready = sendable(queue);
  return (
    <div
      className="rounded-xl border border-[#EDEDF0] bg-white p-4 space-y-3"
      aria-label="Batch Upload"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <MicroLabel>Batch Upload · Other</MicroLabel>
        <label className="inline-flex items-center gap-1.5 text-[12px] text-[#111114]">
          <input
            type="checkbox"
            checked={teamOnly}
            disabled={running}
            onChange={(e) => setTeamOnly(e.target.checked)}
            aria-label="Team Only"
          />
          <Lock className="w-3 h-3" /> Team Only
        </label>
      </div>
      <p className="text-[11px] text-[#55555E]">
        Files are saved as-is under Other, never replacing a licence, insurance or agreement.
        Uploading does not verify anything.{" "}
        {teamOnly ? "The driver will not see these." : "The driver will see these in their portal."}
      </p>
      <div className="flex gap-2">
        <FileUploader
          variant="inline"
          label="Add Files"
          context={`Other · Application ${applicationId.slice(0, 8)}`}
          accept="image/*,application/pdf"
          multiple
          disabled={running}
          onFiles={(files) => setQueue((q) => planBatch(q, files, docs))}
        />
        <button
          type="button"
          disabled={running || !ready.length}
          onClick={() => void run(ready)}
          className="inline-flex items-center gap-1 rounded-md bg-[#111114] text-white px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50"
        >
          {running ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Upload{" "}
          {ready.length || ""}
        </button>
      </div>
      {queue.length > 0 && (
        <ul className="divide-y divide-[#F4F4F6] text-[12px]">
          {queue.map((it) => (
            <li key={it.key} className="flex items-center gap-2 py-1.5">
              <input
                value={it.label}
                maxLength={LABEL_MAX}
                disabled={running || it.status === "saved" || it.status === "skipped"}
                onChange={(e) => patch(it.key, { label: e.target.value })}
                aria-label={`Title for ${it.file.name}`}
                className="min-w-0 flex-1 rounded border border-[#EDEDF0] px-1.5 py-0.5"
              />
              <span
                className="shrink-0 text-[11px] text-[#9A9AA3] truncate max-w-[40%]"
                title={it.note ?? it.file.name}
              >
                {it.status === "ready"
                  ? it.file.name
                  : it.status === "uploading"
                    ? "Uploading…"
                    : it.status === "saved"
                      ? "Saved"
                      : it.note}
              </span>
              {it.status === "failed" && !running && (
                <button
                  type="button"
                  onClick={() => void run([it])}
                  aria-label="Retry"
                  className="text-[#55555E]"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              )}
              {(it.status === "ready" || it.status === "failed" || it.status === "skipped") &&
                !running && (
                  <button
                    type="button"
                    onClick={() => setQueue((q) => q.filter((x) => x.key !== it.key))}
                    aria-label="Remove"
                    className="text-[#9A9AA3]"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
