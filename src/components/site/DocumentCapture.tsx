import { useState } from "react";
import { Check } from "lucide-react";
import { FileUploader } from "@/components/FileUploader";
import { uploadApplicantFile, type UploadKind } from "@/lib/applicant-upload";
import { maxMbFor } from "@/lib/image-optimize";

// Photographing a document on a phone, without wondering whether it worked.
//
// This is built entirely on the shared FileUploader: the camera button comes
// from its `camera` prop (first-class on a phone, not buried in the OS picker
// sheet), and preview/progress/Retry/Remove come from its upload queue. An
// applicant has no read access to these buckets at all — not even to fetch
// back their own licence — so the preview FileUploader shows is a local
// object URL of the file just chosen, never a round trip to storage.

export function DocumentCapture({
  title,
  hint,
  tips,
  kind,
  token,
  onFile,
  onChange,
  optional,
}: {
  title: string;
  /** One line under the title saying what to photograph. */
  hint: string;
  /** Short, concrete things that make a photo usable. Omit if obvious. */
  tips?: string[];
  /** Which document this is. The server turns it into a bucket and a path. */
  kind: UploadKind;
  token: string;
  /**
   * Whether a file is already on the record. Deliberately a boolean: the
   * server does not hand storage paths to a resume-token bearer, and this
   * component only ever used the path for truthiness — the preview it shows
   * is a local object URL of the file just chosen.
   */
  onFile: boolean;
  onChange: (path: string | null) => void;
  optional?: boolean;
}) {
  const [justUploaded, setJustUploaded] = useState(false);
  const done = onFile || justUploaded;

  return (
    <div className="rounded-2xl border border-[#EDEDF0] bg-white overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-[#111114]">
              {title}
              {optional && (
                <span className="ml-2 text-[11px] font-medium text-[#9A9AA3]">Optional</span>
              )}
            </div>
            <p className="text-[13px] text-[#55555E] mt-0.5">{hint}</p>
          </div>
          {done && (
            <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 px-2 py-1 text-[11px] font-semibold">
              <Check className="w-3 h-3" strokeWidth={3} /> Uploaded
            </span>
          )}
        </div>

        {tips && tips.length > 0 && !done && (
          <ul className="mt-3 space-y-1">
            {tips.map((t) => (
              <li key={t} className="flex gap-2 text-[12px] text-[#9A9AA3]">
                <span className="mt-1.5 h-1 w-1 rounded-full bg-[#C4C4CB] shrink-0" />
                {t}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="px-4 pb-4">
        <FileUploader
          camera
          accept="image/*,application/pdf"
          maxBytes={60 * 1024 * 1024}
          context={title}
          title={done ? "Retake Or Replace" : "Take A Photo Or Upload"}
          label={done ? "Replace" : "Upload"}
          submitLabel={done ? "Replace" : "Upload"}
          upload={async (file, { onProgress }) => {
            onProgress(20);
            // A generous client-side ceiling; the real one is applied after
            // optimization, since a phone photo that arrives at 9 MB usually
            // leaves at under one. uploadApplicantFile enforces that ceiling
            // and throws UploadTooLarge, which the queue's Retry relies on.
            const { path } = await uploadApplicantFile({ token, kind, file });
            onProgress(100);
            onChange(path);
          }}
          onAllDone={() => setJustUploaded(true)}
        />
      </div>
    </div>
  );
}
