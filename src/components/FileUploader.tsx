import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Camera, CheckCircle2, FileText, Loader2, RotateCcw, Upload, X, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { acceptsFile } from "@/components/FileDropBridge";

/**
 * FileUploader — the ONE upload control for the app (see src/components/UPLOADS.md).
 *
 * It selects, validates, previews and tracks files; it NEVER chooses where
 * they go. Storage bucket, auth, database rows, dedupe and AI processing stay
 * with the caller, passed in as `upload` (or `onFiles` / `onChange`). Drag and
 * drop, click, keyboard (Enter/Space) and the phone camera all go through the
 * same validation.
 *
 * Three ways to use it (pick one):
 *  1. `upload(file, { onProgress })`  — the uploader runs a queue: preview,
 *     progress, status, Retry and Remove per file. `autoStart={false}` stages
 *     files first and shows an "Upload N Files" button.
 *  2. `value` + `onChange`            — staged selection for forms that submit
 *     later (preview + Remove; the form's own Save does the upload).
 *  3. `onFiles(files)`                — hand validated files to a caller that
 *     already shows its own progress (e.g. Fleet Inbox).
 *
 * Variants: "zone" (full drop area), "inline" (button that accepts drops),
 * "attach" (icon trigger for composers; children = icon).
 */
export type UploadCtx = { onProgress: (pct: number) => void };
export type UploadFn = (file: File, ctx: UploadCtx) => Promise<unknown>;

export type FileUploaderProps = {
  onFiles?: (files: File[]) => void | Promise<void>;
  upload?: UploadFn;
  autoStart?: boolean;
  submitLabel?: string;
  onAllDone?: () => void;
  value?: File[];
  onChange?: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  maxBytes?: number;
  maxFiles?: number;
  camera?: boolean;
  disabled?: boolean;
  busy?: boolean;
  variant?: "zone" | "inline" | "attach";
  title?: string;
  hint?: string;
  /** Where the upload goes, shown so nobody re-picks it, e.g. "RR-006 · Insurance Card". */
  context?: string;
  label?: string;
  className?: string;
  children?: ReactNode;
};

type Item = { id: string; file: File; status: "ready" | "uploading" | "done" | "error"; progress: number; error?: string };

export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const fileKey = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;

/** Validate a list against accept / size / count rules; reports problems as toasts. */
export function validateFiles(list: File[], o: { accept?: string; maxBytes?: number; multiple?: boolean; maxFiles?: number }): File[] {
  const bad = list.filter((f) => !acceptsFile(o.accept ?? "", f));
  const big = o.maxBytes ? list.filter((f) => !bad.includes(f) && f.size > o.maxBytes!) : [];
  const empty = list.filter((f) => !bad.includes(f) && !big.includes(f) && f.size === 0);
  let ok = list.filter((f) => !bad.includes(f) && !big.includes(f) && !empty.includes(f));
  if (bad.length) toast.error(`${bad.length === 1 ? bad[0].name : `${bad.length} files`}: this file type isn't accepted here.`);
  if (big.length) toast.error(`${big.length === 1 ? big[0].name : `${big.length} files`}: larger than ${Math.round(o.maxBytes! / 1048576)} MB.`);
  if (empty.length) toast.error(`${empty.length === 1 ? empty[0].name : `${empty.length} files`}: the file is empty.`);
  if (!o.multiple && ok.length > 1) { toast.message("Only one file can be added here — the first was kept."); ok = ok.slice(0, 1); }
  if (o.maxFiles && ok.length > o.maxFiles) { toast.message(`Up to ${o.maxFiles} files at a time — extra files skipped.`); ok = ok.slice(0, o.maxFiles); }
  return ok;
}

