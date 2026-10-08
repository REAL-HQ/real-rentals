import { useRef, useState, type ReactNode } from "react";
import { Camera, Upload } from "lucide-react";
import { toast } from "sonner";
import { acceptsFile } from "@/components/FileDropBridge";

/**
 * FileUploader — the default upload control for new code.
 *
 * It only selects and validates files; it NEVER stores them. The caller's
 * onFiles handler keeps its own storage bucket, auth, DB rows, dedupe and
 * processing pipeline (Fleet Inbox only where the caller is Fleet Inbox).
 * Drag-and-drop, click, keyboard (Enter/Space) and the phone camera all call
 * the same onFiles with the same validated list.
 *
 * Variants:
 *  - "zone":   full dashed drop area (title + hint + button)
 *  - "inline": compact button that also accepts drops
 *  - "attach": paperclip-sized trigger for composers (children = icon)
 */
export type FileUploaderProps = {
  onFiles: (files: File[]) => void | Promise<void>;
  accept?: string;            // e.g. "image/*,application/pdf"
  multiple?: boolean;
  maxBytes?: number;          // per file
  maxFiles?: number;
  camera?: boolean;           // show "Take Photo" on phones
  disabled?: boolean;
  busy?: boolean;
  variant?: "zone" | "inline" | "attach";
  title?: string;
  hint?: string;
  label?: string;             // button text / accessible name
  className?: string;
  children?: ReactNode;
};

export function FileUploader({
  onFiles, accept = "", multiple = false, maxBytes, maxFiles, camera = false, disabled, busy,
  variant = "zone", title = "Drop Files Here", hint, label = "Upload Files", className = "", children,
}: FileUploaderProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [over, setOver] = useState(false);
  const off = disabled || busy;

  function deliver(list: File[]) {
    if (off || !list.length) return;
    const bad = list.filter((f) => !acceptsFile(accept, f));
    const big = maxBytes ? list.filter((f) => !bad.includes(f) && f.size > maxBytes) : [];
    let ok = list.filter((f) => !bad.includes(f) && !big.includes(f));
    if (bad.length) toast.error(`${bad.length === 1 ? bad[0].name : `${bad.length} files`}: unsupported file type.`);
    if (big.length) toast.error(`${big.length === 1 ? big[0].name : `${big.length} files`}: over ${Math.round(maxBytes! / 1048576)} MB.`);
    if (!multiple && ok.length > 1) ok = ok.slice(0, 1);
    if (maxFiles && ok.length > maxFiles) { toast.message(`Up to ${maxFiles} files at a time — extra files skipped.`); ok = ok.slice(0, maxFiles); }
    if (ok.length) void onFiles(ok);
  }
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  const dnd = {
    onDragEnter: (e: React.DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current++; setOver(true); },
    onDragOver: (e: React.DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = off ? "none" : "copy"; },
    onDragLeave: (e: React.DragEvent) => { if (!hasFiles(e)) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); depth.current = 0; setOver(false); deliver(Array.from(e.dataTransfer.files ?? [])); },
  };
  const open = () => { if (!off) fileRef.current?.click(); };
  const inputs = (
    <>
      <input ref={fileRef} type="file" accept={accept || undefined} multiple={multiple} className="hidden" data-file-drop="primary"
        onChange={(e) => { const l = Array.from(e.target.files ?? []); e.target.value = ""; deliver(l); }} />
      {camera && <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" data-file-drop="ignore"
        onChange={(e) => { const l = Array.from(e.target.files ?? []); e.target.value = ""; deliver(l); }} />}
    </>
  );
  const ring = over ? "border-brand bg-brand/5" : "border-border";

  if (variant === "attach" || variant === "inline") {
    return (
      <span {...dnd} className={`inline-flex rounded-md ${over ? "ring-2 ring-brand" : ""} ${className}`}>
        <button type="button" disabled={off} onClick={open} aria-label={label}
          className={variant === "attach" ? "inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted disabled:opacity-50"
            : "inline-flex min-h-[40px] items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-muted disabled:opacity-50"}>
          {children ?? <><Upload className="h-4 w-4" />{variant === "inline" && label}</>}
        </button>
        {inputs}
      </span>
    );
  }
  return (
    <div {...dnd} role="button" tabIndex={off ? -1 : 0} aria-label={`${label}. Press Enter to choose files, or drop files here.`} aria-busy={!!busy}
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); open(); } }}
      onClick={(e) => { if (e.target === e.currentTarget) open(); }}
      className={`rounded-2xl border-2 border-dashed p-6 text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand ${ring} ${className}`}>
      <Upload className="mx-auto h-7 w-7 text-muted-foreground" />
      <div className="mt-2 text-sm font-semibold text-foreground">{title}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
        <button type="button" disabled={off} onClick={open} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-brand px-5 text-sm font-medium text-brand-foreground disabled:opacity-50">
          <Upload className="h-4 w-4" /> {busy ? "Uploading…" : label}
        </button>
        {camera && (
          <button type="button" disabled={off} onClick={() => camRef.current?.click()} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-border bg-card px-5 text-sm font-medium sm:hidden">
            <Camera className="h-4 w-4" /> Take Photo
          </button>
        )}
      </div>
      {inputs}
      {children}
    </div>
  );
}
