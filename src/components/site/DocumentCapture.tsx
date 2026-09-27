import { useEffect, useRef, useState } from "react";
import { Camera, Upload, Loader2, Check, RefreshCw, FileText } from "lucide-react";
import { toast } from "sonner";
import { uploadApplicantFile, type UploadKind } from "@/lib/applicant-upload";
import { maxMbFor } from "@/lib/image-optimize";

// Photographing a document on a phone, without wondering whether it worked.
//
// Two things make this different from a file input with a label. The camera is
// a first-class button rather than one option buried in the OS picker sheet —
// on a phone it is what almost everyone wants and it was three taps away. And
// the preview is the file the applicant just chose, held locally, because an
// applicant has no read access to these buckets at all and cannot fetch back
// so much as their own licence. That restriction is correct and this works
// within it: a local object URL shows instantly, costs no round trip, and
// proves the right photo was picked.

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
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [isPdf, setIsPdf] = useState(false);
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Object URLs leak until revoked, and this component can outlive several.
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  async function handle(file: File | undefined) {
    if (!file) return;
    // A generous first pass. The real ceiling is applied after optimization,
    // because a phone photo that arrives at 9 MB usually leaves at under one.
    if (file.size > 60 * 1024 * 1024) {
      toast.error(`That file is too big — please keep it under ${maxMbFor(file)} MB.`);
      return;
    }
    const localUrl = URL.createObjectURL(file);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return localUrl;
    });
    setIsPdf((file.type || "").includes("pdf"));
    setUploading(true);
    try {
      const { path } = await uploadApplicantFile({ token, kind, file });
      setJustUploaded(true);
      onChange(path);
    } catch (e) {
      console.error("[upload] failed", e);
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return null;
      });
      toast.error(
        e instanceof Error && e.name === "UploadTooLarge"
          ? e.message
          : "We couldn't upload that. Try again — or email it to team@drivereal.com and we'll add it for you.",
      );
    } finally {
      setUploading(false);
    }
  }

  const [justUploaded, setJustUploaded] = useState(false);
  const done = (onFile || justUploaded) && !uploading;

  return (
    <div className="rounded-2xl border border-[#EDEDF0] bg-white overflow-hidden">
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          void handle(f);
        }}
      />
      <input
        ref={fileInput}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          void handle(f);
        }}
      />

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

      {(preview || uploading) && (
        <div className="relative mx-4 mb-4 rounded-xl overflow-hidden bg-[#FAFAFB] border border-[#EDEDF0]">
          {preview && !isPdf ? (
            <img src={preview} alt={title} className="w-full max-h-56 object-contain" />
          ) : (
            <div className="h-28 grid place-items-center text-[#9A9AA3]">
              <FileText className="w-7 h-7" />
            </div>
          )}
          {uploading && (
            <div className="absolute inset-0 grid place-items-center bg-white/75">
              <span className="inline-flex items-center gap-2 text-[13px] font-medium text-[#55555E]">
                <Loader2 className="w-4 h-4 animate-spin" /> Uploading…
              </span>
            </div>
          )}
        </div>
      )}

      <div className="px-4 pb-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => cameraInput.current?.click()}
          disabled={uploading}
          className="inline-flex items-center justify-center gap-2 min-h-[48px] rounded-xl bg-[#111114] text-white text-[14px] font-semibold disabled:opacity-50 active:scale-[0.99] transition-transform"
        >
          <Camera className="w-4 h-4" />
          {done ? "Retake" : "Take Photo"}
        </button>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
          className="inline-flex items-center justify-center gap-2 min-h-[48px] rounded-xl border border-[#EDEDF0] text-[#111114] text-[14px] font-semibold disabled:opacity-50 active:scale-[0.99] transition-transform"
        >
          {done ? <RefreshCw className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
          {done ? "Replace" : "Upload"}
        </button>
      </div>
    </div>
  );
}