/** Upload queue: one file at a time, per-file status, Retry, Remove, duplicate skip. */
export function useUploadQueue(upload: UploadFn | undefined, onAllDone?: () => void) {
  const [items, setItems] = useState<Item[]>([]);
  const running = useRef(false);
  const patch = (id: string, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const itemsRef = useRef(items); itemsRef.current = items;

  const run = useCallback(async () => {
    if (!upload || running.current) return;
    running.current = true;
    let didWork = false;
    try {
      for (;;) {
        const next = itemsRef.current.find((x) => x.status === "ready");
        if (!next) break;
        didWork = true;
        patch(next.id, { status: "uploading", progress: 5, error: undefined });
        itemsRef.current = itemsRef.current.map((x) => (x.id === next.id ? { ...x, status: "uploading" } : x));
        try {
          await upload(next.file, { onProgress: (p) => patch(next.id, { progress: Math.max(5, Math.min(99, Math.round(p))) }) });
          patch(next.id, { status: "done", progress: 100 });
          itemsRef.current = itemsRef.current.map((x) => (x.id === next.id ? { ...x, status: "done" } : x));
        } catch (e: any) {
          const msg = String(e?.message ?? e ?? "Upload failed").slice(0, 200);
          patch(next.id, { status: "error", error: msg });
          itemsRef.current = itemsRef.current.map((x) => (x.id === next.id ? { ...x, status: "error" } : x));
        }
      }
    } finally {
      running.current = false;
      if (didWork && !itemsRef.current.some((x) => x.status === "error")) onAllDone?.();
    }
  }, [upload, onAllDone]);

  const add = (files: File[], start: boolean) => {
    const have = new Set(itemsRef.current.filter((x) => x.status !== "error").map((x) => fileKey(x.file)));
    const fresh = files.filter((f) => !have.has(fileKey(f)));
    if (fresh.length < files.length) toast.message("Already added — duplicates skipped.");
    const next = [...itemsRef.current, ...fresh.map((file) => ({ id: crypto.randomUUID(), file, status: "ready" as const, progress: 0 }))];
    itemsRef.current = next; setItems(next);
    if (start) void run();
  };
  const remove = (id: string) => setItems((xs) => { const n = xs.filter((x) => x.id !== id || x.status === "uploading"); itemsRef.current = n; return n; });
  const retry = (id: string) => { patch(id, { status: "ready", progress: 0, error: undefined }); itemsRef.current = itemsRef.current.map((x) => (x.id === id ? { ...x, status: "ready" } : x)); void run(); };
  const retryAll = () => { const n = itemsRef.current.map((x) => (x.status === "error" ? { ...x, status: "ready" as const, error: undefined } : x)); itemsRef.current = n; setItems(n); void run(); };
  const clearDone = () => setItems((xs) => { const n = xs.filter((x) => x.status !== "done"); itemsRef.current = n; return n; });
  return { items, add, remove, retry, retryAll, clearDone, start: run, busy: items.some((x) => x.status === "uploading") };
}

function Thumb({ file }: { file: File }) {
  const url = useMemo(() => (file.type.startsWith("image/") ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return url
    ? <img src={url} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
    : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-muted"><FileText className="h-5 w-5 text-muted-foreground" /></span>;
}

/** File rows with preview, size, status, progress, Retry and Remove. */
export function FileList({ items, onRemove, onRetry }: {
  items: { id: string; file: File; status?: Item["status"]; progress?: number; error?: string }[];
  onRemove?: (id: string) => void; onRetry?: (id: string) => void;
}) {
  if (!items.length) return null;
  return (
    <ul className="mt-3 space-y-2 text-left" aria-live="polite">
      {items.map((it) => (
        <li key={it.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-2">
          <Thumb file={it.file} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">{it.file.name}</div>
            <div className="text-xs text-muted-foreground">
              {fmtBytes(it.file.size)}
              {it.status === "ready" && " · Ready"}
              {it.status === "uploading" && ` · Uploading ${it.progress ?? 0}%`}
              {it.status === "done" && " · Uploaded"}
              {it.status === "error" && <span className="text-destructive"> · {it.error ?? "Failed"}</span>}
            </div>
            {it.status === "uploading" && (
              <div className="mt-1 h-1 overflow-hidden rounded bg-muted"><div className="h-full bg-brand transition-all" style={{ width: `${it.progress ?? 0}%` }} /></div>
            )}
          </div>
          {it.status === "uploading" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Uploading" />}
          {it.status === "done" && <CheckCircle2 className="h-4 w-4 text-success" aria-label="Uploaded" />}
          {it.status === "error" && onRetry && (
            <button type="button" onClick={() => onRetry(it.id)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted">
              <RotateCcw className="h-3 w-3" /> Retry
            </button>
          )}
          {it.status !== "uploading" && it.status !== "done" && onRemove && (
            <button type="button" onClick={() => onRemove(it.id)} aria-label={`Remove ${it.file.name}`} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function FileUploader({
  onFiles, upload, autoStart = true, submitLabel, onAllDone, value, onChange,
  accept = "", multiple = false, maxBytes, maxFiles, camera = false, disabled, busy,
  variant = "zone", title = "Drop Files Here", hint, context, label = "Browse Files", className = "", children,
}: FileUploaderProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [over, setOver] = useState(false);
  const q = useUploadQueue(upload, onAllDone);
  const working = busy || q.busy;
  const off = disabled || working;

  function deliver(list: File[]) {
    if (off || !list.length) return;
    const ok = validateFiles(list, { accept, maxBytes, multiple, maxFiles });
    if (!ok.length) return;
    if (upload) q.add(multiple ? ok : ok.slice(0, 1), autoStart);
    else if (onChange) onChange(multiple ? [...(value ?? []), ...ok.filter((f) => !(value ?? []).some((v) => fileKey(v) === fileKey(f)))] : ok.slice(0, 1));
    if (onFiles) void onFiles(ok);
  }
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  const dnd = {
    onDragEnter: (e: React.DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); depth.current++; setOver(true); },
    onDragOver: (e: React.DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = off ? "none" : "copy"; },
    onDragLeave: (e: React.DragEvent) => { if (!hasFiles(e)) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); },
    onDrop: (e: React.DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); depth.current = 0; setOver(false); deliver(Array.from(e.dataTransfer.files ?? [])); },
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

  const staged = value && onChange ? value.map((file, i) => ({ id: `${i}:${fileKey(file)}`, file })) : [];
  const list = upload
    ? <>
        <FileList items={q.items} onRemove={q.remove} onRetry={q.retry} />
        {!autoStart && q.items.some((x) => x.status === "ready") && (
          <div className="mt-3 flex justify-end">
            <button type="button" disabled={q.busy || disabled} onClick={() => void q.start()} className="inline-flex min-h-[40px] items-center gap-2 rounded-md bg-brand px-4 text-sm font-medium text-brand-foreground disabled:opacity-50">
              <Upload className="h-4 w-4" /> {submitLabel ?? `Upload ${q.items.filter((x) => x.status === "ready").length} File${q.items.filter((x) => x.status === "ready").length === 1 ? "" : "s"}`}
            </button>
          </div>
        )}
        {q.items.filter((x) => x.status === "error").length > 1 && (
          <div className="mt-2 flex justify-end"><button type="button" onClick={q.retryAll} className="text-xs font-medium text-brand hover:underline">Retry Failed</button></div>
        )}
      </>
    : staged.length
      ? <FileList items={staged} onRemove={(id) => onChange!(value!.filter((_, i) => staged[i].id !== id))} />
      : null;

  if (variant === "attach" || variant === "inline") {
    return (
      <span className={`inline-flex flex-col ${className}`}>
        <span {...dnd} className={`inline-flex rounded-md ${over ? "ring-2 ring-brand" : ""}`}>
          <button type="button" disabled={off} onClick={open} aria-label={label}
            className={variant === "attach" ? "inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted disabled:opacity-50"
              : "inline-flex min-h-[40px] items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-muted disabled:opacity-50"}>
            {children ?? <>{working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{variant === "inline" && label}</>}
          </button>
          {inputs}
        </span>
        {variant === "inline" && list}
      </span>
    );
  }
  return (
    <div className={className}>
      <div {...dnd} role="button" tabIndex={off ? -1 : 0} aria-label={`${label}. Press Enter to choose files, or drop files here.`} aria-busy={!!working}
        onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); open(); } }}
        onClick={(e) => { if (!(e.target as HTMLElement).closest("button")) open(); }}
        className={`cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand ${over ? "border-brand bg-brand/5" : "border-border"} ${off ? "cursor-default opacity-80" : ""}`}>
        <Upload className="mx-auto h-7 w-7 text-muted-foreground" />
        <div className="mt-2 text-sm font-semibold text-foreground">{over ? "Release to Add" : title}</div>
        {context && <div className="mt-1 text-xs font-medium text-foreground/80">{context}</div>}
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
        <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
          <button type="button" disabled={off} onClick={open} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-brand px-5 text-sm font-medium text-brand-foreground disabled:opacity-50">
            {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} {working ? "Uploading…" : label}
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
      {list}
      {upload && q.items.some((x) => x.status === "error") && !q.busy && (
        <div className="mt-2 flex items-center gap-1 text-xs text-destructive"><AlertCircle className="h-3.5 w-3.5" /> Some files didn't upload. Use Retry, or Remove them.</div>
      )}
    </div>
  );
}
