import { useEffect, useRef, useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { canThumb, lightboxShouldRequest, previewKind, typeLabel, type PreviewState, type PreviewStore } from "@/lib/fleet-file-preview";

type Item = { id: string; document_id?: string | null; mime_type?: string | null; file_name?: string | null; size_bytes?: number | null };

function usePreview(store: PreviewStore | null, documentId: string | null | undefined): PreviewState | undefined {
  const snap = () => (store && documentId ? store.get(documentId) : undefined);
  return useSyncExternalStore((fn) => (store ? store.subscribe(fn) : () => {}), snap, snap);
}

/**
 * Inline thumbnail for one Fleet Inbox row. Loads only when scrolled near the
 * viewport, through the shared bounded store. Non-images show their type.
 */
export function FleetFileThumb({ item, store, onOpen }: { item: Item; store: PreviewStore | null; onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const thumb = canThumb(item);
  const p = usePreview(store, item.document_id);
  useEffect(() => {
    if (!thumb || !store || !item.document_id || p) return;
    const el = ref.current;
    const id = item.document_id;
    if (!el || typeof IntersectionObserver === "undefined") { store.request(id); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { store.request(id); io.disconnect(); } }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [thumb, store, item.document_id, p]);
  const kind = previewKind(item.mime_type, item.file_name);
  const name = item.file_name ?? "file";
  let inner;
  if (!item.document_id) inner = <span className="text-[10px] font-semibold text-[#55555E]">{typeLabel(kind, name)}</span>;
  else if (thumb && p?.state === "ready") inner = <img src={p.url} alt="" className="h-full w-full object-cover" />;
  else if (thumb && (!p || p.state === "loading")) inner = <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-[#9A9AA3]" />;
  else if (p?.state === "restricted") inner = <span className="text-[10px] font-semibold text-[#55555E]">Restricted</span>;
  else if (thumb && p?.state === "error") inner = <span className="text-[10px] font-semibold text-[#B45309]">No Preview</span>;
  else inner = <span className="text-[11px] font-bold text-[#1D4ED8]">{typeLabel(kind, name)}</span>;
  return (
    <button
      ref={ref}
      type="button"
      data-thumb-for={item.id}
      data-thumb-state={thumb ? p?.state ?? "idle" : kind}
      disabled={!item.document_id}
      onClick={onOpen}
      aria-label={`Preview ${name}`}
      className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[#EDEDF0] bg-[#EEF2FF] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] disabled:cursor-default"
    >
      {inner}
    </button>
  );
}

/**
 * Larger preview with the filename. Arrow buttons / keys move between the
 * batch's image files; Esc or the close button closes. Non-image or
 * restricted files show an honest message and the existing Open Original.
 */
export function FleetFileLightbox({
  items, index, store, onIndex, onClose, openOriginal,
}: {
  items: Item[]; index: number | null; store: PreviewStore | null;
  onIndex: (i: number) => void; onClose: () => void; openOriginal: (documentId: string) => void;
}) {
  const it = index === null ? null : items[index] ?? null;
  const p = usePreview(store, it?.document_id);
  // A failed preview is retried once per opening, never in a loop.
  const retried = useRef(new Set<string>());
  useEffect(() => { if (index === null) retried.current.clear(); }, [index]);
  useEffect(() => {
    if (!it || !store || !it.document_id || !canThumb(it)) return;
    if (lightboxShouldRequest(p, retried.current, it.document_id)) store.request(it.document_id);
  }, [it, store, p]);
  const go = (d: number) => { if (index !== null && items.length > 1) onIndex((index + d + items.length) % items.length); };
  const kind = it ? previewKind(it.mime_type, it.file_name) : "other";
  return (
    <Dialog open={!!it} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="max-w-3xl"
        onKeyDown={(e) => { if (e.key === "ArrowRight") go(1); if (e.key === "ArrowLeft") go(-1); }}
      >
        <DialogTitle className="truncate pr-8 text-base">{it?.file_name ?? "File"}</DialogTitle>
        <DialogDescription className="text-xs">
          {index !== null && items.length > 1 ? `${index + 1} of ${items.length}` : typeLabel(kind, it?.file_name)}
        </DialogDescription>
        <div className="flex min-h-[240px] items-center justify-center rounded-md bg-[#F4F4F6]">
          {it && canThumb(it) && p?.state === "ready" ? (
            <img src={p.url} alt={it.file_name ?? "Uploaded file"} className="max-h-[65vh] w-auto object-contain" />
          ) : it && canThumb(it) && (!p || p.state === "loading") ? (
            <p role="status" className="text-sm text-[#55555E]">Loading Preview…</p>
          ) : p?.state === "restricted" ? (
            <p className="text-sm text-[#55555E]">This original is restricted for your role.</p>
          ) : (
            <p className="px-6 text-center text-sm text-[#55555E]">
              {it && canThumb(it) ? "Preview could not be loaded." : `No inline preview for ${typeLabel(kind, it?.file_name)} files.`}
            </p>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-2">
            {items.length > 1 && (
              <>
                <button type="button" onClick={() => go(-1)} aria-label="Previous file" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#EDEDF0]"><ChevronLeft className="h-4 w-4" /></button>
                <button type="button" onClick={() => go(1)} aria-label="Next file" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#EDEDF0]"><ChevronRight className="h-4 w-4" /></button>
              </>
            )}
          </div>
          {it?.document_id && p?.state !== "restricted" && (
            <button type="button" onClick={() => openOriginal(it.document_id!)} className="inline-flex min-h-[36px] items-center gap-1 rounded-md px-3 text-xs font-medium text-[#1D4ED8] hover:underline">
              <ExternalLink className="h-3.5 w-3.5" /> Open Original
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
