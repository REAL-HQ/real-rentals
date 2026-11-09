/**
 * Fleet Inbox file previews. Client-safe: no storage access here. Bytes come
 * only from the existing staff-checked getFleetDocumentFile server function,
 * so permissions (financial / owner-only originals) are unchanged and no
 * public or signed URL is created.
 */
export type PreviewKind = "image" | "pdf" | "video" | "heic" | "other";

/** Browsers render these natively; anything else gets an honest type tile. */
const IMAGE_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"]);
/** Above this the thumbnail is not fetched; the row shows a type tile and opens the original. */
export const THUMB_MAX_BYTES = 12 * 1024 * 1024;
/** At most this many previews download at once. */
export const THUMB_CONCURRENCY = 2;

export function previewKind(mime: string | null | undefined, fileName: string | null | undefined): PreviewKind {
  const m = (mime ?? "").toLowerCase();
  const ext = (fileName ?? "").toLowerCase().split(".").pop() ?? "";
  if (m === "image/heic" || m === "image/heif" || ext === "heic" || ext === "heif") return "heic";
  if (IMAGE_MIME.has(m) || (!m && ["jpg", "jpeg", "png", "webp", "gif"].includes(ext))) return "image";
  if (m === "application/pdf" || ext === "pdf") return "pdf";
  if (m.startsWith("video/")) return "video";
  return "other";
}

export function typeLabel(kind: PreviewKind, fileName: string | null | undefined): string {
  if (kind === "pdf") return "PDF";
  if (kind === "video") return "Video";
  if (kind === "heic") return "HEIC";
  const ext = (fileName ?? "").split(".").pop();
  return ext && ext.length <= 5 && ext !== fileName ? ext.toUpperCase() : "File";
}

/** Whether a row should fetch an inline thumbnail at all. */
export function canThumb(item: { document_id?: string | null; mime_type?: string | null; file_name?: string | null; size_bytes?: number | null }): boolean {
  if (!item.document_id) return false;
  if (previewKind(item.mime_type, item.file_name) !== "image") return false;
  return !(typeof item.size_bytes === "number" && item.size_bytes > THUMB_MAX_BYTES);
}

export type PreviewState =
  | { state: "loading" }
  | { state: "ready"; url: string }
  | { state: "restricted"; message: string }
  | { state: "error" };

type Fetcher = (documentId: string) => Promise<{ base64: string; mimeType: string }>;

/**
 * Per-batch cache + bounded queue. One object URL per document, reused by the
 * row and the lightbox, revoked on dispose (when the batch view unmounts).
 */
export class PreviewStore {
  private cache = new Map<string, PreviewState>();
  private waiting: string[] = [];
  private running = 0;
  private listeners = new Set<() => void>();
  private disposed = false;
  constructor(
    private fetcher: Fetcher,
    private makeUrl: (b: Blob) => string = (b) => URL.createObjectURL(b),
    private revokeUrl: (u: string) => void = (u) => URL.revokeObjectURL(u),
    private limit = THUMB_CONCURRENCY,
  ) {}
  get(id: string): PreviewState | undefined { return this.cache.get(id); }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() { for (const fn of this.listeners) fn(); }
  /** Queue a fetch (once). Failed ones may be retried by calling request again. */
  request(id: string) {
    if (this.disposed) return;
    const cur = this.cache.get(id);
    if (cur && cur.state !== "error") return;
    this.cache.set(id, { state: "loading" });
    this.waiting.push(id);
    this.emit();
    this.pump();
  }
  get inFlight() { return this.running; }
  private pump() {
    while (!this.disposed && this.running < this.limit && this.waiting.length) {
      const id = this.waiting.shift()!;
      this.running++;
      this.fetcher(id)
        .then((f) => {
          if (this.disposed) return;
          const bin = atob(f.base64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          this.cache.set(id, { state: "ready", url: this.makeUrl(new Blob([bytes], { type: f.mimeType })) });
        })
        .catch((e: unknown) => {
          if (this.disposed) return;
          const msg = e instanceof Error ? e.message : "";
          this.cache.set(id, /forbidden/i.test(msg) ? { state: "restricted", message: "Restricted" } : { state: "error" });
        })
        .finally(() => {
          this.running--;
          if (!this.disposed) { this.emit(); this.pump(); }
        });
    }
  }
  dispose() {
    this.disposed = true;
    this.waiting = [];
    for (const v of this.cache.values()) if (v.state === "ready") this.revokeUrl(v.url);
    this.cache.clear();
    this.listeners.clear();
  }
}

/**
 * Lightbox fetch rule: fetch when nothing is cached; retry an error at most
 * once per opening (tracked in `retried`); never re-request restricted files.
 */
export function lightboxShouldRequest(p: PreviewState | undefined, retried: Set<string>, documentId: string): boolean {
  if (!p) return true;
  if (p.state !== "error" || retried.has(documentId)) return false;
  retried.add(documentId);
  return true;
}
